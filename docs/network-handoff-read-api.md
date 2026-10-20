# Network handoff read API (Step 22g)

Approved on 2026-10-20, following merged PR #120. Integrations can list saved network handoffs and copied batches and retrieve their original JSON.

## Acceptance and access

- **AC-001:** only an explicit `network_handoffs:read` key grants organization-wide network package access. Owners/admins issue keys. Existing keys and purchase, transfer, event and disposition permissions gain no network access. Every read checks expiry, revocation and the creator's current owner/admin membership.
- **AC-002:** detail `data.payload` equals the original application JSON download in JSON values. Preserve every branch, including zero-transfer context, exact decimal strings, saved dispatch/p50/p90 dates, original shipment fees, currency-separated freight totals and complete approval/allocation evidence. JSON whitespace and key order may differ. Do not pool item quantities, convert currencies or refresh commitments.
- **AC-003:** `data.current.selection` and `checked_at` are separate live context. `current` means all members still exist and remain selected; `historical` means at least one is superseded; `unavailable` means source context is missing, taking precedence over historical context. This does not validate current freight, lane settings, stock or execution.
- **AC-004:** use bounded creation-based pagination with organization/resource/filter-bound cursors. Unknown, repeated, empty or invalid parameters fail. Missing and foreign IDs both return 404. Copied batches remain readable after source deletion; original single handoffs retain parent cascades. Organization/location deletion retains existing cascades.
- **AC-005:** GET/HEAD perform no business writes; existing key usage metadata may update. Only guarded service-role RPCs receive access, and they derive organization from the key. Direct table/view access is not granted. Browser cookies do not authenticate this API; browser reads retain warehouse-and-every-branch RLS, including zero branches.
- **AC-006:** Settings offers an unchecked explicit permission with organization-wide access explained. Preserve shared compact green typography, keyboard operation and English/Arabic RTL at 375, 768, 1024, 1440 and 1920px.

## Routes

| Method     | Route                                  | Result                                             |
| ---------- | -------------------------------------- | -------------------------------------------------- |
| GET / HEAD | `/api/v1/network-handoffs`             | Saved single summaries and live context            |
| GET / HEAD | `/api/v1/network-handoffs/{id}`        | Original complete network handoff and live context |
| GET / HEAD | `/api/v1/network-handoff-batches`      | Saved batch summaries and live context             |
| GET / HEAD | `/api/v1/network-handoff-batches/{id}` | Original copied batch and live context             |

Use `Authorization: Bearer <key>` from Settings. HEAD performs the same checks with no body; OPTIONS reports supported methods. Package mutations return 405. Network acknowledgement subroutes are unavailable. Existing request IDs, rate limits, no-store responses and RFC 9457 errors apply; see [API v1](api.md) and [generated OpenAPI](../apps/web/src/lib/api/openapi.json).

List responses contain `data`, `next_cursor` and `as_of`. Details contain `data`. Records contain `id`, `created_at`, `summary` and `current`; only details contain `payload`. Summaries expose saved `source_code`, `dispatch_date`, `handoff_count`, `branch_row_count`, currency-separated `totals` and original `handoff_ids`. `item_code` is null for batches. Inspect each saved handoff's branches for quantities and units. Overlapping batches may contain the same member IDs.

Single payloads retain `network-transfer-handoff-v1`; batches retain `network-handoff-batch-v1`. A deleted single handoff returns 404; copied batches retain their original payload and member IDs with unavailable live context.

## Pagination

`limit` defaults to 25, range 1–100. `created_since` is an inclusive RFC 3339 timestamp with offset. Pass `next_cursor` unchanged with the original filter; limit may change. Ordering is `created_at DESC, id ASC`. A null cursor ends traversal.

The first page fixes a creation-time upper bound in `as_of`. It is not a transaction snapshot or a selection-change watermark: late commits and deletions can affect traversal. Reconcile overlapping creation windows and deduplicate by ID. Re-read known IDs for live selection. These endpoints report no external delivery status.

## Verification and lifecycle

pgTAP checks service-only execution, legacy scope isolation, issuance roles, tenant isolation and browser restrictions. Python database tests exercise real planning/review/export chains, exact files, zero branches, currency totals, invalid credentials, creator demotion, paging ties and retained evidence. API unit tests check routing, untouched response text, malformed-request authorization, methods and acknowledgement absence. Browser tests issue/revoke keys through Settings, compare API payloads with browser downloads, exercise historical/deleted sources and inspect all five widths plus RTL.

Migration `20261020233000_network_handoff_read_api.sql` is additive. It extends the scope allowlist to thirteen permissions and adds a private projection with two guarded readers. Existing keys and saved packages are not backfilled. A five-second lock timeout bounds the API-key constraint update.

After review, the owner applies `pnpm exec supabase db push`, then deploys the matching web build. Rollback disables new callers and revokes new reader keys while retaining the additive schema and saved evidence. Hosted migration/deployment is separate from development validation.

Reading packages creates no acknowledgement, transmission, reservation, transfer order, inbound update or stock movement. It does not prevent duplicate external execution.
