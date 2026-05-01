# AI-Assisted Checkout Recovery

A client-side behavioral intelligence layer that detects friction during Shopify checkout and delivers targeted conversational interventions — inline, without redirecting the user or blocking checkout progress.

The system monitors behavioral signals (idle time, exit intent, field events, scroll depth), classifies the likely abandonment cause using a two-tier approach (deterministic rule engine + LLM fallback), and surfaces a minimal-interaction widget that resolves the issue in the moment. Every intervention outcome is recorded so conversion improvement can be measured against a baseline.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Graceful Degradation](#graceful-degradation)

---

## Architecture Overview

The system is delivered as a single JavaScript bundle (`dist/checkout-recovery.js`) injected into the Shopify checkout page via the Script Tag API. All core logic runs in the browser; two lightweight serverless functions handle analytics persistence and LLM classification.

```
Browser (Checkout Page)
├── Friction_Detector      — collects behavioral signals, classifies friction
├── Intervention_Engine    — selects recovery action, assembles payload
├── Conversation_Manager   — renders inline widget, manages turn sequence
├── Session_State          — in-memory session tracking (no PII persisted)
└── Platform_Adapter       — abstracts Shopify Storefront & Admin API calls

Backend Services (Serverless)
├── Analytics_Service      — persists session records, exposes metrics endpoint
└── LLM_Gateway            — Tier 2 classification for ambiguous signal patterns
```

For the full component diagram and sequence flows, see [`docs/TECHNICAL_DOCUMENT.md`](docs/TECHNICAL_DOCUMENT.md).

### Two-Tier Classification

Friction classification uses two tiers to balance speed, cost, and accuracy:

**Tier 1 — Deterministic Rule Engine (primary, ~80% of sessions)**
Runs entirely in the browser with no network calls. Scores each of the eight friction categories (`Price_Hesitation`, `Shipping_Confusion`, `Trust_Issue`, `Missing_Information`, `Coupon_Confusion`, `Size_Uncertainty`, `Delivery_Timeline`, `Payment_Options`) using a configurable weighted signal model, then selects the highest-scoring category. If confidence ≥ 0.60 and the top category leads the second by ≥ 0.15, an intervention is triggered immediately. Zero latency, zero cost, fully auditable.

**Tier 2 — LLM-Assisted Classification (fallback, ~20% of sessions)**
Invoked only when Tier 1 produces an ambiguous result (top two categories within 0.15 of each other). A structured prompt is sent to the LLM Gateway with a 2-second timeout. If the LLM call fails, times out, or returns unparseable output, the system falls back to the Tier 1 result (if confidence ≥ 0.60) or suppresses the intervention entirely.

---

## Installation

### 1. Build the bundle

```bash
npm install
npm run build
```

This outputs `dist/checkout-recovery.js` (minified IIFE bundle).

### 2. Host the bundle

Upload `dist/checkout-recovery.js` to a CDN or static hosting service (e.g., AWS S3 + CloudFront, Cloudflare R2). Note the public URL — you will need it in the next step.

### 3. Inject via Shopify Script Tag API

Register the bundle as a Script Tag on your Shopify store using the Admin API:

```bash
curl -X POST \
  "https://{shop-domain}/admin/api/2024-01/script_tags.json" \
  -H "X-Shopify-Access-Token: {admin-api-access-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "script_tag": {
      "event": "onload",
      "src": "https://your-cdn.example.com/checkout-recovery.js"
    }
  }'
```

The bundle initializes automatically on `DOMContentLoaded` and wraps all startup logic in a top-level `try/catch` so a failure never affects the checkout form.

---

## Environment Variables

The backend serverless functions and the bundle read configuration from environment variables. Set these in your serverless platform (AWS Lambda, Cloudflare Workers, etc.) and in your local `.env` file for development.

### Analytics Service (`functions/analytics-service`)

| Variable | Description | Example |
|---|---|---|
| `ANALYTICS_DB_TYPE` | Database backend: `dynamodb` or `postgres` | `postgres` |
| `DATABASE_URL` | Postgres connection string (if `ANALYTICS_DB_TYPE=postgres`) | `postgres://user:pass@host:5432/db` |
| `DYNAMODB_TABLE` | DynamoDB table name (if `ANALYTICS_DB_TYPE=dynamodb`) | `checkout-recovery-sessions` |
| `BASELINE_CONVERSION_RATE` | Historical conversion rate without the system, as a decimal | `0.68` |

### LLM Gateway (`functions/llm-gateway`)

| Variable | Description | Example |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key for Chat Completions | `sk-...` |
| `OPENAI_MODEL` | Model to use for classification | `gpt-4o-mini` |

### Client Bundle (injected at build time or via `window` globals)

| Variable | Description | Example |
|---|---|---|
| `ANALYTICS_SERVICE_URL` | Base URL of the deployed Analytics Service | `https://api.example.com` |
| `LLM_GATEWAY_URL` | Base URL of the deployed LLM Gateway | `https://llm.example.com` |
| `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Shopify Storefront API public access token | `abc123...` |
| `SHOPIFY_SHOP_DOMAIN` | Shopify store domain | `my-store.myshopify.com` |
| `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | Shopify Admin API access token (server-side only) | `shpat_...` |

> **Note:** `SHOPIFY_ADMIN_API_ACCESS_TOKEN` is used only by the serverless functions and must never be included in the client bundle.

---

## Local Development

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Setup

```bash
# Install dependencies
npm install

# Build the bundle (outputs dist/checkout-recovery.js)
npm run build

# Build in watch mode during development
npm run build:watch

# Type-check without emitting
npm run typecheck
```

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

Tests use [Vitest](https://vitest.dev/) and [fast-check](https://github.com/dubzzz/fast-check) for property-based testing. Unit tests live alongside source files as `*.test.ts`.

### Production Build

```bash
NODE_ENV=production npm run build
```

The production build minifies the output and applies dead-code elimination. Bundle size is validated against a 200ms p95 page load budget via Lighthouse CI:

```bash
npm run lhci
```

---

## Graceful Degradation

The system is strictly additive — it never wraps or intercepts the checkout form submission. At every failure level, the checkout form remains fully functional:

| Level | Condition | Behavior |
|---|---|---|
| 0 | Normal | Full system active |
| 1 | LLM Gateway unavailable | Deterministic-only classification |
| 2 | Platform Adapter degraded | Interventions suppressed for affected categories |
| 3 | Intervention Engine down | No interventions; checkout proceeds normally |
| 4 | Conversation Manager render error | Widget suppressed; no user-visible impact |
| 5 | Full system failure | Checkout proceeds exactly as without the system |

The Intervention Engine also implements a circuit breaker: after 3 consecutive Platform Adapter failures within a 60-second window, all adapter calls are suppressed for 30 seconds to prevent cascading failures during Shopify API degradation.
