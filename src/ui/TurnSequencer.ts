/**
 * TurnSequencer — manages multi-turn conversation flows for each FrictionCategory.
 *
 * Implements a per-category state machine that tracks which "turn" the user is on
 * and produces the next InterventionContent to display based on the user's action.
 *
 * Turn limits (Requirement 4.2, 8.2):
 *   - All categories: at most 2 follow-up questions (turns 1 and 2) before resolution or escalation.
 *   - Size_Uncertainty: at most 3 follow-up questions (turns 1, 2, and 3).
 *   - Turn 0 is the initial display (not counted as a "question").
 *
 * Finite answer sets always use ActionButton elements — no free-text input (Requirement 4.4).
 *
 * Requirements: 4.2, 4.4, 7.2, 7.3, 8.2, 10.2, 10.3
 */

import type {
  ActionButton,
  InterventionContent,
  InterventionPayload,
  UserAction,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** A single step in a conversation flow. */
export interface ConversationTurn {
  /** Turn index (0-based). Turn 0 is the initial payload content. */
  turnIndex: number;
  /** Content to display for this turn. */
  content: InterventionContent;
  /** Whether this turn is a terminal state (resolution or escalation). */
  isTerminal: boolean;
}

/** Result of advancing the sequencer by one user action. */
export interface TurnAdvanceResult {
  /** The next turn to display, or null if the flow is complete (should dismiss). */
  nextTurn: ConversationTurn | null;
  /** Whether the user's action resolved the issue (e.g., applied coupon, selected shipping). */
  resolved: boolean;
}

export interface TurnSequencer {
  /**
   * Get the initial turn for the given payload.
   * Turn 0 is always the content already in the payload.
   */
  getInitialTurn(payload: InterventionPayload): ConversationTurn;

  /**
   * Advance the conversation by one user action.
   * Returns the next turn to display, or null if the flow should end.
   *
   * @param currentTurn  The turn the user just responded to.
   * @param action       The user's action.
   * @param payload      The original intervention payload (for supplemental data).
   */
  advance(
    currentTurn: ConversationTurn,
    action: UserAction,
    payload: InterventionPayload,
  ): TurnAdvanceResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a dismiss-only escalation turn (always terminal). */
function escalationTurn(turnIndex: number, headline: string, body: string): ConversationTurn {
  return {
    turnIndex,
    isTerminal: true,
    content: {
      headline,
      body,
      actions: [{ label: 'Dismiss', actionType: 'dismiss' }],
    },
  };
}

/** Shorthand: resolved result — no next turn, issue resolved. */
const RESOLVED: TurnAdvanceResult = { nextTurn: null, resolved: true };

/** Shorthand: dismissed result — no next turn, not resolved. */
const DISMISSED: TurnAdvanceResult = { nextTurn: null, resolved: false };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of the TurnSequencer interface.
 *
 * Each per-category flow is handled by a dedicated private method.
 * The advance() method dispatches to the correct handler via a switch on
 * payload.category.
 */
export class TurnSequencerImpl implements TurnSequencer {
  // ---------------------------------------------------------------------------
  // TurnSequencer interface
  // ---------------------------------------------------------------------------

  /**
   * Return turn 0 — the initial content already present in the payload.
   * Turn 0 is never terminal (the user still needs to interact).
   */
  getInitialTurn(payload: InterventionPayload): ConversationTurn {
    return {
      turnIndex: 0,
      content: payload.content,
      isTerminal: false,
    };
  }

  /**
   * Advance the conversation by one user action.
   *
   * Dispatches to the per-category handler. Resolving actions
   * (apply_coupon, select_shipping, select_variant, select_payment) always
   * return resolved = true, nextTurn = null. Dismiss always returns
   * resolved = false, nextTurn = null.
   *
   * Requirements: 4.2, 4.4, 7.2, 7.3, 8.2, 10.2, 10.3
   */
  advance(
    currentTurn: ConversationTurn,
    action: UserAction,
    payload: InterventionPayload,
  ): TurnAdvanceResult {
    // Global: resolving actions always end the flow immediately
    if (
      action.actionType === 'apply_coupon' ||
      action.actionType === 'select_shipping' ||
      action.actionType === 'select_variant' ||
      action.actionType === 'select_payment'
    ) {
      return RESOLVED;
    }

    // Global: dismiss always ends the flow without resolution
    if (action.actionType === 'dismiss') {
      return DISMISSED;
    }

    // Route to per-category handler
    switch (payload.category) {
      case 'Price_Hesitation':
        return this._advancePriceHesitation(currentTurn, action, payload);

      case 'Coupon_Confusion':
        return this._advanceCouponConfusion(currentTurn, action, payload);

      case 'Shipping_Confusion':
        return this._advanceShippingConfusion(currentTurn, action, payload);

      case 'Delivery_Timeline':
        return this._advanceDeliveryTimeline(currentTurn, action, payload);

      case 'Trust_Issue':
        return this._advanceTrustIssue(currentTurn, action, payload);

      case 'Size_Uncertainty':
        return this._advanceSizeUncertainty(currentTurn, action, payload);

      case 'Payment_Options':
        return this._advancePaymentOptions(currentTurn, action, payload);

      case 'Missing_Information':
        return this._advanceMissingInformation(currentTurn, action, payload);

      default: {
        // Exhaustiveness guard
        const _exhaustive: never = payload.category;
        console.warn('[TurnSequencer] Unknown category:', _exhaustive);
        return DISMISSED;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-category flow handlers
  // ---------------------------------------------------------------------------

  /**
   * Price_Hesitation flow (max 2 follow-ups).
   *
   * Turn 0: Show offer/price comparison (from payload content — pass through).
   * expand_detail → Turn 1: Detailed price breakdown with "Apply best offer" and "No thanks".
   * Turn 2 (escalation): "Need more help? Contact our support team."
   *
   * Requirements: 4.2, 4.4
   */
  private _advancePriceHesitation(
    currentTurn: ConversationTurn,
    action: UserAction,
    _payload: InterventionPayload,
  ): TurnAdvanceResult {
    const { turnIndex } = currentTurn;

    if (turnIndex === 0 && action.actionType === 'expand_detail') {
      // Turn 1: detailed price breakdown
      const turn1: ConversationTurn = {
        turnIndex: 1,
        isTerminal: false,
        content: {
          headline: 'Price breakdown',
          body: "Here's a detailed look at what you're paying for and why it's a great deal.",
          actions: [
            { label: 'Apply best offer', actionType: 'apply_coupon' },
            { label: 'No thanks', actionType: 'dismiss' },
          ],
        },
      };
      return { nextTurn: turn1, resolved: false };
    }

    if (turnIndex >= 1) {
      // Turn 2: escalation
      return {
        nextTurn: escalationTurn(
          2,
          'Need more help?',
          'Contact our support team for personalised assistance.',
        ),
        resolved: false,
      };
    }

    // Any other action at turn 0 (e.g., unexpected expand_detail variant) → escalate
    return {
      nextTurn: escalationTurn(
        turnIndex + 1,
        'Need more help?',
        'Contact our support team for personalised assistance.',
      ),
      resolved: false,
    };
  }

  /**
   * Coupon_Confusion flow (max 2 follow-ups).
   *
   * Turn 0: Show available coupon codes (from payload).
   * expand_detail → Turn 1: "Which code would you like to try?" with individual coupon buttons.
   * Turn 2 (escalation): "Still having trouble? Our support team can help."
   *
   * Requirements: 4.2, 4.4
   */
  private _advanceCouponConfusion(
    currentTurn: ConversationTurn,
    action: UserAction,
    payload: InterventionPayload,
  ): TurnAdvanceResult {
    const { turnIndex } = currentTurn;

    if (turnIndex === 0 && action.actionType === 'expand_detail') {
      // Build individual coupon buttons from supplementalData if available
      const offers = this._extractOffers(payload);
      const couponActions: ActionButton[] = offers
        .filter((o) => typeof o.couponCode === 'string' && o.couponCode.length > 0)
        .map((o) => ({
          label: `Try ${o.couponCode as string}`,
          actionType: 'apply_coupon' as const,
          payload: { couponCode: o.couponCode, offerId: o.offerId },
        }));

      if (couponActions.length === 0) {
        // No individual codes available — escalate
        return {
          nextTurn: escalationTurn(
            1,
            'Still having trouble?',
            'Our support team can help you apply a discount code.',
          ),
          resolved: false,
        };
      }

      couponActions.push({ label: 'Dismiss', actionType: 'dismiss' });

      const turn1: ConversationTurn = {
        turnIndex: 1,
        isTerminal: false,
        content: {
          headline: 'Which code would you like to try?',
          body: 'Select a discount code to apply it to your cart.',
          actions: couponActions,
        },
      };
      return { nextTurn: turn1, resolved: false };
    }

    if (turnIndex >= 1) {
      return {
        nextTurn: escalationTurn(
          2,
          'Still having trouble?',
          'Our support team can help you apply a discount code.',
        ),
        resolved: false,
      };
    }

    return {
      nextTurn: escalationTurn(
        turnIndex + 1,
        'Still having trouble?',
        'Our support team can help you apply a discount code.',
      ),
      resolved: false,
    };
  }

  /**
   * Shipping_Confusion flow (max 2 follow-ups).
   *
   * Turn 0: Show shipping options list (from payload).
   * expand_detail → Turn 1: "Would you like to enter a different postal code?"
   *   with "Use current address" and dismiss buttons.
   * Turn 2 (escalation): "Need help with shipping? Contact support."
   *
   * Requirements: 4.2, 4.4, 6.3
   */
  private _advanceShippingConfusion(
    currentTurn: ConversationTurn,
    action: UserAction,
    _payload: InterventionPayload,
  ): TurnAdvanceResult {
    const { turnIndex } = currentTurn;

    if (turnIndex === 0 && action.actionType === 'expand_detail') {
      const turn1: ConversationTurn = {
        turnIndex: 1,
        isTerminal: false,
        content: {
          headline: 'Different delivery address?',
          body: 'Would you like to enter a different postal code to see updated shipping options?',
          actions: [
            {
              label: 'Use current address',
              actionType: 'select_shipping',
              payload: { useCurrentAddress: true },
            },
            { label: 'Dismiss', actionType: 'dismiss' },
          ],
        },
      };
      return { nextTurn: turn1, resolved: false };
    }

    if (turnIndex >= 1) {
      return {
        nextTurn: escalationTurn(
          2,
          'Need help with shipping?',
          'Contact our support team and we\'ll sort out your delivery options.',
        ),
        resolved: false,
      };
    }

    return {
      nextTurn: escalationTurn(
        turnIndex + 1,
        'Need help with shipping?',
        'Contact our support team and we\'ll sort out your delivery options.',
      ),
      resolved: false,
    };
  }

  /**
   * Delivery_Timeline flow (max 2 follow-ups).
   *
   * Turn 0: Show delivery estimates (from payload).
   * Turn 1 (if no selection): "Is there a specific delivery date you need?"
   *   with "Yes, I need it by a specific date" and "No, any date is fine" buttons.
   * Turn 2 (escalation): "For urgent delivery needs, please contact our support team."
   *
   * Requirements: 4.2, 4.4
   */
  private _advanceDeliveryTimeline(
    currentTurn: ConversationTurn,
    _action: UserAction,
    _payload: InterventionPayload,
  ): TurnAdvanceResult {
    const { turnIndex } = currentTurn;

    if (turnIndex === 0) {
      const turn1: ConversationTurn = {
        turnIndex: 1,
        isTerminal: false,
        content: {
          headline: 'Do you need it by a specific date?',
          body: 'Let us know if you have a delivery deadline and we\'ll find the best option.',
          actions: [
            {
              label: 'Yes, I need it by a specific date',
              actionType: 'expand_detail',
              payload: { section: 'specific_date' },
            },
            {
              label: 'No, any date is fine',
              actionType: 'dismiss',
            },
          ],
        },
      };
      return { nextTurn: turn1, resolved: false };
    }

    // Turn 1 or beyond → escalate
    return {
      nextTurn: escalationTurn(
        2,
        'For urgent delivery needs',
        'Please contact our support team and we\'ll find the fastest option for you.',
      ),
      resolved: false,
    };
  }

  /**
   * Trust_Issue flow (max 2 follow-ups).
   *
   * Turn 0: Show trust signals inline (return policy, security, reviews) — from payload.
   * expand_detail { section: 'return_policy' } → Turn 1: Return policy details inline.
   * expand_detail { section: 'security' }      → Turn 1: Security details inline.
   * expand_detail { section: 'reviews' }       → Turn 1: Review highlights inline.
   * Turn 2 (escalation): "Still have concerns? Our support team is here to help."
   *
   * All expand_detail actions stay within the widget — no navigation (Requirement 7.3).
   *
   * Requirements: 4.2, 4.4, 7.2, 7.3
   */
  private _advanceTrustIssue(
    currentTurn: ConversationTurn,
    action: UserAction,
    _payload: InterventionPayload,
  ): TurnAdvanceResult {
    const { turnIndex } = currentTurn;

    if (turnIndex === 0 && action.actionType === 'expand_detail') {
      const section = this._extractSection(action.payload);

      let turn1: ConversationTurn;

      if (section === 'return_policy') {
        turn1 = {
          turnIndex: 1,
          isTerminal: false,
          content: {
            headline: 'Our Return Policy',
            body: 'We offer a 30-day hassle-free return policy. If you\'re not completely satisfied, return any item in its original condition for a full refund — no questions asked. Returns are free for orders over $50.',
            actions: [
              { label: 'Got it', actionType: 'dismiss' },
              {
                label: 'See security details',
                actionType: 'expand_detail',
                payload: { section: 'security' },
              },
              { label: 'Dismiss', actionType: 'dismiss' },
            ],
          },
        };
      } else if (section === 'security') {
        turn1 = {
          turnIndex: 1,
          isTerminal: false,
          content: {
            headline: 'Secure Checkout',
            body: 'Your payment information is protected by 256-bit SSL encryption. We are PCI DSS compliant and never store your full card details. All transactions are processed through certified payment gateways.',
            actions: [
              { label: 'Got it', actionType: 'dismiss' },
              {
                label: 'See return policy',
                actionType: 'expand_detail',
                payload: { section: 'return_policy' },
              },
              { label: 'Dismiss', actionType: 'dismiss' },
            ],
          },
        };
      } else if (section === 'reviews') {
        turn1 = {
          turnIndex: 1,
          isTerminal: false,
          content: {
            headline: 'What customers say',
            body: 'Over 10,000 verified customers have rated us 4.8 out of 5 stars. "Fast shipping and great quality" — Sarah M. "Easy returns, no hassle" — James T. "Exactly as described" — Priya K.',
            actions: [
              { label: 'Got it', actionType: 'dismiss' },
              { label: 'Dismiss', actionType: 'dismiss' },
            ],
          },
        };
      } else {
        // Unknown section — escalate
        return {
          nextTurn: escalationTurn(
            1,
            'Still have concerns?',
            'Our support team is here to help with any questions.',
          ),
          resolved: false,
        };
      }

      return { nextTurn: turn1, resolved: false };
    }

    if (turnIndex >= 1) {
      return {
        nextTurn: escalationTurn(
          2,
          'Still have concerns?',
          'Our support team is here to help with any questions.',
        ),
        resolved: false,
      };
    }

    return {
      nextTurn: escalationTurn(
        turnIndex + 1,
        'Still have concerns?',
        'Our support team is here to help with any questions.',
      ),
      resolved: false,
    };
  }

  /**
   * Size_Uncertainty flow (max 3 follow-ups — Requirement 8.2).
   *
   * Turn 0: Show available sizes (from payload).
   * expand_detail → Turn 1: "What's your height and build?" with 4 options.
   * Turn 2: Recommended size with "Select [size]" and "See full size chart" buttons.
   * Turn 3 (escalation): "Still unsure? Our size guide has detailed measurements."
   *
   * Requirements: 4.2, 4.4, 8.2
   */
  private _advanceSizeUncertainty(
    currentTurn: ConversationTurn,
    action: UserAction,
    _payload: InterventionPayload,
  ): TurnAdvanceResult {
    const { turnIndex } = currentTurn;

    if (turnIndex === 0 && action.actionType === 'expand_detail') {
      const turn1: ConversationTurn = {
        turnIndex: 1,
        isTerminal: false,
        content: {
          headline: "What's your height and build?",
          body: "We'll recommend the best size for you based on your measurements.",
          actions: [
            {
              label: "Under 5'6\" / Petite",
              actionType: 'expand_detail',
              payload: { build: 'petite' },
            },
            {
              label: "5'6\"–5'10\" / Average",
              actionType: 'expand_detail',
              payload: { build: 'average' },
            },
            {
              label: "Over 5'10\" / Tall",
              actionType: 'expand_detail',
              payload: { build: 'tall' },
            },
            {
              label: 'I prefer measurements',
              actionType: 'expand_detail',
              payload: { build: 'measurements' },
            },
          ],
        },
      };
      return { nextTurn: turn1, resolved: false };
    }

    if (turnIndex === 1 && action.actionType === 'expand_detail') {
      // Derive a size recommendation from the build selection
      const build = this._extractBuild(action.payload);
      const { recommendedSize, variantId } = this._recommendSize(build);

      const turn2: ConversationTurn = {
        turnIndex: 2,
        isTerminal: false,
        content: {
          headline: `We recommend size ${recommendedSize}`,
          body: `Based on your height and build, ${recommendedSize} should be the best fit. You can also view the full size chart for exact measurements.`,
          actions: [
            {
              label: `Select ${recommendedSize}`,
              actionType: 'select_variant',
              payload: { variantId, size: recommendedSize },
            },
            {
              label: 'See full size chart',
              actionType: 'expand_detail',
              payload: { section: 'size_chart' },
            },
          ],
        },
      };
      return { nextTurn: turn2, resolved: false };
    }

    if (turnIndex >= 2) {
      // Turn 3: escalation (Requirement 8.2 — max 3 follow-ups for Size_Uncertainty)
      return {
        nextTurn: escalationTurn(
          3,
          'Still unsure about sizing?',
          'Our size guide has detailed measurements for every size. You can also contact our support team for personalised advice.',
        ),
        resolved: false,
      };
    }

    // Fallback for unexpected states
    return {
      nextTurn: escalationTurn(
        turnIndex + 1,
        'Still unsure about sizing?',
        'Our size guide has detailed measurements for every size.',
      ),
      resolved: false,
    };
  }

  /**
   * Payment_Options flow (max 2 follow-ups).
   *
   * Turn 0: Show payment methods (from payload).
   * Turn 1: "Do you need help setting up a payment method?"
   *   with "Yes, help me" and "No, I'll figure it out" buttons.
   * Turn 2 (escalation): "Our support team can help you complete your payment."
   *
   * Requirements: 4.2, 4.4
   */
  private _advancePaymentOptions(
    currentTurn: ConversationTurn,
    _action: UserAction,
    _payload: InterventionPayload,
  ): TurnAdvanceResult {
    const { turnIndex } = currentTurn;

    if (turnIndex === 0) {
      const turn1: ConversationTurn = {
        turnIndex: 1,
        isTerminal: false,
        content: {
          headline: 'Need help with payment?',
          body: 'Do you need help setting up a payment method?',
          actions: [
            {
              label: 'Yes, help me',
              actionType: 'expand_detail',
              payload: { section: 'payment_help' },
            },
            {
              label: "No, I'll figure it out",
              actionType: 'dismiss',
            },
          ],
        },
      };
      return { nextTurn: turn1, resolved: false };
    }

    // Turn 1 or beyond → escalate
    return {
      nextTurn: escalationTurn(
        2,
        'Need payment assistance?',
        'Our support team can help you complete your payment.',
      ),
      resolved: false,
    };
  }

  /**
   * Missing_Information flow (max 2 follow-ups).
   *
   * Turn 0: Show missing fields summary (from payload).
   * expand_detail { section: 'missing_fields' } → Turn 1: Each missing field with
   *   plain-language explanation and "Fix: [field label]" ActionButton per field.
   *   Uses supplementalData.missingFields if present.
   * Turn 2: "All fields highlighted above are required..." with dismiss button.
   *
   * Requirements: 4.2, 4.4, 10.2, 10.3
   */
  private _advanceMissingInformation(
    currentTurn: ConversationTurn,
    action: UserAction,
    payload: InterventionPayload,
  ): TurnAdvanceResult {
    const { turnIndex } = currentTurn;

    if (turnIndex === 0 && action.actionType === 'expand_detail') {
      const section = this._extractSection(action.payload);

      if (section === 'missing_fields') {
        // Build per-field action buttons (Requirement 10.2, 10.3)
        const missingFields = this._extractMissingFields(payload);

        const fieldActions: ActionButton[] = missingFields.map((field) => ({
          label: `Fix: ${field.label}`,
          actionType: 'expand_detail' as const,
          payload: { fieldId: field.fieldId },
        }));

        fieldActions.push({ label: 'Dismiss', actionType: 'dismiss' });

        // Build body with plain-language explanation per field
        const fieldDescriptions = missingFields
          .map((f) => {
            const explanation = f.errorMessage !== undefined && f.errorMessage.length > 0
              ? f.errorMessage
              : `${f.label} is required to complete your order.`;
            return `• ${f.label}: ${explanation}`;
          })
          .join('\n');

        const body = missingFields.length > 0
          ? `The following fields need your attention:\n\n${fieldDescriptions}`
          : 'Some required fields are missing or invalid. Please review your form and fill in all required fields.';

        const turn1: ConversationTurn = {
          turnIndex: 1,
          isTerminal: false,
          content: {
            headline: 'Fields that need attention',
            body,
            actions: fieldActions,
          },
        };
        return { nextTurn: turn1, resolved: false };
      }
    }

    if (turnIndex >= 1) {
      // Turn 2: reminder with dismiss
      const turn2: ConversationTurn = {
        turnIndex: 2,
        isTerminal: true,
        content: {
          headline: 'Required fields',
          body: 'All fields highlighted above are required to complete your order. Please fill them in and try again.',
          actions: [{ label: 'Dismiss', actionType: 'dismiss' }],
        },
      };
      return { nextTurn: turn2, resolved: false };
    }

    // Fallback for unexpected states at turn 0
    return {
      nextTurn: escalationTurn(
        turnIndex + 1,
        'Required fields',
        'All highlighted fields are required to complete your order.',
      ),
      resolved: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Private utility helpers
  // ---------------------------------------------------------------------------

  /**
   * Safely extract the `section` string from an action payload.
   */
  private _extractSection(actionPayload: unknown): string | null {
    if (
      actionPayload !== null &&
      typeof actionPayload === 'object' &&
      'section' in actionPayload &&
      typeof (actionPayload as Record<string, unknown>)['section'] === 'string'
    ) {
      return (actionPayload as Record<string, string>)['section'] ?? null;
    }
    return null;
  }

  /**
   * Safely extract the `build` string from a Size_Uncertainty action payload.
   */
  private _extractBuild(actionPayload: unknown): string {
    if (
      actionPayload !== null &&
      typeof actionPayload === 'object' &&
      'build' in actionPayload &&
      typeof (actionPayload as Record<string, unknown>)['build'] === 'string'
    ) {
      return (actionPayload as Record<string, string>)['build'] ?? 'average';
    }
    return 'average';
  }

  /**
   * Map a build selection to a recommended size label and a placeholder variantId.
   * In production the variantId would come from the size guide inventory.
   */
  private _recommendSize(build: string): { recommendedSize: string; variantId: string } {
    switch (build) {
      case 'petite':
        return { recommendedSize: 'S', variantId: 'variant-S' };
      case 'tall':
        return { recommendedSize: 'L', variantId: 'variant-L' };
      case 'measurements':
        return { recommendedSize: 'M', variantId: 'variant-M' };
      case 'average':
      default:
        return { recommendedSize: 'M', variantId: 'variant-M' };
    }
  }

  /**
   * Extract the offers array from supplementalData, if present.
   */
  private _extractOffers(
    payload: InterventionPayload,
  ): Array<{ couponCode?: string; offerId: string }> {
    const data = payload.content.supplementalData;
    if (data === undefined) return [];

    const offers = data['offers'];
    if (!Array.isArray(offers)) return [];

    return offers.filter(
      (o): o is { couponCode?: string; offerId: string } =>
        o !== null &&
        typeof o === 'object' &&
        typeof (o as Record<string, unknown>)['offerId'] === 'string',
    );
  }

  /**
   * Extract the missingFields array from supplementalData, if present.
   * Shape: { fieldId: string, label: string, errorMessage?: string }[]
   *
   * Requirements: 10.2, 10.3
   */
  private _extractMissingFields(
    payload: InterventionPayload,
  ): Array<{ fieldId: string; label: string; errorMessage?: string }> {
    const data = payload.content.supplementalData;
    if (data === undefined) return [];

    const fields = data['missingFields'];
    if (!Array.isArray(fields)) return [];

    return fields.filter(
      (f): f is { fieldId: string; label: string; errorMessage?: string } => {
        if (f === null || typeof f !== 'object') return false;
        const rec = f as Record<string, unknown>;
        return (
          typeof rec['fieldId'] === 'string' &&
          typeof rec['label'] === 'string'
        );
      },
    );
  }
}

export default TurnSequencerImpl;
