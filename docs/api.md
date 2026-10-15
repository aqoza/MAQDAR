# REST API v1

Use `/api/v1` on your MAQDAR application's origin for server-to-server integrations. It lists master data and demand history and accepts atomic bulk upserts using the same validation and merge rules as the import wizard. The [import contract](import-format.md) defines field names, natural keys, required fields, defaults and validation rules.

The machine-readable OpenAPI 3.1.1 description is available at `/api/v1/openapi.json` without authentication. Its [committed copy](../apps/web/src/lib/api/openapi.json) includes request examples for every resource. `/api/v1` returns the documentation and OpenAPI links.

## Create a key

An organization owner or administrator opens **Settings → API keys**, gives the key a name, chooses permissions and an expiry, and selects **Create key**. Copy the key from the dialog into the integration's secret store. It is shown once; Settings subsequently shows only a prefix and suffix. The database stores a SHA-256 hash, never the complete key.

| Scope                | Operations                       |
| -------------------- | -------------------------------- |
| `master_data:read`   | List all master-data resources   |
| `master_data:write`  | Upsert all master-data resources |
| `transactions:read`  | List demand history              |
| `transactions:write` | Upsert and clear demand history  |

Write permission does not include read permission. Any valid key can call `GET /api/v1/organization` to inspect its organization, granted scopes, expiry, limits and available demand-date partitions.

Keys belong to one organization. The API never takes the organization from a cookie, browser session, query parameter or record. A key stops working when it expires, is revoked, or its creator ceases to be an owner or administrator of that organization. Revocation affects subsequent requests immediately. To rotate a key, create a replacement, update the integration, verify it works, then revoke the old key.

Send the key only in the `Authorization` header over HTTPS. Browser session cookies and Supabase JWTs cannot authenticate this API. Authenticated endpoints do not enable cross-origin browser access; keep keys in your integration's backend.

## Quick start

These shell examples assume `MAQDAR_ORIGIN` contains the application's origin and `MAQDAR_API_KEY` is supplied by your secret store. For local development, use `http://localhost:3000`.

```sh
curl --fail-with-body "$MAQDAR_ORIGIN/api/v1/organization" \
  -H "Authorization: Bearer $MAQDAR_API_KEY"

curl --fail-with-body "$MAQDAR_ORIGIN/api/v1/brands:upsert" \
  -H "Authorization: Bearer $MAQDAR_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"records":[{"brand_code":"FALCON","name_en":"Falcon Genuine Parts","brand_type":"oem"}]}'

curl --fail-with-body "$MAQDAR_ORIGIN/api/v1/brands?limit=100" \
  -H "Authorization: Bearer $MAQDAR_API_KEY"
```

## Resources

For each resource, list with `GET /api/v1/{resource}` and upsert with `POST /api/v1/{resource}:upsert`. Create referenced parents first; this table follows contract load order.

| Resource             | Scope category |
| -------------------- | -------------- |
| `work-calendars`     | Master data    |
| `holiday-overrides`  | Master data    |
| `locations`          | Master data    |
| `network-links`      | Master data    |
| `brands`             | Master data    |
| `items`              | Master data    |
| `item-supersessions` | Master data    |
| `item-interchanges`  | Master data    |
| `suppliers`          | Master data    |
| `supplier-items`     | Master data    |
| `fx-rates`           | Master data    |
| `demand-history`     | Transactions   |

There are no single-record or general delete endpoints. References use natural codes rather than database UUIDs. `HEAD` performs the corresponding GET checks and returns its headers without a body. `OPTIONS` reports supported methods in `Allow`.

## Read and synchronize

Master-data lists accept `limit` (default 100, maximum 1,000), `cursor`, and `updated_since` (an RFC 3339 timestamp with an offset). Demand lists require inclusive `from` and `to` dates, spanning at most 366 days, and accept `item_code`, `location_code`, `limit` (default 1,000, maximum 5,000), and `cursor`.

```sh
curl --fail-with-body --get "$MAQDAR_ORIGIN/api/v1/demand-history" \
  -H "Authorization: Bearer $MAQDAR_API_KEY" \
  --data-urlencode 'from=2026-09-01' \
  --data-urlencode 'to=2026-09-30' \
  --data-urlencode 'location_code=JED-BR1'
```

Every list returns `{ "data": [...], "next_cursor": ..., "as_of": ... }`. Continue until `next_cursor` is null, passing each cursor unchanged and retaining the original filters. Cursors are validated against the resource and filter set. Keep them with their original organization: a cursor is a position, not an access grant, and every page always reads only the key's organization. Unknown, repeated, empty and out-of-range query parameters are rejected.

Master data is ordered by internal ID; demand uses its database key order. The cursor's `as_of` records the start of the traversal, not a database snapshot. For incremental master-data sync, save that timestamp after finishing every page and use it minus at least one minute as the next `updated_since` watermark. Overlap and deduplicate by natural key; choose a longer overlap if your writes can remain uncommitted longer, and reconcile periodically. These lists are not a deletion feed. Demand has no `updated_since`; refresh the date windows relevant to your integration.

Decimals and money are returned as strings to preserve precision; booleans and integer fields use their JSON types, weekdays are arrays of ISO weekday numbers (1–7), and dates use `YYYY-MM-DD`. Master-data records include `updated_at`, which an upsert ignores, allowing list records to be sent back directly.

## Bulk upserts

Send UTF-8 JSON with `Content-Type: application/json` and a single envelope: `{ "records": [...] }`. The array must be nonempty and every record must provide the same set of fields. Include the natural key, and include all members of any contract column group. Unknown fields are rejected. Holiday override scope fields default to null when omitted.

