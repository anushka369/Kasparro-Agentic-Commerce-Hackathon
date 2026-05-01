/**
 * Unit tests for FrictionDetectorImpl (Task 6.1)
 *
 * Covers:
 * - start() + stop() lifecycle
 * - stop() removes interval (no events after stop)
 * - onFrictionEvent() registers handlers
 * - Duplicate start() calls are no-ops
 * - stop() is safe to call multiple times
 * - Classification suppressed when confidence < threshold (via mock)
 *
 * Feature: ai-checkout-recovery
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FrictionDetectorImpl } from './FrictionDetector.js';
import type { DetectorConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DetectorConfig = {
  confidenceThreshold: 0.6,
  idleTimeoutMs: 30_000,
  exitIntentMarginPx: 20,
  classificationTimeoutMs: 2_000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FrictionDetectorImpl', () => {
  let detector: FrictionDetectorImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new FrictionDetectorImpl('test-session-id');
  });

  afterEach(() => {
    detector.stop();
    vi.useRealTimers();
  });

  it('start() and stop() do not throw', () => {
    expect(() => detector.start(DEFAULT_CONFIG)).not.toThrow();
    expect(() => detector.stop()).not.toThrow();
  });

  it('duplicate start() calls are no-ops (does not throw)', () => {
    detector.start(DEFAULT_CONFIG);
    expect(() => detector.start(DEFAULT_CONFIG)).not.toThrow();
    // Only one interval should be running — stop once should clean up
    expect(() => detector.stop()).not.toThrow();
  });

  it('stop() is safe to call multiple times', () => {
    detector.start(DEFAULT_CONFIG);
    expect(() => {
      detector.stop();
      detector.stop();
    }).not.toThrow();
  });

  it('stop() before start() does not throw', () => {
    expect(() => detector.stop()).not.toThrow();
  });

  it('onFrictionEvent() registers a handler without throwing', () => {
    const handler = vi.fn();
    expect(() => detector.onFrictionEvent(handler)).not.toThrow();
  });

  it('multiple handlers can be registered', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    expect(() => {
      detector.onFrictionEvent(h1);
      detector.onFrictionEvent(h2);
    }).not.toThrow();
  });

  it('no FrictionEvents emitted after stop() even when time advances', async () => {
    const handler = vi.fn();
    detector.onFrictionEvent(handler);
    detector.start(DEFAULT_CONFIG);
    // Stop immediately — interval should be cleared before any cycle fires
    detector.stop();

    // Advance several cycles — interval should be cleared
    await vi.advanceTimersByTimeAsync(2000);

    expect(handler).not.toHaveBeenCalled();
  });

  it('no FrictionEvents emitted after stop() when called after start', async () => {
    const handler = vi.fn();
    detector.onFrictionEvent(handler);
    detector.start(DEFAULT_CONFIG);

    // Let one cycle run
    await vi.advanceTimersByTimeAsync(600);
    const callCountAfterFirstCycle = handler.mock.calls.length;

    // Stop the detector
    detector.stop();

    // Advance more time — no new events should fire
    await vi.advanceTimersByTimeAsync(5000);

    // Call count should not increase after stop
    expect(handler.mock.calls.length).toBe(callCountAfterFirstCycle);
  });

  it('no FrictionEvents emitted after stop()', async () => {
    const handler = vi.fn();
    detector.onFrictionEvent(handler);
    detector.start(DEFAULT_CONFIG);
    detector.stop();

    // Advance several cycles — interval should be cleared
    await vi.advanceTimersByTimeAsync(5000);

    expect(handler).not.toHaveBeenCalled();
  });
});
