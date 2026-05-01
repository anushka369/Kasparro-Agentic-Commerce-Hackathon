/**
 * In-memory session state for a single checkout visit.
 *
 * Tracks friction events, interventions, and conversion outcome.
 * Enforces at most 2 interventions per session (Requirement 3.2) and
 * no duplicate FrictionCategory in interventions (Requirement 3.3).
 */

import type {
  CheckoutStep,
  FrictionEvent,
  InterventionRecord,
} from '../types/index.js';

/** Generate a UUID v4 string. Uses crypto.randomUUID() when available. */
function generateUUID(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  // Fallback: manual UUID v4 implementation
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Last-resort fallback for environments without crypto
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set version bits (version 4)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  // Set variant bits (variant 1)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/** Maximum number of interventions allowed per session (Requirement 3.2). */
const MAX_INTERVENTIONS = 2;

/**
 * In-memory, client-side store for a single checkout session.
 *
 * All state fields are publicly readable. Mutations are only possible
 * through the provided methods.
 */
export class SessionState {
  /** UUID v4 generated on construction. */
  readonly sessionId: string;

  /** Unix timestamp (ms) when the session started. */
  readonly startedAt: number;

  /** The checkout step the user is currently on. */
  checkoutStep: CheckoutStep;

  /** The Shopify cart GID. */
  readonly cartId: string;

  /** All friction events detected in this session. */
  readonly frictionEvents: FrictionEvent[];

  /** All interventions triggered in this session. */
  readonly interventions: InterventionRecord[];

  /** Whether the session ended in a completed order. */
  converted: boolean;

  /** Unix timestamp (ms) when the session ended, if it has ended. */
  endedAt?: number;

  constructor(cartId: string, checkoutStep: CheckoutStep = 'cart') {
    this.sessionId = generateUUID();
    this.startedAt = Date.now();
    this.cartId = cartId;
    this.checkoutStep = checkoutStep;
    this.frictionEvents = [];
    this.interventions = [];
    this.converted = false;
  }

  /**
   * Append a friction event to the session.
   */
  addFrictionEvent(event: FrictionEvent): void {
    this.frictionEvents.push(event);
  }

  /**
   * Add an intervention record to the session.
   *
   * Returns `true` if the intervention was added, `false` if rejected because:
   * - the session already has 2 interventions (Requirement 3.2), or
   * - an intervention for the same FrictionCategory already exists (Requirement 3.3).
   */
  addIntervention(record: InterventionRecord): boolean {
    if (this.interventions.length >= MAX_INTERVENTIONS) {
      return false;
    }

    const categoryAlreadyPresent = this.interventions.some(
      (i) => i.category === record.category,
    );
    if (categoryAlreadyPresent) {
      return false;
    }

    this.interventions.push(record);
    return true;
  }

  /**
   * Update the outcome of an existing intervention.
   *
   * Finds the intervention by `interventionId` and updates its `outcome`
   * and optionally its `resolvedAt` timestamp.
   */
  updateInterventionOutcome(
    interventionId: string,
    outcome: InterventionRecord['outcome'],
    resolvedAt?: number,
  ): void {
    const record = this.interventions.find(
      (i) => i.interventionId === interventionId,
    );
    if (record === undefined) {
      return;
    }

    record.outcome = outcome;
    if (resolvedAt !== undefined) {
      record.resolvedAt = resolvedAt;
    }
  }

  /**
   * Mark the session as converted (order completed).
   * Sets `converted = true` and records `endedAt`.
   */
  markConverted(): void {
    this.converted = true;
    this.endedAt = Date.now();
  }

  /**
   * End the session without conversion.
   * Sets `endedAt` if not already set.
   */
  end(): void {
    if (this.endedAt === undefined) {
      this.endedAt = Date.now();
    }
  }
}

export default SessionState;
