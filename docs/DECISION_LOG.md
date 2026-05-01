# Decision Log — AI-Assisted Checkout Recovery

This document records the key architectural decisions made during the design of the AI-Assisted Checkout Recovery system. Each entry follows the Architecture Decision Record (ADR) format.

---

## ADR-001: Classification Approach

**Status:** Accepted
**Date:** 2024-03-15

### Context

The system must classify the cause of checkout friction in real time, within a 2-second budget, while running entirely in the browser. A purely rule-based approach may fail on ambiguous behavioral signals where multiple friction categories score similarly. A purely LLM-based approach introduces network latency, cost per classification, and a hard dependency on external service availability — all of which conflict with the non-blocking and graceful-degradation design goals.

### Decision

Use a two-tier classification pipeline: a deterministic rule engine as the primary path, with an LLM-assisted fallback for ambiguous cases.

### Rationale

The deterministic rule engine runs synchronously in the browser with no network calls, making it zero-latency, zero-cost, and fully auditable. It handles approximately 80% of sessions where one friction category clearly dominates the weighted signal scores. For the remaining ~20% of sessions where the top two categories score within 0.15 of each other, a single structured call to the LLM Gateway resolves the ambiguity. This hybrid approach captures the reliability and speed of deterministic logic while retaining the nuanced judgment of an LLM for genuinely ambiguous multi-signal cases.

### Alternatives Considered

- **LLM-only classification:** Rejected because every classification would incur network latency (~200ms minimum), API cost, and a failure dependency on an external service. This conflicts with the 2-second classification budget and the graceful-degradation requirement.
- **Deterministic-only classification:** Rejected because ambiguous multi-signal cases (e.g., a user who is both price-hesitant and confused about shipping) would either be misclassified or suppressed entirely, reducing intervention coverage.
- **ML model embedded in the bundle:** Rejected because embedding a trained model increases bundle size, requires retraining infrastructure, and still cannot match the interpretability of explicit weighted rules.

### Consequences

- The system has two distinct failure modes: rule engine failure (rare, handled by try/catch) and LLM Gateway failure (handled by falling back to the Tier 1 result or suppressing the intervention).
- Signal weight configuration must be maintained and tuned over time as behavioral patterns evolve.
- The LLM prompt structure and response schema must be kept stable; changes require coordinated updates to the gateway and client.
- Classification is fully auditable for the ~80% deterministic path; LLM reasoning is captured in the `reasoning` field of the response for the remaining ~20%.

---

## ADR-002: UI Delivery

**Status:** Accepted
**Date:** 2024-03-15

### Context

The intervention widget must render inline on the Shopify checkout page, read the current state of checkout form fields, and potentially write back to the cart (e.g., applying a coupon or selecting a shipping option). The widget must not block or interfere with the checkout form, and must work within Shopify's Script Tag injection model without requiring a custom storefront or app review.

### Decision

Deliver the intervention widget as an inline overlay rendered directly into the checkout page DOM, without using an iframe.

### Rationale

An iframe would impose a cross-origin boundary between the widget and the checkout page, preventing the widget from reading field values, detecting validation errors, or triggering DOM-level interactions. Inline DOM injection avoids this restriction entirely, allowing the `Conversation_Manager` to observe and interact with the checkout form directly. It also simplifies the rendering pipeline — the widget is a standard DOM subtree styled with scoped CSS, with no postMessage communication layer required.

### Alternatives Considered

- **iframe-based widget:** Rejected because cross-origin restrictions would prevent the widget from reading checkout field state or writing to the cart DOM. A postMessage bridge could partially work around this, but adds significant complexity and latency.
- **Full-page overlay / modal:** Rejected because it would obscure the checkout form and create a perception of blocking the user's progress, conflicting with the non-blocking design goal.
- **Shopify App Block (theme extension):** Rejected because it requires app review and is not available for the standard Shopify checkout without Shopify Plus, making it unsuitable for a hackathon context.

### Consequences

- The widget's CSS must be carefully scoped to avoid style conflicts with the host checkout page's stylesheet.
- The widget must be tested across Shopify's checkout DOM structure, which may change between Shopify versions.
- Inline DOM injection requires careful cleanup on `stop()` to avoid memory leaks or orphaned DOM nodes.
- The widget must be validated at all supported viewport widths (320px–2560px) to ensure it does not overlap required form fields (see Property 10).

---

## ADR-003: State Management

**Status:** Accepted
**Date:** 2024-03-15

### Context

The system collects behavioral signals and intervention outcomes during a checkout session. This data is needed to enforce per-session invariants (e.g., no more than 2 interventions, no repeat category), to assemble intervention payloads, and to flush a session record to the Analytics Service at session end. The system must not persist any personally identifiable information (PII) beyond the current browser session.

### Decision

Use in-memory session state only. All session data is held in a JavaScript object in the browser's memory and is flushed (discarded) when the tab is closed.

### Rationale

Storing session state in memory is the simplest approach that satisfies the privacy requirement: there is no localStorage, sessionStorage, IndexedDB, or cookie write, so no PII can persist beyond the tab's lifetime. The data needed for session-level logic (friction events, intervention records, cart ID, checkout step) is small enough to fit comfortably in memory. At session end, the relevant non-PII fields are extracted and sent to the Analytics Service via a beacon or fetch call before the tab closes.

### Alternatives Considered

