/**
 * Bundle entry point for the AI-Assisted Checkout Recovery system.
 *
 * On DOMContentLoaded:
 *   1. Reads configuration from global variables injected by the Script Tag host.
 *   2. Instantiates all components.
 *   3. Wires the data-flow pipeline:
 *        FrictionDetector → InterventionEngine → ConversationManager
 *        ConversationManager.onAction → ShopifyAdapter mutations → SessionState
 *        Checkout step events → ConversationManager.dismiss('step_completed')
 *        beforeunload / order confirmation → SessionState.end() → AnalyticsClient.flush()
 *   4. Wraps the entire initialisation in try/catch so any failure is silent
 *      and never blocks checkout progress.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

import { SessionState } from './session/SessionState.js';
import { FrictionDetectorImpl } from './detector/FrictionDetector.js';
import { InterventionEngineImpl } from './engine/InterventionEngine.js';
import { CircuitBreaker } from './engine/CircuitBreaker.js';
import { ConversationManagerImpl } from './ui/ConversationManager.js';
import { AnalyticsClient } from './analytics/AnalyticsClient.js';
import { ShopifyAdapter } from './platform/ShopifyAdapter.js';

import type { DetectorConfig, UserAction } from './types/index.js';

// ---------------------------------------------------------------------------
// Global configuration injected by the Script Tag host page
// ---------------------------------------------------------------------------

/**
 * Shape of the global `window.CheckoutRecoveryConfig` object that the
 * merchant's Script Tag is expected to set before this bundle loads.
 *
 * All fields are optional so the bundle degrades gracefully when config
 * is missing or partially set.
 */
interface CheckoutRecoveryConfig {
  /** Shopify shop domain, e.g. "my-store.myshopify.com" */
  shopDomain?: string;
  /** Storefront API public access token */
  storefrontAccessToken?: string;
  /** Admin API access token (server-side only; omit in client bundles) */
  adminAccessToken?: string;
  /** Shopify API version, e.g. "2024-01" */
  apiVersion?: string;
  /** Analytics Service base URL */
  analyticsServiceUrl?: string;
  /** Shopify cart GID for the current session */
  cartId?: string;
  /** Override the confidence threshold (default: 0.60) */
  confidenceThreshold?: number;
  /** Override the idle timeout in ms (default: 30_000) */
  idleTimeoutMs?: number;
}

/**
 * Read the merchant-supplied configuration from the global scope.
 * Returns an empty object if the global is not set.
 */
