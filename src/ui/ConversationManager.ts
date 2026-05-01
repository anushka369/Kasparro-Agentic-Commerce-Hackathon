/**
 * ConversationManager — renders the intervention widget, manages conversational
 * turn sequence, and records dismissals in SessionState.
 *
 * Requirements: 4.1, 4.3, 4.5, 4.6, 12.3
 */

import type {
  ActionButton,
  DismissReason,
  InterventionPayload,
  UserAction,
} from '../types/index.js';
import type { SessionState } from '../session/SessionState.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ConversationManager {
  /** Mount the widget root element into the given container. */
  mount(container: HTMLElement): void;

  /** Display an intervention. Replaces any currently active widget. */
  show(payload: InterventionPayload): void;

  /** Programmatically dismiss the active intervention. */
  dismiss(reason: DismissReason): void;

  /** Register a callback for user action events. */
  onAction(handler: (action: UserAction) => void): void;
}

// ---------------------------------------------------------------------------
// CSS constants
// ---------------------------------------------------------------------------

const WIDGET_STYLE_ID = 'acr-widget-styles';

const WIDGET_CSS = `
/* AI Checkout Recovery — Conversation Widget */
#acr-widget-root {
  position: fixed;
  z-index: 2147483647; /* max z-index */
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a1a;
  pointer-events: none; /* root is transparent; only widget panel captures events */
}

.acr-widget-panel {
  pointer-events: all;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  padding: 16px;
  max-width: 360px;
  min-width: 280px;
  width: calc(100vw - 32px);
  box-sizing: border-box;
  animation: acr-slide-in 0.2s ease-out;
}

@keyframes acr-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.acr-widget-headline {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 8px 0;
  padding-right: 24px; /* space for close button */
}

.acr-widget-body {
  font-size: 13px;
  color: #555555;
  margin: 0 0 12px 0;
}

.acr-widget-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acr-action-btn {
  display: block;
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #d0d0d0;
  background: #f7f7f7;
  color: #1a1a1a;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
  box-sizing: border-box;
}

.acr-action-btn:hover {
  background: #efefef;
  border-color: #b0b0b0;
}

.acr-action-btn:focus-visible {
  outline: 2px solid #0070f3;
  outline-offset: 2px;
}

.acr-action-btn--primary {
  background: #0070f3;
  border-color: #0070f3;
  color: #ffffff;
}

.acr-action-btn--primary:hover {
  background: #005fd1;
  border-color: #005fd1;
}

.acr-action-btn--dismiss {
  background: transparent;
  border-color: transparent;
  color: #888888;
  font-size: 12px;
  padding: 6px 14px;
}

.acr-action-btn--dismiss:hover {
  color: #555555;
  background: transparent;
}

.acr-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #888888;
  font-size: 18px;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.acr-close-btn:hover {
  color: #333333;
  background: #f0f0f0;
}

.acr-close-btn:focus-visible {
  outline: 2px solid #0070f3;
  outline-offset: 2px;
}

/* Responsive: narrow viewports (320px – 480px) */
@media (max-width: 480px) {
  .acr-widget-panel {
    border-radius: 8px;
    padding: 12px;
  }
}

/* Responsive: wide viewports (> 768px) — anchor to bottom-right */
@media (min-width: 769px) {
  .acr-widget-panel {
    width: 360px;
  }
}
`;

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

/**
 * Compute the best position for the widget panel so it does not overlap
 * required checkout form fields. Uses getBoundingClientRect to detect field
 * positions and places the widget in the quadrant with the most free space.
 *
 * Returns CSS properties to apply to the widget root element.
 */
function computeWidgetPosition(container: HTMLElement): {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
} {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Collect bounding rects of all visible form fields inside the container
  const fields = Array.from(
    container.querySelectorAll<HTMLElement>(
      'input, select, textarea, [role="textbox"], [role="combobox"]',
    ),
  ).filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  // Determine occupied vertical regions
  let topOccupied = 0;
  let bottomOccupied = 0;

  for (const field of fields) {
    const rect = field.getBoundingClientRect();
    if (rect.top < vh / 2) {
      topOccupied = Math.max(topOccupied, rect.bottom);
    } else {
      bottomOccupied = Math.max(bottomOccupied, vh - rect.top);
    }
  }

  const freeTop = topOccupied;
  const freeBottom = bottomOccupied;

  // Prefer bottom-right; fall back to top-right if bottom is heavily occupied
  const WIDGET_HEIGHT_ESTIMATE = 220; // px
  const MARGIN = 16; // px

  if (vh - freeBottom - MARGIN >= WIDGET_HEIGHT_ESTIMATE) {
    // Enough space at the bottom
    return {
      bottom: `${freeBottom + MARGIN}px`,
      right: `${MARGIN}px`,
    };
  } else if (freeTop + MARGIN + WIDGET_HEIGHT_ESTIMATE <= vh) {
    // Place below the top-occupied region
    return {
      top: `${freeTop + MARGIN}px`,
      right: `${MARGIN}px`,
    };
  }

  // Fallback: bottom-right corner with a safe margin
  return {
    bottom: `${MARGIN}px`,
    right: `${MARGIN}px`,
  };
}

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

