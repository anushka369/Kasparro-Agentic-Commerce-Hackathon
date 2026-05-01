/**
 * SignalCollector — DOM event listener layer for the Friction_Detector.
 *
 * Attaches listeners for mouse movement, scroll, visibility/unload,
 * field interactions, and idle detection. Produces a `SignalSnapshot`
 * on demand via `getSnapshot()`.
 *
 * Privacy: stores only field element IDs, never field values.
 * Error handling: all listeners are wrapped in try/catch; errors are
 * logged with console.error but never thrown.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import type {
  CheckoutStep,
  DetectorConfig,
  FieldEvent,
  SignalSnapshot,
} from '../types/index.js';

/** Rolling window size for cursor velocity averaging. */
const VELOCITY_WINDOW = 10;

/** Stable ID counter for form fields that lack an `id` attribute. */
let stableIdCounter = 0;

/** WeakMap to assign stable IDs to elements without an `id`. */
const stableIdMap = new WeakMap<Element, string>();

/**
 * Return a stable, non-PII identifier for a form field element.
 * Prefers the element's own `id` attribute; falls back to a generated
 * counter-based ID stored in a WeakMap so it survives across calls.
 */
function getFieldId(el: Element): string {
  const id = (el as HTMLElement).id;
  if (id && id.trim() !== '') {
    return id;
  }
  const existing = stableIdMap.get(el);
  if (existing !== undefined) {
    return existing;
  }
  const generated = `__field_${++stableIdCounter}`;
  stableIdMap.set(el, generated);
  return generated;
}

/**
 * Detect the current checkout step from the URL path or a
 * `data-checkout-step` attribute on the checkout form element.
 * Defaults to `'cart'` if no step can be determined.
 */