function readConfig(): CheckoutRecoveryConfig {
  try {
    const g = globalThis as Record<string, unknown>;
    if (typeof g['CheckoutRecoveryConfig'] === 'object' && g['CheckoutRecoveryConfig'] !== null) {
      return g['CheckoutRecoveryConfig'] as CheckoutRecoveryConfig;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Attempt to read the Shopify cart GID from the page.
 * Tries the config object first, then common Shopify globals.
 */
function resolveCartId(config: CheckoutRecoveryConfig): string {
  if (config.cartId !== undefined && config.cartId !== '') {
    return config.cartId;
  }

  try {
    const g = globalThis as Record<string, unknown>;

    // Shopify injects `Shopify.checkout.token` on checkout pages
    const shopify = g['Shopify'] as Record<string, unknown> | undefined;
    if (shopify !== undefined) {
      const checkout = shopify['checkout'] as Record<string, unknown> | undefined;
      if (checkout !== undefined) {
        const token = checkout['token'];
        if (typeof token === 'string' && token !== '') {
          return token;
        }
      }
    }

    // Cart pages expose `window.__st.cid` (cart token)
    const st = g['__st'] as Record<string, unknown> | undefined;
    if (st !== undefined) {
      const cid = st['cid'];
      if (typeof cid === 'string' && cid !== '') {
        return cid;
      }
    }
  } catch {
    // ignore
  }

  return '';
}

/**
 * Detect the current checkout step from the URL or DOM.
 * Mirrors the logic in SignalCollector so we can initialise SessionState
 * with the correct step before the collector starts.
 */
function resolveCheckoutStep(): import('./types/index.js').CheckoutStep {
  try {
    const form = document.querySelector<HTMLElement>('[data-checkout-step]');
    if (form !== null) {
      const attr = form.dataset['checkoutStep'];
      const steps = ['cart', 'information', 'shipping', 'payment', 'review'] as const;
      if (attr !== undefined && (steps as readonly string[]).includes(attr)) {
        return attr as import('./types/index.js').CheckoutStep;
      }
    }

    const path = window.location.pathname.toLowerCase();
    if (path.includes('/payment')) return 'payment';
    if (path.includes('/shipping')) return 'shipping';
    if (path.includes('/information')) return 'information';
    if (path.includes('/review')) return 'review';
    if (path.includes('/cart')) return 'cart';
  } catch {
    // ignore
  }
  return 'cart';
}

// ---------------------------------------------------------------------------
// Main initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise the checkout recovery system.
 * Called once on DOMContentLoaded.
 * Any uncaught error is caught by the outer try/catch and logged silently.
 */
function init(): void {
  const config = readConfig();

  // --- Session ---
  const cartId = resolveCartId(config);
  const checkoutStep = resolveCheckoutStep();
  const session = new SessionState(cartId, checkoutStep);

  // --- Shopify Adapter ---
  const shopifyAdapter = new ShopifyAdapter({
    shopDomain: config.shopDomain ?? '',
    storefrontAccessToken: config.storefrontAccessToken ?? '',
    adminAccessToken: config.adminAccessToken ?? '',
    apiVersion: config.apiVersion ?? '2024-01',
  });

  // --- Circuit Breaker + Intervention Engine ---
  const circuitBreaker = new CircuitBreaker();
  const interventionEngine = new InterventionEngineImpl(shopifyAdapter, circuitBreaker);

  // --- Conversation Manager ---
  const conversationManager = new ConversationManagerImpl(session);
  conversationManager.mount(document.body);

  // --- Detector config ---
  const detectorConfig: DetectorConfig = {
    confidenceThreshold: config.confidenceThreshold ?? 0.60,
    idleTimeoutMs: config.idleTimeoutMs ?? 30_000,
    exitIntentMarginPx: 20,
    classificationTimeoutMs: 2_000,
  };

  // --- Friction Detector ---
  // SignalCollector is instantiated internally by FrictionDetectorImpl.start().
  const frictionDetector = new FrictionDetectorImpl(session.sessionId);

  // --- Analytics Client ---
  const analyticsClient = new AnalyticsClient({
    analyticsServiceUrl: config.analyticsServiceUrl ?? '/analytics',
    platformId: config.shopDomain ?? '',
  });

  // -------------------------------------------------------------------------
  // Wire 1: FrictionDetector → InterventionEngine → ConversationManager
  // -------------------------------------------------------------------------

  frictionDetector.onFrictionEvent((frictionEvent) => {
    // Record the friction event in session state
    session.addFrictionEvent(frictionEvent);

    // Resolve asynchronously — errors are caught inside resolve()
    void interventionEngine.resolve(frictionEvent, session).then((payload) => {
      if (payload !== null) {
        conversationManager.show(payload);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Wire 2: ConversationManager.onAction → ShopifyAdapter mutations → SessionState
  // -------------------------------------------------------------------------

  conversationManager.onAction((action: UserAction) => {
    void handleUserAction(action, session, shopifyAdapter, conversationManager);
  });

  // -------------------------------------------------------------------------
  // Wire 3: Checkout step completion → ConversationManager.dismiss
  // -------------------------------------------------------------------------

  listenForCheckoutStepCompletion(session, conversationManager);

  // -------------------------------------------------------------------------
  // Wire 4: beforeunload / order confirmation → SessionState.end() → flush
  // -------------------------------------------------------------------------

  window.addEventListener('beforeunload', () => {
    try {
      session.end();
      analyticsClient.flush(session);
    } catch (err) {
      console.error('[CheckoutRecovery] Error flushing session on beforeunload:', err);
    }
  });

  listenForOrderConfirmation(session, analyticsClient);

  // -------------------------------------------------------------------------
  // Start the detector
  // -------------------------------------------------------------------------

  frictionDetector.start(detectorConfig);
}

// ---------------------------------------------------------------------------
// Action handler
// ---------------------------------------------------------------------------

/**
 * Handle a UserAction emitted by the ConversationManager.
 * Calls the appropriate ShopifyAdapter mutation and updates SessionState.
 */
async function handleUserAction(
  action: UserAction,
  session: SessionState,
  adapter: ShopifyAdapter,
  conversationManager: ConversationManagerImpl,
): Promise<void> {
  try {
    switch (action.actionType) {
      case 'apply_coupon': {
        const p = action.payload as { couponCode?: string } | undefined;
        const couponCode = p?.couponCode;
        if (couponCode === undefined || couponCode === '') break;

        const result = await adapter.applyCoupon(session.cartId, couponCode);
        session.updateInterventionOutcome(
          action.interventionId,
          result.success ? 'accepted' : 'dismissed',
          Date.now(),
        );
        break;
      }

      case 'select_shipping': {
        const p = action.payload as { handle?: string } | undefined;
        const handle = p?.handle;
        if (handle === undefined || handle === '') break;

        const result = await adapter.selectShipping(session.cartId, handle);
        session.updateInterventionOutcome(
          action.interventionId,
          result.success ? 'accepted' : 'dismissed',
          Date.now(),
        );
        break;
      }

      case 'select_variant': {
        const p = action.payload as { variantId?: string; lineItemId?: string } | undefined;
        const variantId = p?.variantId;
        const lineItemId = p?.lineItemId ?? '';
        if (variantId === undefined || variantId === '') break;

        const result = await adapter.updateVariant(session.cartId, lineItemId, variantId);
        session.updateInterventionOutcome(
          action.interventionId,
          result.success ? 'accepted' : 'dismissed',
          Date.now(),
        );
        break;
      }

      case 'select_payment': {
        const p = action.payload as { methodId?: string } | undefined;
        const methodId = p?.methodId;
        if (methodId === undefined || methodId === '') break;

        const result = await adapter.selectPaymentMethod(session.cartId, methodId);
        session.updateInterventionOutcome(
          action.interventionId,
          result.success ? 'accepted' : 'dismissed',
          Date.now(),
        );
        break;
      }

      case 'dismiss': {
        // ConversationManager already handles the dismiss internally when the
        // user clicks a dismiss button; we just record the outcome here.
        conversationManager.dismiss('user_dismissed');
        session.updateInterventionOutcome(
          action.interventionId,
          'dismissed',
          Date.now(),
        );
        break;
      }

      case 'expand_detail': {
        // Inline expansion — no navigation, no mutation.
        // The ConversationManager renders the expanded content in-place.
        // No SessionState update needed for this action type.
        break;
      }

      default: {
        // Exhaustiveness guard — unknown action types are silently ignored
        const _exhaustive: never = action.actionType;
        console.warn('[CheckoutRecovery] Unknown action type:', _exhaustive);
        break;
      }
    }
  } catch (err) {
    // Suppress all action handler errors — never surface to user (Req 12.3)
    console.error('[CheckoutRecovery] Action handler error suppressed:', err);
  }
}

// ---------------------------------------------------------------------------
// Checkout step completion listener
// ---------------------------------------------------------------------------

/**
 * Listen for Shopify checkout step advancement events and dismiss the active
 * intervention when the user moves to the next step.
 *
 * Shopify fires a `page:change` event on the document when the checkout SPA
 * navigates between steps. We also watch for URL changes via a MutationObserver
 * on the document title (a reliable proxy for SPA navigation in Shopify).
 */
function listenForCheckoutStepCompletion(
  session: SessionState,
  conversationManager: ConversationManagerImpl,
): void {
  let lastPathname = window.location.pathname;

  // Shopify checkout SPA fires `page:change` on step transitions
  document.addEventListener('page:change', () => {
    try {
      const newStep = resolveCheckoutStep();
      if (newStep !== session.checkoutStep) {
        session.checkoutStep = newStep;
        conversationManager.dismiss('step_completed');
      }
    } catch (err) {
      console.error('[CheckoutRecovery] Error handling page:change:', err);
    }
  });

  // Fallback: poll for URL changes (covers cases where page:change is not fired)
  const observer = new MutationObserver(() => {
    try {
      const currentPathname = window.location.pathname;
      if (currentPathname !== lastPathname) {
        lastPathname = currentPathname;
        const newStep = resolveCheckoutStep();
        if (newStep !== session.checkoutStep) {
          session.checkoutStep = newStep;
          conversationManager.dismiss('step_completed');
        }
      }
    } catch (err) {
      console.error('[CheckoutRecovery] Error in MutationObserver callback:', err);
    }
  });

  // Observe the document title — Shopify updates it on step transitions
  const titleEl = document.querySelector('title');
  if (titleEl !== null) {
    observer.observe(titleEl, { childList: true });
  } else {
    // Fall back to observing the body for subtree changes
    observer.observe(document.body, { childList: true, subtree: false });
  }
}

// ---------------------------------------------------------------------------
// Order confirmation listener
// ---------------------------------------------------------------------------

/**
 * Detect order confirmation and flush the session as a conversion.
 *
 * Shopify's order confirmation page includes a `data-order-id` attribute on
 * the main content element, or the URL contains `/thank_you` or `/orders/`.
 */
function listenForOrderConfirmation(
  session: SessionState,
  analyticsClient: AnalyticsClient,
): void {
  function checkForConfirmation(): void {
    try {
      const path = window.location.pathname.toLowerCase();
      const isConfirmation =
        path.includes('/thank_you') ||
        path.includes('/orders/') ||
        document.querySelector('[data-order-id]') !== null ||
        document.querySelector('.order-confirmation') !== null;

      if (isConfirmation) {
        session.markConverted();
        analyticsClient.flush(session);
      }
    } catch (err) {
      console.error('[CheckoutRecovery] Error checking for order confirmation:', err);
    }
  }

  // Check immediately in case we're already on the confirmation page
  checkForConfirmation();

  // Also listen for Shopify's page:change event in case the SPA navigates
  // to the confirmation page after the bundle loads
  document.addEventListener('page:change', checkForConfirmation);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      init();
    } catch (err) {
      // Requirement 12.1, 12.3: on any initialisation error, log and exit
      // without affecting checkout progress
      console.error('[CheckoutRecovery] Initialisation failed — checkout unaffected:', err);
    }
  });
} else {
  // DOMContentLoaded has already fired (e.g., script loaded with defer/async)
  try {
    init();
  } catch (err) {
    console.error('[CheckoutRecovery] Initialisation failed — checkout unaffected:', err);
  }
}
