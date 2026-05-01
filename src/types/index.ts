/**
 * Shared type definitions for the AI-Assisted Checkout Recovery system.
 *
 * All interfaces and enums used across Friction_Detector, Intervention_Engine,
 * Conversation_Manager, Platform_Adapter, and Analytics_Service are exported here.
 */

// ---------------------------------------------------------------------------
// Friction classification
// ---------------------------------------------------------------------------

/**
 * The eight recognised causes of checkout abandonment.
 * Exactly one category is assigned per FrictionEvent.
 */
export type FrictionCategory =
  | 'Price_Hesitation'
  | 'Shipping_Confusion'
  | 'Trust_Issue'
  | 'Missing_Information'
  | 'Coupon_Confusion'
  | 'Size_Uncertainty'
  | 'Delivery_Timeline'
  | 'Payment_Options';

/** Ordered list of all friction categories — useful for iteration. */
export const ALL_FRICTION_CATEGORIES: readonly FrictionCategory[] = [
  'Price_Hesitation',
  'Shipping_Confusion',
  'Trust_Issue',
  'Missing_Information',
  'Coupon_Confusion',
  'Size_Uncertainty',
  'Delivery_Timeline',
  'Payment_Options',
] as const;

// ---------------------------------------------------------------------------
// Signal collection
// ---------------------------------------------------------------------------

/** The checkout step the user is currently on. */
export type CheckoutStep =
  | 'cart'
  | 'information'
  | 'shipping'
  | 'payment'
  | 'review';

/** A single DOM field interaction recorded by the signal collector. */
export interface FieldEvent {
  /** The `id` attribute of the form field — never the field value. */
  fieldId: string;
  eventType: 'focus' | 'blur' | 'change' | 'error';
  /** Duration between focus and blur in milliseconds. */
  durationMs?: number;
  /** Validation error message associated with the field, if any. */
  errorMessage?: string;
}

/**
 * A point-in-time snapshot of all collected behavioral signals.
 * Produced on demand by SignalCollector.getSnapshot().
 */
export interface SignalSnapshot {
  /** Milliseconds elapsed since the page loaded. */
  timeOnPageMs: number;
  /** Percentage of the page scrolled (0–100). */
  scrollDepthPct: number;
  /** Average cursor velocity in px/ms over the last sampling window. */
  cursorVelocityAvg: number;
  /** True if the cursor has moved within exitIntentMarginPx of the viewport top. */
  exitIntentDetected: boolean;
  /** True if the user has been idle for more than idleTimeoutMs. */
  idleDetected: boolean;
  /** All field interaction events recorded in this session. */
  fieldEvents: FieldEvent[];
  /** True if the user attempted to navigate back. */
  backNavigationAttempted: boolean;
  /** The checkout step the user is currently on. */
  checkoutStep: CheckoutStep;
}

// ---------------------------------------------------------------------------
// Detector configuration and events
// ---------------------------------------------------------------------------

/** Configuration passed to FrictionDetector.start(). */
export interface DetectorConfig {
  /** Minimum confidence score required to trigger an intervention. Default: 0.60 */
  confidenceThreshold: number;
  /** Milliseconds of inactivity before idleDetected is set. Default: 30_000 */
  idleTimeoutMs: number;
  /** Pixels from the top of the viewport that trigger exit-intent. Default: 20 */
  exitIntentMarginPx: number;
  /** Maximum milliseconds allowed for classification before suppression. Default: 2_000 */
  classificationTimeoutMs: number;
}

/**
 * A classified friction event emitted by the Friction_Detector when
 * confidence reaches the configured threshold.
 */
export interface FrictionEvent {
  /** The session this event belongs to. */
  sessionId: string;
  /** The primary friction category identified. */
  category: FrictionCategory;
  /** Confidence score in [0.0, 1.0]. */
  confidence: number;
  /** The signal snapshot that triggered this classification. */
  signals: SignalSnapshot;
  /** Unix timestamp (ms) when the event was detected. */
  detectedAt: number;
}

// ---------------------------------------------------------------------------
// Intervention engine
// ---------------------------------------------------------------------------

/** The recovery strategy mapped to each FrictionCategory. */
export type RecoveryActionType =
  | 'show_coupon'
  | 'show_price_comparison'
  | 'show_shipping_options'
  | 'show_trust_signals'
  | 'show_size_guide'
  | 'show_payment_options'
  | 'highlight_missing_fields'
  | 'show_delivery_estimate';

/** A single actionable button rendered inside the intervention widget. */
export interface ActionButton {
  /** Human-readable label shown on the button. */
  label: string;
  /** The semantic action this button performs. */
  actionType:
    | 'apply_coupon'
    | 'select_shipping'
    | 'select_variant'
    | 'select_payment'
    | 'dismiss'
    | 'expand_detail';
  /** Optional data payload forwarded to the action handler. */
  payload?: unknown;
}

