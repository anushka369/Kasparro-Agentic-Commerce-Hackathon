/**
 * FrictionDetector — Orchestrator for the two-tier friction classification pipeline.
 *
 * Attaches a SignalCollector to the DOM, runs a 500ms classification loop,
 * and emits FrictionEvents when confidence reaches the configured threshold.
 *
 * Two-tier classification:
 *   Tier 1 — Deterministic rule engine (always runs, no network).
 *     If unambiguous AND confidence ≥ threshold → emit FrictionEvent.
 *     If ambiguous → fall through to Tier 2.
 *   Tier 2 — LLM Gateway (async, 2s timeout via AbortController).
 *     On success with confidence ≥ threshold → emit FrictionEvent.
 *     On failure → use Tier 1 result if confidence ≥ threshold, else suppress.
 *
 * Each classification cycle is guarded by `classificationTimeoutMs` via a
 * separate AbortController so a slow LLM call never blocks the next cycle.
 *
 * Once a FrictionEvent for a given category has been emitted in this session,
 * the same category is never re-emitted (deduplication).
 *
 * Error handling: every code path is wrapped in try/catch. The detector
 * never throws and never blocks checkout progress.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.6, 12.1
 */

import type {
  DetectorConfig,
  FrictionCategory,
  FrictionEvent,
  SignalSnapshot,
} from '../types/index.js';
import { SignalCollector } from './SignalCollector.js';
import { classifyDeterministic } from './DeterministicClassifier.js';
import { DEFAULT_WEIGHTS } from '../types/weights.js';

// ---------------------------------------------------------------------------
// LLM Gateway response shape
// ---------------------------------------------------------------------------

interface LlmGatewayResponse {
  category: FrictionCategory | null;
  confidence: number;
  reasoning?: string;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface FrictionDetector {
  /** Start observing the checkout page. Must be called once on page load. */
  start(config: DetectorConfig): void;
  /** Stop observing and clean up all event listeners and timers. */
  stop(): void;
  /** Register a callback invoked when a FrictionEvent is ready. */
  onFrictionEvent(handler: (event: FrictionEvent) => void): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Classification loop interval in milliseconds. */
const CLASSIFICATION_INTERVAL_MS = 500;

/**
 * URL of the LLM Gateway serverless function.
 * Configurable via the LLM_GATEWAY_URL global or environment variable.
 * Falls back to a relative path suitable for same-origin deployments.
 */
function getLlmGatewayUrl(): string {
  // Allow runtime override via a global variable (set by the Script Tag host page)
  if (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as Record<string, unknown>)['LLM_GATEWAY_URL'] === 'string'
  ) {
    return (globalThis as Record<string, unknown>)['LLM_GATEWAY_URL'] as string;
  }
  return '/classify';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of the FrictionDetector interface.
 *
 * Usage:
 *   const detector = new FrictionDetectorImpl('session-uuid');
 *   detector.onFrictionEvent((event) => { ... });
 *   detector.start(config);
 *   // later:
 *   detector.stop();
 */
export class FrictionDetectorImpl implements FrictionDetector {
  /** Session identifier included in every emitted FrictionEvent. */
  private readonly sessionId: string;

  /** Registered friction event handlers. */
  private readonly handlers: Array<(event: FrictionEvent) => void> = [];

  /** The active SignalCollector instance, set on start(). */
  private collector: SignalCollector | null = null;

  /** Handle returned by setInterval for the classification loop. */
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /** Categories already emitted in this session — prevents re-emission. */
  private readonly emittedCategories = new Set<FrictionCategory>();

  /** True while a classification cycle is in progress (prevents overlap). */
  private classifying = false;

  /** The active DetectorConfig, set on start(). */
  private config: DetectorConfig | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // ---------------------------------------------------------------------------
  // FrictionDetector interface
  // ---------------------------------------------------------------------------

  /**
   * Attach a SignalCollector and start the 500ms classification loop.
   * Calling start() while already running is a no-op.
   */
  start(config: DetectorConfig): void {
    if (this.intervalHandle !== null) {
      // Already running — ignore duplicate start() calls
      return;
    }

    this.config = config;

    try {
      this.collector = new SignalCollector(config);
      this.collector.start();
    } catch (err) {
      console.error('[FrictionDetector] Failed to start SignalCollector:', err);
      // Continue without signal collection — graceful degradation (Req 12.1)
    }

    this.intervalHandle = setInterval(() => {
      void this._runClassificationCycle();
    }, CLASSIFICATION_INTERVAL_MS);
  }

  /**
   * Stop the classification loop and detach all listeners.
   * Safe to call multiple times.
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    if (this.collector !== null) {
      try {
        this.collector.stop();
      } catch (err) {
        console.error('[FrictionDetector] Error stopping SignalCollector:', err);
      }
      this.collector = null;
    }

    this.config = null;
    this.classifying = false;
  }

  /**
   * Register a callback that will be invoked for each FrictionEvent.
   * Multiple handlers can be registered; all are called in registration order.
   */
  onFrictionEvent(handler: (event: FrictionEvent) => void): void {
    this.handlers.push(handler);
  }

  // ---------------------------------------------------------------------------
  // Classification cycle
  // ---------------------------------------------------------------------------

  /**
   * Run a single classification cycle, guarded by `classificationTimeoutMs`.
   *
   * The cycle is skipped if:
   * - A previous cycle is still in progress (prevents overlap).
   * - The detector has been stopped (config is null).
   * - The SignalCollector is unavailable.
   */
  private async _runClassificationCycle(): Promise<void> {
    if (this.classifying || this.config === null || this.collector === null) {
      return;
    }

    this.classifying = true;

    // Guard the entire cycle with classificationTimeoutMs
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.classificationTimeoutMs,
    );

    try {
      await this._classify(this.config, controller.signal);
    } catch (err) {
      // AbortError = cycle timed out; all other errors are unexpected
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('[FrictionDetector] Classification cycle timed out');
      } else {
        console.error('[FrictionDetector] Unexpected error in classification cycle:', err);
      }
    } finally {
      clearTimeout(timeoutId);
      this.classifying = false;
    }
  }

