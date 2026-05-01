"use strict";
var CheckoutRecovery = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // src/session/SessionState.ts
  function generateUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join("")
    ].join("-");
  }
  var MAX_INTERVENTIONS = 2;
  var SessionState = class {
    constructor(cartId, checkoutStep = "cart") {
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
    addFrictionEvent(event) {
      this.frictionEvents.push(event);
    }
    /**
     * Add an intervention record to the session.
     *
     * Returns `true` if the intervention was added, `false` if rejected because:
     * - the session already has 2 interventions (Requirement 3.2), or
     * - an intervention for the same FrictionCategory already exists (Requirement 3.3).
     */
    addIntervention(record) {
      if (this.interventions.length >= MAX_INTERVENTIONS) {
        return false;
      }
      const categoryAlreadyPresent = this.interventions.some(
        (i) => i.category === record.category
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
    updateInterventionOutcome(interventionId, outcome, resolvedAt) {
      const record = this.interventions.find(
        (i) => i.interventionId === interventionId
      );
      if (record === void 0) {
        return;
      }
      record.outcome = outcome;
      if (resolvedAt !== void 0) {
        record.resolvedAt = resolvedAt;
      }
    }
    /**
     * Mark the session as converted (order completed).
     * Sets `converted = true` and records `endedAt`.
     */
    markConverted() {
      this.converted = true;
      this.endedAt = Date.now();
    }
    /**
     * End the session without conversion.
     * Sets `endedAt` if not already set.
     */
    end() {
      if (this.endedAt === void 0) {
        this.endedAt = Date.now();
      }
    }
  };

  // src/detector/SignalCollector.ts
  var VELOCITY_WINDOW = 10;
  var stableIdCounter = 0;
  var stableIdMap = /* @__PURE__ */ new WeakMap();
  function getFieldId(el) {
    const id = el.id;
    if (id && id.trim() !== "") {
      return id;
    }
    const existing = stableIdMap.get(el);
    if (existing !== void 0) {
      return existing;
    }
    const generated = `__field_${++stableIdCounter}`;
    stableIdMap.set(el, generated);
    return generated;
  }
  function detectCheckoutStep() {
    try {
      const form = document.querySelector("[data-checkout-step]");
      if (form !== null) {
        const attr = form.dataset["checkoutStep"];
        if (isCheckoutStep(attr)) {
          return attr;
        }
      }
    } catch (e) {
    }
    try {
      const path = window.location.pathname.toLowerCase();
      if (path.includes("/payment")) return "payment";
      if (path.includes("/shipping")) return "shipping";
      if (path.includes("/information")) return "information";
      if (path.includes("/review")) return "review";
      if (path.includes("/cart")) return "cart";
    } catch (e) {
    }
    return "cart";
  }
  var CHECKOUT_STEPS = [
    "cart",
    "information",
    "shipping",
    "payment",
    "review"
  ];
  function isCheckoutStep(value) {
    return value !== void 0 && CHECKOUT_STEPS.includes(value);
  }
  var SignalCollector = class {
    constructor(config) {
      // --- page timing ---
      this.pageLoadTime = Date.now();
      // --- scroll ---
      this.scrollDepthPct = 0;
      // --- cursor velocity ---
      this.velocitySamples = [];
      this.lastMouseX = 0;
      this.lastMouseY = 0;
      this.lastMouseTime = 0;
      // --- exit intent ---
      this.exitIntentDetected = false;
      // --- idle ---
      this.idleDetected = false;
      this.idleTimer = null;
      // --- back navigation ---
      this.backNavigationAttempted = false;
      // --- field events ---
      this.fieldEvents = [];
      /** Map from fieldId → focus timestamp (ms) for computing durationMs. */
      this.focusTimes = /* @__PURE__ */ new Map();
      // Field-level listeners stored as tuples for cleanup
      this._fieldListeners = [];
      this.config = config;
      this._onMouseMove = (e) => this._handleMouseMove(e);
      this._onScroll = () => this._handleScroll();
      this._onVisibilityChange = () => this._handleVisibilityChange();
      this._onBeforeUnload = () => this._handleBeforeUnload();
      this._onKeyDown = () => this._resetIdleTimer();
      this._onClick = () => this._resetIdleTimer();
    }
    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------
    /** Attach all event listeners and start the idle timer. */
    start() {
      try {
        document.addEventListener("mousemove", this._onMouseMove, { passive: true });
      } catch (err) {
        console.error("[SignalCollector] Failed to attach mousemove listener:", err);
      }
      try {
        document.addEventListener("scroll", this._onScroll, { passive: true });
      } catch (err) {
        console.error("[SignalCollector] Failed to attach scroll listener:", err);
      }
      try {
        document.addEventListener("visibilitychange", this._onVisibilityChange);
      } catch (err) {
        console.error("[SignalCollector] Failed to attach visibilitychange listener:", err);
      }
      try {
        window.addEventListener("beforeunload", this._onBeforeUnload);
      } catch (err) {
        console.error("[SignalCollector] Failed to attach beforeunload listener:", err);
      }
      try {
        document.addEventListener("keydown", this._onKeyDown, { passive: true });
      } catch (err) {
        console.error("[SignalCollector] Failed to attach keydown listener:", err);
      }
      try {
        document.addEventListener("click", this._onClick, { passive: true });
      } catch (err) {
        console.error("[SignalCollector] Failed to attach click listener:", err);
      }
      this._attachFieldListeners();
      this._resetIdleTimer();
    }
    /** Remove all event listeners and clear all timers. */
    stop() {
      try {
        document.removeEventListener("mousemove", this._onMouseMove);
      } catch (err) {
        console.error("[SignalCollector] Failed to remove mousemove listener:", err);
      }
      try {
        document.removeEventListener("scroll", this._onScroll);
      } catch (err) {
        console.error("[SignalCollector] Failed to remove scroll listener:", err);
      }
      try {
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
      } catch (err) {
        console.error("[SignalCollector] Failed to remove visibilitychange listener:", err);
      }
      try {
        window.removeEventListener("beforeunload", this._onBeforeUnload);
      } catch (err) {
        console.error("[SignalCollector] Failed to remove beforeunload listener:", err);
      }
      try {
        document.removeEventListener("keydown", this._onKeyDown);
      } catch (err) {
        console.error("[SignalCollector] Failed to remove keydown listener:", err);
      }
      try {
        document.removeEventListener("click", this._onClick);
      } catch (err) {
        console.error("[SignalCollector] Failed to remove click listener:", err);
      }
      for (const { el, type, handler } of this._fieldListeners) {
        try {
          el.removeEventListener(type, handler);
        } catch (err) {
          console.error("[SignalCollector] Failed to remove field listener:", err);
        }
      }
      this._fieldListeners.length = 0;
      if (this.idleTimer !== null) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
    }
    // ---------------------------------------------------------------------------
    // Snapshot
    // ---------------------------------------------------------------------------
    /** Return a point-in-time snapshot of all collected signals. */
    getSnapshot() {
      return {
        timeOnPageMs: Date.now() - this.pageLoadTime,
        scrollDepthPct: this.scrollDepthPct,
        cursorVelocityAvg: this._computeVelocityAvg(),
        exitIntentDetected: this.exitIntentDetected,
        idleDetected: this.idleDetected,
        // Return a shallow copy so callers cannot mutate internal state
        fieldEvents: [...this.fieldEvents],
        backNavigationAttempted: this.backNavigationAttempted,
        checkoutStep: detectCheckoutStep()
      };
    }
    // ---------------------------------------------------------------------------
    // Mouse movement — velocity + exit intent
    // ---------------------------------------------------------------------------
    _handleMouseMove(e) {
      try {
        const now = Date.now();
        if (this.lastMouseTime !== 0) {
          const dx = e.clientX - this.lastMouseX;
          const dy = e.clientY - this.lastMouseY;
          const dt = now - this.lastMouseTime;
          if (dt > 0) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            const velocity = distance / dt;
            this.velocitySamples.push(velocity);
            if (this.velocitySamples.length > VELOCITY_WINDOW) {
              this.velocitySamples.shift();
            }
          }
        }
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.lastMouseTime = now;
        if (e.clientY <= this.config.exitIntentMarginPx) {
          if (!this.exitIntentDetected) {
            setTimeout(() => {
              this.exitIntentDetected = true;
            }, 0);
            this.exitIntentDetected = true;
          }
        }
        this._resetIdleTimer();
      } catch (err) {
        console.error("[SignalCollector] Error in mousemove handler:", err);
      }
    }
    _computeVelocityAvg() {
      if (this.velocitySamples.length === 0) return 0;
      const sum = this.velocitySamples.reduce((acc, v) => acc + v, 0);
      return sum / this.velocitySamples.length;
    }
    // ---------------------------------------------------------------------------
    // Scroll depth
    // ---------------------------------------------------------------------------
    _handleScroll() {
      var _a, _b, _c;
      try {
        const scrollTop = (_c = (_b = (_a = window.scrollY) != null ? _a : document.documentElement.scrollTop) != null ? _b : document.body.scrollTop) != null ? _c : 0;
        const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        if (docHeight > 0) {
          const pct = Math.min(100, Math.max(0, scrollTop / docHeight * 100));
          if (pct > this.scrollDepthPct) {
            this.scrollDepthPct = pct;
          }
        }
        this._resetIdleTimer();
      } catch (err) {
        console.error("[SignalCollector] Error in scroll handler:", err);
      }
    }
    // ---------------------------------------------------------------------------
    // Back navigation
    // ---------------------------------------------------------------------------
    _handleVisibilityChange() {
      try {
        if (document.visibilityState === "hidden") {
          this.backNavigationAttempted = true;
        }
      } catch (err) {
        console.error("[SignalCollector] Error in visibilitychange handler:", err);
      }
    }
    _handleBeforeUnload() {
      try {
        this.backNavigationAttempted = true;
      } catch (err) {
        console.error("[SignalCollector] Error in beforeunload handler:", err);
      }
    }
    // ---------------------------------------------------------------------------
    // Idle detection
    // ---------------------------------------------------------------------------
    _resetIdleTimer() {
      try {
        if (this.idleTimer !== null) {
          clearTimeout(this.idleTimer);
        }
        this.idleDetected = false;
        this.idleTimer = setTimeout(() => {
          this.idleDetected = true;
        }, this.config.idleTimeoutMs);
      } catch (err) {
        console.error("[SignalCollector] Error resetting idle timer:", err);
      }
    }
    // ---------------------------------------------------------------------------
    // Field events
    // ---------------------------------------------------------------------------
    _attachFieldListeners() {
      try {
        const fields = document.querySelectorAll(
          "input, select, textarea"
        );
        for (const el of fields) {
          this._addFieldListener(el, "focus", this._makeFieldFocusHandler(el));
          this._addFieldListener(el, "blur", this._makeFieldBlurHandler(el));
          this._addFieldListener(el, "change", this._makeFieldChangeHandler(el));
        }
      } catch (err) {
        console.error("[SignalCollector] Error attaching field listeners:", err);
      }
    }
    _addFieldListener(el, type, handler) {
      try {
        el.addEventListener(type, handler);
        this._fieldListeners.push({ el, type, handler });
      } catch (err) {
        console.error(`[SignalCollector] Failed to attach ${type} listener on field:`, err);
      }
    }
    _makeFieldFocusHandler(el) {
      return () => {
        try {
          const fieldId = getFieldId(el);
          this.focusTimes.set(fieldId, Date.now());
          this.fieldEvents.push({ fieldId, eventType: "focus" });
          this._resetIdleTimer();
        } catch (err) {
          console.error("[SignalCollector] Error in field focus handler:", err);
        }
      };
    }
    _makeFieldBlurHandler(el) {
      return () => {
        try {
          const fieldId = getFieldId(el);
          const focusTime = this.focusTimes.get(fieldId);
          const durationMs = focusTime !== void 0 ? Date.now() - focusTime : void 0;
          const blurEvent = durationMs !== void 0 ? { fieldId, eventType: "blur", durationMs } : { fieldId, eventType: "blur" };
          this.fieldEvents.push(blurEvent);
          this.focusTimes.delete(fieldId);
          this._checkFieldError(el, fieldId);
          this._resetIdleTimer();
        } catch (err) {
          console.error("[SignalCollector] Error in field blur handler:", err);
        }
      };
    }
    _makeFieldChangeHandler(el) {
      return () => {
        try {
          const fieldId = getFieldId(el);
          this.fieldEvents.push({ fieldId, eventType: "change" });
          this._resetIdleTimer();
        } catch (err) {
          console.error("[SignalCollector] Error in field change handler:", err);
        }
      };
    }
    /**
     * Check whether a field has a validation error and, if so, record an
     * `error` FieldEvent. Checks `:invalid` pseudo-class and
     * `aria-invalid="true"` attribute. Error message is taken from
     * `validationMessage` or the element referenced by `aria-errormessage`.
     *
     * No field values are read or stored.
     */
    _checkFieldError(el, fieldId) {
      var _a;
      try {
        const isInvalid = el.matches(":invalid") || el.getAttribute("aria-invalid") === "true";
        if (!isInvalid) return;
        let errorMessage;
        if ("validationMessage" in el) {
          const msg = el.validationMessage;
          if (msg && msg.trim() !== "") {
            errorMessage = msg;
          }
        }
        if (errorMessage === void 0) {
          const errMsgId = el.getAttribute("aria-errormessage");
          if (errMsgId) {
            const errEl = document.getElementById(errMsgId);
            if (errEl !== null) {
              const text = (_a = errEl.textContent) == null ? void 0 : _a.trim();
              if (text && text !== "") {
                errorMessage = text;
              }
            }
          }
        }
        const errorEvent = errorMessage !== void 0 ? { fieldId, eventType: "error", errorMessage } : { fieldId, eventType: "error" };
        this.fieldEvents.push(errorEvent);
      } catch (err) {
        console.error("[SignalCollector] Error checking field validation:", err);
      }
    }
  };

  // src/types/index.ts
  var ALL_FRICTION_CATEGORIES = [
    "Price_Hesitation",
    "Shipping_Confusion",
    "Trust_Issue",
    "Missing_Information",
    "Coupon_Confusion",
    "Size_Uncertainty",
    "Delivery_Timeline",
    "Payment_Options"
  ];

  // src/detector/DeterministicClassifier.ts
  var MAX_TIME_ON_PAGE_MS = 3e5;
  var MAX_CURSOR_VELOCITY = 5;
  var MAX_FIELD_EVENTS = 10;
  function normalizeSignal(key, snapshot) {
    switch (key) {
      case "timeOnPageMs":
        return Math.min(1, snapshot.timeOnPageMs / MAX_TIME_ON_PAGE_MS);
      case "scrollDepthPct":
        return Math.min(1, snapshot.scrollDepthPct / 100);
      case "cursorVelocityAvg":
        return Math.min(1, snapshot.cursorVelocityAvg / MAX_CURSOR_VELOCITY);
      case "exitIntentDetected":
        return snapshot.exitIntentDetected ? 1 : 0;
      case "idleDetected":
        return snapshot.idleDetected ? 1 : 0;
      case "fieldEvents":
        return Math.min(1, snapshot.fieldEvents.length / MAX_FIELD_EVENTS);
      case "backNavigationAttempted":
        return snapshot.backNavigationAttempted ? 1 : 0;
      case "checkoutStep":
        return 0;
      default: {
        const _exhaustive = key;
        return _exhaustive;
      }
    }
  }
  function computeWeightedScore(signals, categoryWeights) {
    if (categoryWeights === void 0) {
      return 0;
    }
    let score = 0;
    for (const rawKey of Object.keys(categoryWeights)) {
      if (rawKey === "checkoutStep") continue;
      const weight = categoryWeights[rawKey];
      if (weight === void 0 || weight === 0) continue;
      score += normalizeSignal(rawKey, signals) * weight;
    }
    return score;
  }
  function classifyDeterministic(signals, weights) {
    var _a, _b, _c;
    const rawScores = {};
    for (const category of ALL_FRICTION_CATEGORIES) {
      rawScores[category] = computeWeightedScore(signals, weights[category]);
    }
    const maxRaw = Math.max(...Object.values(rawScores));
    const scores = {};
    for (const category of ALL_FRICTION_CATEGORIES) {
      const raw = (_a = rawScores[category]) != null ? _a : 0;
      scores[category] = maxRaw > 0 ? raw / maxRaw : 0;
    }
    const sorted = Object.entries(scores).sort(
      ([, a], [, b]) => b - a
    );
    const [topCategory, topScore] = sorted[0];
    const secondScore = (_c = (_b = sorted[1]) == null ? void 0 : _b[1]) != null ? _c : 0;
    return {
      category: topCategory,
      confidence: topScore,
      isAmbiguous: topScore - secondScore < 0.15,
      allScores: scores
    };
  }

  // src/types/weights.ts
  var DEFAULT_WEIGHTS = {
    Price_Hesitation: {
      timeOnPageMs: 0.3,
      scrollDepthPct: 0.15,
      exitIntentDetected: 0.35,
      idleDetected: 0.2
      // sum: 1.00
    },
    Shipping_Confusion: {
      timeOnPageMs: 0.2,
      fieldEvents: 0.4,
      scrollDepthPct: 0.15,
      exitIntentDetected: 0.25
      // sum: 1.00
    },
    Trust_Issue: {
      scrollDepthPct: 0.25,
      exitIntentDetected: 0.35,
      idleDetected: 0.2,
      backNavigationAttempted: 0.2
      // sum: 1.00
    },
    Missing_Information: {
      fieldEvents: 0.6,
      timeOnPageMs: 0.2,
      idleDetected: 0.2
      // sum: 1.00
    },
    Coupon_Confusion: {
      fieldEvents: 0.5,
      timeOnPageMs: 0.25,
      idleDetected: 0.15,
      exitIntentDetected: 0.1
      // sum: 1.00
    },
    Size_Uncertainty: {
      scrollDepthPct: 0.3,
      idleDetected: 0.25,
      backNavigationAttempted: 0.3,
      timeOnPageMs: 0.15
      // sum: 1.00
    },
    Delivery_Timeline: {
      scrollDepthPct: 0.3,
      fieldEvents: 0.25,
      exitIntentDetected: 0.25,
      idleDetected: 0.2
      // sum: 1.00
    },
    Payment_Options: {
      exitIntentDetected: 0.35,
      fieldEvents: 0.3,
      idleDetected: 0.2,
      timeOnPageMs: 0.15
      // sum: 1.00
    }
  };

  // src/detector/FrictionDetector.ts
  var CLASSIFICATION_INTERVAL_MS = 500;
  function getLlmGatewayUrl() {
    if (typeof globalThis !== "undefined" && typeof globalThis["LLM_GATEWAY_URL"] === "string") {
      return globalThis["LLM_GATEWAY_URL"];
    }
    return "/classify";
  }
  var FrictionDetectorImpl = class {
    constructor(sessionId) {
      /** Registered friction event handlers. */
      this.handlers = [];
      /** The active SignalCollector instance, set on start(). */
      this.collector = null;
      /** Handle returned by setInterval for the classification loop. */
      this.intervalHandle = null;
      /** Categories already emitted in this session — prevents re-emission. */
      this.emittedCategories = /* @__PURE__ */ new Set();
      /** True while a classification cycle is in progress (prevents overlap). */
      this.classifying = false;
      /** The active DetectorConfig, set on start(). */
      this.config = null;
      this.sessionId = sessionId;
    }
    // ---------------------------------------------------------------------------
    // FrictionDetector interface
    // ---------------------------------------------------------------------------
    /**
     * Attach a SignalCollector and start the 500ms classification loop.
     * Calling start() while already running is a no-op.
     */
    start(config) {
      if (this.intervalHandle !== null) {
        return;
      }
      this.config = config;
      try {
        this.collector = new SignalCollector(config);
        this.collector.start();
      } catch (err) {
        console.error("[FrictionDetector] Failed to start SignalCollector:", err);
      }
      this.intervalHandle = setInterval(() => {
        void this._runClassificationCycle();
      }, CLASSIFICATION_INTERVAL_MS);
    }
    /**
     * Stop the classification loop and detach all listeners.
     * Safe to call multiple times.
     */
    stop() {
      if (this.intervalHandle !== null) {
        clearInterval(this.intervalHandle);
        this.intervalHandle = null;
      }
      if (this.collector !== null) {
        try {
          this.collector.stop();
        } catch (err) {
          console.error("[FrictionDetector] Error stopping SignalCollector:", err);
        }
        this.collector = null;
      }
      this.config = null;
      this.classifying = false;
    }
    /**
     * Register a callback that will be invoked for each FrictionEvent.
     * Multiple handlers can be registered; all are called in registration order.
     */
    onFrictionEvent(handler) {
      this.handlers.push(handler);
    }
    // ---------------------------------------------------------------------------
    // Classification cycle
    // ---------------------------------------------------------------------------
    /**
     * Run a single classification cycle, guarded by `classificationTimeoutMs`.
     *
     * The cycle is skipped if:
     * - A previous cycle is still in progress (prevents overlap).
     * - The detector has been stopped (config is null).
     * - The SignalCollector is unavailable.
     */
    async _runClassificationCycle() {
      if (this.classifying || this.config === null || this.collector === null) {
        return;
      }
      this.classifying = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.classificationTimeoutMs
      );
      try {
        await this._classify(this.config, controller.signal);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          console.warn("[FrictionDetector] Classification cycle timed out");
        } else {
          console.error("[FrictionDetector] Unexpected error in classification cycle:", err);
        }
      } finally {
        clearTimeout(timeoutId);
        this.classifying = false;
      }
    }
    /**
     * Core classification logic for a single cycle.
     *
     * 1. Take a signal snapshot.
     * 2. Run Tier 1 (deterministic).
     * 3a. If unambiguous AND confidence ≥ threshold → emit and return.
     * 3b. If ambiguous → call LLM Gateway (Tier 2).
     *     - On LLM success with confidence ≥ threshold → emit.
     *     - On LLM failure → fall back to Tier 1 if confidence ≥ threshold.
     *
     * @param config  The active DetectorConfig.
     * @param signal  AbortSignal from the cycle-level timeout guard.
     */
    async _classify(config, signal) {
      if (signal.aborted) return;
      let snapshot;
      try {
        snapshot = this.collector.getSnapshot();
      } catch (err) {
        console.error("[FrictionDetector] Failed to get signal snapshot:", err);
        return;
      }
      let tier1Result;
      try {
        tier1Result = classifyDeterministic(snapshot, DEFAULT_WEIGHTS);
      } catch (err) {
        console.error("[FrictionDetector] Deterministic classification failed:", err);
        return;
      }
      const { category, confidence, isAmbiguous, allScores } = tier1Result;
      if (signal.aborted) return;
      if (!isAmbiguous && confidence >= config.confidenceThreshold) {
        this._maybeEmit(category, confidence, snapshot);
        return;
      }
      if (isAmbiguous) {
        const topTwo = this._topTwoCategories(allScores);
        const llmResult = await this._callLlmGateway(snapshot, topTwo, signal);
        if (signal.aborted) return;
        if (llmResult !== null && llmResult.category !== null && llmResult.confidence >= config.confidenceThreshold) {
          this._maybeEmit(llmResult.category, llmResult.confidence, snapshot);
          return;
        }
        if (confidence >= config.confidenceThreshold) {
          this._maybeEmit(category, confidence, snapshot);
        }
      }
    }
    // ---------------------------------------------------------------------------
    // LLM Gateway call
    // ---------------------------------------------------------------------------
    /**
     * Call the LLM Gateway with the current signal snapshot and the top two
     * deterministic categories. Applies the cycle-level AbortSignal so the
     * call is cancelled if the overall classification timeout fires.
     *
     * Returns null on any failure (network error, timeout, invalid response).
     */
    async _callLlmGateway(signals, topTwoCategories, signal) {
      try {
        const url = getLlmGatewayUrl();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signals, topTwoCategories }),
          signal
        });
        if (!response.ok) {
          console.warn(
            `[FrictionDetector] LLM Gateway returned HTTP ${response.status}`
          );
          return null;
        }
        const data = await response.json();
        return this._parseLlmResponse(data);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          console.warn("[FrictionDetector] LLM Gateway call timed out");
        } else {
          console.error("[FrictionDetector] LLM Gateway call failed:", err);
        }
        return null;
      }
    }
    /**
     * Validate and parse the raw JSON response from the LLM Gateway.
     * Returns null if the shape is unexpected.
     */
    _parseLlmResponse(data) {
      if (typeof data !== "object" || data === null) return null;
      const obj = data;
      const category = obj["category"];
      if (category !== null && typeof category !== "string") return null;
      const confidence = obj["confidence"];
      if (typeof confidence !== "number") return null;
      if (typeof obj["reasoning"] === "string") {
        return {
          category,
          confidence,
          reasoning: obj["reasoning"]
        };
      }
      return {
        category,
        confidence
      };
    }
    // ---------------------------------------------------------------------------
    // Emission helpers
    // ---------------------------------------------------------------------------
    /**
     * Emit a FrictionEvent for the given category, unless it has already been
     * emitted in this session (deduplication per Req 2.3 / 3.3).
     */
    _maybeEmit(category, confidence, signals) {
      if (this.emittedCategories.has(category)) {
        return;
      }
      this.emittedCategories.add(category);
      const event = {
        sessionId: this.sessionId,
        category,
        confidence,
        signals,
        detectedAt: Date.now()
      };
      this._dispatchEvent(event);
    }
    /**
     * Invoke all registered handlers with the given FrictionEvent.
     * Each handler is called in a separate try/catch so a failing handler
     * cannot prevent subsequent handlers from running.
     */
    _dispatchEvent(event) {
      for (const handler of this.handlers) {
        try {
          handler(event);
        } catch (err) {
          console.error("[FrictionDetector] Error in FrictionEvent handler:", err);
        }
      }
    }
    // ---------------------------------------------------------------------------
    // Utility
    // ---------------------------------------------------------------------------
    /**
     * Extract the top two category names from the allScores map, sorted by
     * score descending. Returns a tuple of two strings; if fewer than two
     * categories exist, the second entry is an empty string.
     */
    _topTwoCategories(allScores) {
      var _a, _b, _c, _d;
      const sorted = Object.entries(allScores).sort(([, a], [, b]) => b - a);
      const first = (_b = (_a = sorted[0]) == null ? void 0 : _a[0]) != null ? _b : "";
      const second = (_d = (_c = sorted[1]) == null ? void 0 : _c[0]) != null ? _d : "";
      return [first, second];
    }
  };

  // src/detector/MissingFieldsScanner.ts
  var REQUIRED_FIELD_SELECTORS = [
    "input[required]",
    "select[required]",
    "textarea[required]",
    '[aria-required="true"]'
  ].join(", ");
  var ERROR_CLASS_FRAGMENTS = ["error", "invalid", "validation"];
  var MissingFieldsScanner = class {
    /**
     * Scan the given root element (or `document.body` if omitted) for required
     * fields that are empty or have validation errors.
     *
     * @param root  Optional root element to scope the scan. Defaults to document.body.
     * @returns     Array of MissingField descriptors — one per missing/invalid field.
     *              Returns an empty array if no missing fields are found or if the
     *              DOM is unavailable.
     */
    scan(root) {
      const results = [];
      let container = null;
      try {
        container = root != null ? root : document.body;
      } catch (e) {
        return results;
      }
      if (container === null) {
        return results;
      }
      let fields;
      try {
        fields = container.querySelectorAll(REQUIRED_FIELD_SELECTORS);
      } catch (e) {
        return results;
      }
      for (const el of fields) {
        try {
          const htmlEl = el;
          if (!this._isMissing(htmlEl)) {
            continue;
          }
          const fieldId = this._resolveFieldId(htmlEl);
          const label = this._resolveLabel(htmlEl, container);
          const errorMessage = this._resolveErrorMessage(htmlEl, container);
          const entry = errorMessage !== void 0 ? { fieldId, label, errorMessage } : { fieldId, label };
          results.push(entry);
        } catch (e) {
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
    _isMissing(el) {
      var _a, _b;
      try {
        if (el.getAttribute("aria-invalid") === "true") {
          return true;
        }
      } catch (e) {
      }
      try {
        if (el.matches(":invalid")) {
          return true;
        }
      } catch (e) {
      }
      try {
        const describedBy = el.getAttribute("aria-describedby");
        if (describedBy !== null) {
          for (const id of describedBy.trim().split(/\s+/)) {
            if (id === "") continue;
            const refEl = document.getElementById(id);
            if (refEl !== null) {
              const text = (_b = (_a = refEl.textContent) == null ? void 0 : _a.trim()) != null ? _b : "";
              if (text !== "") {
                return true;
              }
            }
          }
        }
      } catch (e) {
      }
      try {
        if (this._findNearbyErrorElement(el) !== null) {
          return true;
        }
      } catch (e) {
      }
      try {
        const tag = el.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") {
          const value = el.value;
          if (value.trim() === "") {
            return true;
          }
        }
      } catch (e) {
      }
      return false;
    }
    /**
     * Resolve a stable identifier for the field element.
     * Prefers the element's `id` attribute; falls back to `name`, then a
     * generated placeholder.
     */
    _resolveFieldId(el) {
      try {
        const id = el.id;
        if (id && id.trim() !== "") {
          return id;
        }
      } catch (e) {
      }
      try {
        const name = el.name;
        if (name && name.trim() !== "") {
          return name;
        }
      } catch (e) {
      }
      return "__missing_field__";
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
    _resolveLabel(el, root) {
      var _a, _b, _c, _d, _e, _f;
      try {
        const id = el.id;
        if (id && id.trim() !== "") {
          const labelEl = root.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (labelEl !== null) {
            const text = (_b = (_a = labelEl.textContent) == null ? void 0 : _a.trim()) != null ? _b : "";
            if (text !== "") return text;
          }
        }
      } catch (e) {
        try {
          const id = el.id;
          if (id && id.trim() !== "") {
            const labelEl = root.querySelector(`label[for="${id}"]`);
            if (labelEl !== null) {
              const text = (_d = (_c = labelEl.textContent) == null ? void 0 : _c.trim()) != null ? _d : "";
              if (text !== "") return text;
            }
          }
        } catch (e2) {
        }
      }
      try {
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel !== null && ariaLabel.trim() !== "") {
          return ariaLabel.trim();
        }
      } catch (e) {
      }
      try {
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy !== null && labelledBy.trim() !== "") {
          const parts = [];
          for (const id of labelledBy.trim().split(/\s+/)) {
            if (id === "") continue;
            const refEl = document.getElementById(id);
            if (refEl !== null) {
              const text = (_f = (_e = refEl.textContent) == null ? void 0 : _e.trim()) != null ? _f : "";
              if (text !== "") parts.push(text);
            }
          }
          if (parts.length > 0) {
            return parts.join(" ");
          }
        }
      } catch (e) {
      }
      try {
        const placeholder = el.placeholder;
        if (placeholder && placeholder.trim() !== "") {
          return placeholder.trim();
        }
      } catch (e) {
      }
      try {
        const name = el.name;
        if (name && name.trim() !== "") {
          return name.trim();
        }
      } catch (e) {
      }
      try {
        const id = el.id;
        if (id && id.trim() !== "") {
          return id.trim();
        }
      } catch (e) {
      }
      return "Unknown field";
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
    _resolveErrorMessage(el, _root) {
      var _a, _b, _c, _d;
      try {
        const describedBy = el.getAttribute("aria-describedby");
        if (describedBy !== null) {
          const parts = [];
          for (const id of describedBy.trim().split(/\s+/)) {
            if (id === "") continue;
            const refEl = document.getElementById(id);
            if (refEl !== null) {
              const text = (_b = (_a = refEl.textContent) == null ? void 0 : _a.trim()) != null ? _b : "";
              if (text !== "") parts.push(text);
            }
          }
          if (parts.length > 0) {
            return parts.join(" ");
          }
        }
      } catch (e) {
      }
      try {
        const errorEl = this._findNearbyErrorElement(el);
        if (errorEl !== null) {
          const text = (_d = (_c = errorEl.textContent) == null ? void 0 : _c.trim()) != null ? _d : "";
          if (text !== "") return text;
        }
      } catch (e) {
      }
      try {
        if ("validationMessage" in el) {
          const msg = el.validationMessage;
          if (msg && msg.trim() !== "") {
            return msg.trim();
          }
        }
      } catch (e) {
      }
      return void 0;
    }
    /**
     * Search for a nearby element (next sibling, parent's children, or the
     * field's own children) whose class list contains an error-related fragment.
     *
     * Returns the first matching element, or null if none is found.
     */
    _findNearbyErrorElement(el) {
      try {
        const next = el.nextElementSibling;
        if (next !== null && this._hasErrorClass(next)) {
          return next;
        }
      } catch (e) {
      }
      try {
        const prev = el.previousElementSibling;
        if (prev !== null && this._hasErrorClass(prev)) {
          return prev;
        }
      } catch (e) {
      }
      try {
        const parent = el.parentElement;
        if (parent !== null) {
          for (const child of parent.children) {
            if (child !== el && this._hasErrorClass(child)) {
              return child;
            }
          }
        }
      } catch (e) {
      }
      try {
        for (const child of el.children) {
          if (this._hasErrorClass(child)) {
            return child;
          }
        }
      } catch (e) {
      }
      return null;
    }
    /**
     * Return true if the element's className contains any error-related fragment.
     */
    _hasErrorClass(el) {
      try {
        const className = typeof el.className === "string" ? el.className.toLowerCase() : "";
        return ERROR_CLASS_FRAGMENTS.some(
          (fragment) => className.includes(fragment)
        );
      } catch (e) {
        return false;
      }
    }
  };

  // src/engine/InterventionEngine.ts
  var MAX_INTERVENTIONS2 = 2;
  var RESOLVE_TIMEOUT_MS = 3e3;
  var EXPIRES_OFFSET_MS = 3e3;
  function generateUUID2() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join("")
    ].join("-");
  }
  function buildPriceHesitationContent(offers) {
    if (offers.length > 0) {
      const best = offers.reduce(
        (a, b) => b.discountAmount > a.discountAmount ? b : a
      );
      const actions = [];
      if (best.couponCode !== void 0) {
        actions.push({
          label: `Apply ${best.couponCode}`,
          actionType: "apply_coupon",
          payload: { couponCode: best.couponCode, offerId: best.offerId }
        });
      }
      actions.push({ label: "No thanks", actionType: "dismiss" });
      return {
        headline: "Here's a deal for you",
        body: `${best.title} \u2014 ${best.description}`,
        actions,
        supplementalData: { offers }
      };
    }
    return {
      headline: "Great value in your cart",
      body: "You're getting a competitive price. Here's a quick summary of what makes this a great deal.",
      actions: [
        { label: "See price breakdown", actionType: "expand_detail" },
        { label: "Continue to checkout", actionType: "dismiss" }
      ],
      supplementalData: { offers: [] }
    };
  }
  function buildShippingConfusionContent(options) {
    const actions = options.map((opt) => ({
      label: `${opt.title} \u2014 ${opt.currencyCode} ${opt.price.toFixed(2)}${opt.deliveryEstimate !== void 0 ? ` (${opt.deliveryEstimate})` : ""}`,
      actionType: "select_shipping",
      payload: { handle: opt.handle }
    }));
    actions.push({ label: "Dismiss", actionType: "dismiss" });
    return {
      headline: "Shipping options for your order",
      body: "Choose the shipping speed that works best for you:",
      actions,
      supplementalData: { shippingOptions: options }
    };
  }
  function buildDeliveryTimelineContent(options) {
    const actions = options.map((opt) => ({
      label: `${opt.title}${opt.deliveryEstimate !== void 0 ? ` \u2014 ${opt.deliveryEstimate}` : ""}`,
      actionType: "select_shipping",
      payload: { handle: opt.handle }
    }));
    actions.push({ label: "Dismiss", actionType: "dismiss" });
    return {
      headline: "Estimated delivery for your order",
      body: "Here are the available delivery options with estimated arrival times:",
      actions,
      supplementalData: { shippingOptions: options }
    };
  }
  function buildTrustIssueContent() {
    return {
      headline: "Shop with confidence",
      body: "Your order is protected by our secure checkout, easy returns, and verified customer reviews.",
      actions: [
        { label: "View return policy", actionType: "expand_detail", payload: { section: "return_policy" } },
        { label: "See security details", actionType: "expand_detail", payload: { section: "security" } },
        { label: "Read reviews", actionType: "expand_detail", payload: { section: "reviews" } },
        { label: "Continue to checkout", actionType: "dismiss" }
      ],
      supplementalData: {
        trustSignals: [
          { type: "return_policy", label: "30-day hassle-free returns" },
          { type: "security", label: "SSL-encrypted checkout" },
          { type: "reviews", label: "Verified customer reviews" }
        ]
      }
    };
  }
  function buildSizeUncertaintyContent(guide) {
    const availableSizes = Object.values(guide.inventory).filter((v) => v.available).map((v) => ({
      label: v.size,
      variantId: v.variantId
    }));
    const actions = availableSizes.map((s) => ({
      label: s.label,
      actionType: "select_variant",
      payload: { variantId: s.variantId }
    }));
    actions.push({ label: "See full size guide", actionType: "expand_detail", payload: { guideUrl: guide.guideUrl } });
    actions.push({ label: "Dismiss", actionType: "dismiss" });
    return {
      headline: `Find your size \u2014 ${guide.productTitle}`,
      body: "Select your size below. In-stock sizes are shown.",
      actions,
      supplementalData: {
        sizeGuide: guide,
        availableSizes
      }
    };
  }
  function buildPaymentOptionsContent(methods) {
    const available = methods.filter((m) => m.available);
    const actions = available.map((m) => ({
      label: m.name,
      actionType: "select_payment",
      payload: { methodId: m.methodId }
    }));
    actions.push({ label: "Dismiss", actionType: "dismiss" });
    return {
      headline: "Payment options available",
      body: "We accept the following payment methods \u2014 choose the one that works for you:",
      actions,
      supplementalData: { paymentMethods: methods }
    };
  }
  function buildMissingInformationContent(missingFields) {
    const count = missingFields.length;
    const fieldWord = count === 1 ? "field needs" : "fields need";
    return {
      headline: "Let's finish your order",
      body: `${count} required ${fieldWord} attention before you can proceed.`,
      actions: [
        { label: "Show me what's missing", actionType: "expand_detail", payload: { section: "missing_fields" } },
        { label: "Dismiss", actionType: "dismiss" }
      ],
      supplementalData: { missingFields }
    };
  }
  function buildCouponConfusionContent(offers) {
    if (offers.length > 0) {
      const actions = offers.filter((o) => o.couponCode !== void 0).map((o) => ({
        label: `Apply ${o.couponCode}`,
        actionType: "apply_coupon",
        payload: { couponCode: o.couponCode, offerId: o.offerId }
      }));
      actions.push({ label: "Dismiss", actionType: "dismiss" });
      return {
        headline: "Having trouble with a coupon?",
        body: "Here are the available discount codes for your cart:",
        actions,
        supplementalData: { offers }
      };
    }
    return {
      headline: "No active coupon codes",
      body: "There are no coupon codes available for your current cart. You can continue to checkout at the regular price.",
      actions: [{ label: "Continue to checkout", actionType: "dismiss" }],
      supplementalData: { offers: [] }
    };
  }
  var InterventionEngineImpl = class {
    constructor(adapter, breaker) {
      this.adapter = adapter;
      this.breaker = breaker;
    }
    // ---------------------------------------------------------------------------
    // InterventionEngine interface
    // ---------------------------------------------------------------------------
    /**
     * Resolve a FrictionEvent into an InterventionPayload.
     *
     * Returns null when:
     * - The session already has 2 interventions (Requirement 3.2).
     * - The session already has an intervention for this category (Requirement 3.3).
     * - The Platform_Adapter returns empty/null data for the category (Requirement 3.5).
     * - The Platform_Adapter call throws (circuit open or API error) (Requirement 12.2).
     * - The entire resolution exceeds 3 seconds (Requirement 12.2).
     */
    async resolve(event, session) {
      if (session.interventions.length >= MAX_INTERVENTIONS2) {
        return null;
      }
      const categoryAlreadyPresent = session.interventions.some(
        (i) => i.category === event.category
      );
      if (categoryAlreadyPresent) {
        return null;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
      try {
        return await this._resolveWithSignal(event, session, controller.signal);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          console.warn("[InterventionEngine] Resolution timed out for category:", event.category);
        } else {
          console.error("[InterventionEngine] Unexpected error during resolution:", err);
        }
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    /**
     * Core resolution logic, executed within the AbortController timeout guard.
     * Throws AbortError if the signal fires before completion.
     */
    async _resolveWithSignal(event, session, signal) {
      if (signal.aborted) return null;
      const category = event.category;
      let content = null;
      let recoveryAction;
      try {
        switch (category) {
          case "Price_Hesitation": {
            const offers = await this._callAdapter(
              () => this.adapter.getApplicableOffers(session.cartId),
              signal
            );
            if (offers === null) return null;
            recoveryAction = offers.length > 0 ? "show_coupon" : "show_price_comparison";
            content = buildPriceHesitationContent(offers);
            break;
          }
          case "Shipping_Confusion": {
            const options = await this._callAdapter(
              () => this.adapter.getShippingOptions(
                session.cartId,
                this._extractPostalCode(session)
              ),
              signal
            );
            if (options === null || options.length === 0) return null;
            const sorted = this._sortShippingOptions(options);
            recoveryAction = "show_shipping_options";
            content = buildShippingConfusionContent(sorted);
            break;
          }
          case "Delivery_Timeline": {
            const options = await this._callAdapter(
              () => this.adapter.getShippingOptions(
                session.cartId,
                this._extractPostalCode(session)
              ),
              signal
            );
            if (options === null || options.length === 0) return null;
            const sorted = this._sortShippingOptions(options);
            recoveryAction = "show_delivery_estimate";
            content = buildDeliveryTimelineContent(sorted);
            break;
          }
          case "Trust_Issue": {
            if (signal.aborted) return null;
            recoveryAction = "show_trust_signals";
            content = buildTrustIssueContent();
            break;
          }
          case "Size_Uncertainty": {
            const productId = this._extractProductId(session);
            if (productId === null) return null;
            const guide = await this._callAdapter(
              () => this.adapter.getSizeGuide(productId),
              signal
            );
            if (guide === null) return null;
            const hasAvailable = Object.values(guide.inventory).some(
              (v) => v.available
            );
            if (!hasAvailable) return null;
            recoveryAction = "show_size_guide";
            content = buildSizeUncertaintyContent(guide);
            break;
          }
          case "Payment_Options": {
            const methods = await this._callAdapter(
              () => this.adapter.getPaymentMethods(session.cartId),
              signal
            );
            if (methods === null || methods.length === 0) return null;
            const available = methods.filter((m) => m.available);
            if (available.length === 0) return null;
            recoveryAction = "show_payment_options";
            content = buildPaymentOptionsContent(methods);
            break;
          }
          case "Missing_Information": {
            if (signal.aborted) return null;
            const scanner = new MissingFieldsScanner();
            const missingFields = scanner.scan();
            if (missingFields.length === 0) return null;
            recoveryAction = "highlight_missing_fields";
            content = buildMissingInformationContent(missingFields);
            break;
          }
          case "Coupon_Confusion": {
            const offers = await this._callAdapter(
              () => this.adapter.getApplicableOffers(session.cartId),
              signal
            );
            if (offers === null) return null;
            recoveryAction = "show_coupon";
            content = buildCouponConfusionContent(offers);
            break;
          }
          default: {
            const _exhaustive = category;
            console.warn("[InterventionEngine] Unknown category:", _exhaustive);
            return null;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw err;
        }
        console.error("[InterventionEngine] Adapter call failed:", err);
        return null;
      }
      if (content === null || signal.aborted) return null;
      const payload = {
        interventionId: generateUUID2(),
        category,
        recoveryAction,
        content,
        expiresAt: Date.now() + EXPIRES_OFFSET_MS
      };
      return payload;
    }
    /**
     * Wrap a Platform_Adapter call in the CircuitBreaker and honour the
     * AbortSignal. Returns null on any error (circuit open, API error, abort).
     */
    async _callAdapter(fn, signal) {
      if (signal.aborted) return null;
      try {
        const result = await this.breaker.call(fn);
        return result;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw err;
        }
        console.warn("[InterventionEngine] Adapter call suppressed by circuit breaker or error:", err);
        return null;
      }
    }
    /**
     * Attempt to extract a postal code from the session's signal snapshot.
     * Falls back to an empty string (the adapter should handle missing postal codes).
     */
    _extractPostalCode(session) {
      const lastEvent = session.frictionEvents[session.frictionEvents.length - 1];
      if (lastEvent === void 0) return "";
      const postalField = lastEvent.signals.fieldEvents.find(
        (fe) => fe.fieldId.toLowerCase().includes("postal") || fe.fieldId.toLowerCase().includes("zip") || fe.fieldId.toLowerCase().includes("postcode")
      );
      return postalField !== void 0 ? "" : "";
    }
    /**
     * Attempt to extract a product ID from the session's friction events.
     * Returns null if no product ID can be determined.
     */
    _extractProductId(session) {
      if (session.cartId === "") return null;
      return session.cartId;
    }
    /**
     * Sort shipping options by delivery speed ascending (fastest first).
     * Options without delivery day estimates are placed at the end.
     */
    _sortShippingOptions(options) {
      return [...options].sort((a, b) => {
        var _a, _b;
        const aMin = (_a = a.minDeliveryDays) != null ? _a : Number.MAX_SAFE_INTEGER;
        const bMin = (_b = b.minDeliveryDays) != null ? _b : Number.MAX_SAFE_INTEGER;
        return aMin - bMin;
      });
    }
  };

  // src/engine/CircuitBreaker.ts
  var FAILURE_THRESHOLD = 3;
  var FAILURE_WINDOW_MS = 6e4;
  var RETRY_DELAY_MS = 3e4;
  var CircuitBreaker = class {
    constructor() {
      this.state = {
        status: "closed",
        failureCount: 0,
        lastFailureAt: 0,
        nextRetryAt: 0
      };
    }
    /**
     * Returns a read-only snapshot of the current circuit breaker state.
     * Useful for inspection and testing.
     */
    getState() {
      return __spreadValues({}, this.state);
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
    async call(fn) {
      const now = Date.now();
      if (this.state.status === "open") {
        if (now < this.state.nextRetryAt) {
          throw new Error(
            `Circuit breaker is open. Calls suppressed until ${new Date(this.state.nextRetryAt).toISOString()}.`
          );
        }
        this.state.status = "half-open";
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
    onSuccess() {
      this.state.status = "closed";
      this.state.failureCount = 0;
      this.state.lastFailureAt = 0;
      this.state.nextRetryAt = 0;
    }
    onFailure(now) {
      if (this.state.lastFailureAt > 0 && now - this.state.lastFailureAt > FAILURE_WINDOW_MS) {
        this.state.failureCount = 0;
      }
      this.state.failureCount += 1;
      this.state.lastFailureAt = now;
      if (this.state.failureCount >= FAILURE_THRESHOLD) {
        this.state.status = "open";
        this.state.nextRetryAt = now + RETRY_DELAY_MS;
      }
    }
  };

  // src/ui/ConversationManager.ts
  var WIDGET_STYLE_ID = "acr-widget-styles";
  var WIDGET_CSS = `
/* AI Checkout Recovery \u2014 Conversation Widget */
#acr-widget-root {
  position: fixed;
  z-index: 2147483647; /* max z-index */
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a1a;
  pointer-events: none; /* root is transparent; only widget panel captures events */
}

.acr-widget-panel {
  pointer-events: all;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  padding: 16px;
  max-width: 360px;
  min-width: 280px;
  width: calc(100vw - 32px);
  box-sizing: border-box;
  animation: acr-slide-in 0.2s ease-out;
}

@keyframes acr-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.acr-widget-headline {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 8px 0;
  padding-right: 24px; /* space for close button */
}

.acr-widget-body {
  font-size: 13px;
  color: #555555;
  margin: 0 0 12px 0;
}

.acr-widget-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acr-action-btn {
  display: block;
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #d0d0d0;
  background: #f7f7f7;
  color: #1a1a1a;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
  box-sizing: border-box;
}

.acr-action-btn:hover {
  background: #efefef;
  border-color: #b0b0b0;
}

.acr-action-btn:focus-visible {
  outline: 2px solid #0070f3;
  outline-offset: 2px;
}

.acr-action-btn--primary {
  background: #0070f3;
  border-color: #0070f3;
  color: #ffffff;
}

.acr-action-btn--primary:hover {
  background: #005fd1;
  border-color: #005fd1;
}

.acr-action-btn--dismiss {
  background: transparent;
  border-color: transparent;
  color: #888888;
  font-size: 12px;
  padding: 6px 14px;
}

.acr-action-btn--dismiss:hover {
  color: #555555;
  background: transparent;
}

.acr-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #888888;
  font-size: 18px;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.acr-close-btn:hover {
  color: #333333;
  background: #f0f0f0;
}

.acr-close-btn:focus-visible {
  outline: 2px solid #0070f3;
  outline-offset: 2px;
}

/* Responsive: narrow viewports (320px \u2013 480px) */
@media (max-width: 480px) {
  .acr-widget-panel {
    border-radius: 8px;
    padding: 12px;
  }
}

/* Responsive: wide viewports (> 768px) \u2014 anchor to bottom-right */
@media (min-width: 769px) {
  .acr-widget-panel {
    width: 360px;
  }
}
`;
  function computeWidgetPosition(container) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fields = Array.from(
      container.querySelectorAll(
        'input, select, textarea, [role="textbox"], [role="combobox"]'
      )
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    let topOccupied = 0;
    let bottomOccupied = 0;
    for (const field of fields) {
      const rect = field.getBoundingClientRect();
      if (rect.top < vh / 2) {
        topOccupied = Math.max(topOccupied, rect.bottom);
      } else {
        bottomOccupied = Math.max(bottomOccupied, vh - rect.top);
      }
    }
    const freeTop = topOccupied;
    const freeBottom = bottomOccupied;
    const WIDGET_HEIGHT_ESTIMATE = 220;
    const MARGIN = 16;
    if (vh - freeBottom - MARGIN >= WIDGET_HEIGHT_ESTIMATE) {
      return {
        bottom: `${freeBottom + MARGIN}px`,
        right: `${MARGIN}px`
      };
    } else if (freeTop + MARGIN + WIDGET_HEIGHT_ESTIMATE <= vh) {
      return {
        top: `${freeTop + MARGIN}px`,
        right: `${MARGIN}px`
      };
    }
    return {
      bottom: `${MARGIN}px`,
      right: `${MARGIN}px`
    };
  }
  function injectStyles() {
    if (document.getElementById(WIDGET_STYLE_ID) !== null) {
      return;
    }
    const style = document.createElement("style");
    style.id = WIDGET_STYLE_ID;
    style.textContent = WIDGET_CSS;
    document.head.appendChild(style);
  }
  var ConversationManagerImpl = class {
    constructor(session) {
      /** The root element injected into the container. */
      this.rootEl = null;
      /** The container element passed to mount(). */
      this.container = null;
      /** The currently displayed intervention payload. */
      this.activePayload = null;
      /** Registered action handler callbacks. */
      this.actionHandlers = [];
      /** Timer handle for auto-dismiss on expiry. */
      this.expiryTimerId = null;
      this.session = session;
    }
    // ---------------------------------------------------------------------------
    // ConversationManager interface
    // ---------------------------------------------------------------------------
    /**
     * Inject the widget root element into `container` and attach CSS.
     * Requirement 4.1, 4.6
     */
    mount(container) {
      this.container = container;
      injectStyles();
      if (this.rootEl === null) {
        const root = document.createElement("div");
        root.id = "acr-widget-root";
        root.setAttribute("role", "complementary");
        root.setAttribute("aria-label", "Checkout assistance");
        this.rootEl = root;
      }
      container.appendChild(this.rootEl);
    }
    /**
     * Render headline, body, and ActionButton elements from the payload.
     * Replaces any currently active widget.
     * Requirement 4.1, 4.3, 4.6, 12.3
     */
    show(payload) {
      try {
        this._show(payload);
      } catch (err) {
        console.error("[ConversationManager] Render error suppressed:", err);
        this.dismiss("engine_error");
      }
    }
    /**
     * Remove the widget from the DOM and record the DismissReason in SessionState.
     * Requirement 4.5
     */
    dismiss(reason) {
      this._clearExpiryTimer();
      if (this.activePayload !== null) {
        const outcome = dismissReasonToOutcome(reason);
        this.session.updateInterventionOutcome(
          this.activePayload.interventionId,
          outcome,
          Date.now()
        );
        this.activePayload = null;
      }
      if (this.rootEl !== null) {
        this.rootEl.innerHTML = "";
      }
    }
    /**
     * Register a callback for UserAction events.
     */
    onAction(handler) {
      this.actionHandlers.push(handler);
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    /**
     * Core render logic. Called inside a try/catch error boundary in show().
     */
    _show(payload) {
      var _a;
      if (this.rootEl === null) {
        throw new Error("[ConversationManager] mount() must be called before show()");
      }
      if (this.activePayload !== null) {
        this.dismiss("step_completed");
      }
      this.activePayload = payload;
      this.session.addIntervention({
        interventionId: payload.interventionId,
        category: payload.category,
        triggeredAt: Date.now(),
        outcome: "pending"
      });
      const position = computeWidgetPosition((_a = this.container) != null ? _a : document.body);
      Object.assign(this.rootEl.style, __spreadValues({
        top: "",
        bottom: "",
        left: "",
        right: ""
      }, position));
      const panel = this._buildPanel(payload);
      this.rootEl.innerHTML = "";
      this.rootEl.appendChild(panel);
      const msUntilExpiry = payload.expiresAt - Date.now();
      if (msUntilExpiry > 0) {
        this.expiryTimerId = setTimeout(() => {
          this.dismiss("timeout");
        }, msUntilExpiry);
      } else {
        this.dismiss("timeout");
      }
    }
    /**
     * Build the widget panel DOM element for the given payload.
     */
    _buildPanel(payload) {
      const panel = document.createElement("div");
      panel.className = "acr-widget-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-labelledby", "acr-headline");
      panel.style.position = "relative";
      const closeBtn = document.createElement("button");
      closeBtn.className = "acr-close-btn";
      closeBtn.setAttribute("aria-label", "Dismiss");
      closeBtn.textContent = "\xD7";
      closeBtn.addEventListener("click", () => {
        this._handleAction(payload, {
          label: "Dismiss",
          actionType: "dismiss"
        });
      });
      panel.appendChild(closeBtn);
      const headline = document.createElement("p");
      headline.id = "acr-headline";
      headline.className = "acr-widget-headline";
      headline.textContent = payload.content.headline;
      panel.appendChild(headline);
      const body = document.createElement("p");
      body.className = "acr-widget-body";
      body.textContent = payload.content.body;
      panel.appendChild(body);
      const actionsContainer = document.createElement("div");
      actionsContainer.className = "acr-widget-actions";
      payload.content.actions.forEach((action, index) => {
        const btn = this._buildActionButton(action, index === 0, payload);
        actionsContainer.appendChild(btn);
      });
      panel.appendChild(actionsContainer);
      return panel;
    }
    /**
     * Build a single action button element.
     */
    _buildActionButton(action, isPrimary, payload) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      if (action.actionType === "dismiss") {
        btn.className = "acr-action-btn acr-action-btn--dismiss";
      } else if (isPrimary) {
        btn.className = "acr-action-btn acr-action-btn--primary";
      } else {
        btn.className = "acr-action-btn";
      }
      btn.addEventListener("click", () => {
        this._handleAction(payload, action);
      });
      return btn;
    }
    /**
     * Handle a user action: emit the UserAction event and dismiss if needed.
     * Uses requestAnimationFrame + async handler to deliver next message within
     * 1 second of user action (Requirement 4.3).
     */
    _handleAction(payload, action) {
      const userAction = {
        interventionId: payload.interventionId,
        actionType: action.actionType,
        payload: action.payload,
        timestamp: Date.now()
      };
      if (action.actionType === "dismiss") {
        this.dismiss("user_dismissed");
      }
      requestAnimationFrame(() => {
        void this._dispatchActionAsync(userAction);
      });
    }
    /**
     * Async dispatch of action handlers. Wrapped in try/catch to prevent
     * unhandled promise rejections from surfacing to the user.
     */
    async _dispatchActionAsync(userAction) {
      for (const handler of this.actionHandlers) {
        try {
          await Promise.resolve(handler(userAction));
        } catch (err) {
          console.error("[ConversationManager] Action handler error suppressed:", err);
        }
      }
    }
    /**
     * Clear the expiry auto-dismiss timer if one is pending.
     */
    _clearExpiryTimer() {
      if (this.expiryTimerId !== null) {
        clearTimeout(this.expiryTimerId);
        this.expiryTimerId = null;
      }
    }
  };
  function dismissReasonToOutcome(reason) {
    switch (reason) {
      case "user_dismissed":
        return "dismissed";
      case "step_completed":
        return "dismissed";
      case "timeout":
        return "timed_out";
      case "engine_error":
        return "dismissed";
      default: {
        const _exhaustive = reason;
        return "dismissed";
      }
    }
  }

  // src/analytics/AnalyticsClient.ts
  var CATEGORY_DEFAULT_RECOVERY_ACTION = {
    Price_Hesitation: "show_coupon",
    Shipping_Confusion: "show_shipping_options",
    Trust_Issue: "show_trust_signals",
    Missing_Information: "highlight_missing_fields",
    Coupon_Confusion: "show_coupon",
    Size_Uncertainty: "show_size_guide",
    Delivery_Timeline: "show_delivery_estimate",
    Payment_Options: "show_payment_options"
  };
  function serializeSession(session, platformId) {
    var _a;
    const endedAtMs = (_a = session.endedAt) != null ? _a : Date.now();
    return {
      sessionId: session.sessionId,
      platformId,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      checkoutStepReached: session.checkoutStep,
      frictionEvents: session.frictionEvents.map((event) => ({
        category: event.category,
        confidence: event.confidence,
        detectedAt: new Date(event.detectedAt).toISOString()
      })),
      interventions: session.interventions.map((intervention) => ({
        interventionId: intervention.interventionId,
        category: intervention.category,
        // InterventionRecord does not store recoveryAction; derive from category
        recoveryAction: CATEGORY_DEFAULT_RECOVERY_ACTION[intervention.category],
        triggeredAt: new Date(intervention.triggeredAt).toISOString(),
        // Map 'pending' → 'timed_out' since SessionRecord does not allow 'pending'
        outcome: intervention.outcome === "pending" ? "timed_out" : intervention.outcome
      })),
      converted: session.converted
    };
  }
  var AnalyticsClient = class {
    constructor(config) {
      this.analyticsServiceUrl = config.analyticsServiceUrl;
      this.platformId = config.platformId;
    }
    /**
     * Flush the session to the Analytics Service.
     * Calls session.end() to ensure endedAt is set before serializing.
     * Fire-and-forget — never throws.
     */
    flush(session) {
      session.end();
      const record = serializeSession(session, this.platformId);
      const url = `${this.analyticsServiceUrl}/session`;
      const body = JSON.stringify(record);
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const sent = navigator.sendBeacon(
          url,
          new Blob([body], { type: "application/json" })
        );
        if (sent) {
          return;
        }
      }
      this.sendWithRetry(url, body);
    }
    /**
     * Attempt a POST via fetch. On failure, retry once after 1 second.
     * Drops silently if the retry also fails.
     */
    sendWithRetry(url, body) {
      this.sendFetch(url, body).catch(() => {
        setTimeout(() => {
          this.sendFetch(url, body).catch((err) => {
            console.error("[AnalyticsClient] Failed to send session record after retry:", err);
          });
        }, 1e3);
      });
    }
    /**
     * Send a single POST request via fetch.
     * Rejects if the network request fails or the server returns a non-ok status.
     */
    async sendFetch(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      if (!response.ok) {
        throw new Error(
          `[AnalyticsClient] HTTP ${response.status} from ${url}`
        );
      }
    }
  };

  // src/platform/ShopifyAdapter.ts
  var PlatformError = class extends Error {
    constructor(message, statusCode, code) {
      super(message);
      this.name = "PlatformError";
      this.statusCode = statusCode;
      this.code = code;
    }
  };
  var ShopifyAdapter = class {
    constructor(config) {
      this.config = config;
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /** Base URL for the Storefront API GraphQL endpoint. */
    get storefrontUrl() {
      return `https://${this.config.shopDomain}/api/${this.config.apiVersion}/graphql.json`;
    }
    /** Base URL for the Admin REST API. */
    get adminBaseUrl() {
      return `https://${this.config.shopDomain}/admin/api/${this.config.apiVersion}`;
    }
    /**
     * Execute a Storefront API GraphQL request.
     * Throws PlatformError on HTTP 4xx/5xx.
     */
    async storefrontQuery(query, variables = {}) {
      const response = await fetch(this.storefrontUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": this.config.storefrontAccessToken
        },
        body: JSON.stringify({ query, variables })
      });
      if (!response.ok) {
        throw new PlatformError(
          `Storefront API request failed: ${response.statusText}`,
          response.status,
          "STOREFRONT_API_ERROR"
        );
      }
      const json = await response.json();
      if (json.errors !== void 0 && json.errors.length > 0) {
        const firstError = json.errors[0];
        throw new PlatformError(
          firstError !== void 0 ? firstError.message : "GraphQL error",
          422,
          "GRAPHQL_ERROR"
        );
      }
      return json.data;
    }
    /**
     * Execute an Admin REST API GET request.
     * Throws PlatformError on HTTP 4xx/5xx.
     */
    async adminGet(path) {
      const url = `${this.adminBaseUrl}${path}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.config.adminAccessToken
        }
      });
      if (!response.ok) {
        throw new PlatformError(
          `Admin API request failed: ${response.statusText}`,
          response.status,
          "ADMIN_API_ERROR"
        );
      }
      return response.json();
    }
    // -------------------------------------------------------------------------
    // PlatformAdapter — read methods
    // -------------------------------------------------------------------------
    /**
     * Fetch applicable discount codes for the current cart.
     *
     * Uses the Admin REST API to list active price rules and their discount
     * codes. Filters to rules that are currently active (within starts_at /
     * ends_at window).
     *
     * Requirements: 5.1
     */
    async getApplicableOffers(_cartId) {
      const priceRulesResponse = await this.adminGet(
        "/price_rules.json?status=enabled&limit=250"
      );
      const now = /* @__PURE__ */ new Date();
      const activePriceRules = priceRulesResponse.price_rules.filter((rule) => {
        const startsAt = rule.starts_at !== null ? new Date(rule.starts_at) : null;
        const endsAt = rule.ends_at !== null ? new Date(rule.ends_at) : null;
        const started = startsAt === null || startsAt <= now;
        const notExpired = endsAt === null || endsAt > now;
        return started && notExpired;
      });
      if (activePriceRules.length === 0) {
        return [];
      }
      const ruleSlice = activePriceRules.slice(0, 10);
      const codeResults = await Promise.allSettled(
        ruleSlice.map(
          (rule) => this.adminGet(
            `/price_rules/${rule.id}/discount_codes.json`
          )
        )
      );
      const offers = [];
      for (let i = 0; i < ruleSlice.length; i++) {
        const rule = ruleSlice[i];
        const result = codeResults[i];
        if (rule === void 0 || result === void 0) continue;
        if (result.status !== "fulfilled") continue;
        const codes = result.value.discount_codes;
        if (codes.length === 0) continue;
        const code = codes[0];
        if (code === void 0) continue;
        const discountAmount = rule.value_type === "percentage" ? Math.abs(parseFloat(rule.value)) / 100 : Math.abs(parseFloat(rule.value));
        const offer = {
          offerId: String(rule.id),
          title: rule.title,
          description: rule.value_type === "percentage" ? `${Math.abs(parseFloat(rule.value))}% off` : `$${Math.abs(parseFloat(rule.value)).toFixed(2)} off`,
          couponCode: code.code,
          discountAmount,
          discountType: rule.value_type === "percentage" ? "percentage" : "fixed"
        };
        if (rule.ends_at !== null) {
          offer.expiresAt = rule.ends_at;
        }
        offers.push(offer);
      }
      return offers;
    }
    /**
     * Fetch available shipping rates for the given postal code.
     *
     * Uses the Storefront API to query shipping rates on the checkout.
     * Results are sorted by minDeliveryDays ascending (fastest first).
     *
     * Requirements: 6.1
     */
    async getShippingOptions(_cartId, postalCode) {
      var _a, _b, _c;
      const query = `
      query GetShippingRates($postalCode: String!) {
        shop {
          shipsToCountries
        }
      }
    `;
      const shippingQuery = `
      query GetCheckoutShippingRates($checkoutId: ID!) {
        node(id: $checkoutId) {
          ... on Checkout {
            availableShippingRates {
              ready
              shippingRates {
                handle
                title
                priceV2 {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `;
      const data = await this.storefrontQuery(shippingQuery, { checkoutId: _cartId });
      const rates = (_c = (_b = (_a = data.node) == null ? void 0 : _a.availableShippingRates) == null ? void 0 : _b.shippingRates) != null ? _c : [];
      const options = rates.map((rate) => {
        var _a2, _b2;
        const minDays = (_a2 = rate.deliveryRange) == null ? void 0 : _a2.minDays;
        const maxDays = (_b2 = rate.deliveryRange) == null ? void 0 : _b2.maxDays;
        let deliveryEstimate;
        if (minDays !== void 0 && maxDays !== void 0) {
          deliveryEstimate = `${minDays}\u2013${maxDays} business days`;
        } else if (minDays !== void 0) {
          deliveryEstimate = `${minDays}+ business days`;
        }
        const option = {
          handle: rate.handle,
          title: rate.title,
          price: parseFloat(rate.priceV2.amount),
          currencyCode: rate.priceV2.currencyCode
        };
        if (minDays !== void 0) option.minDeliveryDays = minDays;
        if (maxDays !== void 0) option.maxDeliveryDays = maxDays;
        if (deliveryEstimate !== void 0) option.deliveryEstimate = deliveryEstimate;
        return option;
      });
      return options.sort((a, b) => {
        var _a2, _b2;
        const aMin = (_a2 = a.minDeliveryDays) != null ? _a2 : Number.MAX_SAFE_INTEGER;
        const bMin = (_b2 = b.minDeliveryDays) != null ? _b2 : Number.MAX_SAFE_INTEGER;
        return aMin - bMin;
      });
    }
    /**
     * Fetch size guide and variant inventory for a product.
     *
     * Queries the Storefront API for product metafields in the `size_guide`
     * namespace and variant inventory levels.
     *
     * Requirements: 8.1
     */
    async getSizeGuide(productId) {
      var _a;
      const query = `
      query GetSizeGuide($productId: ID!) {
        product(id: $productId) {
          id
          title
          metafields(identifiers: [
            { namespace: "size_guide", key: "entries" },
            { namespace: "size_guide", key: "guide_url" }
          ]) {
            namespace
            key
            value
          }
          variants(first: 50) {
            edges {
              node {
                id
                title
                availableForSale
                quantityAvailable
              }
            }
          }
        }
      }
    `;
      const data = await this.storefrontQuery(query, { productId });
      if (data.product === null) {
        throw new PlatformError(
          `Product not found: ${productId}`,
          404,
          "PRODUCT_NOT_FOUND"
        );
      }
      const product = data.product;
      const metafields = product.metafields.filter(
        (mf) => mf !== null
      );
      const entriesMetafield = metafields.find(
        (mf) => mf.namespace === "size_guide" && mf.key === "entries"
      );
      const guideUrlMetafield = metafields.find(
        (mf) => mf.namespace === "size_guide" && mf.key === "guide_url"
      );
      let entries = [];
      if (entriesMetafield !== void 0) {
        try {
          const parsed = JSON.parse(entriesMetafield.value);
          if (Array.isArray(parsed)) {
            entries = parsed;
          }
        } catch (e) {
          entries = [];
        }
      }
      const inventory = {};
      for (const edge of product.variants.edges) {
        const variant = edge.node;
        inventory[variant.id] = {
          variantId: variant.id,
          size: variant.title,
          available: variant.availableForSale,
          quantityAvailable: (_a = variant.quantityAvailable) != null ? _a : 0
        };
      }
      const sizeGuide = {
        productId: product.id,
        productTitle: product.title,
        entries,
        inventory
      };
      if ((guideUrlMetafield == null ? void 0 : guideUrlMetafield.value) !== void 0) {
        sizeGuide.guideUrl = guideUrlMetafield.value;
      }
      return sizeGuide;
    }
    /**
     * Fetch available payment gateways for the checkout.
     *
     * Queries the Storefront API for `availablePaymentGateways` on the shop.
     *
     * Requirements: 9.1
     */
    async getPaymentMethods(_checkoutId) {
      const query = `
      query GetPaymentGateways {
        shop {
          paymentSettings {
            acceptedCardBrands
            enabledPresentmentCurrencies
          }
        }
        checkout: node(id: $checkoutId) {
          ... on Checkout {
            availableShippingRates {
              ready
            }
          }
        }
      }
    `;
      const gatewaysQuery = `
      query GetPaymentGateways {
        shop {
          paymentSettings {
            acceptedCardBrands
          }
        }
      }
    `;
      const data = await this.storefrontQuery(gatewaysQuery);
      const cardBrands = data.shop.paymentSettings.acceptedCardBrands;
      const cardMethods = cardBrands.map((brand) => ({
        methodId: brand.toLowerCase().replace(/\s+/g, "_"),
        name: brand,
        type: "card",
        available: true
      }));
      const digitalWallets = [
        {
          methodId: "shop_pay",
          name: "Shop Pay",
          type: "digital_wallet",
          available: true
        },
        {
          methodId: "paypal",
          name: "PayPal",
          type: "digital_wallet",
          available: true
        },
        {
          methodId: "apple_pay",
          name: "Apple Pay",
          type: "digital_wallet",
          available: true
        },
        {
          methodId: "google_pay",
          name: "Google Pay",
          type: "digital_wallet",
          available: true
        }
      ];
      return [...cardMethods, ...digitalWallets];
    }
    // -------------------------------------------------------------------------
    // PlatformAdapter — mutation methods
    // -------------------------------------------------------------------------
    /**
     * Apply a discount code to the cart using the `cartDiscountCodesUpdate` mutation.
     *
     * Requirements: 5.4
     */
    async applyCoupon(cartId, couponCode) {
      const mutation = `
      mutation CartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
        cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
          cart {
            id
            discountCodes {
              code
              applicable
            }
            cost {
              totalAmount {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
      const data = await this.storefrontQuery(mutation, { cartId, discountCodes: [couponCode] });
      const result = data.cartDiscountCodesUpdate;
      if (result.userErrors.length > 0) {
        const firstError = result.userErrors[0];
        return {
          success: false,
          errorMessage: firstError !== void 0 ? firstError.message : "Unknown error",
          userErrors: result.userErrors
        };
      }
      if (result.cart === null) {
        return {
          success: false,
          errorMessage: "Cart not found"
        };
      }
      const appliedCode = result.cart.discountCodes.find(
        (dc) => dc.code.toLowerCase() === couponCode.toLowerCase()
      );
      if (appliedCode !== void 0 && !appliedCode.applicable) {
        return {
          success: false,
          errorMessage: `Discount code "${couponCode}" is not applicable to this cart`,
          userErrors: []
        };
      }
      return {
        success: true,
        cartTotal: parseFloat(result.cart.cost.totalAmount.amount),
        currencyCode: result.cart.cost.totalAmount.currencyCode
      };
    }
    /**
     * Update the selected shipping line on a checkout using the
     * `checkoutShippingLineUpdate` mutation.
     *
     * Requirements: 6.4
     */
    async selectShipping(checkoutId, shippingHandle) {
      const mutation = `
      mutation CheckoutShippingLineUpdate($checkoutId: ID!, $shippingRateHandle: String!) {
        checkoutShippingLineUpdate(checkoutId: $checkoutId, shippingRateHandle: $shippingRateHandle) {
          checkout {
            id
            totalPriceV2 {
              amount
              currencyCode
            }
          }
          checkoutUserErrors {
            field
            message
          }
        }
      }
    `;
      const data = await this.storefrontQuery(mutation, { checkoutId, shippingRateHandle: shippingHandle });
      const result = data.checkoutShippingLineUpdate;
      if (result.checkoutUserErrors.length > 0) {
        const firstError = result.checkoutUserErrors[0];
        return {
          success: false,
          errorMessage: firstError !== void 0 ? firstError.message : "Unknown error",
          userErrors: result.checkoutUserErrors
        };
      }
      if (result.checkout === null) {
        return {
          success: false,
          errorMessage: "Checkout not found"
        };
      }
      return {
        success: true,
        cartTotal: parseFloat(result.checkout.totalPriceV2.amount),
        currencyCode: result.checkout.totalPriceV2.currencyCode
      };
    }
    /**
     * Update a cart line item to a different variant using the
     * `cartLinesUpdate` mutation.
     *
     * Requirements: 8.3
     */
    async updateVariant(cartId, lineItemId, variantId) {
      const mutation = `
      mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) {
          cart {
            id
            cost {
              totalAmount {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
      const data = await this.storefrontQuery(mutation, {
        cartId,
        lines: [{ id: lineItemId, merchandiseId: variantId }]
      });
      const result = data.cartLinesUpdate;
      if (result.userErrors.length > 0) {
        const firstError = result.userErrors[0];
        return {
          success: false,
          errorMessage: firstError !== void 0 ? firstError.message : "Unknown error",
          userErrors: result.userErrors
        };
      }
      if (result.cart === null) {
        return {
          success: false,
          errorMessage: "Cart not found"
        };
      }
      return {
        success: true,
        cartTotal: parseFloat(result.cart.cost.totalAmount.amount),
        currencyCode: result.cart.cost.totalAmount.currencyCode
      };
    }
    /**
     * Pre-select a payment method on the checkout.
     *
     * Uses the Storefront API `checkoutPaymentMethodUpdate` mutation (or the
     * equivalent for the configured API version).
     *
     * Requirements: 9.3
     */
    async selectPaymentMethod(checkoutId, methodId) {
      const mutation = `
      mutation CheckoutAttributesUpdate($checkoutId: ID!, $input: CheckoutAttributesUpdateV2Input!) {
        checkoutAttributesUpdateV2(checkoutId: $checkoutId, input: $input) {
          checkout {
            id
            totalPriceV2 {
              amount
              currencyCode
            }
          }
          checkoutUserErrors {
            field
            message
          }
        }
      }
    `;
      const data = await this.storefrontQuery(mutation, {
        checkoutId,
        input: {
          customAttributes: [
            { key: "selected_payment_method", value: methodId }
          ]
        }
      });
      const result = data.checkoutAttributesUpdateV2;
      if (result.checkoutUserErrors.length > 0) {
        const firstError = result.checkoutUserErrors[0];
        return {
          success: false,
          errorMessage: firstError !== void 0 ? firstError.message : "Unknown error",
          userErrors: result.checkoutUserErrors
        };
      }
      if (result.checkout === null) {
        return {
          success: false,
          errorMessage: "Checkout not found"
        };
      }
      return {
        success: true,
        cartTotal: parseFloat(result.checkout.totalPriceV2.amount),
        currencyCode: result.checkout.totalPriceV2.currencyCode
      };
    }
  };

  // src/index.ts
  function readConfig() {
    try {
      const g = globalThis;
      if (typeof g["CheckoutRecoveryConfig"] === "object" && g["CheckoutRecoveryConfig"] !== null) {
        return g["CheckoutRecoveryConfig"];
      }
    } catch (e) {
    }
    return {};
  }
  function resolveCartId(config) {
    if (config.cartId !== void 0 && config.cartId !== "") {
      return config.cartId;
    }
    try {
      const g = globalThis;
      const shopify = g["Shopify"];
      if (shopify !== void 0) {
        const checkout = shopify["checkout"];
        if (checkout !== void 0) {
          const token = checkout["token"];
          if (typeof token === "string" && token !== "") {
            return token;
          }
        }
      }
      const st = g["__st"];
      if (st !== void 0) {
        const cid = st["cid"];
        if (typeof cid === "string" && cid !== "") {
          return cid;
        }
      }
    } catch (e) {
    }
    return "";
  }
  function resolveCheckoutStep() {
    try {
      const form = document.querySelector("[data-checkout-step]");
      if (form !== null) {
        const attr = form.dataset["checkoutStep"];
        const steps = ["cart", "information", "shipping", "payment", "review"];
        if (attr !== void 0 && steps.includes(attr)) {
          return attr;
        }
      }
      const path = window.location.pathname.toLowerCase();
      if (path.includes("/payment")) return "payment";
      if (path.includes("/shipping")) return "shipping";
      if (path.includes("/information")) return "information";
      if (path.includes("/review")) return "review";
      if (path.includes("/cart")) return "cart";
    } catch (e) {
    }
    return "cart";
  }
  function init() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const config = readConfig();
    const cartId = resolveCartId(config);
    const checkoutStep = resolveCheckoutStep();
    const session = new SessionState(cartId, checkoutStep);
    const shopifyAdapter = new ShopifyAdapter({
      shopDomain: (_a = config.shopDomain) != null ? _a : "",
      storefrontAccessToken: (_b = config.storefrontAccessToken) != null ? _b : "",
      adminAccessToken: (_c = config.adminAccessToken) != null ? _c : "",
      apiVersion: (_d = config.apiVersion) != null ? _d : "2024-01"
    });
    const circuitBreaker = new CircuitBreaker();
    const interventionEngine = new InterventionEngineImpl(shopifyAdapter, circuitBreaker);
    const conversationManager = new ConversationManagerImpl(session);
    conversationManager.mount(document.body);
    const detectorConfig = {
      confidenceThreshold: (_e = config.confidenceThreshold) != null ? _e : 0.6,
      idleTimeoutMs: (_f = config.idleTimeoutMs) != null ? _f : 3e4,
      exitIntentMarginPx: 20,
      classificationTimeoutMs: 2e3
    };
    const frictionDetector = new FrictionDetectorImpl(session.sessionId);
    const analyticsClient = new AnalyticsClient({
      analyticsServiceUrl: (_g = config.analyticsServiceUrl) != null ? _g : "/analytics",
      platformId: (_h = config.shopDomain) != null ? _h : ""
    });
    frictionDetector.onFrictionEvent((frictionEvent) => {
      session.addFrictionEvent(frictionEvent);
      void interventionEngine.resolve(frictionEvent, session).then((payload) => {
        if (payload !== null) {
          conversationManager.show(payload);
        }
      });
    });
    conversationManager.onAction((action) => {
      void handleUserAction(action, session, shopifyAdapter, conversationManager);
    });
    listenForCheckoutStepCompletion(session, conversationManager);
    window.addEventListener("beforeunload", () => {
      try {
        session.end();
        analyticsClient.flush(session);
      } catch (err) {
        console.error("[CheckoutRecovery] Error flushing session on beforeunload:", err);
      }
    });
    listenForOrderConfirmation(session, analyticsClient);
    frictionDetector.start(detectorConfig);
  }
  async function handleUserAction(action, session, adapter, conversationManager) {
    var _a;
    try {
      switch (action.actionType) {
        case "apply_coupon": {
          const p = action.payload;
          const couponCode = p == null ? void 0 : p.couponCode;
          if (couponCode === void 0 || couponCode === "") break;
          const result = await adapter.applyCoupon(session.cartId, couponCode);
          session.updateInterventionOutcome(
            action.interventionId,
            result.success ? "accepted" : "dismissed",
            Date.now()
          );
          break;
        }
        case "select_shipping": {
          const p = action.payload;
          const handle = p == null ? void 0 : p.handle;
          if (handle === void 0 || handle === "") break;
          const result = await adapter.selectShipping(session.cartId, handle);
          session.updateInterventionOutcome(
            action.interventionId,
            result.success ? "accepted" : "dismissed",
            Date.now()
          );
          break;
        }
        case "select_variant": {
          const p = action.payload;
          const variantId = p == null ? void 0 : p.variantId;
          const lineItemId = (_a = p == null ? void 0 : p.lineItemId) != null ? _a : "";
          if (variantId === void 0 || variantId === "") break;
          const result = await adapter.updateVariant(session.cartId, lineItemId, variantId);
          session.updateInterventionOutcome(
            action.interventionId,
            result.success ? "accepted" : "dismissed",
            Date.now()
          );
          break;
        }
        case "select_payment": {
          const p = action.payload;
          const methodId = p == null ? void 0 : p.methodId;
          if (methodId === void 0 || methodId === "") break;
          const result = await adapter.selectPaymentMethod(session.cartId, methodId);
          session.updateInterventionOutcome(
            action.interventionId,
            result.success ? "accepted" : "dismissed",
            Date.now()
          );
          break;
        }
        case "dismiss": {
          conversationManager.dismiss("user_dismissed");
          session.updateInterventionOutcome(
            action.interventionId,
            "dismissed",
            Date.now()
          );
          break;
        }
        case "expand_detail": {
          break;
        }
        default: {
          const _exhaustive = action.actionType;
          console.warn("[CheckoutRecovery] Unknown action type:", _exhaustive);
          break;
        }
      }
    } catch (err) {
      console.error("[CheckoutRecovery] Action handler error suppressed:", err);
    }
  }
  function listenForCheckoutStepCompletion(session, conversationManager) {
    let lastPathname = window.location.pathname;
    document.addEventListener("page:change", () => {
      try {
        const newStep = resolveCheckoutStep();
        if (newStep !== session.checkoutStep) {
          session.checkoutStep = newStep;
          conversationManager.dismiss("step_completed");
        }
      } catch (err) {
        console.error("[CheckoutRecovery] Error handling page:change:", err);
      }
    });
    const observer = new MutationObserver(() => {
      try {
        const currentPathname = window.location.pathname;
        if (currentPathname !== lastPathname) {
          lastPathname = currentPathname;
          const newStep = resolveCheckoutStep();
          if (newStep !== session.checkoutStep) {
            session.checkoutStep = newStep;
            conversationManager.dismiss("step_completed");
          }
        }
      } catch (err) {
        console.error("[CheckoutRecovery] Error in MutationObserver callback:", err);
      }
    });
    const titleEl = document.querySelector("title");
    if (titleEl !== null) {
      observer.observe(titleEl, { childList: true });
    } else {
      observer.observe(document.body, { childList: true, subtree: false });
    }
  }
  function listenForOrderConfirmation(session, analyticsClient) {
    function checkForConfirmation() {
      try {
        const path = window.location.pathname.toLowerCase();
        const isConfirmation = path.includes("/thank_you") || path.includes("/orders/") || document.querySelector("[data-order-id]") !== null || document.querySelector(".order-confirmation") !== null;
        if (isConfirmation) {
          session.markConverted();
          analyticsClient.flush(session);
        }
      } catch (err) {
        console.error("[CheckoutRecovery] Error checking for order confirmation:", err);
      }
    }
    checkForConfirmation();
    document.addEventListener("page:change", checkForConfirmation);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      try {
        init();
      } catch (err) {
        console.error("[CheckoutRecovery] Initialisation failed \u2014 checkout unaffected:", err);
      }
    });
  } else {
    try {
      init();
    } catch (err) {
      console.error("[CheckoutRecovery] Initialisation failed \u2014 checkout unaffected:", err);
    }
  }
})();
//# sourceMappingURL=checkout-recovery.js.map
