# Implementation Plan: AI-Assisted Checkout Recovery

## Overview

Implement the AI-Assisted Checkout Recovery system as a single TypeScript/JavaScript bundle injected into Shopify checkout via Script Tag API. The plan follows an incremental delivery order: shared types and interfaces first, then core detection and classification logic, then the intervention engine, then the conversational UI, then platform and backend integrations, then property-based and integration tests, and finally hackathon deliverables.

All tasks are coding tasks only. The system must never block checkout progress; every component degrades gracefully.

---

## Tasks

- [x] 1. Project scaffold and shared type definitions
  - Initialize TypeScript project with `tsconfig.json`, bundler config (esbuild or Rollup), and `package.json` with `fast-check`, `vitest`, and Shopify Storefront API client as dependencies
  - Create `src/types/index.ts` exporting all shared interfaces and enums: `FrictionCategory`, `FrictionEvent`, `SignalSnapshot`, `FieldEvent`, `CheckoutStep`, `DetectorConfig`, `InterventionPayload`, `InterventionContent`, `ActionButton`, `RecoveryActionType`, `UserAction`, `DismissReason`, `SessionState`, `InterventionRecord`, `SessionRecord`, `MetricsQuery`, `MetricsResult`, `CircuitBreakerState`, `CartUpdateResult`, `Offer`, `ShippingOption`, `SizeGuide`, `PaymentMethod`
  - Create `src/types/weights.ts` exporting `SignalWeightMap` type and `DEFAULT_WEIGHTS` constant covering all eight `FrictionCategory` entries
  - _Requirements: 2.1, 2.4_

- [x] 2. Session_State module
  - [x] 2.1 Implement `SessionState` in-memory store (`src/session/SessionState.ts`)
    - Generate UUID v4 `sessionId` on construction
    - Track `checkoutStep`, `cartId`, `frictionEvents`, `interventions`, `converted`, `startedAt`, `endedAt`
    - Expose `addFrictionEvent`, `addIntervention`, `updateInterventionOutcome`, `markConverted`, `end` methods
    - _Requirements: 11.1_
  - [ ]* 2.2 Write unit tests for SessionState
    - Test that `sessionId` is unique across instances
    - Test `addIntervention` enforces at-most-2 limit and no duplicate category
    - Test `markConverted` sets `converted = true` and `endedAt`
    - _Requirements: 3.2, 3.3, 11.1_

- [x] 3. Signal collection — DOM event listeners
  - [x] 3.1 Implement `src/detector/SignalCollector.ts`
    - Attach event listeners for: `mousemove` (cursor velocity + exit-intent detection within `exitIntentMarginPx` of viewport top, firing within 500ms), `scroll` (scroll depth %), `visibilitychange` / `beforeunload` (back-navigation), field `focus`/`blur`/`change`/`error` events on checkout form inputs, idle timer via `setTimeout` reset on any interaction
    - Produce a `SignalSnapshot` on demand via `getSnapshot(): SignalSnapshot`
    - Wrap all listeners in try/catch; on error log and continue without throwing
    - Store no PII — field IDs only, no field values
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ]* 3.2 Write property test for Signal Snapshot Integrity (Property 1)
    - **Property 1: Signal Snapshot Integrity**
    - **Validates: Requirements 1.1, 1.4**
    - Generate arbitrary sequences of synthetic DOM events; assert `getSnapshot()` always returns an object with all required fields and no PII keys
  - [ ]* 3.3 Write property test for Signal Detection Thresholds (Property 2)
    - **Property 2: Signal Detection Thresholds**
    - **Validates: Requirements 1.2, 1.3**
    - For arbitrary idle durations and cursor positions, assert `idleDetected` and `exitIntentDetected` match the threshold conditions exactly

- [x] 4. Deterministic classifier (Tier 1)
  - [x] 4.1 Implement `src/detector/DeterministicClassifier.ts`
    - Export `classifyDeterministic(signals: SignalSnapshot, weights: SignalWeightMap): ClassificationResult`
    - Compute weighted score per category, normalize to [0, 1], return top category with `confidence`, `isAmbiguous` flag (gap < 0.15), and `allScores`
    - _Requirements: 2.1, 2.2, 2.5, 2.6_
  - [ ]* 4.2 Write property test for Classification Produces Exactly One Category (Property 3)
    - **Property 3: Classification Produces Exactly One Category with Maximum Score**
    - **Validates: Requirements 2.1, 2.2, 2.5**
    - For arbitrary `SignalSnapshot` inputs, assert exactly one category returned, confidence in [0.0, 1.0], and returned category has the highest score among all categories