  /**
   * Core classification logic for a single cycle.
   *
   * 1. Take a signal snapshot.
   * 2. Run Tier 1 (deterministic).
   * 3a. If unambiguous AND confidence ≥ threshold → emit and return.
   * 3b. If ambiguous → call LLM Gateway (Tier 2).
   *     - On LLM success with confidence ≥ threshold → emit.
   *     - On LLM failure → fall back to Tier 1 if confidence ≥ threshold.
   *
   * @param config  The active DetectorConfig.
   * @param signal  AbortSignal from the cycle-level timeout guard.
   */
  private async _classify(
    config: DetectorConfig,
    signal: AbortSignal,
  ): Promise<void> {
    // Bail out immediately if the cycle was already aborted
    if (signal.aborted) return;

    // Snapshot — collector is guaranteed non-null by the caller
    let snapshot: SignalSnapshot;
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      snapshot = this.collector!.getSnapshot();
    } catch (err) {
      console.error('[FrictionDetector] Failed to get signal snapshot:', err);
      return;
    }

    // Tier 1: deterministic classification
    let tier1Result;
    try {
      tier1Result = classifyDeterministic(snapshot, DEFAULT_WEIGHTS);
    } catch (err) {
      console.error('[FrictionDetector] Deterministic classification failed:', err);
      return;
    }

    const { category, confidence, isAmbiguous, allScores } = tier1Result;

    // Check for abort before potentially making a network call
    if (signal.aborted) return;

    if (!isAmbiguous && confidence >= config.confidenceThreshold) {
      // Tier 1 unambiguous result — emit directly
      this._maybeEmit(category, confidence, snapshot);
      return;
    }

