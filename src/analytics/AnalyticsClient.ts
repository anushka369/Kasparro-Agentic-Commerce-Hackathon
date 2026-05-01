/**
 * Analytics client for flushing session data to the Analytics Service.
 *
 * Uses navigator.sendBeacon (primary) with fetch fallback and one retry
 * on failure with a 1-second delay.
 *
 * Requirements: 11.1, 11.2, 12.1
 */

import type { SessionRecord, FrictionCategory, RecoveryActionType } from '../types/index.js';
import type { SessionState } from '../session/SessionState.js';

export interface AnalyticsClientConfig {
  /** Base URL of the Analytics Service (e.g., "https://analytics.example.com"). */
  analyticsServiceUrl: string;
  /** Shopify shop domain (e.g., "my-store.myshopify.com"). */
  platformId: string;
}

/**
 * Default recovery action per friction category.
 * Used when serializing InterventionRecord to SessionRecord, since
 * InterventionRecord does not store the recoveryAction chosen at runtime.
 * Price_Hesitation defaults to 'show_coupon' (the more common path).
 */
const CATEGORY_DEFAULT_RECOVERY_ACTION: Record<
  FrictionCategory,
  RecoveryActionType
> = {
  Price_Hesitation: 'show_coupon',
  Shipping_Confusion: 'show_shipping_options',
  Trust_Issue: 'show_trust_signals',
  Missing_Information: 'highlight_missing_fields',
  Coupon_Confusion: 'show_coupon',
  Size_Uncertainty: 'show_size_guide',
  Delivery_Timeline: 'show_delivery_estimate',
  Payment_Options: 'show_payment_options',
};

/**
 * Serialize a SessionState instance to a SessionRecord for persistence.
 * Converts Unix ms timestamps to ISO 8601 strings.
 * Pending interventions are mapped to 'timed_out'.
 * Exported for testability.
 */
export function serializeSession(
  session: SessionState,
  platformId: string,
): SessionRecord {
  // endedAt should be set by the time we serialize; fall back to now if not
  const endedAtMs = session.endedAt ?? Date.now();

  return {
    sessionId: session.sessionId,
    platformId,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    checkoutStepReached: session.checkoutStep,
    frictionEvents: session.frictionEvents.map((event) => ({
      category: event.category,
      confidence: event.confidence,
      detectedAt: new Date(event.detectedAt).toISOString(),
    })),
    interventions: session.interventions.map((intervention) => ({
      interventionId: intervention.interventionId,
      category: intervention.category,
      // InterventionRecord does not store recoveryAction; derive from category
      recoveryAction: CATEGORY_DEFAULT_RECOVERY_ACTION[intervention.category],
      triggeredAt: new Date(intervention.triggeredAt).toISOString(),
      // Map 'pending' → 'timed_out' since SessionRecord does not allow 'pending'
      outcome:
        intervention.outcome === 'pending' ? 'timed_out' : intervention.outcome,
    })),
    converted: session.converted,
  };
}

/**
 * Client for flushing session data to the Analytics Service.
 * Uses navigator.sendBeacon (primary) with fetch fallback and one retry.
 */
export class AnalyticsClient {
  private readonly analyticsServiceUrl: string;
  private readonly platformId: string;

  constructor(config: AnalyticsClientConfig) {
    this.analyticsServiceUrl = config.analyticsServiceUrl;
    this.platformId = config.platformId;
  }

  /**
   * Flush the session to the Analytics Service.
   * Calls session.end() to ensure endedAt is set before serializing.
   * Fire-and-forget — never throws.
   */
  flush(session: SessionState): void {
    // Ensure endedAt is set
    session.end();

    const record = serializeSession(session, this.platformId);
    const url = `${this.analyticsServiceUrl}/session`;
    const body = JSON.stringify(record);

    // Attempt sendBeacon first (best-effort, no response handling)
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      const sent = navigator.sendBeacon(
        url,
        new Blob([body], { type: 'application/json' }),
      );
      if (sent) {
        // sendBeacon accepted the payload — we're done
        return;
      }
      // sendBeacon returned false (e.g., queue full) — fall through to fetch
    }

    // Fetch fallback with one retry
    this.sendWithRetry(url, body);
  }

  /**
   * Attempt a POST via fetch. On failure, retry once after 1 second.
   * Drops silently if the retry also fails.
   */
  private sendWithRetry(url: string, body: string): void {
    this.sendFetch(url, body).catch(() => {
      // First attempt failed — retry once after 1 second
      setTimeout(() => {
        this.sendFetch(url, body).catch((err: unknown) => {
          // Retry also failed — drop silently
          console.error('[AnalyticsClient] Failed to send session record after retry:', err);
        });
      }, 1000);
    });
  }

  /**
   * Send a single POST request via fetch.
   * Rejects if the network request fails or the server returns a non-ok status.
   */
  private async sendFetch(url: string, body: string): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new Error(
        `[AnalyticsClient] HTTP ${response.status} from ${url}`,
      );
    }
  }
}

export default AnalyticsClient;