/** The displayable content of an intervention. */
export interface InterventionContent {
  /** Short headline shown at the top of the widget. */
  headline: string;
  /** Body copy providing context or a question. */
  body: string;
  /** Selectable action buttons. */
  actions: ActionButton[];
  /**
   * Category-specific supplemental data (e.g., coupon codes, shipping options).
   * Typed as a generic record; consumers should narrow via the recoveryAction field.
   */
  supplementalData?: Record<string, unknown>;
}

/**
 * The full payload handed from Intervention_Engine to Conversation_Manager.
 */
export interface InterventionPayload {
  /** UUID v4 uniquely identifying this intervention instance. */
  interventionId: string;
  /** The friction category this intervention addresses. */
  category: FrictionCategory;
  /** The recovery strategy being applied. */
  recoveryAction: RecoveryActionType;
  /** Displayable content for the widget. */
  content: InterventionContent;
  /** Unix timestamp (ms) after which the intervention should auto-dismiss. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Conversation manager
// ---------------------------------------------------------------------------

/** Reason an active intervention was closed. */
export type DismissReason =
  | 'user_dismissed'
  | 'step_completed'
  | 'timeout'
  | 'engine_error';

/** A user interaction event emitted by the Conversation_Manager. */
export interface UserAction {
  /** The intervention this action belongs to. */
  interventionId: string;
  /** The button the user clicked. */
  actionType: ActionButton['actionType'];
  /** Optional payload from the button definition. */
  payload?: unknown;
  /** Unix timestamp (ms) when the action occurred. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Session state (in-memory, client-side)
// ---------------------------------------------------------------------------

/** Outcome record for a single intervention within a session. */
export interface InterventionRecord {
  interventionId: string;
  category: FrictionCategory;
  /** Unix timestamp (ms) when the intervention was shown. */
  triggeredAt: number;
  outcome: 'accepted' | 'dismissed' | 'timed_out' | 'pending';
  /** Unix timestamp (ms) when the outcome was recorded. */
  resolvedAt?: number;
}

/** In-memory state for a single checkout session. */
export interface SessionState {
  /** UUID v4 generated on page load. */
  sessionId: string;
  /** Unix timestamp (ms) when the session started. */
  startedAt: number;
  /** The checkout step the user is currently on. */
  checkoutStep: CheckoutStep;
  /** The Shopify cart GID. */
  cartId: string;
  /** All friction events detected in this session. */
  frictionEvents: FrictionEvent[];
  /** All interventions triggered in this session. */
  interventions: InterventionRecord[];
  /** Whether the session ended in a completed order. */
  converted: boolean;
  /** Unix timestamp (ms) when the session ended, if it has ended. */
  endedAt?: number;
}

// ---------------------------------------------------------------------------
// Session record (persisted, server-side)
// ---------------------------------------------------------------------------

/**
 * The serialised form of a session sent to the Analytics_Service.
 * Timestamps are ISO 8601 strings for JSON serialisation.
 */
export interface SessionRecord {
  sessionId: string;
  /** Shopify shop domain (e.g., "my-store.myshopify.com"). */
  platformId: string;
  startedAt: string;
  endedAt: string;
  checkoutStepReached: CheckoutStep;
  frictionEvents: Array<{
    category: FrictionCategory;
    confidence: number;
    detectedAt: string;
  }>;
  interventions: Array<{
    interventionId: string;
    category: FrictionCategory;
    recoveryAction: RecoveryActionType;
    triggeredAt: string;
    outcome: 'accepted' | 'dismissed' | 'timed_out';
  }>;
  converted: boolean;
}

// ---------------------------------------------------------------------------
// Analytics service
// ---------------------------------------------------------------------------

/** Query parameters for the metrics endpoint. */
export interface MetricsQuery {
  /** ISO 8601 date string (inclusive start). */
  startDate: string;
  /** ISO 8601 date string (inclusive end). */
  endDate: string;
  /** Optional filter to a single friction category. */
  frictionCategory?: FrictionCategory;
}

/** Aggregated metrics returned by the analytics endpoint. */
export interface MetricsResult {
  /** Percentage of sessions that ended in a conversion. */
  conversionRate: number;
  /** Historical baseline conversion rate without the system active. */
  baselineConversionRate: number;
  /** conversionRate − baselineConversionRate, in percentage points. */
  deltaPercentagePoints: number;
  /** Percentage of interventions that were accepted by the user. */
  interventionAcceptanceRate: number;
  /** Per-category recovery rate (accepted interventions / total for that category). */
  perCategoryRecoveryRate: Record<FrictionCategory, number>;
  totalSessions: number;
  totalInterventions: number;
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/** Runtime state of the circuit breaker wrapping Platform_Adapter calls. */
export interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  /** Number of consecutive failures in the current window. */
  failureCount: number;
  /** Unix timestamp (ms) of the most recent failure. */
  lastFailureAt: number;
  /** Unix timestamp (ms) after which a probe call is allowed. */
  nextRetryAt: number;
}

// ---------------------------------------------------------------------------
// Platform adapter types
// ---------------------------------------------------------------------------

/** A promotional offer or discount applicable to the current cart. */
export interface Offer {
  /** Unique identifier for the offer (e.g., discount code or GID). */
  offerId: string;
  /** Human-readable title shown to the user. */
  title: string;
  /** Short description of the offer. */
  description: string;
  /** The coupon code to apply, if applicable. */
  couponCode?: string;
  /** Discount amount as a decimal (e.g., 0.10 = 10%). */
  discountAmount: number;
  /** Whether the discount is a percentage or a fixed amount. */
  discountType: 'percentage' | 'fixed';
  /** ISO 8601 expiry date, if the offer has one. */
  expiresAt?: string;
}

/** A shipping option available for the current cart and postal code. */
export interface ShippingOption {
  /** Shopify shipping rate handle. */
  handle: string;
  /** Carrier and service name (e.g., "Standard Shipping"). */
  title: string;
  /** Price in the store's currency. */
  price: number;
  /** ISO 4217 currency code (e.g., "USD"). */
  currencyCode: string;
  /** Estimated minimum delivery days. */
  minDeliveryDays?: number;
  /** Estimated maximum delivery days. */
  maxDeliveryDays?: number;
  /** Human-readable delivery estimate (e.g., "3–5 business days"). */
  deliveryEstimate?: string;
}

/** A size entry within a product's size guide. */
export interface SizeGuideEntry {
  /** Size label (e.g., "S", "M", "L", "XL", "32", "34"). */
  label: string;
  /** Chest measurement in cm, if applicable. */
  chestCm?: number;
  /** Waist measurement in cm, if applicable. */
  waistCm?: number;
  /** Hip measurement in cm, if applicable. */
  hipCm?: number;
  /** Height range in cm, if applicable. */
  heightCm?: string;
}

/** Size guide and inventory data for a product. */
export interface SizeGuide {
  productId: string;
  productTitle: string;
  /** Ordered list of size entries. */
  entries: SizeGuideEntry[];
  /** Variant inventory keyed by variant ID. */
  inventory: Record<string, { variantId: string; size: string; available: boolean; quantityAvailable: number }>;
  /** URL to the full size guide page, if available. */
  guideUrl?: string;
}

/** A payment method available for the current checkout. */
export interface PaymentMethod {
  /** Unique identifier for the payment method. */
  methodId: string;
  /** Display name (e.g., "Visa", "PayPal", "Shop Pay"). */
  name: string;
  /** Payment method category. */
  type: 'card' | 'digital_wallet' | 'buy_now_pay_later' | 'bank_transfer' | 'other';
  /** URL to the payment method's logo image. */
  logoUrl?: string;
  /** Whether this method is currently available for the order total. */
  available: boolean;
}

// ---------------------------------------------------------------------------
// Platform adapter interface
// ---------------------------------------------------------------------------

/**
 * Abstracts all Shopify API calls. Swappable for other platforms without
 * changing core logic.
 */
export interface PlatformAdapter {
  /** Fetch applicable coupons/promotions for the current cart. */
  getApplicableOffers(cartId: string): Promise<Offer[]>;

