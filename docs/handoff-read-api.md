# Purchase handoff read API (Step 15c)

The owner approved this scope on 2026-10-17 after PR #34 merged as `cfcd83d`.

## Contract

Integrations can list saved purchase handoffs and batches and retrieve their original JSON evidence through `/api/v1/purchase-handoffs` and `/api/v1/purchase-handoff-batches`, with a single-record `/{id}` endpoint for each. Both current and historical records are available. The saved `payload` remains separate from `current.selected` and its `checked_at` timestamp. Selection is context at read time, not an instruction or authorization to place an order. A batch is selected only while every source proposal remains selected and available.

The new `purchase_handoffs:read` permission is explicit and organization-wide. Only owners/admins issue keys; existing keys gain no new scope. Expiry, revocation and the creator's owner/admin membership are checked for every request. Browser sessions cannot authenticate these endpoints. Existing session downloads and branch access remain unchanged.

Lists contain compact summaries and handoff IDs, including a batch's member IDs so consumers can detect overlapping packages. Detail responses add the original saved payload without changing decimal strings, units, dates or evidence. Reading never acknowledges, reserves, transmits or creates an order/inbound. ERP mappings, outbound delivery and execution are outside this step.

## Requests and responses

| Method and path                             | Result                                        |
| ------------------------------------------- | --------------------------------------------- |
| `GET /api/v1/purchase-handoffs`             | Single-handoff summaries                      |
| `GET /api/v1/purchase-handoffs/{id}`        | One handoff with original `data.payload`      |
| `GET /api/v1/purchase-handoff-batches`      | Batch summaries and their original member IDs |
| `GET /api/v1/purchase-handoff-batches/{id}` | One batch with original `data.payload`        |

Send `Authorization: Bearer <key>` from the integration's backend. HEAD authenticates identically and returns no body; OPTIONS describes the allowed methods. POST/PUT/PATCH/DELETE return 405. Invalid UUIDs or query parameters return 400, missing/invalid credentials 401, missing scope 403, and missing or other-organization records 404. Common rate-limit and server errors follow [REST API v1](api.md).

List query example: `/api/v1/purchase-handoffs?limit=25&created_since=2026-10-01T00%3A00%3A00Z`. Pass each `next_cursor` URL-encoded on the next request with the same `created_since`; page size may change. Details accept no query parameters.

Each list row has `id`, `created_at`, `summary` and `current`. The summary contains saved supplier/location/item codes, currency, subtotal as a decimal string, order date, line count and `handoff_ids`. `item_code` is null for batches. The envelope contains `data`, `next_cursor` and `as_of`. Details return `{ "data": { ...row, "payload": ... } }`.

`data.payload` is equal in JSON values to the existing application download, including the versioned schema and exact decimal strings. The API envelope, whitespace and object-key order differ from that download. Current selection does not revalidate price or policy compatibility, indicate dispatch, or prevent duplicate external orders. A deleted batch member makes that batch's current selection false while its saved copy remains readable.

## Acceptance and verification

- GET/HEAD require the explicit scope; other mutation methods are refused. Tenant isolation, expired/revoked keys, lost creator authority and direct RPC access are tested in PostgreSQL and through HTTP.
- Lists use bounded cursor pagination (25 by default, at most 100), newest creation first with UUID tie-breaking, and an optional inclusive `created_since` timestamp. Cursors bind the resource, organization and filter. Unknown/repeated/empty parameters and malformed cursors are rejected.
- `as_of` bounds record creation to the first page; it is not a transaction snapshot or a selection-change feed. Concurrent deletions can remove rows and late commits can appear behind a cursor. Poll with overlap, deduplicate by stable ID and reconcile periodically; re-read individual records for current selection. No deletion feed or exactly-once consumption is claimed.
- Current selection and immutable payload are exercised after later approvals, source deletion and price changes. Overlap remains visible through stable member IDs. API reads leave proposals, handoffs, batches, stock and inbound unchanged (normal key usage metadata may update).
- Preserve common rate limits, no-store responses, safe problem errors and redacted logs. Update Settings, OpenAPI and the integration guide; run lint, typecheck, unit tests, pgTAP, Python tests, production build and the browser suite.

## Rollout

Apply the additive migration before deploying the web build. The migration expands the allowed key scopes and adds a private read view and service-role-only RPCs; it does not grant direct table access or change existing keys or saved evidence. Hosted rollout remains owner-run after PR review. Roll back the web build and retain additive database objects; revoke newly issued integration keys if disabling the capability. No hosted worker or external credentials are needed.

After review, the owner runs `pnpm exec supabase db push` to apply `20261017010115_purchase_handoff_read_api.sql`, then deploys the web build. Verify one scoped key can list and fetch a known record, a legacy key receives 403, and revocation returns 401. The constraint replacement uses a five-second lock timeout; retry during a quieter window if the schema lock cannot be acquired.

## Verification record

Local checks passed formatting, lint, TypeScript, logical CSS, production build, 1,171 Vitest cases, pgTAP across 46 files (including the final 53-case handoff API suite), 293 Python unit tests, 100 Python database tests and three retention-script tests. The browser suite passed 52 cases with three opt-in scale cases skipped, including responsive checks at 375, 768, 1024, 1440 and 1920px. The new browser/HTTP flow used synthetic local evidence to verify Settings key creation, pagination, exact downloaded payload equality, cross-tenant denial, historical selection and revocation.

Local Cloudflare packaging reached bundle generation but Windows refused a required symlink (`EPERM`). Linux CI performs the same packaging check. Hosted migrations and deployment are outside these development checks.
