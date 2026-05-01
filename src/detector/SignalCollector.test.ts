/**
 * Unit tests for SignalCollector (Task 3.1)
 *
 * Covers:
 * - getSnapshot() returns all required fields
 * - No PII fields in snapshot
 * - Snapshot fields have correct types
 * - stop() can be called without errors
 * - start() + stop() lifecycle works
 *
 * Note: DOM event simulation is limited in the vitest/node environment.
 * These tests verify the snapshot shape and lifecycle contract.
 *
 * Feature: ai-checkout-recovery
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignalCollector } from './SignalCollector.js';
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

const REQUIRED_SNAPSHOT_KEYS = [
  'timeOnPageMs',
  'scrollDepthPct',
  'cursorVelocityAvg',
  'exitIntentDetected',
  'idleDetected',
  'fieldEvents',
  'backNavigationAttempted',
  'checkoutStep',
] as const;

/** Keys that must NOT appear in a snapshot (PII guard). */
const FORBIDDEN_PII_KEYS = [
  'value',
  'password',
  'email',
  'phone',
  'name',
  'address',
  'creditCard',
  'cardNumber',
  'cvv',
  'ssn',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SignalCollector', () => {
  let collector: SignalCollector;

  beforeEach(() => {
    collector = new SignalCollector(DEFAULT_CONFIG);
  });

  afterEach(() => {
    try {
      collector.stop();
    } catch {
      // ignore cleanup errors
    }
  });

  it('getSnapshot() returns an object with all required fields', () => {
    const snapshot = collector.getSnapshot();
    for (const key of REQUIRED_SNAPSHOT_KEYS) {
      expect(snapshot).toHaveProperty(key);
    }
  });

  it('snapshot contains no PII field names', () => {
    const snapshot = collector.getSnapshot();
    const keys = Object.keys(snapshot);
    for (const forbidden of FORBIDDEN_PII_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('timeOnPageMs is a non-negative number', () => {
    const snapshot = collector.getSnapshot();
    expect(typeof snapshot.timeOnPageMs).toBe('number');
    expect(snapshot.timeOnPageMs).toBeGreaterThanOrEqual(0);
  });

  it('scrollDepthPct is in [0, 100]', () => {
    const snapshot = collector.getSnapshot();
    expect(snapshot.scrollDepthPct).toBeGreaterThanOrEqual(0);
    expect(snapshot.scrollDepthPct).toBeLessThanOrEqual(100);
  });

  it('cursorVelocityAvg is a non-negative number', () => {
    const snapshot = collector.getSnapshot();
    expect(typeof snapshot.cursorVelocityAvg).toBe('number');
    expect(snapshot.cursorVelocityAvg).toBeGreaterThanOrEqual(0);
  });

  it('exitIntentDetected is a boolean', () => {
    const snapshot = collector.getSnapshot();
    expect(typeof snapshot.exitIntentDetected).toBe('boolean');
  });

  it('idleDetected is a boolean', () => {
    const snapshot = collector.getSnapshot();
    expect(typeof snapshot.idleDetected).toBe('boolean');
  });

  it('fieldEvents is an array', () => {
    const snapshot = collector.getSnapshot();
    expect(Array.isArray(snapshot.fieldEvents)).toBe(true);
  });

  it('backNavigationAttempted is a boolean', () => {
    const snapshot = collector.getSnapshot();
    expect(typeof snapshot.backNavigationAttempted).toBe('boolean');
  });

  it('checkoutStep is a valid CheckoutStep value', () => {
    const snapshot = collector.getSnapshot();
    const validSteps = ['cart', 'information', 'shipping', 'payment', 'review'];
    expect(validSteps).toContain(snapshot.checkoutStep);
  });

  it('getSnapshot() returns a copy of fieldEvents (not internal reference)', () => {
    const snap1 = collector.getSnapshot();
    const snap2 = collector.getSnapshot();
    // They should be different array instances
    expect(snap1.fieldEvents).not.toBe(snap2.fieldEvents);
  });

  it('start() and stop() do not throw', () => {
    expect(() => collector.start()).not.toThrow();
    expect(() => collector.stop()).not.toThrow();
  });

  it('stop() is safe to call multiple times', () => {
    collector.start();
    expect(() => {
      collector.stop();
      collector.stop();
    }).not.toThrow();
  });

  it('getSnapshot() works before start() is called', () => {
    // Should not throw even without listeners attached
    expect(() => collector.getSnapshot()).not.toThrow();
  });
});