- [x] 5. LLM Gateway serverless function (Tier 2 fallback)
  - [x] 5.1 Implement `functions/llm-gateway/index.ts` as a serverless handler
    - Accept POST body `{ signals: SignalSnapshot, topTwoCategories: [string, string] }`
    - Build structured prompt from design spec, call OpenAI Chat Completions API with 2-second timeout via `AbortController`
    - Parse JSON response `{ category, confidence, reasoning }`; on parse failure or timeout return HTTP 200 with `{ category: null, confidence: 0 }`
    - _Requirements: 2.1, 2.6, 12.1_
  - [ ]* 5.2 Write unit tests for LLM Gateway
    - Test timeout path returns null category
    - Test invalid JSON response returns null category
    - Test valid response is parsed and returned correctly
    - _Requirements: 12.1_

- [x] 6. Friction_Detector orchestrator
  - [x] 6.1 Implement `src/detector/FrictionDetector.ts` implementing the `FrictionDetector` interface
    - `start(config)`: attach `SignalCollector`, start classification loop
    - Classification loop: every 500ms call `classifyDeterministic`; if unambiguous and confidence ≥ threshold emit `FrictionEvent`; if ambiguous call LLM Gateway (async, 2s timeout); apply `classificationTimeoutMs` guard via `AbortController`
    - `stop()`: detach all listeners, cancel timers
    - `onFrictionEvent(handler)`: register callback
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 12.1_
  - [ ]* 6.2 Write unit tests for FrictionDetector
    - Test classification suppressed when confidence < 0.60
    - Test LLM fallback invoked when `isAmbiguous = true`
    - Test `stop()` removes all listeners
    - _Requirements: 2.3, 2.6_

- [x] 7. Checkpoint — core detection pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Circuit breaker
  - [x] 8.1 Implement `src/engine/CircuitBreaker.ts`
    - Track `status`, `failureCount`, `lastFailureAt`, `nextRetryAt`
    - Open after 3 consecutive failures within 60-second window; suppress calls for 30 seconds; transition to half-open on first call after `nextRetryAt`
    - Expose `call<T>(fn: () => Promise<T>): Promise<T>` wrapping any async operation
    - _Requirements: 12.2_
  - [ ]* 8.2 Write unit tests for CircuitBreaker
    - Test circuit opens after 3 failures
    - Test circuit resets after 30-second window
    - Test half-open allows one probe call
    - _Requirements: 12.2_

- [x] 9. Intervention_Engine
  - [x] 9.1 Implement `src/engine/InterventionEngine.ts` implementing the `InterventionEngine` interface
    - `resolve(event, session)`: check session intervention count (≤ 2) and no duplicate category; if either limit exceeded return `null`
    - For each `FrictionCategory`, call the appropriate `Platform_Adapter` method(s) via `CircuitBreaker`; if adapter returns empty/error return `null`
    - Assemble `InterventionPayload` with `interventionId` (UUID v4), `expiresAt` (now + 3000ms), and category-specific `InterventionContent`
    - Apply 3-second `AbortController` timeout; on timeout return `null`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 5.1, 5.2, 5.3, 6.1, 7.1, 8.1, 9.1, 10.1, 12.2_
  - [ ]* 9.2 Write property test for Confidence Threshold Gates Interventions (Property 4)
    - **Property 4: Confidence Threshold Gates Interventions**
    - **Validates: Requirements 2.3, 3.1**
    - For arbitrary classification results, assert `resolve` returns `null` iff confidence < 0.60 (or no recovery data available)
  - [ ]* 9.3 Write property test for Session Intervention Count Invariant (Property 5)
    - **Property 5: Session Intervention Count Invariant**
    - **Validates: Requirements 3.2, 3.3**
    - For arbitrary sequences of FrictionEvents in a session, assert total interventions ≤ 2 and no category appears twice
  - [ ]* 9.4 Write property test for No Intervention Without Recovery Action (Property 6)
    - **Property 6: No Intervention Without Recovery Action**
    - **Validates: Requirements 3.5**
    - For any FrictionEvent where Platform_Adapter returns empty data, assert `resolve` returns `null`
  - [ ]* 9.5 Write property test for Intervention Payload Contains All Required Category Data (Property 11)
    - **Property 11: Intervention Payload Contains All Required Category Data**
    - **Validates: Requirements 5.2, 6.2, 7.1, 9.2, 10.2**
    - For each FrictionCategory with valid recovery data, assert the assembled payload contains all required fields for that category