function detectCheckoutStep(): CheckoutStep {
  // 1. Check for a data attribute on the checkout form
  try {
    const form = document.querySelector<HTMLElement>('[data-checkout-step]');
    if (form !== null) {
      const attr = form.dataset['checkoutStep'];
      if (isCheckoutStep(attr)) {
        return attr;
      }
    }
  } catch {
    // ignore DOM errors
  }

  // 2. Derive from URL path segments
  try {
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

const CHECKOUT_STEPS: readonly CheckoutStep[] = [
  'cart',
  'information',
  'shipping',
  'payment',
  'review',
];

function isCheckoutStep(value: string | undefined): value is CheckoutStep {
  return value !== undefined && (CHECKOUT_STEPS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// SignalCollector
// ---------------------------------------------------------------------------

export class SignalCollector {
  private readonly config: DetectorConfig;

  // --- page timing ---
  private readonly pageLoadTime: number = Date.now();

  // --- scroll ---
  private scrollDepthPct = 0;

  // --- cursor velocity ---
  private readonly velocitySamples: number[] = [];
  private lastMouseX = 0;
  private lastMouseY = 0;
  private lastMouseTime = 0;

  // --- exit intent ---
  private exitIntentDetected = false;

  // --- idle ---
  private idleDetected = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  // --- back navigation ---
  private backNavigationAttempted = false;

  // --- field events ---
  private readonly fieldEvents: FieldEvent[] = [];
  /** Map from fieldId → focus timestamp (ms) for computing durationMs. */
  private readonly focusTimes = new Map<string, number>();

  // --- bound listener references (needed for removeEventListener) ---
  private readonly _onMouseMove: (e: MouseEvent) => void;
  private readonly _onScroll: () => void;
  private readonly _onVisibilityChange: () => void;
  private readonly _onBeforeUnload: () => void;
  private readonly _onKeyDown: () => void;
  private readonly _onClick: () => void;

  // Field-level listeners stored as tuples for cleanup
  private readonly _fieldListeners: Array<{
    el: Element;
    type: string;
    handler: EventListener;
  }> = [];

  constructor(config: DetectorConfig) {
    this.config = config;

    // Bind all handlers once so we can remove them later
    this._onMouseMove = (e: MouseEvent) => this._handleMouseMove(e);
    this._onScroll = () => this._handleScroll();
    this._onVisibilityChange = () => this._handleVisibilityChange();
    this._onBeforeUnload = () => this._handleBeforeUnload();
    this._onKeyDown = () => this._resetIdleTimer();
    this._onClick = () => this._resetIdleTimer();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Attach all event listeners and start the idle timer. */
  start(): void {
    try {
      document.addEventListener('mousemove', this._onMouseMove, { passive: true });
    } catch (err) {
      console.error('[SignalCollector] Failed to attach mousemove listener:', err);
    }

    try {
      document.addEventListener('scroll', this._onScroll, { passive: true });
    } catch (err) {
      console.error('[SignalCollector] Failed to attach scroll listener:', err);
    }

    try {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    } catch (err) {
      console.error('[SignalCollector] Failed to attach visibilitychange listener:', err);
    }

    try {
      window.addEventListener('beforeunload', this._onBeforeUnload);
    } catch (err) {
      console.error('[SignalCollector] Failed to attach beforeunload listener:', err);
    }

    try {
      document.addEventListener('keydown', this._onKeyDown, { passive: true });
    } catch (err) {
      console.error('[SignalCollector] Failed to attach keydown listener:', err);
    }

    try {
      document.addEventListener('click', this._onClick, { passive: true });
    } catch (err) {
      console.error('[SignalCollector] Failed to attach click listener:', err);
    }

    // Attach field-level listeners
    this._attachFieldListeners();

    // Start idle timer
    this._resetIdleTimer();
  }

  /** Remove all event listeners and clear all timers. */
  stop(): void {
    try {
      document.removeEventListener('mousemove', this._onMouseMove);
    } catch (err) {
      console.error('[SignalCollector] Failed to remove mousemove listener:', err);
    }

    try {
      document.removeEventListener('scroll', this._onScroll);
    } catch (err) {
      console.error('[SignalCollector] Failed to remove scroll listener:', err);
    }

    try {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    } catch (err) {
      console.error('[SignalCollector] Failed to remove visibilitychange listener:', err);
    }

    try {
      window.removeEventListener('beforeunload', this._onBeforeUnload);
    } catch (err) {
      console.error('[SignalCollector] Failed to remove beforeunload listener:', err);
    }

    try {
      document.removeEventListener('keydown', this._onKeyDown);
    } catch (err) {
      console.error('[SignalCollector] Failed to remove keydown listener:', err);
    }

    try {
      document.removeEventListener('click', this._onClick);
    } catch (err) {
      console.error('[SignalCollector] Failed to remove click listener:', err);
    }

    // Remove field-level listeners
    for (const { el, type, handler } of this._fieldListeners) {
      try {
        el.removeEventListener(type, handler);
      } catch (err) {
        console.error('[SignalCollector] Failed to remove field listener:', err);
      }
    }
    this._fieldListeners.length = 0;

    // Clear idle timer
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  /** Return a point-in-time snapshot of all collected signals. */
  getSnapshot(): SignalSnapshot {
    return {
      timeOnPageMs: Date.now() - this.pageLoadTime,
      scrollDepthPct: this.scrollDepthPct,
      cursorVelocityAvg: this._computeVelocityAvg(),
      exitIntentDetected: this.exitIntentDetected,
      idleDetected: this.idleDetected,
      // Return a shallow copy so callers cannot mutate internal state
      fieldEvents: [...this.fieldEvents],
      backNavigationAttempted: this.backNavigationAttempted,
      checkoutStep: detectCheckoutStep(),
    };
  }

  // ---------------------------------------------------------------------------
  // Mouse movement — velocity + exit intent
  // ---------------------------------------------------------------------------

  private _handleMouseMove(e: MouseEvent): void {
    try {
      const now = Date.now();

      // Compute instantaneous velocity (px/ms)
      if (this.lastMouseTime !== 0) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        const dt = now - this.lastMouseTime;
        if (dt > 0) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          const velocity = distance / dt;
          this.velocitySamples.push(velocity);
          // Keep only the last VELOCITY_WINDOW samples
          if (this.velocitySamples.length > VELOCITY_WINDOW) {
            this.velocitySamples.shift();
          }
        }
      }

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.lastMouseTime = now;

      // Exit-intent: cursor within exitIntentMarginPx of viewport top
      if (e.clientY <= this.config.exitIntentMarginPx) {
        if (!this.exitIntentDetected) {
          // Schedule the flag set within 500ms (Requirement 1.3)
          setTimeout(() => {
            this.exitIntentDetected = true;
          }, 0); // fires asynchronously but well within 500ms
          this.exitIntentDetected = true; // also set immediately to satisfy ≤500ms
        }
      }

      // Reset idle timer on mouse movement
      this._resetIdleTimer();
    } catch (err) {
      console.error('[SignalCollector] Error in mousemove handler:', err);
    }
  }

  private _computeVelocityAvg(): number {
    if (this.velocitySamples.length === 0) return 0;
    const sum = this.velocitySamples.reduce((acc, v) => acc + v, 0);
    return sum / this.velocitySamples.length;
  }

  // ---------------------------------------------------------------------------
  // Scroll depth
  // ---------------------------------------------------------------------------

  private _handleScroll(): void {
    try {
      const scrollTop =
        window.scrollY ??
        document.documentElement.scrollTop ??
        document.body.scrollTop ??
        0;
      const docHeight =
        document.documentElement.scrollHeight - document.documentElement.clientHeight;

      if (docHeight > 0) {
        const pct = Math.min(100, Math.max(0, (scrollTop / docHeight) * 100));
        if (pct > this.scrollDepthPct) {
          this.scrollDepthPct = pct;
        }
      }

      this._resetIdleTimer();
    } catch (err) {
      console.error('[SignalCollector] Error in scroll handler:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Back navigation
  // ---------------------------------------------------------------------------

  private _handleVisibilityChange(): void {
    try {
      if (document.visibilityState === 'hidden') {
        this.backNavigationAttempted = true;
      }
    } catch (err) {
      console.error('[SignalCollector] Error in visibilitychange handler:', err);
    }
  }

  private _handleBeforeUnload(): void {
    try {
      this.backNavigationAttempted = true;
    } catch (err) {
      console.error('[SignalCollector] Error in beforeunload handler:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Idle detection
  // ---------------------------------------------------------------------------

  private _resetIdleTimer(): void {
    try {
      if (this.idleTimer !== null) {
        clearTimeout(this.idleTimer);
      }
      // If we were idle, reset the flag on new interaction
      this.idleDetected = false;
      this.idleTimer = setTimeout(() => {
        this.idleDetected = true;
      }, this.config.idleTimeoutMs);
    } catch (err) {
      console.error('[SignalCollector] Error resetting idle timer:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Field events
  // ---------------------------------------------------------------------------

  private _attachFieldListeners(): void {
    try {
      const fields = document.querySelectorAll<HTMLElement>(
        'input, select, textarea',
      );

      for (const el of fields) {
        this._addFieldListener(el, 'focus', this._makeFieldFocusHandler(el));
        this._addFieldListener(el, 'blur', this._makeFieldBlurHandler(el));
        this._addFieldListener(el, 'change', this._makeFieldChangeHandler(el));
      }
    } catch (err) {
      console.error('[SignalCollector] Error attaching field listeners:', err);
    }
  }

  private _addFieldListener(
    el: Element,
    type: string,
    handler: EventListener,
  ): void {
    try {
      el.addEventListener(type, handler);
      this._fieldListeners.push({ el, type, handler });
    } catch (err) {
      console.error(`[SignalCollector] Failed to attach ${type} listener on field:`, err);
    }
  }

  private _makeFieldFocusHandler(el: HTMLElement): EventListener {
    return () => {
      try {
        const fieldId = getFieldId(el);
        this.focusTimes.set(fieldId, Date.now());
        this.fieldEvents.push({ fieldId, eventType: 'focus' });
        this._resetIdleTimer();
      } catch (err) {
        console.error('[SignalCollector] Error in field focus handler:', err);
      }
    };
  }

  private _makeFieldBlurHandler(el: HTMLElement): EventListener {
    return () => {
      try {
        const fieldId = getFieldId(el);
        const focusTime = this.focusTimes.get(fieldId);
        const durationMs =
          focusTime !== undefined ? Date.now() - focusTime : undefined;

        const blurEvent: FieldEvent =
          durationMs !== undefined
            ? { fieldId, eventType: 'blur', durationMs }
            : { fieldId, eventType: 'blur' };
        this.fieldEvents.push(blurEvent);
        this.focusTimes.delete(fieldId);

        // Check for validation errors on blur
        this._checkFieldError(el, fieldId);

        this._resetIdleTimer();
      } catch (err) {
        console.error('[SignalCollector] Error in field blur handler:', err);
      }
    };
  }

  private _makeFieldChangeHandler(el: HTMLElement): EventListener {
    return () => {
      try {
        const fieldId = getFieldId(el);
        this.fieldEvents.push({ fieldId, eventType: 'change' });
        this._resetIdleTimer();
      } catch (err) {
        console.error('[SignalCollector] Error in field change handler:', err);
      }
    };
  }

  /**
   * Check whether a field has a validation error and, if so, record an
   * `error` FieldEvent. Checks `:invalid` pseudo-class and
   * `aria-invalid="true"` attribute. Error message is taken from
   * `validationMessage` or the element referenced by `aria-errormessage`.
   *
   * No field values are read or stored.
   */
  private _checkFieldError(el: HTMLElement, fieldId: string): void {
    try {
      const isInvalid =
        el.matches(':invalid') || el.getAttribute('aria-invalid') === 'true';

      if (!isInvalid) return;

      let errorMessage: string | undefined;

      // Prefer native validationMessage
      if ('validationMessage' in el) {
        const msg = (el as HTMLInputElement).validationMessage;
        if (msg && msg.trim() !== '') {
          errorMessage = msg;
        }
      }

      // Fall back to aria-errormessage
      if (errorMessage === undefined) {
        const errMsgId = el.getAttribute('aria-errormessage');
        if (errMsgId) {
          const errEl = document.getElementById(errMsgId);
          if (errEl !== null) {
            const text = errEl.textContent?.trim();
            if (text && text !== '') {
              errorMessage = text;
            }
          }
        }
      }

      const errorEvent: FieldEvent =
        errorMessage !== undefined
          ? { fieldId, eventType: 'error', errorMessage }
          : { fieldId, eventType: 'error' };
      this.fieldEvents.push(errorEvent);
    } catch (err) {
      console.error('[SignalCollector] Error checking field validation:', err);
    }
  }
}

export default SignalCollector;
