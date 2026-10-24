# Dealer-return handoff read API

Step 27e exposes saved internal return authorizations through the existing v1 integration API. It does not grant external dealers access or perform physical receiving, credits, reservations, inbound updates or stock movements.

## Contract and access

- An explicit `dealer_return_handoffs:read` key grants access across its organization. Only owners/admins issue keys. Existing keys and other handoff permissions gain no return access. Every read checks the key's expiry/revocation and its creator's current owner/admin membership.
- Detail `data.payload` contains the original saved JSON values, equal to the application download in JSON values. Whitespace/key order may differ. Preserve exact quantity strings, separate declared conditions, requested dates, original references and complete approval evidence. No quantity pooling or inferred eligibility is introduced. Requested dates are not scheduled receipts.
- `data.current.sources_available` and `checked_at` describe current existence of the original sources independently of saved evidence. They do not validate current catalog details, eligibility or stock. Requests have one terminal decision; no new selected/historical lifecycle is inferred. Copied batches remain readable after source-request deletion with `sources_available: false`; their files remain unchanged. Individual handoffs follow their request parent. Existing organization/location cascades remain.
- Lists use bounded creation-based pagination with tenant/resource/filter-bound cursors. Missing and foreign IDs both return 404. No query parameters are accepted on details; unknown, repeated, empty and invalid list parameters fail. Reads cause no business writes; existing key usage metadata may update.
- Only two guarded service-role RPCs can read the private projection. The organization comes from the key; no raw table/view grants are added. Browser cookies do not authenticate this API. Browser pages/downloads retain session membership and both-location RLS.
- Settings presents an unchecked explicit permission, its organization-wide meaning and an English/Arabic badge. Preserve the compact green layout and shared typography at 375, 768, 1024, 1440 and 1920px plus RTL.

## Routes and responses

| Method     | Route                                        | Response                       |
| ---------- | -------------------------------------------- | ------------------------------ |
| GET / HEAD | `/api/v1/dealer-return-handoffs`             | Single authorization summaries |
| GET / HEAD | `/api/v1/dealer-return-handoffs/{id}`        | Original single authorization  |
| GET / HEAD | `/api/v1/dealer-return-handoff-batches`      | Copied batch summaries         |
| GET / HEAD | `/api/v1/dealer-return-handoff-batches/{id}` | Original complete copied batch |

Send `Authorization: Bearer <key>`. HEAD performs the same authorization and queries without a response body; OPTIONS lists supported methods. Package writes return 405; acknowledgement subroutes use the separate Step 27f reporting permission. Existing rate limits, private/no-store responses, request IDs and RFC 9457 errors apply. See [API v1](api.md) and the [generated OpenAPI contract](../apps/web/src/lib/api/openapi.json).

Lists return `data`, `next_cursor` and `as_of`; details return `data`. Records have `id`, `created_at`, `summary`, `current`, and (on details only) `payload`. Summaries contain saved `source_code`, `location_code`, `requested_return_date`, `item_code`, `handoff_count` and original `handoff_ids`. Batch `item_code` is null; inspect each copied line. Overlapping batches can contain the same handoff identities and do not prevent duplicate external processing.

The payload versions remain `dealer-return-handoff-v1` and `dealer-return-batch-v1`. Renamed/deleted items, changed catalog units, inactive endpoints and account deletion never substitute new values into saved summaries or payloads. Deleting an actual endpoint or organization follows the existing cascades.

`limit` defaults to 25 and permits 1–100. `created_since` is an inclusive RFC 3339 timestamp with offset. Pass the opaque `next_cursor` unchanged with the same filter; limit may change. Order is `created_at DESC, id ASC`. The first page fixes a creation-time upper bound in `as_of`; it is not a transaction snapshot or source-change watermark. Late commits/deletions can affect traversal. Reconcile overlapping creation windows, deduplicate identities and reread known records for live source availability.

## Verification and rollout

Run pgTAP `0125_dealer_return_handoff_read_api.test.sql` and the full privilege/tenant suite. Run `test_dealer_return_handoff_api_db.py` for real request/review/export chains, exact evidence, old-scope isolation, current creator authority, pagination boundaries and copied retention. Run database suites and browser tests sequentially against the local stack.

API unit tests cover routing, unchanged response bytes, authorization before invalid-parameter errors, package methods and independent acknowledgement permissions. OpenAPI validates real saved payload fixtures and rejects altered approval/decimal types. The production browser test issues/revokes an actual key in Settings, compares both API payloads with original downloads, checks other tenants/permissions and retained batch reads, and captures every required width in English and Arabic RTL.

Apply `20261024190000_dealer_return_handoff_read_api.sql` after Step 27d and before the matching web deployment. It extends the explicit key allowlist to seventeen scopes without changing existing keys. A five-second lock timeout bounds the constraint update. After review, the owner runs `pnpm exec supabase db push` for the hosted project. Rollback disables the new callers and revokes return reader keys while retaining additive schema and saved files.

Acknowledgements, an external dealer portal, credits and physical receiving are separate increments.

### Local verification — 2026-10-24

- All 127 pgTAP files / 7,639 assertions were exercised. The only failure was the expected-function privilege inventory; after listing the two new service-only readers, that suite and the new API suite passed all 61 assertions. All other suites passed in the complete run.
- All 28 new database integration tests passed, covering real return/review/export chains, legacy scopes, current creator authority, exact quantities, pagination and copied retention.
- All 2,299 web unit tests, 498 engine non-database tests and 13 simulation-worker tests passed. Lint, typecheck, formatting, logical CSS checks and the production web build passed.
- The new production browser flow and four existing API/regional-read flows passed. Inspected Settings at all five widths in English and Arabic RTL, including keyboard permission selection, issuance/revocation and retained downloads after source deletion.
- A deliberate broad-scope substitution failed both resource authorization tests. The original implementation was restored and the full web unit suite then passed.

The complete Python database and browser suites remain CI checks for this PR. Local Cloudflare packaging rebuilt Next.js successfully but Windows denied OpenNext's middleware symlink with `EPERM`; Linux CI remains the packaging gate. No hosted migration or deployment was performed.

Step 27f adds separately scoped acknowledgement subresources; package GET/HEAD remain read-only. See [dealer-return acknowledgements](dealer-return-acknowledgements.md).