- [x] 10. Checkpoint — intervention engine
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Platform_Adapter — Shopify integration
  - [x] 11.1 Implement `src/platform/ShopifyAdapter.ts` implementing the `PlatformAdapter` interface
    - `getApplicableOffers`: query Shopify Admin API REST for active discount codes applicable to `cartId`
    - `getShippingOptions`: query Shopify Storefront API GraphQL for shipping rates given `postalCode`; sort results by delivery speed ascending
    - `getSizeGuide`: query Shopify Storefront API for product metafields containing size guide data and variant inventory
    - `getPaymentMethods`: query Shopify Storefront API for available payment gateways on the checkout
    - `applyCoupon`: Storefront API `cartDiscountCodesUpdate` mutation
    - `selectShipping`: Storefront API `checkoutShippingLineUpdate` mutation
    - `updateVariant`: Storefront API `cartLinesUpdate` mutation
    - `selectPaymentMethod`: Storefront API checkout payment update mutation
    - All methods return typed results; on HTTP 4xx/5xx throw a typed `PlatformError` caught by `CircuitBreaker`
    - _Requirements: 5.1, 5.4, 6.1, 6.4, 8.1, 8.3, 9.1, 9.3_
  - [ ]* 11.2 Write property test for Cart Mutation Round-Trip (Property 12)
    - **Property 12: Cart Mutation Round-Trip**
    - **Validates: Requirements 5.4, 6.4, 8.3, 9.3**
    - Using a Shopify test store, for arbitrary valid coupon/shipping/variant/payment inputs assert the mutation is called with correct parameters and the returned `CartUpdateResult` reflects the applied change

- [x] 12. Conversation_Manager — widget core
  - [x] 12.1 Implement `src/ui/ConversationManager.ts` implementing the `ConversationManager` interface
    - `mount(container)`: inject widget root element into `container`; attach CSS with responsive layout rules (min-width 320px, max-width 2560px); position widget to avoid overlapping checkout form fields (use `getBoundingClientRect` to detect field positions)
    - `show(payload)`: render headline, body, and `ActionButton` elements from `InterventionPayload`; replace any currently active widget
    - `dismiss(reason)`: remove widget from DOM, record `DismissReason` in `SessionState`
    - `onAction(handler)`: register callback for `UserAction` events
    - Wrap render logic in an error boundary (try/catch); on render error call `dismiss('engine_error')` and log silently
    - Deliver next message within 1 second of user action (use `requestAnimationFrame` + async action handler)
    - _Requirements: 4.1, 4.3, 4.5, 4.6, 12.3_
  - [ ]* 12.2 Write property test for Responsive Layout Does Not Obscure Checkout Fields (Property 10)
    - **Property 10: Responsive Layout Does Not Obscure Checkout Fields**
    - **Validates: Requirements 4.6**
    - For arbitrary viewport widths in [320, 2560], assert widget bounding rect does not intersect any required checkout field bounding rect in a JSDOM test environment