    if (isAmbiguous) {
      // Tier 2: LLM-assisted classification
      const topTwo = this._topTwoCategories(allScores);
      const llmResult = await this._callLlmGateway(snapshot, topTwo, signal);

      if (signal.aborted) return;

      if (
        llmResult !== null &&
        llmResult.category !== null &&
        llmResult.confidence >= config.confidenceThreshold
      ) {
        // LLM succeeded with sufficient confidence
        this._maybeEmit(llmResult.category, llmResult.confidence, snapshot);
        return;
      }

      // LLM failed or returned low confidence — fall back to Tier 1
      if (confidence >= config.confidenceThreshold) {
        this._maybeEmit(category, confidence, snapshot);
      }
      // else: suppress (confidence too low on both tiers)
    }

    // Non-ambiguous but confidence < threshold: suppress and wait for more signals
  }

  // ---------------------------------------------------------------------------
  // LLM Gateway call
  // ---------------------------------------------------------------------------

  /**
   * Call the LLM Gateway with the current signal snapshot and the top two
   * deterministic categories. Applies the cycle-level AbortSignal so the
   * call is cancelled if the overall classification timeout fires.
   *
   * Returns null on any failure (network error, timeout, invalid response).
   */
  private async _callLlmGateway(
    signals: SignalSnapshot,
    topTwoCategories: [string, string],
    signal: AbortSignal,
  ): Promise<LlmGatewayResponse | null> {
    try {
      const url = getLlmGatewayUrl();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals, topTwoCategories }),
        signal,
      });

      if (!response.ok) {
        console.warn(
          `[FrictionDetector] LLM Gateway returned HTTP ${response.status}`,
        );
        return null;
      }

      const data = (await response.json()) as unknown;
      return this._parseLlmResponse(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Timeout — expected failure path (Req 2.6)
        console.warn('[FrictionDetector] LLM Gateway call timed out');
      } else {
        console.error('[FrictionDetector] LLM Gateway call failed:', err);
      }
      return null;
    }
  }

  /**
   * Validate and parse the raw JSON response from the LLM Gateway.
   * Returns null if the shape is unexpected.
   */
  private _parseLlmResponse(data: unknown): LlmGatewayResponse | null {
    if (typeof data !== 'object' || data === null) return null;

    const obj = data as Record<string, unknown>;

    // category may be null (gateway returns null on failure)
    const category = obj['category'];
    if (category !== null && typeof category !== 'string') return null;

    const confidence = obj['confidence'];
    if (typeof confidence !== 'number') return null;

    if (typeof obj['reasoning'] === 'string') {
      return {
        category: category as FrictionCategory | null,
        confidence,
        reasoning: obj['reasoning'],
      };
    }

    return {
      category: category as FrictionCategory | null,
      confidence,
    };
  }

  // ---------------------------------------------------------------------------
  // Emission helpers
  // ---------------------------------------------------------------------------

  /**
   * Emit a FrictionEvent for the given category, unless it has already been
   * emitted in this session (deduplication per Req 2.3 / 3.3).
   */
  private _maybeEmit(
    category: FrictionCategory,
    confidence: number,
    signals: SignalSnapshot,
  ): void {
    if (this.emittedCategories.has(category)) {
      return;
    }

    this.emittedCategories.add(category);

    const event: FrictionEvent = {
      sessionId: this.sessionId,
      category,
      confidence,
      signals,
      detectedAt: Date.now(),
    };

    this._dispatchEvent(event);
  }

  /**
   * Invoke all registered handlers with the given FrictionEvent.
   * Each handler is called in a separate try/catch so a failing handler
   * cannot prevent subsequent handlers from running.
   */
  private _dispatchEvent(event: FrictionEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[FrictionDetector] Error in FrictionEvent handler:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Extract the top two category names from the allScores map, sorted by
   * score descending. Returns a tuple of two strings; if fewer than two
   * categories exist, the second entry is an empty string.
   */
  private _topTwoCategories(
    allScores: Partial<Record<FrictionCategory, number>>,
  ): [string, string] {
    const sorted = (
      Object.entries(allScores) as Array<[FrictionCategory, number]>
    ).sort(([, a], [, b]) => b - a);

    const first = sorted[0]?.[0] ?? '';
    const second = sorted[1]?.[0] ?? '';
    return [first, second];
  }
}

export default FrictionDetectorImpl;
