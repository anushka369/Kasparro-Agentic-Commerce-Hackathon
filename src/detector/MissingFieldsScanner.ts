/**
 * MissingFieldsScanner — scans the checkout form DOM for required fields
 * that are empty or have validation errors.
 *
 * Returns a complete list (not a subset) of all missing/invalid fields,
 * each with a resolved label and optional error message.
 *
 * Error handling: all DOM operations are wrapped in try/catch. On error,
 * the affected field is skipped and scanning continues. The scanner never
 * throws and never blocks checkout progress.
 *
 * Requirements: 10.1, 10.2, 10.3
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Represents a single required checkout field that is empty or invalid.
 */
export interface MissingField {
  /** The `id` attribute of the field element, or a generated identifier. */
  fieldId: string;
  /** Human-readable label resolved from the DOM. */
  label: string;
  /** Validation error message, if one could be determined. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** CSS selectors for required form fields. */
const REQUIRED_FIELD_SELECTORS = [
  'input[required]',
  'select[required]',
  'textarea[required]',
  '[aria-required="true"]',
].join(', ');

/** Class name fragments that identify error message elements. */
const ERROR_CLASS_FRAGMENTS = ['error', 'invalid', 'validation'];

// ---------------------------------------------------------------------------
// MissingFieldsScanner
// ---------------------------------------------------------------------------

/**
 * Scans a checkout form (or the entire document) for required fields that
 * are empty or have validation errors.
 *
 * Usage:
 *   const scanner = new MissingFieldsScanner();
 *   const missing = scanner.scan(); // scans document.body
 *   const missing = scanner.scan(formElement); // scans a specific form
 */
export class MissingFieldsScanner {
  /**
   * Scan the given root element (or `document.body` if omitted) for required
   * fields that are empty or have validation errors.
   *
   * @param root  Optional root element to scope the scan. Defaults to document.body.
   * @returns     Array of MissingField descriptors — one per missing/invalid field.
   *              Returns an empty array if no missing fields are found or if the
   *              DOM is unavailable.
   */
  scan(root?: HTMLElement): MissingField[] {
    const results: MissingField[] = [];

    let container: HTMLElement | null = null;
    try {
      container = root ?? document.body;
    } catch {
      // DOM unavailable — return empty
      return results;
    }

    if (container === null) {
      return results;
    }

    let fields: NodeListOf<Element>;
    try {
      fields = container.querySelectorAll(REQUIRED_FIELD_SELECTORS);
    } catch {
      return results;
    }

    for (const el of fields) {
      try {
        const htmlEl = el as HTMLElement;

        if (!this._isMissing(htmlEl)) {
          continue;
        }

        const fieldId = this._resolveFieldId(htmlEl);
        const label = this._resolveLabel(htmlEl, container);
        const errorMessage = this._resolveErrorMessage(htmlEl, container);

        const entry: MissingField =
          errorMessage !== undefined
            ? { fieldId, label, errorMessage }
            : { fieldId, label };

        results.push(entry);
      } catch {
        // Skip this field and continue scanning
        continue;
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Determine whether a field is "missing" — i.e., empty or invalid.
   *
   * A field is missing if:
   * - Its value is blank/whitespace (for input/textarea/select), OR
   * - It matches the `:invalid` CSS pseudo-class, OR
   * - It has `aria-invalid="true"`, OR
   * - It has an associated error element (aria-describedby or nearby sibling).
   */
  private _isMissing(el: HTMLElement): boolean {
    // Check for explicit invalidity markers first
    try {
      if (el.getAttribute('aria-invalid') === 'true') {
        return true;
      }
    } catch {
      // ignore
    }

    try {
      if (el.matches(':invalid')) {
        return true;
      }
    } catch {
      // :invalid may not be supported in all environments — fall through
    }

    // Check for an associated error element via aria-describedby
    try {
      const describedBy = el.getAttribute('aria-describedby');
      if (describedBy !== null) {
        for (const id of describedBy.trim().split(/\s+/)) {
          if (id === '') continue;
          const refEl = document.getElementById(id);
          if (refEl !== null) {
            const text = refEl.textContent?.trim() ?? '';
            if (text !== '') {
              // A non-empty describedby element suggests an error is present
              return true;
            }
          }
        }
      }
    } catch {
      // ignore
    }

    // Check for a nearby sibling error element
    try {
      if (this._findNearbyErrorElement(el) !== null) {
        return true;
      }
    } catch {
      // ignore
    }

    // Check for empty value
    try {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const value = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
        if (value.trim() === '') {
          return true;
        }
      }
    } catch {
      // ignore
    }

    return false;
  }

  /**
   * Resolve a stable identifier for the field element.
   * Prefers the element's `id` attribute; falls back to `name`, then a
   * generated placeholder.
   */
  private _resolveFieldId(el: HTMLElement): string {
    try {
      const id = el.id;
      if (id && id.trim() !== '') {
        return id;
      }
    } catch {
      // ignore
    }

    try {
      const name = (el as HTMLInputElement).name;
      if (name && name.trim() !== '') {
        return name;
      }
    } catch {
      // ignore
    }

    return '__missing_field__';
  }

  /**
   * Resolve a human-readable label for the field.
   *
   * Resolution order:
   * 1. `<label for="fieldId">` element in the root container.
   * 2. `aria-label` attribute on the field.
   * 3. Element(s) referenced by `aria-labelledby`.
   * 4. `placeholder` attribute.
   * 5. `name` attribute.
   * 6. `id` attribute.
   * 7. Fallback: "Unknown field".
   */
  private _resolveLabel(el: HTMLElement, root: HTMLElement): string {
    // 1. <label for="id">
    try {
      const id = el.id;
      if (id && id.trim() !== '') {
        const labelEl = root.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
        if (labelEl !== null) {
          const text = labelEl.textContent?.trim() ?? '';
          if (text !== '') return text;
        }
      }
    } catch {
      // CSS.escape may not be available in all environments — try without escaping
      try {
        const id = el.id;
        if (id && id.trim() !== '') {
          const labelEl = root.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
          if (labelEl !== null) {
            const text = labelEl.textContent?.trim() ?? '';
            if (text !== '') return text;
          }
        }
      } catch {
        // ignore
      }
    }

    // 2. aria-label
    try {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel !== null && ariaLabel.trim() !== '') {
        return ariaLabel.trim();
      }
    } catch {
      // ignore
    }

    // 3. aria-labelledby
    try {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy !== null && labelledBy.trim() !== '') {
        const parts: string[] = [];
        for (const id of labelledBy.trim().split(/\s+/)) {
          if (id === '') continue;
          const refEl = document.getElementById(id);
          if (refEl !== null) {
            const text = refEl.textContent?.trim() ?? '';
            if (text !== '') parts.push(text);
          }
        }
        if (parts.length > 0) {
          return parts.join(' ');
        }
      }
    } catch {
      // ignore
    }

    // 4. placeholder
    try {
      const placeholder = (el as HTMLInputElement).placeholder;
      if (placeholder && placeholder.trim() !== '') {
        return placeholder.trim();
      }
    } catch {
      // ignore
    }

    // 5. name attribute
    try {
      const name = (el as HTMLInputElement).name;
      if (name && name.trim() !== '') {
        return name.trim();
      }
    } catch {
      // ignore
    }

    // 6. id attribute
    try {
      const id = el.id;
      if (id && id.trim() !== '') {
        return id.trim();
      }
    } catch {
      // ignore
    }

    return 'Unknown field';
  }

