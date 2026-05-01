/**
 * DeterministicClassifier — Tier 1 friction classification.
 *
 * Computes a weighted score for each FrictionCategory based on normalized
 * behavioral signals, normalizes all scores to [0, 1], and returns the
 * top-scoring category along with a confidence value and ambiguity flag.
 *
 * Requirements: 2.1, 2.2, 2.5, 2.6
 */

import type { FrictionCategory, SignalSnapshot } from '../types/index.js';
import { ALL_FRICTION_CATEGORIES } from '../types/index.js';
import type { SignalWeightMap } from '../types/weights.js';

export { ALL_FRICTION_CATEGORIES };

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * The output of the deterministic classifier.
 */
export interface ClassificationResult {
  /** The primary friction category with the highest weighted score. */
  category: FrictionCategory;
  /** Normalized confidence score in [0.0, 1.0]. */
  confidence: number;
  /**
   * True when the gap between the top and second-highest score is less than
   * 0.15 — indicating the classification is ambiguous and may benefit from
   * LLM-assisted Tier 2 classification.
   */
  isAmbiguous: boolean;
  /** Normalized scores for all categories. */
  allScores: Partial<Record<FrictionCategory, number>>;
}

// ---------------------------------------------------------------------------
// Signal normalization constants
// ---------------------------------------------------------------------------

/** Maximum time on page used for normalization (5 minutes). */
const MAX_TIME_ON_PAGE_MS = 300_000;

/** Maximum cursor velocity used for normalization (px/ms). */
const MAX_CURSOR_VELOCITY = 5;

/** Maximum field event count used for normalization. */
const MAX_FIELD_EVENTS = 10;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a raw signal value to [0, 1] based on the signal key.
 * Returns 0 for `checkoutStep` (non-numeric, excluded from scoring).
 */
function normalizeSignal(
  key: keyof SignalSnapshot,
  snapshot: SignalSnapshot,
): number {
  switch (key) {
    case 'timeOnPageMs':
      return Math.min(1, snapshot.timeOnPageMs / MAX_TIME_ON_PAGE_MS);

    case 'scrollDepthPct':
      return Math.min(1, snapshot.scrollDepthPct / 100);

    case 'cursorVelocityAvg':
      return Math.min(1, snapshot.cursorVelocityAvg / MAX_CURSOR_VELOCITY);

    case 'exitIntentDetected':
      return snapshot.exitIntentDetected ? 1 : 0;

    case 'idleDetected':
      return snapshot.idleDetected ? 1 : 0;

    case 'fieldEvents':
      return Math.min(1, snapshot.fieldEvents.length / MAX_FIELD_EVENTS);

    case 'backNavigationAttempted':
      return snapshot.backNavigationAttempted ? 1 : 0;

    case 'checkoutStep':
      // Non-numeric — excluded from weighted sum
      return 0;

    default: {
      // Exhaustiveness guard — TypeScript will catch unhandled keys at compile time
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

/**
 * Compute the raw weighted score for a single category given the signal
 * snapshot and the category's weight map.
 *
 * Missing weights are treated as 0 (the category simply doesn't use that
 * signal). `checkoutStep` is always skipped.
 */
function computeWeightedScore(
  signals: SignalSnapshot,
  categoryWeights: Partial<Record<keyof SignalSnapshot, number>> | undefined,
): number {
  if (categoryWeights === undefined) {
    return 0;
  }

  let score = 0;

  for (const rawKey of Object.keys(categoryWeights) as Array<keyof SignalSnapshot>) {
    if (rawKey === 'checkoutStep') continue;

    const weight = categoryWeights[rawKey];
    if (weight === undefined || weight === 0) continue;

    score += normalizeSignal(rawKey, signals) * weight;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify the friction category for a given signal snapshot.
 *
 * Steps:
 * 1. Compute a raw weighted score for each of the 8 FrictionCategories.
 * 2. Normalize all scores to [0, 1] by dividing by the maximum score.
 * 3. Return the top category, its normalized confidence, an ambiguity flag
 *    (gap between top and second < 0.15), and all normalized scores.
 *
 * Edge cases:
 * - All zero scores → first category returned with confidence 0, isAmbiguous true.
 * - Single non-zero score → isAmbiguous false (gap is the full score).
 * - Missing weights for a category → treated as 0 score.
 */
export function classifyDeterministic(
  signals: SignalSnapshot,
  weights: SignalWeightMap,
): ClassificationResult {
  // Step 1: compute raw weighted scores for every category
  const rawScores: Partial<Record<FrictionCategory, number>> = {};

  for (const category of ALL_FRICTION_CATEGORIES) {
    rawScores[category] = computeWeightedScore(signals, weights[category]);
  }

  // Step 2: normalize scores to [0, 1]
  const maxRaw = Math.max(...(Object.values(rawScores) as number[]));

  const scores: Partial<Record<FrictionCategory, number>> = {};
  for (const category of ALL_FRICTION_CATEGORIES) {
    const raw = rawScores[category] ?? 0;
    scores[category] = maxRaw > 0 ? raw / maxRaw : 0;
  }

  // Step 3: sort by normalized score descending
  const sorted = (Object.entries(scores) as Array<[FrictionCategory, number]>).sort(
    ([, a], [, b]) => b - a,
  );

  // ALL_FRICTION_CATEGORIES is non-empty (8 entries), so sorted is always non-empty.
  // We use a non-null assertion here because the compiler cannot infer this statically
  // under noUncheckedIndexedAccess, but the invariant is guaranteed by the loop above.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const [topCategory, topScore] = sorted[0]!;
  const secondScore = sorted[1]?.[1] ?? 0;

  return {
    category: topCategory,
    confidence: topScore,
    isAmbiguous: topScore - secondScore < 0.15,
    allScores: scores,
  };
}
