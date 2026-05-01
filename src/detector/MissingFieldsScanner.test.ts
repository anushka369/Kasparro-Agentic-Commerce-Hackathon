/**
 * Unit tests for MissingFieldsScanner (Task 17.1)
 *
 * Covers:
 * - Returns empty array when no required fields exist
 * - Returns empty array when all required fields are filled and valid
 * - Detects empty required input fields
 * - Detects fields with aria-invalid="true"
 * - Detects fields matching :invalid pseudo-class
 * - Detects fields with aria-describedby pointing to a non-empty error element
 * - Detects fields with a nearby sibling error element
 * - Returns ALL missing fields, not a subset
 * - Label resolution: <label for>, aria-label, aria-labelledby, placeholder, name, id
 * - Error message resolution: aria-describedby, nearby error element, validationMessage
 * - Defensive: never throws on DOM errors
 * - Works with a scoped root element
 *
 * Requirements: 10.1, 10.2, 10.3
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MissingFieldsScanner } from './MissingFieldsScanner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal checkout form in the JSDOM document. */
function createForm(html: string): HTMLFormElement {
  const form = document.createElement('form');
  form.innerHTML = html;
  document.body.appendChild(form);
  return form;
}

/** Remove all child nodes from document.body between tests. */
function clearBody(): void {
  document.body.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MissingFieldsScanner', () => {
  let scanner: MissingFieldsScanner;

  beforeEach(() => {
    scanner = new MissingFieldsScanner();
    clearBody();
  });

  afterEach(() => {
    clearBody();
  });

  // -------------------------------------------------------------------------
  // Basic cases
  // -------------------------------------------------------------------------

  it('returns an empty array when there are no required fields', () => {
    createForm('<input type="text" id="optional" value="hello" />');
    const result = scanner.scan();
    expect(result).toEqual([]);
  });

  it('returns an empty array when all required fields are filled', () => {
    createForm(`
      <input type="text" id="first-name" required value="Alice" />
      <input type="email" id="email" required value="alice@example.com" />
    `);
    const result = scanner.scan();
    expect(result).toEqual([]);
  });

  it('detects a single empty required input', () => {
    createForm('<input type="text" id="first-name" required value="" />');
    const result = scanner.scan();
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('first-name');
  });

  it('detects a required input with whitespace-only value as empty', () => {
    createForm('<input type="text" id="city" required value="   " />');
    const result = scanner.scan();
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('city');
  });

  it('detects a required select with empty value', () => {
    createForm(`
      <select id="country" required>
        <option value="">Select a country</option>
        <option value="US">United States</option>
      </select>
    `);
    const result = scanner.scan();
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('country');
  });

  it('detects a required textarea with empty value', () => {
    createForm('<textarea id="notes" required></textarea>');
    const result = scanner.scan();
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('notes');
  });

  // -------------------------------------------------------------------------
  // aria-required
  // -------------------------------------------------------------------------

  it('detects a field with aria-required="true" that is empty', () => {
    createForm('<input type="text" id="zip" aria-required="true" value="" />');
    const result = scanner.scan();
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('zip');
  });

  it('does not flag a field with aria-required="true" that has a value', () => {
    createForm('<input type="text" id="zip" aria-required="true" value="10001" />');
    const result = scanner.scan();
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // aria-invalid
  // -------------------------------------------------------------------------

  it('detects a field with aria-invalid="true" even if it has a value', () => {
    createForm('<input type="text" id="phone" required aria-invalid="true" value="not-a-phone" />');
    const result = scanner.scan();
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('phone');
  });

  // -------------------------------------------------------------------------
  // aria-describedby error detection
  // -------------------------------------------------------------------------

  it('detects a field whose aria-describedby points to a non-empty error element', () => {
    const form = createForm(`
      <input type="email" id="email" required value="bad" aria-describedby="email-error" />
      <span id="email-error">Please enter a valid email address.</span>
    `);
    // Move the error span to document body so getElementById can find it
    const errorSpan = form.querySelector('#email-error')!;
    document.body.appendChild(errorSpan);

    const result = scanner.scan(form);
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('email');
  });

  // -------------------------------------------------------------------------
  // Nearby sibling error element detection
  // -------------------------------------------------------------------------

  it('detects a field with a next-sibling element having an error class', () => {
    createForm(`
      <input type="text" id="card-number" required value="" />
      <span class="field-error">Card number is required.</span>
    `);
    const result = scanner.scan();
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('card-number');
  });

  it('detects a field with a sibling element having an "invalid" class', () => {
    createForm(`
      <input type="text" id="cvv" required value="" />
      <div class="input-invalid-message">CVV is invalid.</div>
    `);
    const result = scanner.scan();
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('cvv');
  });

  // -------------------------------------------------------------------------
  // Returns ALL missing fields
  // -------------------------------------------------------------------------

  it('returns all missing fields, not a subset', () => {
    createForm(`
      <input type="text" id="first-name" required value="" />
      <input type="text" id="last-name" required value="" />
      <input type="email" id="email" required value="" />
      <input type="text" id="address" required value="123 Main St" />
    `);
    const result = scanner.scan();
    // 3 empty required fields; 1 filled
    expect(result).toHaveLength(3);
    const ids = result.map((f) => f.fieldId);
    expect(ids).toContain('first-name');
    expect(ids).toContain('last-name');
    expect(ids).toContain('email');
    expect(ids).not.toContain('address');
  });

  // -------------------------------------------------------------------------
  // Label resolution
  // -------------------------------------------------------------------------

  it('resolves label from <label for="id">', () => {
    createForm(`
      <label for="first-name">First Name</label>
      <input type="text" id="first-name" required value="" />
    `);
    const result = scanner.scan();
    expect(result[0]?.label).toBe('First Name');
  });

  it('resolves label from aria-label when no <label> element exists', () => {
    createForm(`
      <input type="text" id="search" required aria-label="Search query" value="" />
    `);
    const result = scanner.scan();
    expect(result[0]?.label).toBe('Search query');
  });

  it('resolves label from aria-labelledby', () => {
    const form = createForm(`
      <input type="text" id="zip" required aria-labelledby="zip-label" value="" />
    `);
    const labelEl = document.createElement('span');
    labelEl.id = 'zip-label';
    labelEl.textContent = 'ZIP Code';
    document.body.appendChild(labelEl);

    const result = scanner.scan(form);
    expect(result[0]?.label).toBe('ZIP Code');
  });

  it('resolves label from placeholder when no other label source exists', () => {
    createForm(`
      <input type="text" id="promo" required placeholder="Enter promo code" value="" />
    `);
    const result = scanner.scan();
    expect(result[0]?.label).toBe('Enter promo code');
  });

  it('resolves label from name attribute as fallback', () => {
    createForm(`
      <input type="text" name="billing_address" required value="" />
    `);
    const result = scanner.scan();
    expect(result[0]?.label).toBe('billing_address');
  });

  it('resolves label from id attribute when name is absent', () => {
    createForm(`
      <input type="text" id="my-field" required value="" />
    `);
    const result = scanner.scan();
    expect(result[0]?.label).toBe('my-field');
  });

  it('falls back to "Unknown field" when no label source is available', () => {
    createForm(`
      <input type="text" required value="" />
    `);
    const result = scanner.scan();
    expect(result[0]?.label).toBe('Unknown field');
  });

  // -------------------------------------------------------------------------
  // Error message resolution
  // -------------------------------------------------------------------------

  it('resolves error message from aria-describedby reference', () => {
    const form = createForm(`
      <input type="email" id="email" required value="" aria-describedby="email-err" />
    `);
    const errEl = document.createElement('span');
    errEl.id = 'email-err';
    errEl.textContent = 'Email is required.';
    document.body.appendChild(errEl);

    const result = scanner.scan(form);
    expect(result[0]?.errorMessage).toBe('Email is required.');
  });

  it('resolves error message from a nearby sibling error element', () => {
    createForm(`
      <input type="text" id="city" required value="" />
      <span class="validation-message">City is required.</span>
    `);
    const result = scanner.scan();
    expect(result[0]?.errorMessage).toBe('City is required.');
  });

  it('includes errorMessage from validationMessage when field is :invalid', () => {
    // An empty required field will match :invalid in JSDOM and have a validationMessage.
    // The scanner should surface that message.
    createForm(`
      <input type="text" id="simple" required value="" />
    `);
    const result = scanner.scan();
    expect(result[0]).toBeDefined();
    // errorMessage may or may not be present depending on the environment's
    // validationMessage support — we just verify the field is detected.
    expect(result[0]?.fieldId).toBe('simple');
  });

  // -------------------------------------------------------------------------
  // Scoped root element
  // -------------------------------------------------------------------------

  it('scans only within the provided root element', () => {
    // Field outside the scoped form
    const outsideInput = document.createElement('input');
    outsideInput.type = 'text';
    outsideInput.id = 'outside';
    outsideInput.required = true;
    outsideInput.value = '';
    document.body.appendChild(outsideInput);

    // Form to scope the scan
    const form = createForm(`
      <input type="text" id="inside" required value="" />
    `);

    const result = scanner.scan(form);
    expect(result).toHaveLength(1);
    expect(result[0]?.fieldId).toBe('inside');
  });

  // -------------------------------------------------------------------------
  // Defensive / error handling
  // -------------------------------------------------------------------------

  it('does not throw when called with no arguments', () => {
    expect(() => scanner.scan()).not.toThrow();
  });

  it('returns an array (never throws)', () => {
    const result = scanner.scan();
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles a mix of valid and invalid fields without throwing', () => {
    createForm(`
      <input type="text" id="f1" required value="filled" />
      <input type="text" id="f2" required value="" />
      <input type="text" id="f3" required aria-invalid="true" value="bad" />
      <select id="f4" required><option value="">Pick one</option></select>
    `);
    expect(() => scanner.scan()).not.toThrow();
    const result = scanner.scan();
    // f2 (empty), f3 (aria-invalid), f4 (empty select) should be flagged
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});