- An omitted optional field preserves an existing value; inserts use the contract default or require a value as specified by the contract.
- An explicit `null` or empty string clears a nullable field. Required fields cannot be cleared.
- Send decimal and money values as strings when exact precision matters. Numbers are accepted, but a client may already have rounded them before transmission.
- Use JSON booleans and weekday arrays, rather than CSV representations.
- Demand requests must supply `quantity` or `lost_sales_quantity`. The contract's zero-demand rules can remove a row; the omitted measure is preserved on updates.

One request is one transaction. A validation failure or write conflict saves no records from that request. Larger datasets must be split into requests, and the whole sequence is not atomic. Use the import wizard for larger resumable batches.

A successful response has HTTP 200 and includes `recorded`, `import_id`, `resource`, `records`, `counts`, warnings and a request ID. Only requests that change data create an import history record, visible in **Imports** with source **API**. An unchanged replay returns `recorded: false` and `import_id: null`. API imports do not store an original upload file.

Deleting an import from history does not restore daily write quota. A separate private ledger retains changed writes for the rolling 24-hour limit; failed requests and unchanged replays do not add entries.

Upserts replace supplied values by natural key; they do not add to demand quantities. Replaying the same values against unchanged data is a no-op. There is no idempotency-key ledger or optimistic version precondition, so coordinate writers: retrying after another system's edit can overwrite its values.

## Limits and retries

| Limit                                | Value                               |
| ------------------------------------ | ----------------------------------- |
| Request body                         | 1 MiB, counted while streaming      |
| Master-data records per upsert       | 1,000                               |
| Demand records per upsert            | 2,500                               |
| Concurrent writes per organization   | 1, shared with the import wizard    |
| Recorded API writes per organization | 5,000 in a rolling 24 hours         |
| Active keys per organization         | 20                                  |
| Settings expiry choices              | 30, 90, 180 or 365 days; default 90 |
| Key request limiter                  | 120 requests per 60 seconds         |
| Client IP request limiter            | 300 requests per 60 seconds         |

The request limiters use Cloudflare Workers bindings, are counted per Cloudflare location, and are eventually consistent. They provide abuse protection rather than an exact global quota. They are absent under `next dev` and `next start`; binding failures allow requests and emit a warning. Database write, record, key and date-range caps remain enforced locally and on Workers.

Honor `Retry-After` on temporary refusals and apply backoff with jitter. Serialize writes for each organization. Split a request after HTTP 413; correct invalid data after HTTP 400 or 422. A missing scope requires a differently scoped key. An expired or revoked key requires a replacement. Demand dates must fit the top-level `demand_window` returned by `/api/v1/organization` and cannot exceed tomorrow; partitions are managed by migrations, never created by a request.

## Error responses

Errors use `application/problem+json` with RFC 9457 fields `type`, `title`, `status`, `detail` and `instance`, plus stable `code` and `request_id` members. Validation errors additionally identify the zero-based record index, field and JSON pointer, such as `/records/0/item_code`. Use codes rather than matching English messages.

| Status  | Typical codes                                         | Action                                          |
| ------- | ----------------------------------------------------- | ----------------------------------------------- |
| 400     | `invalid_parameter`, `invalid_cursor`, `invalid_json` | Correct the request; restart invalid pagination |
| 401     | `unauthorized`, `invalid_token`                       | Supply a valid API key                          |
| 403     | `insufficient_scope`                                  | Grant the required permission through a new key |
| 404     | `not_found`                                           | Check the resource path                         |
| 405     | `method_not_allowed`                                  | Follow the `Allow` header                       |
| 409     | `import_in_progress`, `busy`, `write_conflict`        | Retry after the indicated delay                 |
| 413     | `payload_too_large`, `too_many_records`               | Split the request                               |
| 415     | `unsupported_media_type`                              | Send uncompressed UTF-8 JSON                    |
| 422     | `invalid_request`, `validation_failed`                | Correct fields or values; nothing was saved     |
| 429     | `rate_limited`, `daily_limit`                         | Honor the retry delay                           |
| 500/503 | See OpenAPI                                           | Retain the request ID for investigation         |

Request-shape errors return up to 100 entries; data-validation errors return up to 1,000; warnings return up to 100. Counts remain complete and truncation flags indicate omitted entries. Error values may contain up to 200 characters of your submitted data, so handle error reports accordingly.

Responses include `X-Request-Id` and `Server-Timing`. Authenticated responses use `Cache-Control: no-store`. OpenAPI is public, supports CORS, and has an ETag and a five-minute cache lifetime. Request logs exclude credentials and bodies.

## Development and rollout

Regenerate the OpenAPI artifact with `pnpm --filter web gen:openapi` after changing the contract, resources, limits, examples or problem definitions. Unit tests detect drift. Run `pnpm db:test` and `pnpm --filter web test:e2e` against the local Supabase stack for SQL and HTTP/browser coverage.

The Step 5b migration must be reviewed and applied by the owner before deploying the API. It adds key management and service-role-only API RPCs and reuses the import validators. The application needs `SUPABASE_SECRET_KEY` on the server; only `src/lib/supabase/api.ts` may use it for these data RPCs. Existing browser and wizard operations continue to use the signed-in user's client.

The owner runs `pnpm exec supabase db push` after migration review. For Cloudflare, retain both `API_KEY_LIMITER` and `API_IP_LIMITER` bindings in each Wrangler environment, confirm their namespace IDs are available in the account, and set the Worker secret through the existing deployment process. Run `pnpm --filter web cf:build` to validate packaging before deployment. No hosted migration or deployment is performed by the development checks.

Version 1 changes are additive. Clients should tolerate new response fields and error codes. If an operation is deprecated, its OpenAPI entry and `Deprecation`, optional `Sunset`, and `Link` response headers identify the change. No operations are currently deprecated.