- [x] 13. Conversation_Manager — turn sequencing and action rendering
  - [x] 13.1 Implement turn sequencer in `src/ui/TurnSequencer.ts`
    - Define per-category conversation flows as state machines: at most 2 follow-up questions before resolution or human escalation (3 questions for `Size_Uncertainty`)
    - Render `ActionButton` elements (not free-text inputs) for all finite answer sets
    - On `Size_Uncertainty` flow: render condensed size recommendation with ≤ 3 questions
    - On `Missing_Information` flow: highlight specific empty/invalid fields and render plain-language explanation per field
    - On `Trust_Issue` flow: render trust signals inline; support `expand_detail` action to expand content without navigation
    - _Requirements: 4.2, 4.4, 7.2, 7.3, 8.2, 10.2, 10.3_
  - [ ]* 13.2 Write property test for Conversation Turn Limit (Property 7)
    - **Property 7: Conversation Turn Limit**
    - **Validates: Requirements 4.2, 8.2**
    - For arbitrary user response paths through any category flow, assert the flow reaches resolution or escalation within the allowed question count
  - [ ]* 13.3 Write property test for Finite Answer Sets Use Selectable Choices (Property 8)
    - **Property 8: Finite Answer Sets Use Selectable Choices**
    - **Validates: Requirements 4.4**
    - For any InterventionPayload with a finite known answer set, assert rendered DOM contains `ActionButton` elements and no `<input type="text">` or `<textarea>` elements
  - [ ]* 13.4 Write property test for Dismissal Prevents Re-trigger (Property 9)
    - **Property 9: Dismissal Prevents Re-trigger**
    - **Validates: Requirements 4.5**
    - For any session state where category C was dismissed, assert a subsequent FrictionEvent for C does not produce a new InterventionPayload

- [x] 14. Checkpoint — UI and turn sequencing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Analytics_Service serverless function
  - [x] 15.1 Implement `functions/analytics-service/index.ts` as a serverless handler with two routes
    - `POST /session`: validate `SessionRecord` shape, persist to database (DynamoDB or Postgres via environment config), respond within 5 seconds
    - `GET /metrics`: accept `MetricsQuery` params, aggregate `conversionRate = (converted / total) * 100`, `deltaPercentagePoints = conversionRate - baselineConversionRate`, `interventionAcceptanceRate`, `perCategoryRecoveryRate`; return `MetricsResult`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [ ]* 15.2 Write property test for Session Record Completeness (Property 14)
    - **Property 14: Session Record Completeness**
    - **Validates: Requirements 11.1**
    - For arbitrary completed sessions, assert persisted `SessionRecord` contains all required fields with correct types
  - [ ]* 15.3 Write property test for Conversion Rate Formula Correctness (Property 15)
    - **Property 15: Conversion Rate Formula Correctness**
    - **Validates: Requirements 11.4, 11.5**
    - For arbitrary datasets of `k` converted sessions out of `n` total, assert `conversionRate = (k / n) * 100` and `deltaPercentagePoints = conversionRate - baselineConversionRate`

- [x] 16. Session flush and Analytics_Service client
  - [x] 16.1 Implement `src/analytics/AnalyticsClient.ts`
    - On `SessionState.end()`, serialize `SessionState` to `SessionRecord` and POST to Analytics_Service via `navigator.sendBeacon` (primary) with `fetch` fallback
    - On fetch failure, retry once with 1-second exponential backoff; drop silently if still failing
    - _Requirements: 11.1, 11.2, 12.1_
  - [ ]* 16.2 Write unit tests for AnalyticsClient
    - Test `sendBeacon` called on session end
    - Test fetch fallback invoked when `sendBeacon` unavailable
    - Test retry-once behavior on failure
    - _Requirements: 11.2_

- [x] 17. Missing_Information field identification
  - [x] 17.1 Implement `src/detector/MissingFieldsScanner.ts`
    - Scan checkout form DOM for required fields (`[required]`, `[aria-required="true"]`) that are empty or have validation errors
    - Return array of `{ fieldId, label, errorMessage }` for all `n` missing/invalid fields — not a subset
    - Integrate into `Intervention_Engine.resolve` for `Missing_Information` category
    - _Requirements: 10.1, 10.2, 10.3_
  - [ ]* 17.2 Write property test for Missing Fields Fully Identified (Property 13)
    - **Property 13: Missing Fields Fully Identified**
    - **Validates: Requirements 10.1, 10.2**
    - For arbitrary checkout form states with `n` empty required fields, assert scanner returns exactly `n` entries with correct `fieldId` and non-empty `label`

