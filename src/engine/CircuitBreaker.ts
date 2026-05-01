/**
 * Circuit breaker pattern for wrapping Platform_Adapter calls.
 *
 * Opens after 3 consecutive failures within a 60-second window.
 * Suppresses all calls for 30 seconds while open.
 * Transitions to half-open on the first call after nextRetryAt has passed,
 * allowing a single probe call through to test recovery.
 *
 * Requirements: 12.2
 */

import type { CircuitBreakerState } from '../types/index.js';

/** Number of consecutive failures before the circuit opens. */
const FAILURE_THRESHOLD = 3;

/** Window in milliseconds within which failures are counted. */
const FAILURE_WINDOW_MS = 60_000;

/** Duration in milliseconds the circuit stays open before allowing a probe. */
const RETRY_DELAY_MS = 30_000;

export class CircuitBreaker {
  private state: CircuitBreakerState = {
    status: 'closed',
    failureCount: 0,
    lastFailureAt: 0,
    nextRetryAt: 0,
  };

  /**
   * Returns a read-only snapshot of the current circuit breaker state.
   * Useful for inspection and testing.
   */
  getState(): Readonly<CircuitBreakerState> {
    return { ...this.state };
  }

  /**
   * Wraps an async operation with circuit breaker protection.
   *
   * - If the circuit is **open** and the retry window has not elapsed,
   *   throws immediately without calling `fn`.
   * - If the circuit is **open** and the retry window has elapsed,
   *   transitions to **half-open** and allows one probe call through.
   * - If the circuit is **half-open**, allows the probe call:
   *   - On success → closes the circuit and resets failure count.
   *   - On failure → re-opens the circuit and resets the retry window.
   * - If the circuit is **closed**, calls `fn` normally:
   *   - On success → resets the failure count.
   *   - On failure → increments the failure count; if the threshold is
   *     reached within the failure window, opens the circuit.
   *
   * @param fn The async operation to execute.
   * @returns The result of `fn`.
   * @throws The error from `fn`, or a descriptive error when the circuit is open.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // Transition from open → half-open if the retry window has elapsed.
    if (this.state.status === 'open') {
      if (now < this.state.nextRetryAt) {
        throw new Error(
          `Circuit breaker is open. Calls suppressed until ${new Date(this.state.nextRetryAt).toISOString()}.`
        );
      }
      // Retry window has elapsed — allow one probe call.
      this.state.status = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(now);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private onSuccess(): void {
    this.state.status = 'closed';
    this.state.failureCount = 0;
    this.state.lastFailureAt = 0;
    this.state.nextRetryAt = 0;
  }

  private onFailure(now: number): void {
    // If the last failure was outside the 60-second window, reset the counter.
    if (this.state.lastFailureAt > 0 && now - this.state.lastFailureAt > FAILURE_WINDOW_MS) {
      this.state.failureCount = 0;
    }

    this.state.failureCount += 1;
    this.state.lastFailureAt = now;

    if (this.state.failureCount >= FAILURE_THRESHOLD) {
      this.state.status = 'open';
      this.state.nextRetryAt = now + RETRY_DELAY_MS;
    }
  }
}
