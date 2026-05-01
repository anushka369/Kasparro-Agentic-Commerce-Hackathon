/**
 * InterventionEngine — selects the appropriate RecoveryAction for a FrictionEvent,
 * fetches required data from the Platform_Adapter (via CircuitBreaker), and
 * assembles an InterventionPayload.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5, 5.1, 5.2, 5.3, 6.1, 7.1, 8.1, 9.1, 10.1, 12.2
 */

import type {
  ActionButton,
  FrictionCategory,
  FrictionEvent,
  InterventionContent,
  InterventionPayload,
  Offer,
  PaymentMethod,
  PlatformAdapter,
  ShippingOption,
  SizeGuide,
} from '../types/index.js';
import type { SessionState } from '../session/SessionState.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { MissingFieldsScanner } from '../detector/MissingFieldsScanner.js';
import type { MissingField } from '../detector/MissingFieldsScanner.js';

// Re-export PlatformAdapter so consumers can import it from this module
export type { PlatformAdapter };

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface InterventionEngine {
  /**
   * Process a FrictionEvent and produce an InterventionPayload, or null if no
   * action is appropriate (session limit reached, duplicate category, no
   * recovery data available, or 3-second timeout exceeded).
   */
  resolve(
    event: FrictionEvent,
    session: SessionState,
  ): Promise<InterventionPayload | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of interventions allowed per session (Requirement 3.2). */
const MAX_INTERVENTIONS = 2;

/** Timeout in milliseconds for the entire resolution process (Requirement 12.2). */
const RESOLVE_TIMEOUT_MS = 3_000;

/** Expiry offset in milliseconds added to Date.now() for the payload (Requirement 12.2). */
const EXPIRES_OFFSET_MS = 3_000;

// ---------------------------------------------------------------------------
// UUID helper (mirrors the one in SessionState)
// ---------------------------------------------------------------------------

function generateUUID(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Version 4
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  // Variant 1
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Content builders — one per FrictionCategory
// ---------------------------------------------------------------------------

function buildPriceHesitationContent(
  offers: Offer[],
): InterventionContent {
  if (offers.length > 0) {
    // At least one applicable offer — surface the best one (highest discount)
    const best = offers.reduce((a, b) =>
      b.discountAmount > a.discountAmount ? b : a,
    );

    const actions: ActionButton[] = [];

    if (best.couponCode !== undefined) {
      actions.push({
        label: `Apply ${best.couponCode}`,
        actionType: 'apply_coupon',
        payload: { couponCode: best.couponCode, offerId: best.offerId },
      });
    }

    actions.push({ label: 'No thanks', actionType: 'dismiss' });

    return {
      headline: "Here's a deal for you",
      body: `${best.title} — ${best.description}`,
      actions,
      supplementalData: { offers },
    };
  }

  // No offers — show price comparison / value summary
  return {
    headline: 'Great value in your cart',
    body: "You're getting a competitive price. Here's a quick summary of what makes this a great deal.",
    actions: [
      { label: 'See price breakdown', actionType: 'expand_detail' },
      { label: 'Continue to checkout', actionType: 'dismiss' },
    ],
    supplementalData: { offers: [] },
  };
}

function buildShippingConfusionContent(
  options: ShippingOption[],
): InterventionContent {
  const actions: ActionButton[] = options.map((opt) => ({
    label: `${opt.title} — ${opt.currencyCode} ${opt.price.toFixed(2)}${opt.deliveryEstimate !== undefined ? ` (${opt.deliveryEstimate})` : ''}`,
    actionType: 'select_shipping' as const,
    payload: { handle: opt.handle },
  }));

  actions.push({ label: 'Dismiss', actionType: 'dismiss' });

  return {
    headline: 'Shipping options for your order',
    body: 'Choose the shipping speed that works best for you:',
    actions,
    supplementalData: { shippingOptions: options },
  };
}

function buildDeliveryTimelineContent(
  options: ShippingOption[],
): InterventionContent {
  const actions: ActionButton[] = options.map((opt) => ({
    label: `${opt.title}${opt.deliveryEstimate !== undefined ? ` — ${opt.deliveryEstimate}` : ''}`,
    actionType: 'select_shipping' as const,
    payload: { handle: opt.handle },
  }));

  actions.push({ label: 'Dismiss', actionType: 'dismiss' });

  return {
    headline: 'Estimated delivery for your order',
    body: 'Here are the available delivery options with estimated arrival times:',
    actions,
    supplementalData: { shippingOptions: options },
  };
}

function buildTrustIssueContent(): InterventionContent {
  return {
    headline: 'Shop with confidence',
    body: 'Your order is protected by our secure checkout, easy returns, and verified customer reviews.',
    actions: [
      { label: 'View return policy', actionType: 'expand_detail', payload: { section: 'return_policy' } },
      { label: 'See security details', actionType: 'expand_detail', payload: { section: 'security' } },
      { label: 'Read reviews', actionType: 'expand_detail', payload: { section: 'reviews' } },
      { label: 'Continue to checkout', actionType: 'dismiss' },
    ],
    supplementalData: {
      trustSignals: [
        { type: 'return_policy', label: '30-day hassle-free returns' },
        { type: 'security', label: 'SSL-encrypted checkout' },
        { type: 'reviews', label: 'Verified customer reviews' },
      ],
    },
  };
}

function buildSizeUncertaintyContent(guide: SizeGuide): InterventionContent {
  const availableSizes = Object.values(guide.inventory)
    .filter((v) => v.available)
    .map((v) => ({
      label: v.size,
      variantId: v.variantId,
    }));

  const actions: ActionButton[] = availableSizes.map((s) => ({
    label: s.label,
    actionType: 'select_variant' as const,
    payload: { variantId: s.variantId },
  }));

  actions.push({ label: 'See full size guide', actionType: 'expand_detail', payload: { guideUrl: guide.guideUrl } });
  actions.push({ label: 'Dismiss', actionType: 'dismiss' });

  return {
    headline: `Find your size — ${guide.productTitle}`,
    body: 'Select your size below. In-stock sizes are shown.',
    actions,
    supplementalData: {
      sizeGuide: guide,
      availableSizes,
    },
  };
}

function buildPaymentOptionsContent(
  methods: PaymentMethod[],
): InterventionContent {
  const available = methods.filter((m) => m.available);

  const actions: ActionButton[] = available.map((m) => ({
    label: m.name,
    actionType: 'select_payment' as const,
    payload: { methodId: m.methodId },
  }));

  actions.push({ label: 'Dismiss', actionType: 'dismiss' });

  return {
    headline: 'Payment options available',
    body: 'We accept the following payment methods — choose the one that works for you:',
    actions,
    supplementalData: { paymentMethods: methods },
  };
}

function buildMissingInformationContent(
  missingFields: MissingField[],
): InterventionContent {
  const count = missingFields.length;
  const fieldWord = count === 1 ? 'field needs' : 'fields need';

  return {
    headline: "Let's finish your order",
    body: `${count} required ${fieldWord} attention before you can proceed.`,
    actions: [
      { label: "Show me what's missing", actionType: 'expand_detail', payload: { section: 'missing_fields' } },
      { label: 'Dismiss', actionType: 'dismiss' },
    ],
    supplementalData: { missingFields },
  };
}

function buildCouponConfusionContent(offers: Offer[]): InterventionContent {
  if (offers.length > 0) {
    const actions: ActionButton[] = offers
      .filter((o) => o.couponCode !== undefined)
      .map((o) => ({
        label: `Apply ${o.couponCode!}`,
        actionType: 'apply_coupon' as const,
        payload: { couponCode: o.couponCode, offerId: o.offerId },
      }));

    actions.push({ label: 'Dismiss', actionType: 'dismiss' });

    return {
      headline: 'Having trouble with a coupon?',
      body: 'Here are the available discount codes for your cart:',
      actions,
      supplementalData: { offers },
    };
  }

  return {
    headline: 'No active coupon codes',
    body: 'There are no coupon codes available for your current cart. You can continue to checkout at the regular price.',
    actions: [{ label: 'Continue to checkout', actionType: 'dismiss' }],
    supplementalData: { offers: [] },
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of the InterventionEngine interface.
 *
 * Usage:
 *   const engine = new InterventionEngineImpl(platformAdapter, circuitBreaker);
 *   const payload = await engine.resolve(frictionEvent, session);
 */
export class InterventionEngineImpl implements InterventionEngine {
  private readonly adapter: PlatformAdapter;
  private readonly breaker: CircuitBreaker;

  constructor(adapter: PlatformAdapter, breaker: CircuitBreaker) {
    this.adapter = adapter;
    this.breaker = breaker;
  }

  // ---------------------------------------------------------------------------
  // InterventionEngine interface
  // ---------------------------------------------------------------------------

  /**
   * Resolve a FrictionEvent into an InterventionPayload.
   *
   * Returns null when:
   * - The session already has 2 interventions (Requirement 3.2).
   * - The session already has an intervention for this category (Requirement 3.3).
   * - The Platform_Adapter returns empty/null data for the category (Requirement 3.5).
   * - The Platform_Adapter call throws (circuit open or API error) (Requirement 12.2).
   * - The entire resolution exceeds 3 seconds (Requirement 12.2).
   */
  async resolve(
    event: FrictionEvent,
    session: SessionState,
  ): Promise<InterventionPayload | null> {
    // --- Guard: session intervention limits (Requirements 3.2, 3.3) ---
    if (session.interventions.length >= MAX_INTERVENTIONS) {
      return null;
    }

    const categoryAlreadyPresent = session.interventions.some(
      (i) => i.category === event.category,
    );
    if (categoryAlreadyPresent) {
      return null;
    }

    // --- Guard: 3-second AbortController timeout (Requirement 12.2) ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

    try {
      return await this._resolveWithSignal(event, session, controller.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('[InterventionEngine] Resolution timed out for category:', event.category);
      } else {
        console.error('[InterventionEngine] Unexpected error during resolution:', err);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Core resolution logic, executed within the AbortController timeout guard.
   * Throws AbortError if the signal fires before completion.
   */
  private async _resolveWithSignal(
    event: FrictionEvent,
    session: SessionState,
    signal: AbortSignal,
  ): Promise<InterventionPayload | null> {
    if (signal.aborted) return null;

    const category = event.category;
    let content: InterventionContent | null = null;
    let recoveryAction: InterventionPayload['recoveryAction'];

    try {
      switch (category) {
        case 'Price_Hesitation': {
          const offers = await this._callAdapter(
            () => this.adapter.getApplicableOffers(session.cartId),
            signal,
          );
          if (offers === null) return null;
          // An empty offers array is still valid — we show price comparison
          recoveryAction = offers.length > 0 ? 'show_coupon' : 'show_price_comparison';
          content = buildPriceHesitationContent(offers);
          break;
        }

        case 'Shipping_Confusion': {
          const options = await this._callAdapter(
            () =>
              this.adapter.getShippingOptions(
                session.cartId,
                this._extractPostalCode(session),
              ),
            signal,
          );
          if (options === null || options.length === 0) return null;
          // Sort by delivery speed ascending (fewest days first)
          const sorted = this._sortShippingOptions(options);
          recoveryAction = 'show_shipping_options';
          content = buildShippingConfusionContent(sorted);
          break;
        }

        case 'Delivery_Timeline': {
          const options = await this._callAdapter(
            () =>
              this.adapter.getShippingOptions(
                session.cartId,
                this._extractPostalCode(session),
              ),
            signal,
          );
          if (options === null || options.length === 0) return null;
          const sorted = this._sortShippingOptions(options);
          recoveryAction = 'show_delivery_estimate';
          content = buildDeliveryTimelineContent(sorted);
          break;
        }

        case 'Trust_Issue': {
          // Trust signals are static — no adapter call needed.
          // We still check the signal to ensure the abort hasn't fired.
          if (signal.aborted) return null;
          recoveryAction = 'show_trust_signals';
          content = buildTrustIssueContent();
          break;
        }

        case 'Size_Uncertainty': {
          const productId = this._extractProductId(session);
          if (productId === null) return null;
          const guide = await this._callAdapter(
            () => this.adapter.getSizeGuide(productId),
            signal,
          );
          if (guide === null) return null;
          // Require at least one available size
          const hasAvailable = Object.values(guide.inventory).some(
            (v) => v.available,
          );
          if (!hasAvailable) return null;
          recoveryAction = 'show_size_guide';
          content = buildSizeUncertaintyContent(guide);
          break;
        }

        case 'Payment_Options': {
          const methods = await this._callAdapter(
            () => this.adapter.getPaymentMethods(session.cartId),
            signal,
          );
          if (methods === null || methods.length === 0) return null;
          const available = methods.filter((m) => m.available);
          if (available.length === 0) return null;
          recoveryAction = 'show_payment_options';
          content = buildPaymentOptionsContent(methods);
          break;
        }

        case 'Missing_Information': {
          // Scan the checkout form DOM for required fields that are empty or invalid.
          if (signal.aborted) return null;
          const scanner = new MissingFieldsScanner();
          const missingFields = scanner.scan();
          // If no missing fields are found, no intervention is needed.
          if (missingFields.length === 0) return null;
          recoveryAction = 'highlight_missing_fields';
          content = buildMissingInformationContent(missingFields);
          break;
        }

        case 'Coupon_Confusion': {
          const offers = await this._callAdapter(
            () => this.adapter.getApplicableOffers(session.cartId),
            signal,
          );
          if (offers === null) return null;
          recoveryAction = 'show_coupon';
          content = buildCouponConfusionContent(offers);
          break;
        }

        default: {
          // Exhaustiveness guard
          const _exhaustive: never = category;
          console.warn('[InterventionEngine] Unknown category:', _exhaustive);
          return null;
        }
      }
    } catch (err) {
      // Re-throw AbortError so the outer handler can log it correctly
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      // Any other adapter/circuit-breaker error → suppress intervention
      console.error('[InterventionEngine] Adapter call failed:', err);
      return null;
    }

    if (content === null || signal.aborted) return null;

    // --- Assemble InterventionPayload ---
    const payload: InterventionPayload = {
      interventionId: generateUUID(),
      category,
      recoveryAction,
      content,
      expiresAt: Date.now() + EXPIRES_OFFSET_MS,
    };

    return payload;
  }

  /**
   * Wrap a Platform_Adapter call in the CircuitBreaker and honour the
   * AbortSignal. Returns null on any error (circuit open, API error, abort).
   */
  private async _callAdapter<T>(
    fn: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T | null> {
    if (signal.aborted) return null;

    try {
      const result = await this.breaker.call(fn);
      return result;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err; // propagate so the timeout handler can log it
      }
      // Circuit open or adapter error — suppress
      console.warn('[InterventionEngine] Adapter call suppressed by circuit breaker or error:', err);
      return null;
    }
  }

  /**
   * Attempt to extract a postal code from the session's signal snapshot.
   * Falls back to an empty string (the adapter should handle missing postal codes).
   */
  private _extractPostalCode(session: SessionState): string {
    // The postal code is not directly stored on SessionState; it would normally
    // come from the checkout form DOM. We use the most recent friction event's
    // signals as a proxy — if no postal code is available, pass an empty string
    // and let the adapter handle the missing value gracefully.
    const lastEvent = session.frictionEvents[session.frictionEvents.length - 1];
    if (lastEvent === undefined) return '';

    // Look for a field event on a postal-code-like field
    const postalField = lastEvent.signals.fieldEvents.find(
      (fe) =>
        fe.fieldId.toLowerCase().includes('postal') ||
        fe.fieldId.toLowerCase().includes('zip') ||
        fe.fieldId.toLowerCase().includes('postcode'),
    );

    // We only have the fieldId, not the value — return empty string as fallback
    // The adapter is expected to use the checkout's stored address when available
    return postalField !== undefined ? '' : '';
  }

  /**
   * Attempt to extract a product ID from the session's friction events.
   * Returns null if no product ID can be determined.
   */
  private _extractProductId(session: SessionState): string | null {
    // Product ID is not directly on SessionState; it would come from the cart
    // or checkout DOM. We use the cartId as a proxy identifier here — the
    // ShopifyAdapter implementation is expected to resolve the product from
    // the cart context. If the cartId is empty, we cannot proceed.
    if (session.cartId === '') return null;
    return session.cartId;
  }

  /**
   * Sort shipping options by delivery speed ascending (fastest first).
   * Options without delivery day estimates are placed at the end.
   */
  private _sortShippingOptions(options: ShippingOption[]): ShippingOption[] {
    return [...options].sort((a, b) => {
      const aMin = a.minDeliveryDays ?? Number.MAX_SAFE_INTEGER;
      const bMin = b.minDeliveryDays ?? Number.MAX_SAFE_INTEGER;
      return aMin - bMin;
    });
  }
}

export default InterventionEngineImpl;
