/**
 * Analytics Service — serverless handler for session persistence and metrics aggregation.
 *
 * Routes:
 *   POST /session  — validate SessionRecord shape, persist to DynamoDB or Postgres
 *   GET  /metrics  — aggregate MetricsResult from stored sessions
 *
 * Database backend is selected via the DB_PROVIDER environment variable:
 *   "dynamodb"  — uses @aws-sdk/client-dynamodb + @aws-sdk/lib-dynamodb
 *   "postgres"  — uses pg (node-postgres)
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import type {
  SessionRecord,
  MetricsQuery,
  MetricsResult,
  FrictionCategory,
} from '../../src/types/index.js';
import { ALL_FRICTION_CATEGORIES } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Environment constants
// ---------------------------------------------------------------------------

const DB_PROVIDER = (process.env['DB_PROVIDER'] ?? 'dynamodb') as
  | 'dynamodb'
  | 'postgres';

const DYNAMODB_TABLE =
  process.env['DYNAMODB_TABLE'] ?? 'checkout-recovery-sessions';

const POSTGRES_CONNECTION_STRING = process.env['POSTGRES_CONNECTION_STRING'] ?? '';

/** Baseline conversion rate read from environment (percentage, e.g. 2.5 = 2.5%). */
const BASELINE_CONVERSION_RATE = parseFloat(
  process.env['BASELINE_CONVERSION_RATE'] ?? '2.5',
);

/** Hard timeout for the persist operation (Requirement 11.2). */
const PERSIST_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// SessionRecord validation
// ---------------------------------------------------------------------------

const VALID_CHECKOUT_STEPS = new Set([
  'cart',
  'information',
  'shipping',
  'payment',
  'review',
]);

const VALID_FRICTION_CATEGORIES = new Set<string>(ALL_FRICTION_CATEGORIES);

const VALID_RECOVERY_ACTIONS = new Set([
  'show_coupon',
  'show_price_comparison',
  'show_shipping_options',
  'show_trust_signals',
  'show_size_guide',
  'show_payment_options',
  'highlight_missing_fields',
  'show_delivery_estimate',
]);

const VALID_INTERVENTION_OUTCOMES = new Set(['accepted', 'dismissed', 'timed_out']);

/**
 * Validate that the given value conforms to the SessionRecord shape.
 * Returns a descriptive error string on failure, or null on success.
 */