function injectStyles(): void {
  if (document.getElementById(WIDGET_STYLE_ID) !== null) {
    return; // already injected
  }
  const style = document.createElement('style');
  style.id = WIDGET_STYLE_ID;
  style.textContent = WIDGET_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of the ConversationManager interface.
 *
 * Usage:
 *   const cm = new ConversationManagerImpl(sessionState);
 *   cm.mount(document.body);
 *   cm.onAction(handler);
 *   cm.show(payload);
 */
export class ConversationManagerImpl implements ConversationManager {
  private readonly session: SessionState;

  /** The root element injected into the container. */
  private rootEl: HTMLElement | null = null;

  /** The container element passed to mount(). */
  private container: HTMLElement | null = null;

  /** The currently displayed intervention payload. */
  private activePayload: InterventionPayload | null = null;

  /** Registered action handler callbacks. */
  private actionHandlers: Array<(action: UserAction) => void> = [];

  /** Timer handle for auto-dismiss on expiry. */
  private expiryTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor(session: SessionState) {
    this.session = session;
  }

  // ---------------------------------------------------------------------------
  // ConversationManager interface
  // ---------------------------------------------------------------------------

  /**
   * Inject the widget root element into `container` and attach CSS.
   * Requirement 4.1, 4.6
   */
  mount(container: HTMLElement): void {
    this.container = container;
    injectStyles();

    // Create root element if not already present
    if (this.rootEl === null) {
      const root = document.createElement('div');
      root.id = 'acr-widget-root';
      root.setAttribute('role', 'complementary');
      root.setAttribute('aria-label', 'Checkout assistance');
      this.rootEl = root;
    }

    container.appendChild(this.rootEl);
  }

  /**
   * Render headline, body, and ActionButton elements from the payload.
   * Replaces any currently active widget.
   * Requirement 4.1, 4.3, 4.6, 12.3
   */
  show(payload: InterventionPayload): void {
    try {
      this._show(payload);
    } catch (err) {
      // Error boundary: suppress widget and log silently (Requirement 12.3)
      console.error('[ConversationManager] Render error suppressed:', err);
      this.dismiss('engine_error');
    }
  }

  /**
   * Remove the widget from the DOM and record the DismissReason in SessionState.
   * Requirement 4.5
   */
  dismiss(reason: DismissReason): void {
    this._clearExpiryTimer();

    if (this.activePayload !== null) {
      const outcome = dismissReasonToOutcome(reason);
      this.session.updateInterventionOutcome(
        this.activePayload.interventionId,
        outcome,
        Date.now(),
      );
      this.activePayload = null;
    }

    if (this.rootEl !== null) {
      this.rootEl.innerHTML = '';
    }
  }

  /**
   * Register a callback for UserAction events.
   */
  onAction(handler: (action: UserAction) => void): void {
    this.actionHandlers.push(handler);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Core render logic. Called inside a try/catch error boundary in show().
   */
  private _show(payload: InterventionPayload): void {
    if (this.rootEl === null) {
      throw new Error('[ConversationManager] mount() must be called before show()');
    }

    // Dismiss any currently active widget first
    if (this.activePayload !== null) {
      this.dismiss('step_completed');
    }

    this.activePayload = payload;

    // Record the intervention in session state
    this.session.addIntervention({
      interventionId: payload.interventionId,
      category: payload.category,
      triggeredAt: Date.now(),
      outcome: 'pending',
    });

    // Reposition widget to avoid overlapping form fields (Requirement 4.6)
    const position = computeWidgetPosition(this.container ?? document.body);
    Object.assign(this.rootEl.style, {
      top: '',
      bottom: '',
      left: '',
      right: '',
      ...position,
    });

    // Build the widget panel
    const panel = this._buildPanel(payload);
    this.rootEl.innerHTML = '';
    this.rootEl.appendChild(panel);

    // Schedule auto-dismiss when the payload expires (Requirement 12.2 / expiresAt)
    const msUntilExpiry = payload.expiresAt - Date.now();
    if (msUntilExpiry > 0) {
      this.expiryTimerId = setTimeout(() => {
        this.dismiss('timeout');
      }, msUntilExpiry);
    } else {
      // Already expired — dismiss immediately
      this.dismiss('timeout');
    }
  }

  /**
   * Build the widget panel DOM element for the given payload.
   */
  private _buildPanel(payload: InterventionPayload): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'acr-widget-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'acr-headline');
    panel.style.position = 'relative';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'acr-close-btn';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      this._handleAction(payload, {
        label: 'Dismiss',
        actionType: 'dismiss',
      });
    });
    panel.appendChild(closeBtn);

    // Headline
    const headline = document.createElement('p');
    headline.id = 'acr-headline';
    headline.className = 'acr-widget-headline';
    headline.textContent = payload.content.headline;
    panel.appendChild(headline);

    // Body
    const body = document.createElement('p');
    body.className = 'acr-widget-body';
    body.textContent = payload.content.body;
    panel.appendChild(body);

    // Action buttons
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'acr-widget-actions';

    payload.content.actions.forEach((action, index) => {
      const btn = this._buildActionButton(action, index === 0, payload);
      actionsContainer.appendChild(btn);
    });

    panel.appendChild(actionsContainer);

    return panel;
  }

  /**
   * Build a single action button element.
   */
  private _buildActionButton(
    action: ActionButton,
    isPrimary: boolean,
    payload: InterventionPayload,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;

    if (action.actionType === 'dismiss') {
      btn.className = 'acr-action-btn acr-action-btn--dismiss';
    } else if (isPrimary) {
      btn.className = 'acr-action-btn acr-action-btn--primary';
    } else {
      btn.className = 'acr-action-btn';
    }

    btn.addEventListener('click', () => {
      this._handleAction(payload, action);
    });

    return btn;
  }

  /**
   * Handle a user action: emit the UserAction event and dismiss if needed.
   * Uses requestAnimationFrame + async handler to deliver next message within
   * 1 second of user action (Requirement 4.3).
   */
  private _handleAction(payload: InterventionPayload, action: ActionButton): void {
    const userAction: UserAction = {
      interventionId: payload.interventionId,
      actionType: action.actionType,
      payload: action.payload,
      timestamp: Date.now(),
    };

    if (action.actionType === 'dismiss') {
      this.dismiss('user_dismissed');
    }

    // Deliver next message within 1 second using requestAnimationFrame + async
    // (Requirement 4.3). We schedule the handler dispatch on the next animation
    // frame so the browser can paint the current state first, then the async
    // handler can produce a follow-up payload within the 1-second budget.
    requestAnimationFrame(() => {
      void this._dispatchActionAsync(userAction);
    });
  }

  /**
   * Async dispatch of action handlers. Wrapped in try/catch to prevent
   * unhandled promise rejections from surfacing to the user.
   */
  private async _dispatchActionAsync(userAction: UserAction): Promise<void> {
    for (const handler of this.actionHandlers) {
      try {
        await Promise.resolve(handler(userAction));
      } catch (err) {
        // Silently log handler errors — never surface to user (Requirement 12.3)
        console.error('[ConversationManager] Action handler error suppressed:', err);
      }
    }
  }

  /**
   * Clear the expiry auto-dismiss timer if one is pending.
   */
  private _clearExpiryTimer(): void {
    if (this.expiryTimerId !== null) {
      clearTimeout(this.expiryTimerId);
      this.expiryTimerId = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a DismissReason to the InterventionRecord outcome field.
 */
function dismissReasonToOutcome(
  reason: DismissReason,
): 'accepted' | 'dismissed' | 'timed_out' | 'pending' {
  switch (reason) {
    case 'user_dismissed':
      return 'dismissed';
    case 'step_completed':
      return 'dismissed';
    case 'timeout':
      return 'timed_out';
    case 'engine_error':
      return 'dismissed';
    default: {
      const _exhaustive: never = reason;
      return 'dismissed';
    }
  }
}

export default ConversationManagerImpl;