- [x] 18. Bundle entry point and Script Tag injection
  - [x] 18.1 Implement `src/index.ts` as the bundle entry point
    - On `DOMContentLoaded`: instantiate `SessionState`, `SignalCollector`, `FrictionDetector`, `InterventionEngine`, `ConversationManager`, `AnalyticsClient`, `ShopifyAdapter`
    - Wire `FrictionDetector.onFrictionEvent` → `InterventionEngine.resolve` → `ConversationManager.show`
    - Wire `ConversationManager.onAction` → `ShopifyAdapter` mutations → `SessionState` updates
    - Wire checkout step completion events → `ConversationManager.dismiss('step_completed')`
    - Wire `beforeunload` / order confirmation → `SessionState.end()` → `AnalyticsClient.flush()`
    - Wrap entire initialization in try/catch; on error log and exit without affecting checkout
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [x] 18.2 Configure bundler for production output
    - Output single minified IIFE bundle to `dist/checkout-recovery.js` with content-hash filename
    - Set bundle size budget: verify page load impact ≤ 200ms at p95 via Lighthouse CI config
    - _Requirements: 12.4_

- [x] 19. Checkpoint — full system wiring
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Integration tests
  - [ ]* 20.1 Write integration test: coupon application round-trip
    - Using Shopify test store credentials from environment, apply a coupon via `ShopifyAdapter.applyCoupon` and assert cart total is updated
    - _Requirements: 5.4_
  - [ ]* 20.2 Write integration test: shipping option retrieval and selection
    - Retrieve shipping options for a test postal code and assert options are sorted by delivery speed; select one and assert it is applied to the checkout
    - _Requirements: 6.1, 6.4_
  - [ ]* 20.3 Write integration test: variant update via cart mutation
    - Update a cart line item to a different variant and assert the cart reflects the new variant without page navigation
    - _Requirements: 8.3_
  - [ ]* 20.4 Write integration test: session record persistence
    - POST a `SessionRecord` to the Analytics_Service and assert it is retrievable and complete
    - _Requirements: 11.1, 11.2_
  - [ ]* 20.5 Write integration test: metrics endpoint aggregation
    - Seed multiple session records with known conversion outcomes and assert `GET /metrics` returns correct `conversionRate` and `deltaPercentagePoints`
    - _Requirements: 11.3, 11.4, 11.5_

- [ ] 21. Performance tests
  - [ ]* 21.1 Write performance test: bundle load time
    - Run Lighthouse CI against a test checkout page with the bundle injected; assert p95 page load increase ≤ 200ms
    - _Requirements: 12.4_
  - [ ]* 21.2 Write performance test: classification latency
    - Measure `classifyDeterministic` execution time via `performance.now()` across 1000 random `SignalSnapshot` inputs; assert all complete within 2000ms
    - _Requirements: 2.6_
  - [ ]* 21.3 Write performance test: widget response time
    - Simulate user action in JSDOM and assert next message rendered within 1000ms
    - _Requirements: 4.3_

- [x] 22. Final checkpoint — all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Hackathon deliverables
  - [x] 23.1 Write `README.md`
    - Installation instructions (Script Tag injection, environment variables for Analytics_Service and LLM_Gateway URLs, Shopify API credentials)
    - Local development setup (`npm install`, `npm run build`, `npm test`)
    - Architecture overview with component diagram reference
  - [x] 23.2 Write `docs/PRODUCT_DOCUMENT.md`
    - Problem statement, solution overview, friction categories, intervention flows, metrics and baseline comparison
  - [x] 23.3 Write `docs/TECHNICAL_DOCUMENT.md`
    - System architecture, component interfaces, two-tier classification design, graceful degradation hierarchy, data models, API contracts
  - [x] 23.4 Write `docs/DECISION_LOG.md`
    - Record key design decisions from the design document's decision table with rationale
  - [x] 23.5 Write `docs/CONTRIBUTION_NOTE.md`
    - Describe the role of AI assistance in the project (Kiro spec workflow, code generation, property derivation)

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 7, 10, 14, 19, and 22 ensure incremental validation
- Property tests (Properties 1–15) validate universal correctness invariants using fast-check with ≥ 100 iterations each
- Unit tests validate specific examples and edge cases
- Integration tests require a Shopify test store and live Analytics_Service; set credentials via environment variables
- The bundle entry point (task 18) is the final wiring step — all components must be complete before it
- Hackathon deliverables (task 23) are documentation-only and can be written in parallel with late-stage implementation tasks
