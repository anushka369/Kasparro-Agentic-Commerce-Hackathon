/**
 * Signal weight configuration for the deterministic friction classifier.
 *
 * Each FrictionCategory has a set of SignalSnapshot keys with associated
 * weights. Weights within a category MUST sum to 1.0.
 */

import type { FrictionCategory, SignalSnapshot } from './index.js';

/**
 * Maps each FrictionCategory to a partial set of SignalSnapshot keys and
 * their corresponding weights. Only the keys listed for a category
 * contribute to that category's score.
 */
export type SignalWeightMap = Record<
  FrictionCategory,
  Partial<Record<keyof SignalSnapshot, number>>
>;

/**
 * Default signal weights for all eight friction categories.
 *
 * Design rationale per category:
 *
 * Price_Hesitation — user lingers and shows exit intent without field errors.
 *   exitIntentDetected dominates; time on page and idle are secondary.
 *
 * Shipping_Confusion — user repeatedly interacts with shipping fields.
 *   fieldEvents dominates; exit intent and time on page are secondary.
 *
 * Trust_Issue — user scrolls to review sections and shows exit intent.
 *   exitIntentDetected and scrollDepthPct share the load; idle is secondary.
 *
 * Missing_Information — field error events dominate; idle and time on page
 *   indicate the user is stuck.
 *
 * Coupon_Confusion — user focuses on the coupon field repeatedly.
 *   fieldEvents dominates; time on page and idle are secondary.
 *
 * Size_Uncertainty — user scrolls back to product details and is idle.
 *   scrollDepthPct and idle share the load; back navigation is a strong signal.
 *
 * Delivery_Timeline — similar to Shipping_Confusion but scroll depth
 *   (reading delivery info) is more prominent than field events.
 *
 * Payment_Options — user reaches the payment step and shows exit intent.
 *   exitIntentDetected and fieldEvents share the load; idle is secondary.
 */
export const DEFAULT_WEIGHTS: SignalWeightMap = {
  Price_Hesitation: {
    timeOnPageMs: 0.30,
    scrollDepthPct: 0.15,
    exitIntentDetected: 0.35,
    idleDetected: 0.20,
    // sum: 1.00
  },

  Shipping_Confusion: {
    timeOnPageMs: 0.20,
    fieldEvents: 0.40,
    scrollDepthPct: 0.15,
    exitIntentDetected: 0.25,
    // sum: 1.00
  },

  Trust_Issue: {
    scrollDepthPct: 0.25,
    exitIntentDetected: 0.35,
    idleDetected: 0.20,
    backNavigationAttempted: 0.20,
    // sum: 1.00
  },

  Missing_Information: {
    fieldEvents: 0.60,
    timeOnPageMs: 0.20,
    idleDetected: 0.20,
    // sum: 1.00
  },

  Coupon_Confusion: {
    fieldEvents: 0.50,
    timeOnPageMs: 0.25,
    idleDetected: 0.15,
    exitIntentDetected: 0.10,
    // sum: 1.00
  },

  Size_Uncertainty: {
    scrollDepthPct: 0.30,
    idleDetected: 0.25,
    backNavigationAttempted: 0.30,
    timeOnPageMs: 0.15,
    // sum: 1.00
  },

  Delivery_Timeline: {
    scrollDepthPct: 0.30,
    fieldEvents: 0.25,
    exitIntentDetected: 0.25,
    idleDetected: 0.20,
    // sum: 1.00
  },

  Payment_Options: {
    exitIntentDetected: 0.35,
    fieldEvents: 0.30,
    idleDetected: 0.20,
    timeOnPageMs: 0.15,
    // sum: 1.00
  },
} as const;
