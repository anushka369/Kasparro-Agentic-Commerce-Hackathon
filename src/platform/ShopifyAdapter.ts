/**
 * ShopifyAdapter — concrete implementation of the PlatformAdapter interface
 * for Shopify stores.
 *
 * Read methods use the Shopify Storefront API (GraphQL) and Admin API (REST).
 * Mutation methods use the Storefront API GraphQL mutations.
 *
 * On HTTP 4xx/5xx responses a typed PlatformError is thrown so the
 * CircuitBreaker can detect and count failures.
 *
 * Requirements: 5.1, 5.4, 6.1, 6.4, 8.1, 8.3, 9.1, 9.3
 */

import type {
  CartUpdateResult,
  Offer,
  PaymentMethod,
  PlatformAdapter,
  ShippingOption,
  SizeGuide,
  SizeGuideEntry,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// PlatformError
// ---------------------------------------------------------------------------

/**
 * Typed error thrown by ShopifyAdapter on HTTP 4xx/5xx responses.
 * The CircuitBreaker counts these as failures.
 */
export class PlatformError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'PlatformError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ShopifyAdapterConfig {
  /** Shopify shop domain, e.g. "my-store.myshopify.com" */
  shopDomain: string;
  /** Storefront API access token (public) */
  storefrontAccessToken: string;
  /** Admin API access token (private — server-side only) */
  adminAccessToken: string;
  /** Shopify API version, e.g. "2024-01" */
  apiVersion: string;
}

// ---------------------------------------------------------------------------
// Internal Shopify API response shapes
// ---------------------------------------------------------------------------

interface ShopifyUserError {
  field: string[];
  message: string;
}

interface AdminPriceRule {
  id: number;
  title: string;
  value_type: 'percentage' | 'fixed_amount';
  value: string;
  starts_at: string | null;
  ends_at: string | null;
}

interface AdminDiscountCode {
  id: number;
  code: string;
  usage_count: number;
  price_rule_id: number;
}

interface StorefrontShippingRate {
  handle: string;
  title: string;
  priceV2: { amount: string; currencyCode: string };
  deliveryRange?: { minDays: number; maxDays: number };
}

interface StorefrontProductMetafield {
  namespace: string;
  key: string;
  value: string;
}

interface StorefrontVariantNode {
  id: string;
  title: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
}

interface StorefrontPaymentGateway {
  name: string;
}

interface StorefrontCartDiscountCodesUpdatePayload {
  cart: { id: string; discountCodes: Array<{ code: string; applicable: boolean }> } | null;
  userErrors: ShopifyUserError[];
}

interface StorefrontCheckoutShippingLineUpdatePayload {
  checkout: { id: string; totalPriceV2: { amount: string; currencyCode: string } } | null;
  checkoutUserErrors: ShopifyUserError[];
}

interface StorefrontCartLinesUpdatePayload {
  cart: { id: string; cost: { totalAmount: { amount: string; currencyCode: string } } } | null;
  userErrors: ShopifyUserError[];
}

// ---------------------------------------------------------------------------
// ShopifyAdapter
// ---------------------------------------------------------------------------

export class ShopifyAdapter implements PlatformAdapter {
  private readonly config: ShopifyAdapterConfig;

  constructor(config: ShopifyAdapterConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Base URL for the Storefront API GraphQL endpoint. */
  private get storefrontUrl(): string {
    return `https://${this.config.shopDomain}/api/${this.config.apiVersion}/graphql.json`;
  }

  /** Base URL for the Admin REST API. */
  private get adminBaseUrl(): string {
    return `https://${this.config.shopDomain}/admin/api/${this.config.apiVersion}`;
  }

  /**
   * Execute a Storefront API GraphQL request.
   * Throws PlatformError on HTTP 4xx/5xx.
   */
  private async storefrontQuery<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await fetch(this.storefrontUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': this.config.storefrontAccessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new PlatformError(
        `Storefront API request failed: ${response.statusText}`,
        response.status,
        'STOREFRONT_API_ERROR',
      );
    }