function validateSessionRecord(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return 'body must be a JSON object';
  }

  const obj = value as Record<string, unknown>;

  // Required string fields
  for (const field of ['sessionId', 'platformId', 'startedAt', 'endedAt'] as const) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).trim() === '') {
      return `missing or empty string field: ${field}`;
    }
  }

  // ISO 8601 date strings
  for (const field of ['startedAt', 'endedAt'] as const) {
    const d = new Date(obj[field] as string);
    if (isNaN(d.getTime())) {
      return `${field} is not a valid ISO 8601 date string`;
    }
  }

  // checkoutStepReached
  if (
    typeof obj['checkoutStepReached'] !== 'string' ||
    !VALID_CHECKOUT_STEPS.has(obj['checkoutStepReached'] as string)
  ) {
    return `checkoutStepReached must be one of: ${[...VALID_CHECKOUT_STEPS].join(', ')}`;
  }

  // converted
  if (typeof obj['converted'] !== 'boolean') {
    return 'converted must be a boolean';
  }

  // frictionEvents
  if (!Array.isArray(obj['frictionEvents'])) {
    return 'frictionEvents must be an array';
  }
  for (let i = 0; i < (obj['frictionEvents'] as unknown[]).length; i++) {
    const fe = (obj['frictionEvents'] as unknown[])[i];
    if (typeof fe !== 'object' || fe === null) {
      return `frictionEvents[${i}] must be an object`;
    }
    const feObj = fe as Record<string, unknown>;
    if (
      typeof feObj['category'] !== 'string' ||
      !VALID_FRICTION_CATEGORIES.has(feObj['category'] as string)
    ) {
      return `frictionEvents[${i}].category is invalid`;
    }
    if (
      typeof feObj['confidence'] !== 'number' ||
      (feObj['confidence'] as number) < 0 ||
      (feObj['confidence'] as number) > 1
    ) {
      return `frictionEvents[${i}].confidence must be a number in [0, 1]`;
    }
    if (typeof feObj['detectedAt'] !== 'string' || isNaN(new Date(feObj['detectedAt'] as string).getTime())) {
      return `frictionEvents[${i}].detectedAt is not a valid ISO 8601 date string`;
    }
  }

  // interventions
  if (!Array.isArray(obj['interventions'])) {
    return 'interventions must be an array';
  }
  for (let i = 0; i < (obj['interventions'] as unknown[]).length; i++) {
    const iv = (obj['interventions'] as unknown[])[i];
    if (typeof iv !== 'object' || iv === null) {
      return `interventions[${i}] must be an object`;
    }
    const ivObj = iv as Record<string, unknown>;
    if (typeof ivObj['interventionId'] !== 'string' || (ivObj['interventionId'] as string).trim() === '') {
      return `interventions[${i}].interventionId must be a non-empty string`;
    }
    if (
      typeof ivObj['category'] !== 'string' ||
      !VALID_FRICTION_CATEGORIES.has(ivObj['category'] as string)
    ) {
      return `interventions[${i}].category is invalid`;
    }
    if (
      typeof ivObj['recoveryAction'] !== 'string' ||
      !VALID_RECOVERY_ACTIONS.has(ivObj['recoveryAction'] as string)
    ) {
      return `interventions[${i}].recoveryAction is invalid`;
    }
    if (typeof ivObj['triggeredAt'] !== 'string' || isNaN(new Date(ivObj['triggeredAt'] as string).getTime())) {
      return `interventions[${i}].triggeredAt is not a valid ISO 8601 date string`;
    }
    if (
      typeof ivObj['outcome'] !== 'string' ||
      !VALID_INTERVENTION_OUTCOMES.has(ivObj['outcome'] as string)
    ) {
      return `interventions[${i}].outcome must be one of: accepted, dismissed, timed_out`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Database abstraction
// ---------------------------------------------------------------------------

/** Minimal interface for the database backend. */
interface DbBackend {
  /** Persist a session record. */
  persistSession(record: SessionRecord): Promise<void>;
  /** Query sessions within a date range, optionally filtered by frictionCategory. */
  querySessions(query: MetricsQuery): Promise<SessionRecord[]>;
}

// ---------------------------------------------------------------------------
// DynamoDB backend
// ---------------------------------------------------------------------------

async function createDynamoDbBackend(): Promise<DbBackend> {
  // Dynamic import so the module is only loaded when DynamoDB is configured.
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand, ScanCommand } = await import(
    '@aws-sdk/lib-dynamodb'
  );

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async persistSession(record: SessionRecord): Promise<void> {
      await client.send(
        new PutCommand({
          TableName: DYNAMODB_TABLE,
          Item: {
            sessionId: record.sessionId,
            platformId: record.platformId,
            startedAt: record.startedAt,
            endedAt: record.endedAt,
            checkoutStepReached: record.checkoutStepReached,
            frictionEvents: record.frictionEvents,
            interventions: record.interventions,
            converted: record.converted,
          },
        }),
      );
    },

    async querySessions(query: MetricsQuery): Promise<SessionRecord[]> {
      // DynamoDB Scan with a FilterExpression on startedAt / endedAt.
      // For production use, a GSI on startedAt would be more efficient.
      const result = await client.send(
        new ScanCommand({
          TableName: DYNAMODB_TABLE,
          FilterExpression:
            'startedAt >= :start AND startedAt <= :end',
          ExpressionAttributeValues: {
            ':start': query.startDate,
            ':end': query.endDate,
          },
        }),
      );

      const items = (result.Items ?? []) as SessionRecord[];

      if (query.frictionCategory) {
        const cat = query.frictionCategory;
        return items.filter((s) =>
          s.frictionEvents.some((fe) => fe.category === cat),
        );
      }

      return items;
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres backend
// ---------------------------------------------------------------------------

async function createPostgresBackend(): Promise<DbBackend> {
  // Dynamic import so the module is only loaded when Postgres is configured.
  const { Pool } = await import('pg');

  const pool = new Pool({ connectionString: POSTGRES_CONNECTION_STRING });

  // Ensure the sessions table exists (idempotent).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id           TEXT PRIMARY KEY,
      platform_id          TEXT NOT NULL,
      started_at           TIMESTAMPTZ NOT NULL,
      ended_at             TIMESTAMPTZ NOT NULL,
      checkout_step_reached TEXT NOT NULL,
      friction_events      JSONB NOT NULL DEFAULT '[]',
      interventions        JSONB NOT NULL DEFAULT '[]',
      converted            BOOLEAN NOT NULL
    )
  `);

  return {
    async persistSession(record: SessionRecord): Promise<void> {
      await pool.query(
        `INSERT INTO sessions
           (session_id, platform_id, started_at, ended_at,
            checkout_step_reached, friction_events, interventions, converted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (session_id) DO UPDATE SET
           platform_id           = EXCLUDED.platform_id,
           started_at            = EXCLUDED.started_at,
           ended_at              = EXCLUDED.ended_at,
           checkout_step_reached = EXCLUDED.checkout_step_reached,
           friction_events       = EXCLUDED.friction_events,
           interventions         = EXCLUDED.interventions,
           converted             = EXCLUDED.converted`,
        [
          record.sessionId,
          record.platformId,
          record.startedAt,
          record.endedAt,
          record.checkoutStepReached,
          JSON.stringify(record.frictionEvents),
          JSON.stringify(record.interventions),
          record.converted,
        ],
      );
    },

    async querySessions(query: MetricsQuery): Promise<SessionRecord[]> {
      const params: unknown[] = [query.startDate, query.endDate];
      let sql = `
        SELECT session_id, platform_id, started_at, ended_at,
               checkout_step_reached, friction_events, interventions, converted
        FROM sessions
        WHERE started_at >= $1 AND started_at <= $2
      `;

      if (query.frictionCategory) {
        params.push(query.frictionCategory);
        sql += ` AND friction_events @> $${params.length}::jsonb`;
        // Use a JSONB containment check for the category field.
        // We replace the placeholder with a proper JSONB array element check.
        sql = sql.replace(
          `$${params.length}::jsonb`,
          `jsonb_build_array(jsonb_build_object('category', $${params.length}::text))`,
        );
      }

      const result = await pool.query(sql, params);

      return result.rows.map((row) => ({
        sessionId: row.session_id as string,
        platformId: row.platform_id as string,
        startedAt: (row.started_at as Date).toISOString(),
        endedAt: (row.ended_at as Date).toISOString(),
        checkoutStepReached: row.checkout_step_reached as SessionRecord['checkoutStepReached'],
        frictionEvents: row.friction_events as SessionRecord['frictionEvents'],
        interventions: row.interventions as SessionRecord['interventions'],
        converted: row.converted as boolean,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Lazy-initialised database backend singleton
// ---------------------------------------------------------------------------

let _dbBackend: DbBackend | null = null;

async function getDbBackend(): Promise<DbBackend> {
  if (_dbBackend !== null) return _dbBackend;

  if (DB_PROVIDER === 'postgres') {
    _dbBackend = await createPostgresBackend();
  } else {
    _dbBackend = await createDynamoDbBackend();
  }

  return _dbBackend;
}

// ---------------------------------------------------------------------------
// Metrics aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate a MetricsResult from a list of session records.
 *
 * conversionRate = (converted / total) * 100
 * deltaPercentagePoints = conversionRate - baselineConversionRate
 * interventionAcceptanceRate = accepted interventions / total interventions * 100
 * perCategoryRecoveryRate = per-category accepted / triggered * 100
 */
export function aggregateMetrics(
  sessions: SessionRecord[],
  baselineConversionRate: number,
): MetricsResult {
  const totalSessions = sessions.length;

  if (totalSessions === 0) {
    const zeroCategoryRates = Object.fromEntries(
      ALL_FRICTION_CATEGORIES.map((c) => [c, 0]),
    ) as Record<FrictionCategory, number>;

    return {
      conversionRate: 0,
      baselineConversionRate,
      deltaPercentagePoints: 0 - baselineConversionRate,
      interventionAcceptanceRate: 0,
      perCategoryRecoveryRate: zeroCategoryRates,
      totalSessions: 0,
      totalInterventions: 0,
    };
  }

  // Conversion rate (Requirement 11.4)
  const convertedCount = sessions.filter((s) => s.converted).length;
  const conversionRate = (convertedCount / totalSessions) * 100;

  // Delta (Requirement 11.5)
  const deltaPercentagePoints = conversionRate - baselineConversionRate;

  // Intervention acceptance rate
  let totalInterventions = 0;
  let acceptedInterventions = 0;

  // Per-category counters
  const categoryTriggered: Record<FrictionCategory, number> = Object.fromEntries(
    ALL_FRICTION_CATEGORIES.map((c) => [c, 0]),
  ) as Record<FrictionCategory, number>;

  const categoryAccepted: Record<FrictionCategory, number> = Object.fromEntries(
    ALL_FRICTION_CATEGORIES.map((c) => [c, 0]),
  ) as Record<FrictionCategory, number>;

  for (const session of sessions) {
    for (const intervention of session.interventions) {
      totalInterventions++;
      const cat = intervention.category;

      // Guard: only count known categories
      if (VALID_FRICTION_CATEGORIES.has(cat)) {
        categoryTriggered[cat]++;
        if (intervention.outcome === 'accepted') {
          acceptedInterventions++;
          categoryAccepted[cat]++;
        }
      } else if (intervention.outcome === 'accepted') {
        acceptedInterventions++;
      }
    }
  }

  const interventionAcceptanceRate =
    totalInterventions === 0
      ? 0
      : (acceptedInterventions / totalInterventions) * 100;

  // Per-category recovery rate
  const perCategoryRecoveryRate: Record<FrictionCategory, number> =
    Object.fromEntries(
      ALL_FRICTION_CATEGORIES.map((cat) => {
        const triggered = categoryTriggered[cat] ?? 0;
        const accepted = categoryAccepted[cat] ?? 0;
        const rate = triggered === 0 ? 0 : (accepted / triggered) * 100;
        return [cat, rate];
      }),
    ) as Record<FrictionCategory, number>;

  return {
    conversionRate,
    baselineConversionRate,
    deltaPercentagePoints,
    interventionAcceptanceRate,
    perCategoryRecoveryRate,
    totalSessions,
    totalInterventions,
  };
}

// ---------------------------------------------------------------------------
// MetricsQuery validation
// ---------------------------------------------------------------------------

function validateMetricsQuery(params: Record<string, string>): string | null {
  const { startDate, endDate } = params;

  if (typeof startDate !== 'string' || startDate.trim() === '') {
    return 'startDate query parameter is required';
  }
  if (typeof endDate !== 'string' || endDate.trim() === '') {
    return 'endDate query parameter is required';
  }
  if (isNaN(new Date(startDate).getTime())) {
    return 'startDate is not a valid ISO 8601 date string';
  }
  if (isNaN(new Date(endDate).getTime())) {
    return 'endDate is not a valid ISO 8601 date string';
  }

  const frictionCategory = params['frictionCategory'];
  if (
    frictionCategory !== undefined &&
    !VALID_FRICTION_CATEGORIES.has(frictionCategory)
  ) {
    return `frictionCategory must be one of: ${ALL_FRICTION_CATEGORIES.join(', ')}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTTP response helpers
// ---------------------------------------------------------------------------

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
};

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /session
 *
 * Validates the SessionRecord body and persists it to the configured database.
 * Responds within 5 seconds (Requirement 11.2).
 */
async function handlePostSession(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Request body must be valid JSON' });
  }

  const validationError = validateSessionRecord(body);
  if (validationError !== null) {
    return jsonResponse(400, { error: validationError });
  }

  const record = body as SessionRecord;

  // Enforce 5-second timeout on the persist operation (Requirement 11.2)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PERSIST_TIMEOUT_MS);

  try {
    const db = await getDbBackend();

    await Promise.race([
      db.persistSession(record),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error('persist timeout')),
        );
      }),
    ]);

    return jsonResponse(201, { ok: true, sessionId: record.sessionId });
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.message === 'persist timeout';
    console.error(
      isTimeout
        ? '[AnalyticsService] Persist timed out after 5s'
        : '[AnalyticsService] Persist failed:',
      err,
    );
    return jsonResponse(500, {
      error: isTimeout ? 'Persist timed out' : 'Internal server error',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * GET /metrics
 *
 * Accepts MetricsQuery as URL query parameters and returns aggregated MetricsResult.
 * Requirement 11.3, 11.4, 11.5.
 */
async function handleGetMetrics(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const validationError = validateMetricsQuery(params);
  if (validationError !== null) {
    return jsonResponse(400, { error: validationError });
  }

  const query: MetricsQuery = {
    startDate: params['startDate'] as string,
    endDate: params['endDate'] as string,
    ...(params['frictionCategory'] !== undefined && {
      frictionCategory: params['frictionCategory'] as FrictionCategory,
    }),
  };

  try {
    const db = await getDbBackend();
    const sessions = await db.querySessions(query);
    const result = aggregateMetrics(sessions, BASELINE_CONVERSION_RATE);
    return jsonResponse(200, result);
  } catch (err) {
    console.error('[AnalyticsService] Metrics query failed:', err);
    return jsonResponse(500, { error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

/**
 * Route an incoming Request to the appropriate handler.
 * Accepts a standard Web API `Request` object (Cloudflare Workers / testing).
 */
export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const path = url.pathname.replace(/\/$/, ''); // strip trailing slash

  try {
    if (method === 'POST' && path === '/session') {
      return await handlePostSession(req);
    }

    if (method === 'GET' && path === '/metrics') {
      return await handleGetMetrics(req);
    }

    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    // Top-level catch — never crash the serverless function
    console.error('[AnalyticsService] Unhandled error:', err);
    return jsonResponse(500, { error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// AWS Lambda adapter
// ---------------------------------------------------------------------------

/** AWS Lambda event shape (REST API v1 + HTTP API v2). */
interface LambdaEvent {
  httpMethod?: string;
  requestContext?: {
    http?: { method?: string; path?: string };
    resourcePath?: string;
  };
  path?: string;
  rawPath?: string;
  queryStringParameters?: Record<string, string> | null;
  multiValueQueryStringParameters?: Record<string, string[]> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string> | null;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * AWS Lambda handler.
 *
 * Maps the Lambda event to a standard `Request` object and delegates to
 * `handleRequest`, then maps the `Response` back to a Lambda response shape.
 */
export async function handler(
  event: LambdaEvent,
): Promise<LambdaResponse> {
  // Resolve method (REST API v1 vs HTTP API v2)
  const method =
    event.httpMethod ??
    event.requestContext?.http?.method ??
    'GET';

  // Resolve path
  const path =
    event.rawPath ??
    event.path ??
    event.requestContext?.http?.path ??
    '/';

  // Build query string
  const qs = event.queryStringParameters ?? {};
  const searchParams = new URLSearchParams(
    Object.entries(qs).map(([k, v]) => [k, v ?? '']),
  );
  const queryString = searchParams.toString();
  const fullUrl = `https://analytics-service${path}${queryString ? `?${queryString}` : ''}`;

  // Decode body
  let bodyText: string | null = null;
  if (event.body) {
    bodyText = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
  }

  const req = new Request(fullUrl, {
    method,
    headers: event.headers ?? {},
    body: bodyText,
  });

  const res = await handleRequest(req);
  const responseBody = await res.text();

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    statusCode: res.status,
    headers: responseHeaders,
    body: responseBody,
  };
}
