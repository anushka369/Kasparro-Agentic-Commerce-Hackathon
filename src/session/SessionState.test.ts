/**
 * Unit tests for SessionState (Task 2.1)
 *
 * Covers:
 * - sessionId is unique across instances
 * - addIntervention enforces at-most-2 limit
 * - addIntervention rejects duplicate category
 * - markConverted sets converted = true and endedAt
 * - end() sets endedAt without marking converted
 * - updateInterventionOutcome updates the correct record
 *
 * Feature: ai-checkout-recovery
 */

import { describe, it, expect } from 'vitest';
import { SessionState } from './SessionState.js';
import type { InterventionRecord } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  overrides: Partial<InterventionRecord> = {},
): InterventionRecord {
  return {
    interventionId: `iv-${Math.random()}`,
    category: 'Price_Hesitation',
    triggeredAt: Date.now(),
    outcome: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionState', () => {
  it('generates a unique sessionId for each instance', () => {
    const a = new SessionState('cart-1');
    const b = new SessionState('cart-2');
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(typeof a.sessionId).toBe('string');
    expect(a.sessionId.length).toBeGreaterThan(0);
  });

  it('sessionId matches UUID v4 format', () => {
    const session = new SessionState('cart-1');
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(session.sessionId).toMatch(uuidV4Regex);
  });

  it('starts with empty frictionEvents and interventions', () => {
    const session = new SessionState('cart-1');
    expect(session.frictionEvents).toHaveLength(0);
    expect(session.interventions).toHaveLength(0);
    expect(session.converted).toBe(false);
    expect(session.endedAt).toBeUndefined();
  });

  it('addIntervention accepts up to 2 interventions', () => {
    const session = new SessionState('cart-1');
    const r1 = makeRecord({ category: 'Price_Hesitation' });
    const r2 = makeRecord({ category: 'Shipping_Confusion' });

    expect(session.addIntervention(r1)).toBe(true);
    expect(session.addIntervention(r2)).toBe(true);
    expect(session.interventions).toHaveLength(2);
  });

  it('addIntervention rejects a 3rd intervention (at-most-2 limit)', () => {
    const session = new SessionState('cart-1');
    session.addIntervention(makeRecord({ category: 'Price_Hesitation' }));
    session.addIntervention(makeRecord({ category: 'Shipping_Confusion' }));

    const r3 = makeRecord({ category: 'Trust_Issue' });
    expect(session.addIntervention(r3)).toBe(false);
    expect(session.interventions).toHaveLength(2);
  });

  it('addIntervention rejects duplicate category', () => {
    const session = new SessionState('cart-1');
    session.addIntervention(makeRecord({ category: 'Price_Hesitation' }));

    const duplicate = makeRecord({ category: 'Price_Hesitation' });
    expect(session.addIntervention(duplicate)).toBe(false);
    expect(session.interventions).toHaveLength(1);
  });

  it('markConverted sets converted = true and endedAt', () => {
    const session = new SessionState('cart-1');
    const before = Date.now();
    session.markConverted();
    const after = Date.now();

    expect(session.converted).toBe(true);
    expect(session.endedAt).toBeDefined();
    expect(session.endedAt!).toBeGreaterThanOrEqual(before);
    expect(session.endedAt!).toBeLessThanOrEqual(after);
  });

  it('end() sets endedAt without marking converted', () => {
    const session = new SessionState('cart-1');
    session.end();

    expect(session.converted).toBe(false);
    expect(session.endedAt).toBeDefined();
  });

  it('end() is idempotent — does not overwrite endedAt on second call', () => {
    const session = new SessionState('cart-1');
    session.end();
    const firstEndedAt = session.endedAt;
    session.end();
    expect(session.endedAt).toBe(firstEndedAt);
  });

  it('updateInterventionOutcome updates the matching record', () => {
    const session = new SessionState('cart-1');
    const record = makeRecord({ interventionId: 'iv-abc', outcome: 'pending' });
    session.addIntervention(record);

    session.updateInterventionOutcome('iv-abc', 'accepted', 12345);

    const updated = session.interventions.find((i) => i.interventionId === 'iv-abc');
    expect(updated?.outcome).toBe('accepted');
    expect(updated?.resolvedAt).toBe(12345);
  });

  it('updateInterventionOutcome is a no-op for unknown interventionId', () => {
    const session = new SessionState('cart-1');
    // Should not throw
    expect(() =>
      session.updateInterventionOutcome('nonexistent', 'dismissed'),
    ).not.toThrow();
  });
});