- **sessionStorage:** Rejected because sessionStorage persists across page refreshes within the same tab, which could expose session data to other scripts and complicates the privacy guarantee. It also requires explicit cleanup logic.
- **localStorage:** Rejected outright — localStorage persists across sessions and tabs, which is incompatible with the no-PII-persistence requirement.
- **Server-side session (cookie-backed):** Rejected because it would require a round-trip to create and maintain a server-side session record, adding latency and infrastructure complexity for data that is only needed client-side during the session.

### Consequences

- If the tab crashes or is force-closed before the session flush completes, the session record is lost. The Analytics Service must tolerate missing sessions without corrupting aggregate metrics.
- The in-memory state is not shared across tabs; multi-tab checkout scenarios are not supported.
- No session replay or debugging of past sessions is possible from the client side; all historical data must come from the Analytics Service.
- The `SessionState` interface must be kept lean to avoid excessive memory use on low-end devices.

---

## ADR-004: Platform Integration

**Status:** Accepted
**Date:** 2024-03-15

### Context

The system must integrate with Shopify to read cart state, fetch offers and shipping options, and apply cart mutations (coupon codes, shipping selection, variant updates). The integration must work without requiring Shopify Plus, without a lengthy app review process, and within the constraints of a hackathon timeline.

### Decision

Integrate with Shopify using the Storefront API for cart reads and mutations, and deliver the client-side bundle via Shopify's Script Tag API.

### Rationale

The Script Tag API is a standard Shopify extension point available to all public apps and custom apps without app review. It allows an arbitrary JavaScript bundle to be injected into the checkout page, which is exactly what the system requires. The Storefront API provides a stable, well-documented GraphQL interface for cart operations that does not require admin-level credentials, making it safe to call from the browser. Together, these two mechanisms provide full integration capability within the hackathon's time and review constraints.

### Alternatives Considered

- **Shopify App Blocks / Theme Extensions:** Rejected because they require Shopify Plus for checkout customization and are subject to app review, which is incompatible with the hackathon timeline.
- **Shopify Admin API for cart mutations:** Rejected because the Admin API requires server-side authentication and cannot be called directly from the browser without exposing admin credentials.
- **Custom storefront (Hydrogen / Headless):** Rejected because it requires rebuilding the entire checkout experience, which is far outside the scope of this project.
- **Checkout UI Extensions:** Rejected because they are sandboxed and do not allow arbitrary DOM access, which is required for the inline widget approach (ADR-002).

### Consequences

- The `Platform_Adapter` interface abstracts all Shopify-specific calls, so the core logic remains platform-agnostic and can be adapted to other platforms by swapping the adapter.
- The Storefront API access token must be scoped to the minimum required permissions and must not be embedded in the bundle in a way that exposes it to end users.
- Script Tag injection is subject to Shopify's Content Security Policy; the bundle must be served from a CDN with a stable, allowlisted domain.
- Future migration to Shopify's Checkout Extensibility platform (for Shopify Plus merchants) would require replacing the Script Tag injection and DOM manipulation with the Checkout UI Extensions API.

---

## ADR-005: Confidence Threshold

**Status:** Accepted
**Date:** 2024-03-15

### Context

The deterministic classifier produces a confidence score in [0.0, 1.0] for the top-ranked friction category. A threshold is needed to decide when confidence is high enough to trigger an intervention. Setting the threshold too low causes false-positive interventions — the system interrupts users who are not actually hesitating, which degrades the checkout experience and reduces trust in the widget. Setting it too high causes false negatives — the system misses genuine friction events and fails to recover abandoning users.

### Decision

Set the default confidence threshold at 0.60.

### Rationale

A threshold of 0.60 represents a deliberate balance between intervention precision and recall. At this level, the classifier must assign more than 60% of the maximum possible weighted score to a single category before triggering an intervention, which filters out low-signal noise while still catching the majority of genuine friction events. The threshold is exposed as a tunable configuration parameter (`DetectorConfig.confidenceThreshold`) so it can be adjusted based on observed false-positive and false-negative rates from the Analytics Service without a code change.

### Alternatives Considered

- **Threshold of 0.50:** Considered but rejected as the starting point because it would trigger interventions on cases where the classifier is only marginally more confident in one category than another, increasing false positives and potentially annoying users who are progressing normally.
- **Threshold of 0.75:** Considered but rejected because it would suppress interventions in many genuine friction cases, particularly for categories like `Shipping_Confusion` where behavioral signals are inherently noisier and scores rarely exceed 0.70 without LLM assistance.
- **Dynamic threshold (per-category):** Considered as a future enhancement. Different friction categories have different signal clarity (e.g., `Missing_Information` is highly deterministic via field error events, while `Trust_Issue` is more ambiguous). Per-category thresholds could improve precision, but add configuration complexity and require more data to calibrate. Deferred to post-hackathon iteration.

### Consequences

- The 0.60 threshold applies to both Tier 1 (deterministic) and Tier 2 (LLM) classification results.
- The LLM fallback is only invoked when the Tier 1 result is ambiguous (top two categories within 0.15) AND confidence is below 0.60; if Tier 1 confidence is already ≥ 0.60, the LLM is not called even if the result is ambiguous.
- Merchants or operators who observe high false-positive rates can raise the threshold via configuration; those who observe low intervention rates can lower it.
- The threshold value should be reviewed after the first 1,000 sessions using Analytics Service data to determine whether recalibration is warranted.