  /** Fetch shipping options for a given postal code. */
  getShippingOptions(cartId: string, postalCode: string): Promise<ShippingOption[]>;

  /** Fetch size guide and inventory for a product variant. */
  getSizeGuide(productId: string): Promise<SizeGuide>;

  /** Fetch accepted payment methods for the current checkout. */
  getPaymentMethods(checkoutId: string): Promise<PaymentMethod[]>;

  /** Apply a coupon code to the cart. */
  applyCoupon(cartId: string, couponCode: string): Promise<CartUpdateResult>;

  /** Update the selected shipping option. */
  selectShipping(checkoutId: string, shippingHandle: string): Promise<CartUpdateResult>;

  /** Update a cart line item to a different variant. */
  updateVariant(cartId: string, lineItemId: string, variantId: string): Promise<CartUpdateResult>;

  /** Pre-select a payment method. */
  selectPaymentMethod(checkoutId: string, methodId: string): Promise<CartUpdateResult>;
}

/** Result returned by all cart mutation methods on the Platform_Adapter. */
export interface CartUpdateResult {
  /** Whether the mutation succeeded. */
  success: boolean;
  /** Updated cart total in the store's currency. */
  cartTotal?: number;
  /** ISO 4217 currency code. */
  currencyCode?: string;
  /** Human-readable error message if success is false. */
  errorMessage?: string;
  /** The raw Shopify userErrors array, if any. */
  userErrors?: Array<{ field: string[]; message: string }>;
}
