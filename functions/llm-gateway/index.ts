/**
 * LLM Gateway — Tier 2 friction classification serverless handler.
 *
 * Accepts a POST request with a SignalSnapshot and the top two deterministic
 * category candidates. Calls the OpenAI Chat Completions API with a 2-second
 * timeout and returns a structured classification result.
 *
 * On any failure (timeout, network error, invalid JSON, unexpected shape) the
 * handler returns HTTP 200 with `{ category: null, confidence: 0 }` so the
 * caller can fall back to Tier 1 without treating the response as an error.
 *
 * Requirements: 2.1, 2.6, 12.1
 */

import type { FrictionCategory, SignalSnapshot } from '../../src/types/index.js';
import { ALL_FRICTION_CATEGORIES } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

/** POST body expected by this handler. */
export interface LlmGatewayRequest {
  signals: SignalSnapshot;
  /** The two highest-scoring categories from the deterministic classifier. */
  topTwoCategories: [string, string];
}

/** Successful classification result from the LLM. */
export interface LlmClassificationResult {
  category: FrictionCategory | null;
  confidence: number;
  /** One-sentence reasoning from the model (omitted on failure). */
  reasoning?: string;
}

/** The raw JSON shape the LLM is expected to return. */
interface LlmRawResponse {
  category: string;
  confidence: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Null-result sentinel — returned on any failure path
// ---------------------------------------------------------------------------

const NULL_RESULT: LlmClassificationResult = { category: null, confidence: 0 };

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the structured prompt described in the design spec.
 * The prompt asks the model to return ONLY a JSON object so it can be
 * parsed without any post-processing of markdown fences.
 */
function buildPrompt(
  signals: SignalSnapshot,
  topTwoCategories: [string, string],
): string {
  // Summarise field events without exposing PII (field IDs only)
  const fieldEventsSummary =
    signals.fieldEvents.length === 0
      ? 'none'
      : signals.fieldEvents
          .map((fe) => {
            const parts = [`${fe.eventType} on ${fe.fieldId}`];
            if (fe.durationMs !== undefined) parts.push(`(${fe.durationMs}ms)`);
            if (fe.errorMessage !== undefined) parts.push(`[error: ${fe.errorMessage}]`);
            return parts.join(' ');
          })
          .join(', ');

  const categoryList = ALL_FRICTION_CATEGORIES.join(', ');

  return `You are a checkout friction classifier. Given the following behavioral signals from a user on a checkout page, classify the PRIMARY reason they are hesitating. Respond with ONLY a JSON object — no markdown, no explanation outside the JSON.

Signals:
- Time on page: ${signals.timeOnPageMs}ms
- Scroll depth: ${signals.scrollDepthPct}%
- Exit intent detected: ${signals.exitIntentDetected}
- Idle detected: ${signals.idleDetected}
- Back navigation attempted: ${signals.backNavigationAttempted}
- Field events: ${fieldEventsSummary}
- Checkout step: ${signals.checkoutStep}
- Top deterministic scores: ${topTwoCategories[0]}, ${topTwoCategories[1]}

Valid categories: ${categoryList}

Respond with exactly this JSON shape:
{"category": "<one of the valid categories above>", "confidence": <number between 0.0 and 1.0>, "reasoning": "<one sentence>"}`;
}

// ---------------------------------------------------------------------------
// OpenAI call
// ---------------------------------------------------------------------------

/** Environment variable names consumed by this function. */
const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';
const OPENAI_MODEL_ENV = 'OPENAI_MODEL';
const DEFAULT_MODEL = 'gpt-4o-mini';

/** Hard timeout for the OpenAI call (Requirement 2.6). */
const LLM_TIMEOUT_MS = 2_000;

/**
 * Call the OpenAI Chat Completions API and return the raw parsed response.
 * Throws on network error, timeout, or non-2xx HTTP status.
 */
async function callOpenAI(prompt: string): Promise<LlmRawResponse> {
  const apiKey = process.env[OPENAI_API_KEY_ENV];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const model = process.env[OPENAI_MODEL_ENV] ?? DEFAULT_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 128,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`OpenAI API returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('OpenAI response contained no content');
  }

  // Parse the model's JSON output
  const parsed = JSON.parse(content) as unknown;
  return validateLlmResponse(parsed);
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

/**
 * Validate that the parsed JSON from the LLM matches the expected shape.
 * Throws a descriptive error if any field is missing or out of range.
 */
function validateLlmResponse(parsed: unknown): LlmRawResponse {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM response is not an object');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['category'] !== 'string') {
    throw new Error('LLM response missing string "category"');
  }

  if (typeof obj['confidence'] !== 'number') {
    throw new Error('LLM response missing numeric "confidence"');
  }

  if (typeof obj['reasoning'] !== 'string') {
    throw new Error('LLM response missing string "reasoning"');
  }

  const confidence = obj['confidence'];
  if (confidence < 0 || confidence > 1) {
    throw new Error(`LLM confidence out of range: ${confidence}`);
  }

  return {
    category: obj['category'],
    confidence,
    reasoning: obj['reasoning'],
  };
}

/**
 * Return true if the given string is one of the eight valid FrictionCategory
 * values. Used to guard against the model hallucinating a category name.
 */
function isValidFrictionCategory(value: string): value is FrictionCategory {
  return (ALL_FRICTION_CATEGORIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Core classification logic (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Classify friction using the LLM.
 *
 * Returns `NULL_RESULT` on any failure so the caller can fall back to Tier 1
 * without treating the response as an error (Requirement 12.1).
 */
export async function classifyWithLlm(
  request: LlmGatewayRequest,
): Promise<LlmClassificationResult> {
  try {
    const prompt = buildPrompt(request.signals, request.topTwoCategories);
    const raw = await callOpenAI(prompt);

    if (!isValidFrictionCategory(raw.category)) {
      console.error(
        `[LlmGateway] Model returned unknown category: "${raw.category}"`,
      );
      return NULL_RESULT;
    }

    return {
      category: raw.category,
      confidence: raw.confidence,
      reasoning: raw.reasoning,
    };
  } catch (err) {
    // AbortError = timeout; all other errors are network / parse failures.
    // In every case we return the null sentinel (Requirement 12.1).
    const isTimeout =
      err instanceof Error && err.name === 'AbortError';
    console.error(
      isTimeout
        ? '[LlmGateway] OpenAI call timed out after 2s'
        : '[LlmGateway] Classification failed:',
      err,
    );
    return NULL_RESULT;
  }
}

// ---------------------------------------------------------------------------
// HTTP handler (platform-agnostic)
// ---------------------------------------------------------------------------

/**
 * Minimal HTTP request/response abstraction so the handler can be adapted to
 * AWS Lambda, Cloudflare Workers, or any Node.js HTTP server without changing
 * the core logic.
 */
export interface HttpRequest {
  method: string;
  body: string | null;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
};

function jsonResponse(status: number, data: unknown): HttpResponse {
  return {
    status,
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  };
}

/**
 * Parse and validate the incoming POST body.
 * Returns `null` if the body is missing, unparseable, or structurally invalid.
 */
function parseRequestBody(raw: string | null): LlmGatewayRequest | null {
  if (raw === null || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;

  // Validate signals field
  if (typeof obj['signals'] !== 'object' || obj['signals'] === null) return null;

  // Validate topTwoCategories field
  const ttc = obj['topTwoCategories'];
  if (
    !Array.isArray(ttc) ||
    ttc.length !== 2 ||
    typeof ttc[0] !== 'string' ||
    typeof ttc[1] !== 'string'
  ) {
    return null;
  }

  return {
    signals: obj['signals'] as SignalSnapshot,
    topTwoCategories: [ttc[0], ttc[1]] as [string, string],
  };
}

/**
 * Main HTTP handler.
 *
 * - Only accepts POST requests.
 * - Returns HTTP 405 for non-POST methods.
 * - Returns HTTP 400 for malformed request bodies.
 * - Returns HTTP 200 with `{ category: null, confidence: 0 }` on LLM failure.
 * - Returns HTTP 200 with the classification result on success.
 */
export async function handler(req: HttpRequest): Promise<HttpResponse> {
  if (req.method.toUpperCase() !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  const request = parseRequestBody(req.body);
  if (request === null) {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const result = await classifyWithLlm(request);
  return jsonResponse(200, result);
}

// ---------------------------------------------------------------------------
// AWS Lambda adapter (optional entry point)
// ---------------------------------------------------------------------------

/**
 * AWS Lambda handler adapter.
 *
 * Maps the Lambda event shape to the platform-agnostic `HttpRequest` and
 * returns a Lambda-compatible response object.
 */
export async function lambdaHandler(event: {
  httpMethod?: string;
  requestContext?: { http?: { method?: string } };
  body?: string | null;
}): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  // Support both REST API (httpMethod) and HTTP API v2 (requestContext.http.method)
  const method =
    event.httpMethod ??
    event.requestContext?.http?.method ??
    'POST';

  const req: HttpRequest = {
    method,
    body: event.body ?? null,
  };

  const res = await handler(req);
  return {
    statusCode: res.status,
    headers: res.headers,
    body: res.body,
  };
}