  /**
   * Resolve an error message for the field.
   *
   * Resolution order:
   * 1. Element(s) referenced by `aria-describedby` (non-empty text content).
   * 2. Nearby sibling/child element with a class containing "error", "invalid",
   *    or "validation".
   * 3. Native `validationMessage` property (non-empty).
   *
   * Returns `undefined` if no error message can be found.
   */
  private _resolveErrorMessage(
    el: HTMLElement,
    _root: HTMLElement,
  ): string | undefined {
    // 1. aria-describedby
    try {
      const describedBy = el.getAttribute('aria-describedby');
      if (describedBy !== null) {
        const parts: string[] = [];
        for (const id of describedBy.trim().split(/\s+/)) {
          if (id === '') continue;
          const refEl = document.getElementById(id);
          if (refEl !== null) {
            const text = refEl.textContent?.trim() ?? '';
            if (text !== '') parts.push(text);
          }
        }
        if (parts.length > 0) {
          return parts.join(' ');
        }
      }
    } catch {
      // ignore
    }

    // 2. Nearby sibling/child error element
    try {
      const errorEl = this._findNearbyErrorElement(el);
      if (errorEl !== null) {
        const text = errorEl.textContent?.trim() ?? '';
        if (text !== '') return text;
      }
    } catch {
      // ignore
    }

    // 3. Native validationMessage
    try {
      if ('validationMessage' in el) {
        const msg = (el as HTMLInputElement).validationMessage;
        if (msg && msg.trim() !== '') {
          return msg.trim();
        }
      }
    } catch {
      // ignore
    }

    return undefined;
  }

  /**
   * Search for a nearby element (next sibling, parent's children, or the
   * field's own children) whose class list contains an error-related fragment.
   *
   * Returns the first matching element, or null if none is found.
   */
  private _findNearbyErrorElement(el: HTMLElement): Element | null {
    // Check next sibling
    try {
      const next = el.nextElementSibling;
      if (next !== null && this._hasErrorClass(next)) {
        return next;
      }
    } catch {
      // ignore
    }

    // Check previous sibling
    try {
      const prev = el.previousElementSibling;
      if (prev !== null && this._hasErrorClass(prev)) {
        return prev;
      }
    } catch {
      // ignore
    }

    // Check parent's children (excluding the field itself)
    try {
      const parent = el.parentElement;
      if (parent !== null) {
        for (const child of parent.children) {
          if (child !== el && this._hasErrorClass(child)) {
            return child;
          }
        }
      }
    } catch {
      // ignore
    }

    // Check field's own children
    try {
      for (const child of el.children) {
        if (this._hasErrorClass(child)) {
          return child;
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Return true if the element's className contains any error-related fragment.
   */
  private _hasErrorClass(el: Element): boolean {
    try {
      const className =
        typeof el.className === 'string'
          ? el.className.toLowerCase()
          : '';
      return ERROR_CLASS_FRAGMENTS.some((fragment) =>
        className.includes(fragment),
      );
    } catch {
      return false;
    }
  }
}

export default MissingFieldsScanner;