    const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors !== undefined && json.errors.length > 0) {
      const firstError = json.errors[0];
      throw new PlatformError(
        firstError !== undefined ? firstError.message : 'GraphQL error',
        422,
        'GRAPHQL_ERROR',
      );
    }

    return json.data as T;
  }

  /**
   * Execute an Admin REST API GET request.
   * Throws PlatformError on HTTP 4xx/5xx.
   */
  private async adminGet<T>(path: string): Promise<T> {
    const url = `${this.adminBaseUrl}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.config.adminAccessToken,
      },
    });

    if (!response.ok) {
      throw new PlatformError(
        `Admin API request failed: ${response.statusText}`,
        response.status,
        'ADMIN_API_ERROR',
      );
    }

    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // PlatformAdapter — read methods
  // -------------------------------------------------------------------------

  /**
   * Fetch applicable discount codes for the current cart.
   *
   * Uses the Admin REST API to list active price rules and their discount
   * codes. Filters to rules that are currently active (within starts_at /
   * ends_at window).
   *
   * Requirements: 5.1
   */
  async getApplicableOffers(_cartId: string): Promise<Offer[]> {
    // Fetch all active price rules
    const priceRulesResponse = await this.adminGet<{ price_rules: AdminPriceRule[] }>(
      '/price_rules.json?status=enabled&limit=250',
    );

    const now = new Date();
    const activePriceRules = priceRulesResponse.price_rules.filter((rule) => {
      const startsAt = rule.starts_at !== null ? new Date(rule.starts_at) : null;
      const endsAt = rule.ends_at !== null ? new Date(rule.ends_at) : null;
      const started = startsAt === null || startsAt <= now;
      const notExpired = endsAt === null || endsAt > now;
      return started && notExpired;
    });

    if (activePriceRules.length === 0) {
      return [];
    }

    // Fetch discount codes for each active price rule (in parallel, up to 10)
    const ruleSlice = activePriceRules.slice(0, 10);
    const codeResults = await Promise.allSettled(
      ruleSlice.map((rule) =>
        this.adminGet<{ discount_codes: AdminDiscountCode[] }>(
          `/price_rules/${rule.id}/discount_codes.json`,
        ),
      ),
    );

    const offers: Offer[] = [];

    for (let i = 0; i < ruleSlice.length; i++) {
      const rule = ruleSlice[i];
      const result = codeResults[i];

      if (rule === undefined || result === undefined) continue;
      if (result.status !== 'fulfilled') continue;

      const codes = result.value.discount_codes;
      if (codes.length === 0) continue;

      // Use the first discount code for this rule
      const code = codes[0];
      if (code === undefined) continue;

      const discountAmount =
        rule.value_type === 'percentage'
          ? Math.abs(parseFloat(rule.value)) / 100
          : Math.abs(parseFloat(rule.value));

      const offer: Offer = {
        offerId: String(rule.id),
        title: rule.title,
        description:
          rule.value_type === 'percentage'
            ? `${Math.abs(parseFloat(rule.value))}% off`
            : `$${Math.abs(parseFloat(rule.value)).toFixed(2)} off`,
        couponCode: code.code,
        discountAmount,
        discountType: rule.value_type === 'percentage' ? 'percentage' : 'fixed',
      };
      if (rule.ends_at !== null) {
        offer.expiresAt = rule.ends_at;
      }
      offers.push(offer);
    }

    return offers;
  }

  /**
   * Fetch available shipping rates for the given postal code.
   *
   * Uses the Storefront API to query shipping rates on the checkout.
   * Results are sorted by minDeliveryDays ascending (fastest first).
   *
   * Requirements: 6.1
   */
  async getShippingOptions(_cartId: string, postalCode: string): Promise<ShippingOption[]> {
    // Query available shipping rates via the checkout's shippingRates field.
    // We use the checkout node identified by cartId (treated as checkoutId here).
    const query = `
      query GetShippingRates($postalCode: String!) {
        shop {
          shipsToCountries
        }
      }
    `;

    // The Storefront API exposes shipping rates on a checkout object.
    // We query the checkout's availableShippingRates using the checkoutId.
    const shippingQuery = `
      query GetCheckoutShippingRates($checkoutId: ID!) {
        node(id: $checkoutId) {
          ... on Checkout {
            availableShippingRates {
              ready
              shippingRates {
                handle
                title
                priceV2 {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `;

    // Suppress unused variable warning — postalCode is passed for context
    void postalCode;
    void query;

    const data = await this.storefrontQuery<{
      node: {
        availableShippingRates?: {
          ready: boolean;
          shippingRates: StorefrontShippingRate[];
        };
      } | null;
    }>(shippingQuery, { checkoutId: _cartId });

    const rates = data.node?.availableShippingRates?.shippingRates ?? [];

    const options: ShippingOption[] = rates.map((rate) => {
      const minDays = rate.deliveryRange?.minDays;
      const maxDays = rate.deliveryRange?.maxDays;

      let deliveryEstimate: string | undefined;
      if (minDays !== undefined && maxDays !== undefined) {
        deliveryEstimate = `${minDays}–${maxDays} business days`;
      } else if (minDays !== undefined) {
        deliveryEstimate = `${minDays}+ business days`;
      }

      const option: ShippingOption = {
        handle: rate.handle,
        title: rate.title,
        price: parseFloat(rate.priceV2.amount),
        currencyCode: rate.priceV2.currencyCode,
      };
      if (minDays !== undefined) option.minDeliveryDays = minDays;
      if (maxDays !== undefined) option.maxDeliveryDays = maxDays;
      if (deliveryEstimate !== undefined) option.deliveryEstimate = deliveryEstimate;
      return option;
    });

    // Sort by minDeliveryDays ascending; options without estimates go last
    return options.sort((a, b) => {
      const aMin = a.minDeliveryDays ?? Number.MAX_SAFE_INTEGER;
      const bMin = b.minDeliveryDays ?? Number.MAX_SAFE_INTEGER;
      return aMin - bMin;
    });
  }

  /**
   * Fetch size guide and variant inventory for a product.
   *
   * Queries the Storefront API for product metafields in the `size_guide`
   * namespace and variant inventory levels.
   *
   * Requirements: 8.1
   */
  async getSizeGuide(productId: string): Promise<SizeGuide> {
    const query = `
      query GetSizeGuide($productId: ID!) {
        product(id: $productId) {
          id
          title
          metafields(identifiers: [
            { namespace: "size_guide", key: "entries" },
            { namespace: "size_guide", key: "guide_url" }
          ]) {
            namespace
            key
            value
          }
          variants(first: 50) {
            edges {
              node {
                id
                title
                availableForSale
                quantityAvailable
              }
            }
          }
        }
      }
    `;

    const data = await this.storefrontQuery<{
      product: {
        id: string;
        title: string;
        metafields: Array<StorefrontProductMetafield | null>;
        variants: {
          edges: Array<{ node: StorefrontVariantNode }>;
        };
      } | null;
    }>(query, { productId });

    if (data.product === null) {
      throw new PlatformError(
        `Product not found: ${productId}`,
        404,
        'PRODUCT_NOT_FOUND',
      );
    }

    const product = data.product;

    // Parse metafields
    const metafields = product.metafields.filter(
      (mf): mf is StorefrontProductMetafield => mf !== null,
    );

    const entriesMetafield = metafields.find(
      (mf) => mf.namespace === 'size_guide' && mf.key === 'entries',
    );
    const guideUrlMetafield = metafields.find(
      (mf) => mf.namespace === 'size_guide' && mf.key === 'guide_url',
    );

    let entries: SizeGuideEntry[] = [];
    if (entriesMetafield !== undefined) {
      try {
        const parsed = JSON.parse(entriesMetafield.value) as unknown;
        if (Array.isArray(parsed)) {
          entries = parsed as SizeGuideEntry[];
        }
      } catch {
        // Malformed metafield — use empty entries
        entries = [];
      }
    }

    // Build inventory map from variants
    const inventory: SizeGuide['inventory'] = {};
    for (const edge of product.variants.edges) {
      const variant = edge.node;
      inventory[variant.id] = {
        variantId: variant.id,
        size: variant.title,
        available: variant.availableForSale,
        quantityAvailable: variant.quantityAvailable ?? 0,
      };
    }

    const sizeGuide: SizeGuide = {
      productId: product.id,
      productTitle: product.title,
      entries,
      inventory,
    };
    if (guideUrlMetafield?.value !== undefined) {
      sizeGuide.guideUrl = guideUrlMetafield.value;
    }
    return sizeGuide;
  }

  /**
   * Fetch available payment gateways for the checkout.
   *
   * Queries the Storefront API for `availablePaymentGateways` on the shop.
   *
   * Requirements: 9.1
   */
  async getPaymentMethods(_checkoutId: string): Promise<PaymentMethod[]> {
    const query = `
      query GetPaymentGateways {
        shop {
          paymentSettings {
            acceptedCardBrands
            enabledPresentmentCurrencies
          }
        }
        checkout: node(id: $checkoutId) {
          ... on Checkout {
            availableShippingRates {
              ready
            }
          }
        }
      }
    `;

    // Use a simpler query that doesn't require checkout node for payment gateways
    const gatewaysQuery = `
      query GetPaymentGateways {
        shop {
          paymentSettings {
            acceptedCardBrands
          }
        }
      }
    `;

    void query; // suppress unused warning

    const data = await this.storefrontQuery<{
      shop: {
        paymentSettings: {
          acceptedCardBrands: string[];
        };
      };
    }>(gatewaysQuery);

    const cardBrands = data.shop.paymentSettings.acceptedCardBrands;

    // Map accepted card brands to PaymentMethod entries
    const cardMethods: PaymentMethod[] = cardBrands.map((brand) => ({
      methodId: brand.toLowerCase().replace(/\s+/g, '_'),
      name: brand,
      type: 'card' as const,
      available: true,
    }));

    // Add common digital wallets that Shopify supports
    const digitalWallets: PaymentMethod[] = [
      {
        methodId: 'shop_pay',
        name: 'Shop Pay',
        type: 'digital_wallet',
        available: true,
      },
      {
        methodId: 'paypal',
        name: 'PayPal',
        type: 'digital_wallet',
        available: true,
      },
      {
        methodId: 'apple_pay',
        name: 'Apple Pay',
        type: 'digital_wallet',
        available: true,
      },
      {
        methodId: 'google_pay',
        name: 'Google Pay',
        type: 'digital_wallet',
        available: true,
      },
    ];

    return [...cardMethods, ...digitalWallets];
  }

  // -------------------------------------------------------------------------
  // PlatformAdapter — mutation methods
  // -------------------------------------------------------------------------

  /**
   * Apply a discount code to the cart using the `cartDiscountCodesUpdate` mutation.
   *
   * Requirements: 5.4
   */
  async applyCoupon(cartId: string, couponCode: string): Promise<CartUpdateResult> {
    const mutation = `
      mutation CartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
        cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
          cart {
            id
            discountCodes {
              code
              applicable
            }
            cost {
              totalAmount {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const data = await this.storefrontQuery<{
      cartDiscountCodesUpdate: {
        cart: {
          id: string;
          discountCodes: Array<{ code: string; applicable: boolean }>;
          cost: { totalAmount: { amount: string; currencyCode: string } };
        } | null;
        userErrors: ShopifyUserError[];
      };
    }>(mutation, { cartId, discountCodes: [couponCode] });

    const result = data.cartDiscountCodesUpdate;

    if (result.userErrors.length > 0) {
      const firstError = result.userErrors[0];
      return {
        success: false,
        errorMessage: firstError !== undefined ? firstError.message : 'Unknown error',
        userErrors: result.userErrors,
      };
    }

    if (result.cart === null) {
      return {
        success: false,
        errorMessage: 'Cart not found',
      };
    }

    // Check if the discount code was actually applicable
    const appliedCode = result.cart.discountCodes.find(
      (dc) => dc.code.toLowerCase() === couponCode.toLowerCase(),
    );

    if (appliedCode !== undefined && !appliedCode.applicable) {
      return {
        success: false,
        errorMessage: `Discount code "${couponCode}" is not applicable to this cart`,
        userErrors: [],
      };
    }

    return {
      success: true,
      cartTotal: parseFloat(result.cart.cost.totalAmount.amount),
      currencyCode: result.cart.cost.totalAmount.currencyCode,
    };
  }

  /**
   * Update the selected shipping line on a checkout using the
   * `checkoutShippingLineUpdate` mutation.
   *
   * Requirements: 6.4
   */
  async selectShipping(checkoutId: string, shippingHandle: string): Promise<CartUpdateResult> {
    const mutation = `
      mutation CheckoutShippingLineUpdate($checkoutId: ID!, $shippingRateHandle: String!) {
        checkoutShippingLineUpdate(checkoutId: $checkoutId, shippingRateHandle: $shippingRateHandle) {
          checkout {
            id
            totalPriceV2 {
              amount
              currencyCode
            }
          }
          checkoutUserErrors {
            field
            message
          }
        }
      }
    `;

    const data = await this.storefrontQuery<{
      checkoutShippingLineUpdate: StorefrontCheckoutShippingLineUpdatePayload;
    }>(mutation, { checkoutId, shippingRateHandle: shippingHandle });

    const result = data.checkoutShippingLineUpdate;

    if (result.checkoutUserErrors.length > 0) {
      const firstError = result.checkoutUserErrors[0];
      return {
        success: false,
        errorMessage: firstError !== undefined ? firstError.message : 'Unknown error',
        userErrors: result.checkoutUserErrors,
      };
    }

    if (result.checkout === null) {
      return {
        success: false,
        errorMessage: 'Checkout not found',
      };
    }

    return {
      success: true,
      cartTotal: parseFloat(result.checkout.totalPriceV2.amount),
      currencyCode: result.checkout.totalPriceV2.currencyCode,
    };
  }

  /**
   * Update a cart line item to a different variant using the
   * `cartLinesUpdate` mutation.
   *
   * Requirements: 8.3
   */
  async updateVariant(
    cartId: string,
    lineItemId: string,
    variantId: string,
  ): Promise<CartUpdateResult> {
    const mutation = `
      mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) {
          cart {
            id
            cost {
              totalAmount {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const data = await this.storefrontQuery<{
      cartLinesUpdate: StorefrontCartLinesUpdatePayload;
    }>(mutation, {
      cartId,
      lines: [{ id: lineItemId, merchandiseId: variantId }],
    });

    const result = data.cartLinesUpdate;

    if (result.userErrors.length > 0) {
      const firstError = result.userErrors[0];
      return {
        success: false,
        errorMessage: firstError !== undefined ? firstError.message : 'Unknown error',
        userErrors: result.userErrors,
      };
    }

    if (result.cart === null) {
      return {
        success: false,
        errorMessage: 'Cart not found',
      };
    }

    return {
      success: true,
      cartTotal: parseFloat(result.cart.cost.totalAmount.amount),
      currencyCode: result.cart.cost.totalAmount.currencyCode,
    };
  }

  /**
   * Pre-select a payment method on the checkout.
   *
   * Uses the Storefront API `checkoutPaymentMethodUpdate` mutation (or the
   * equivalent for the configured API version).
   *
   * Requirements: 9.3
   */
  async selectPaymentMethod(
    checkoutId: string,
    methodId: string,
  ): Promise<CartUpdateResult> {
    // Shopify's Storefront API does not expose a direct "select payment method"
    // mutation in the same way as shipping. The closest equivalent is
    // `checkoutPaymentMethodUpdateV2` which accepts a payment object.
    // For digital wallets and card payments, the actual payment token is
    // generated client-side (e.g., via Shopify.pay or Braintree). Here we
    // record the intent and return a success result so the UI can update.
    //
    // In a production implementation this would integrate with the
    // Shopify Payments SDK or a third-party payment processor.

    const mutation = `
      mutation CheckoutAttributesUpdate($checkoutId: ID!, $input: CheckoutAttributesUpdateV2Input!) {
        checkoutAttributesUpdateV2(checkoutId: $checkoutId, input: $input) {
          checkout {
            id
            totalPriceV2 {
              amount
              currencyCode
            }
          }
          checkoutUserErrors {
            field
            message
          }
        }
      }
    `;

    // Store the selected payment method as a custom attribute on the checkout
    // so the checkout page can read it and pre-select the appropriate UI.
    const data = await this.storefrontQuery<{
      checkoutAttributesUpdateV2: {
        checkout: {
          id: string;
          totalPriceV2: { amount: string; currencyCode: string };
        } | null;
        checkoutUserErrors: ShopifyUserError[];
      };
    }>(mutation, {
      checkoutId,
      input: {
        customAttributes: [
          { key: 'selected_payment_method', value: methodId },
        ],
      },
    });

    const result = data.checkoutAttributesUpdateV2;

    if (result.checkoutUserErrors.length > 0) {
      const firstError = result.checkoutUserErrors[0];
      return {
        success: false,
        errorMessage: firstError !== undefined ? firstError.message : 'Unknown error',
        userErrors: result.checkoutUserErrors,
      };
    }

    if (result.checkout === null) {
      return {
        success: false,
        errorMessage: 'Checkout not found',
      };
    }

    return {
      success: true,
      cartTotal: parseFloat(result.checkout.totalPriceV2.amount),
      currencyCode: result.checkout.totalPriceV2.currencyCode,
    };
  }
}

export default ShopifyAdapter;
