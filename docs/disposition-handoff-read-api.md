# Disposition handoff read API (Step 20e)

Approved on 2026-10-19. Integrations can list saved disposition handoffs and batches and retrieve their original JSON. This completes the read-only integration step after PR #94. It adds no acknowledgement, transmission, return, scrap, reservation, write-off or stock-movement operation.

## Acceptance and access

- AC-001: explicit `excess_disposition_handoffs:read` keys access their whole organization. Only current owners/admins issue keys. Existing keys, ordinary purchase, transfer and event permissions grant no disposition access; expiry, revocation and current creator-role checks remain enforced on every read.
- AC-002: detail `data.payload` equals the original application JSON download in JSON values. Complete copied evidence and decimal strings, including trailing zeros, remain unchanged. JSON whitespace and key order may differ. Do not parse quantities/reference values into floating-point numbers or round them to currency precision. Reference inventory values are neither recovery proceeds nor accounting write-offs.
- AC-003: `data.current.selection` and `checked_at` are live context outside the immutable payload. `current` means all original members remain selected; `historical` means at least one has been superseded; `unavailable` means a source is missing. Missing context takes precedence over historical context. This does not recheck stock, as-of validity, supplier eligibility or execution.
- AC-004: lists use bounded cursor traversal, exact organization/resource/filter binding and stable creation ordering. Invalid, empty, repeated or unknown query parameters fail; missing and foreign IDs both return 404.
- AC-005: GET/HEAD are business-read-only. API-key usage metadata may update. No table privileges are added to service/anonymous/worker roles; guarded service-only RPCs explicitly constrain the organization. Browser cookie downloads retain tenant/location RLS. Responses are private/no-store with request IDs, existing rate limits and RFC 9457 errors.
- AC-006: Settings offers the permission unselected by default, with organization-wide access explained. Shared compact green typography remains; test keyboard operation and English/Arabic RTL at 375, 768, 1024, 1440 and 1920px. Existing API families remain compatible.

## Routes and response

| Method     | Route                                             | Response                                       |
| ---------- | ------------------------------------------------- | ---------------------------------------------- |
| GET / HEAD | `/api/v1/excess-disposition-handoffs`             | Saved handoff summaries and live context       |
| GET / HEAD | `/api/v1/excess-disposition-handoffs/{id}`        | Original single payload and live context       |
| GET / HEAD | `/api/v1/excess-disposition-handoff-batches`      | Saved batch summaries and live context         |
| GET / HEAD | `/api/v1/excess-disposition-handoff-batches/{id}` | Original copied batch payload and live context |

Use `Authorization: Bearer <key>` from Settings. Cookie sessions do not authenticate these routes. HEAD performs the same checks and returns no body. OPTIONS returns the allowed methods; mutations return 405 and acknowledgement subroutes return 404. [Generated OpenAPI](../apps/web/src/lib/api/openapi.json) describes all required fields.

List responses contain `data`, `next_cursor` and `as_of`; detail responses contain `data`. Every record has `id`, `created_at`, `summary` and `current`; only details include `payload`. Summaries contain saved location code, disposition kind, currency, cutoff, exact `reference_value`, `line_count`, original `handoff_ids`, and `item_code` (null for batches). There is no pooled quantity or unit. Inspect each saved line for its approved quantity and unit. Overlapping batches may repeat original member IDs and do not reserve quantities or prevent duplicate external execution.

Single payloads use `excess-disposition-handoff-v1`; batches use `excess-disposition-handoff-batch-v1`. Neither contract changes. A single handoff cascades when its source proposal/assessment is deleted and then returns 404. Copied batches remain listable/readable with unavailable live context and original member IDs. Organization/location deletion retains existing cascades.

## Pagination and reconciliation

`limit` defaults to 25, range 1–100. `created_since` is an inclusive RFC 3339 creation timestamp with offset. Pass `next_cursor` unchanged with the same filter; limit may change. Ordering is `created_at DESC, id ASC`; a null next cursor ends traversal. Cursors cannot be reused for another organization, resource or filter.

The first page fixes `as_of` as a creation-time upper bound, **not a transaction snapshot or selection-change watermark**. Late commits and deletions can affect traversal. Reconcile overlapping creation windows and deduplicate by ID; re-read known IDs for live selection. Silence is not delivery failure. These routes offer no external delivery report.

## Verification

- `supabase/tests/0077_disposition_handoff_read_api.test.sql`: real assessment/review/handoff/batch RPC fixtures; scoped issuance, expiry/revocation/creator authority, legacy scope isolation, tenant/branch isolation, cursor ties/bounds, exact payload equality, selection transitions, deletion retention and no operational writes.
- `supabase/tests/0020_table_privileges.test.sql`: exhaustive grants, with only two additional service-role RPCs; projection remains private.
- API auth/handler/OpenAPI tests: distinct routing, raw response preservation, HEAD/OPTIONS/mutations, required scope before malformed-request errors, complete versioned schemas and no acknowledgement capability.
- `apps/web/e2e/disposition-handoff-read-api.spec.ts`: real Settings issuance/revocation, all five widths and RTL, keyboard toggles, authenticated HTTP list/detail traversal, cookie-download equality, explicit legacy denial, tenant isolation and saved context lifecycle. Existing purchase/transfer/event reader suites cover compatibility.
- Run database suites sequentially before production browser suites on the local stack. Do not reset shared data. Record actual completed checks in the PR.

## Rollout and rollback

Migration `20261019080000_excess_disposition_handoff_read_api.sql` is additive: extends the scope constraint/issuance allowlist to eleven permissions, adds a private projection and two guarded readers. No keys or saved records are backfilled. A five-second lock timeout limits the existing API-key constraint update; retry in a maintenance window if busy. No production-scale migration load test is claimed.

After review, the owner applies `pnpm exec supabase db push`, then deploys the matching web build. Create a new explicitly scoped key and confirm same-tenant data, foreign-ID 404, and retained unavailable batch evidence. Existing keys remain unchanged.

Rollback removes/disables new web entry points and revokes newly issued reader keys while retaining the additive schema and saved evidence. No destructive down migration. Hosted migration/deployment is separate from this PR.
