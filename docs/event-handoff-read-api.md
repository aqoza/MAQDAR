# Event purchase handoff read API (Step 19j)

**Status:** Implemented; review pending. Scope and organization-wide permission approved on 2026-10-18. PR #80 was merged as `72e549a` with all CI checks passing before implementation.

Integrations can discover saved event purchase handoffs and batches and retrieve their original JSON. The selection is the **full event-adjusted quantity and cost**. Baseline quantities, baseline costs and differences are comparison evidence, never additional order lines. Ordinary purchase and transfer packages remain separate.

## Access and endpoints

An owner/admin explicitly chooses **Read event purchase handoffs** in Settings when issuing an expiring key. `event_purchase_handoffs:read` covers its whole organization, including historical packages. Existing keys gain no permission; purchase, transfer, transaction and master-data scopes grant no event access. Every read checks expiry, revocation and the creator's current owner/admin membership.

Send `Authorization: Bearer <key>` from the integration backend. Cookie sessions do not authenticate `/api/v1`. Browser pages and original downloads retain receiving-location restrictions. API readers cannot directly select source tables or the private projection; only two guarded service-role RPCs are exposed.

| Method     | Path                                          | Result                                         |
| ---------- | --------------------------------------------- | ---------------------------------------------- |
| GET / HEAD | `/api/v1/event-purchase-handoffs`             | Saved single-package summaries                 |
| GET / HEAD | `/api/v1/event-purchase-handoffs/{id}`        | Original individual payload and live selection |
| GET / HEAD | `/api/v1/event-purchase-handoff-batches`      | Saved batch summaries and original member IDs  |
| GET / HEAD | `/api/v1/event-purchase-handoff-batches/{id}` | Original batch payload and live selection      |

HEAD performs the same checks and returns no body. OPTIONS describes allowed methods. POST, PUT, PATCH and DELETE return 405; event acknowledgement routes do not exist. Responses are private/no-store and use the common request IDs, rate limits and safe API errors. A missing ID and an ID from another organization both return 404.

Lists accept `limit` (default 25, maximum 100), `cursor` and inclusive RFC 3339 `created_since`. Unknown, repeated or empty parameters are rejected. Details accept no query parameters.

## Evidence and selection

Each list record has `id`, `created_at`, `summary` and `current`. Summary includes saved supplier/location/item codes (item is null for a batch), currency and precision, order date, line count and original `handoff_ids`. `selected_quantity_basis` is `full_event_adjusted`; `subtotal` is the adjusted total, alongside `baseline_subtotal` and `cost_increase`. Decimal strings preserve every saved digit, including trailing currency places. Different line units remain separate. Member IDs can overlap other batches and do not reserve quantities.

Details add `data.payload`, equal in JSON values to the original application download, including complete nested event, forecast, policy, stock, supplier, calendar, price and approval evidence. The API adds an envelope; whitespace and key order can differ. Runtime readers pass through the database JSON text without parsing quantities as JavaScript numbers. OpenAPI describes required nested fields while allowing additional original evidence.

`current.selected` and `current.checked_at` are evaluated separately at request time. A batch is selected only while every original member exists and its proposal remains selected. These fields do not recheck current prices, calendars, timing, stock commitments or external execution. Later approvals and price edits leave payloads unchanged; a batch retains its saved member copies after a source handoff is deleted.

Reads create no orders, reservations, inbound, acknowledgements or planning records. Only normal API-key usage metadata may update.

## Pagination and reconciliation

Rows sort by creation time descending, then UUID ascending. Cursors bind the organization, resource and `created_since`; pass them unchanged with the original filter. Page size may change. Follow `next_cursor` until null.

`as_of` fixes a creation-time upper bound from the first page. It is **not a transaction snapshot or selection-change feed**: late commits and deletions can affect traversal. Poll overlapping creation windows, deduplicate IDs, reconcile periodically and re-read known records for selection changes. These packages provide no exactly-once external execution guarantee.

For example, using an origin and key supplied by your integration's configuration/secret store:

```sh
curl --fail-with-body "$MAQDAR_ORIGIN/api/v1/event-purchase-handoffs?limit=25" \
  -H "Authorization: Bearer $MAQDAR_API_KEY"
```

## Acceptance and verification

- Explicitly scoped keys read only their own organization's records. Prior scopes, expired/revoked keys, lost creator authority, cookie-only requests and direct table access are denied.
- Original payloads and exact comparison totals survive newer selections, price changes and deleted members. Live selection remains separate.
- Tied timestamps paginate deterministically; organization/resource/filter cursor reuse and invalid bounds fail.
- Event acknowledgements and mutations are unavailable. Existing purchase/transfer readers and acknowledgements retain their behavior.
- Settings key creation, keyboard selection and revocation work with the compact green shared typography at 375, 768, 1024, 1440 and 1920px, with Arabic RTL coverage.

Verification uses synthetic loopback fixtures and runs pgTAP, pytest database tests and browser tests sequentially. Local verification completed on 2026-10-18: all 4,411 pgTAP assertions, five API concurrency cases, the non-database engine suite, production build, lint, typecheck, logical utilities and scoped formatting passed. All 1,527 web unit assertions were verified: the full run passed 1,525 with two existing five-second filesystem-scan timeouts; both affected files then passed all 13 tests in isolation with unchanged timeouts. Five production-build Playwright flows passed without retries (event reader, purchase/transfer readers and purchase/transfer acknowledgements). Seven Settings screenshots were visually inspected at the five English widths and Arabic RTL at 375/1440px; no page overflow or clipped new scope label. Manual code/security review found no blocking issues. Hosted rollout was not performed.

## Rollout and rollback

After review, the owner runs `pnpm exec supabase db push` to apply `20261018183653_event_purchase_handoff_read_api.sql`, then deploys the web build. The additive migration extends the scope constraint/create allowlist, adds a private projection and two service-only readers, and changes no existing keys or saved evidence. Constraint replacement uses a five-second lock timeout; retry in a quieter window if it cannot acquire the lock.

Rollback the web build while retaining the additive schema and saved evidence. Revoke newly issued event-reader keys if disabling this capability. Hosted migration/deployment, acknowledgements, ERP transmission and order creation are outside this step.
