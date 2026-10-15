import { getEntity, type EntityName } from '../imports/contract'

/**
 * Limits of the REST API (approved plan, "Limits"). The database enforces the record caps, the
 * list limits, the demand range, the key count and the daily write cap again; the OpenAPI
 * document and its drift test read these values, so a change here, in `app.api_limits()` and the
 * literals of the `rest_api` migration, and in `supabase/tests/fixtures/api_limits.json` go
 * together (see `organizationLimits`). Pure module.
 */
export const API_LIMITS = {
  /** Bytes of a request body, counted while streaming (413 `payload_too_large`). */
  bodyBytes: 1_048_576,
  /** Records per upsert of a master-data resource (413 `too_many_records`). */
  masterRecords: 1_000,
  /**
   * Records per upsert of a transaction resource (`demand-history`). 2,500 rather than the plan's
   * 5,000: 5,000 new demand records took 1.6-2.4 s locally, at the 2.0 s p95 target.
   */
  transactionRecords: 2_500,
  /** Request-shape errors returned by one 422 `invalid_request`. */
  requestErrors: 100,
  /** Validation errors returned by one 422 `validation_failed` (the counts stay complete). */
  validationErrors: 1_000,
  /** Warnings returned by one upsert result or problem. */
  warnings: 100,
  /** `limit` of master-data lists; out of range is a 400, never clamped. */
  masterList: { min: 1, max: 1_000, default: 100 },
  /** `limit` of transaction lists. */
  transactionList: { min: 1, max: 5_000, default: 1_000 },
  /** Days a demand list may span, `from` and `to` included (`to - from <= 365`). */
  demandRangeDays: 366,
  /** Characters of a list cursor. */
  cursorChars: 1_024,
  /** Characters of a bearer token the API reads at all. */
  tokenChars: 255,
  /** Requests per key and per client IP in one window (Workers Rate Limiting bindings). */
  keyRequestsPerWindow: 120,
  ipRequestsPerWindow: 300,
  rateLimitWindowSeconds: 60,
  /** Writes per organization in flight at once (the import lock, 409 without waiting). */
  writesInFlight: 1,
  /** Recorded writes per organization in 24 hours (429 `daily_limit`). */
  recordedWritesPerDay: 5_000,
  /** Active (unrevoked, unexpired) keys per organization. */
  activeKeysPerOrganization: 20,
  /** Expiry choices offered by Settings, in days, and the default. SQL accepts 1-366. */
  keyExpiryDays: [30, 90, 180, 365],
  defaultKeyExpiryDays: 90,
  maxKeyExpiryDays: 366,
  /** Characters of a caller's own value echoed in an error item. */
  valueChars: 200,
} as const

export type ListLimits = { readonly min: number; readonly max: number; readonly default: number }

/** Entities whose resources need the `transactions:*` scopes (demand history; Step 6 adds more). */
export const TRANSACTION_ENTITIES: ReadonlySet<EntityName> = new Set<EntityName>([
  'demand_history',
  'stock_snapshots',
  'open_orders',
  'receipts',
])

export function isTransactionEntity(entity: EntityName): boolean {
  getEntity(entity)
  return TRANSACTION_ENTITIES.has(entity)
}

/** Records one upsert of the entity may carry. */
export function recordCap(entity: EntityName): number {
  return entity === 'demand_history' ? API_LIMITS.transactionRecords : API_LIMITS.masterRecords
}

/** `limit` bounds and default of the entity's list. */
export function listLimits(entity: EntityName): ListLimits {
  return entity === 'demand_history' ? API_LIMITS.transactionList : API_LIMITS.masterList
}

type PerCategory = { readonly master_data: number; readonly demand_history: number }

/** The `limits` member of `GET /organization`. */
export type OrganizationLimits = {
  readonly body_bytes: number
  readonly upsert_records: PerCategory
  readonly list_limit: PerCategory
  readonly list_default_limit: PerCategory
  readonly demand_list_days: number
  readonly recorded_writes_per_day: number
  readonly active_keys: number
}

/**
 * The `limits` member of `GET /organization`, key order included, built from `API_LIMITS`. SQL
 * returns it from `app.api_limits()` (the `rest_api` migration), whose record caps
 * `app.api_check_fields` enforces. `supabase/tests/fixtures/api_limits.json` holds the same object:
 * limits.test.ts compares this function with it, and pgTAP compares `app.api_limits()` with it.
 */
export function organizationLimits(): OrganizationLimits {
  return {
    body_bytes: API_LIMITS.bodyBytes,
    upsert_records: {
      master_data: API_LIMITS.masterRecords,
      demand_history: API_LIMITS.transactionRecords,
    },
    list_limit: {
      master_data: API_LIMITS.masterList.max,
      demand_history: API_LIMITS.transactionList.max,
    },
    list_default_limit: {
      master_data: API_LIMITS.masterList.default,
      demand_history: API_LIMITS.transactionList.default,
    },
    demand_list_days: API_LIMITS.demandRangeDays,
    recorded_writes_per_day: API_LIMITS.recordedWritesPerDay,
    active_keys: API_LIMITS.activeKeysPerOrganization,
  }
}
