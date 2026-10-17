# Transfer handoff read API (Step 16g)

**Status:** Implemented and locally verified; review pending. The owner approved this scope on 2026-10-17 after PR #48 merged as `bcbff02`.

Integrations can list saved transfer handoffs and batches and retrieve their original JSON evidence. Current selection is reported separately from immutable quantities, units, dispatch and p50/p90 receipt dates, freight charges and approval references. These are planning packages; reading does not reserve stock, refresh commitments, transmit a transfer, acknowledge delivery or create orders/inbound. Shipment consolidation, acknowledgements and execution remain later increments.

## Access

Owners/admins explicitly choose **Read transfer handoffs** when issuing an expiring API key in Settings. The new `transfer_handoffs:read` scope covers the key's whole organization, including both endpoints and historical packages. Existing keys receive no new permission. Purchase permissions do not imply transfer access, and transfer permission does not imply purchase, transaction or master-data access. Every request checks key revocation, expiry and the creator's current owner/admin membership.

Use `Authorization: Bearer <key>` from an integration backend. Browser cookies are not API credentials. Session downloads retain their existing tenant and both-location RLS rules; this migration changes none of those policies. Only the API service runtime can invoke the guarded read RPCs. The service role gains no direct access to the saved tables or private projection, and each RPC derives the organization from the key and filters it explicitly.

## Contract

| Method and path                             | Result                                           |
| ------------------------------------------- | ------------------------------------------------ |
| `GET /api/v1/transfer-handoffs`             | Saved individual-handoff summaries               |
| `GET /api/v1/transfer-handoffs/{id}`        | One summary, original payload and live selection |
| `GET /api/v1/transfer-handoff-batches`      | Saved batch summaries and member IDs             |
| `GET /api/v1/transfer-handoff-batches/{id}` | One batch with complete original line evidence   |

HEAD authenticates identically without a response body. OPTIONS reports allowed methods. POST/PUT/PATCH/DELETE are 405; transfer acknowledgement paths are unavailable. Invalid credentials return 401, missing permission 403, invalid parameters 400, and missing or other-organization IDs 404. Existing API rate limits, safe problem responses, redacted logging and private/no-store behavior apply. See [API v1](api.md) and the generated OpenAPI document.

List parameters are `limit` (default 25, range 1–100), `cursor` and optional inclusive `created_since` (RFC 3339 with offset). Unknown, repeated, empty or invalid parameters are rejected. Detail endpoints accept no query parameters. Lists return `{ data, next_cursor, as_of }`; details return `{ data }`.

Each record contains `id`, `created_at`, `summary` and `current`. The summary contains saved `lane_id`, source/destination identities and codes, `item_code` (null for a batch), currency/precision, exact string subtotal, dispatch date, line count and original `handoff_ids`. Member IDs expose overlap without implying extra demand or reserved quantities. No quantities or different receipt dates are pooled. Batch subtotals retain every line's saved rounded freight charge, including each shipment fee.

Details add `data.payload`, equal in JSON values to the existing application download. Decimal strings, units, date-only fields and original evidence remain unchanged; envelope, whitespace and object-key order can differ. Live `current.selected` and `current.checked_at` remain outside that payload. A batch is selected only while all original members exist and their proposals remain selected. Selection does not recheck current freight, timing, stock availability or external execution. Deleted members make the batch historical while its saved copy stays readable.

## Pagination limits

Order is newest creation first, UUID ascending for ties. Cursors bind the resource, key organization and `created_since`; pass them unchanged with the same filter, though page size may change. `as_of` fixes the first page's creation-time upper bound. It is not a transaction snapshot or selection-change feed: concurrent deletion can remove rows and late commits can appear behind a cursor. Poll overlapping creation windows, deduplicate stable IDs, reconcile periodically and re-read known records for current selection. No deletion feed or exactly-once execution is claimed.

## Acceptance and verification

- AC-001: Given a valid explicitly scoped key, GET/HEAD list or fetch only its organization's saved transfer records. Legacy/purchase keys, expired/revoked keys and lost creator authority are denied; browser endpoint access remains unchanged. Verify pgTAP, handler tests and real HTTP requests.
- AC-002: Given a saved single/batch payload, detail reads preserve its JSON values after later approval, freight changes or source-member deletion. Live selection changes separately. Verify payload equality against application downloads and SQL fixtures.
- AC-003: Given timestamp ties and multiple pages, bounded cursors traverse records in the specified order and reject resource/organization/filter reuse. Verify SQL boundary cases and browser HTTP pagination; document concurrency limits.
- AC-004: Reading and attempted mutation routes leave stock, orders, proposals and saved packages unchanged. Only normal key usage metadata can update. Verify privilege tests, row counts and HTTP method tests.
- AC-005: Settings exposes the new explicit scope with organization-wide wording, and OpenAPI describes all four endpoints, errors, cursor semantics and original versioned payloads. Verify schema snapshots, Settings key creation/revocation and layouts at 375, 768, 1024, 1440 and 1920px.

Fixtures are synthetic and use the local/CI Supabase stack only. Run database suites sequentially. Verification results are recorded in the pull request.

Local verification passed 1,295 web unit tests, all 3,228 pgTAP assertions, lint, typecheck, logical-layout and formatting checks, and the production build. Six Playwright flows cover transfer/purchase reads, purchase acknowledgements and API-key/resource regressions. The transfer flow compares API payloads with original application downloads, tests tenant isolation, historical selection, source deletion and revocation, and captures the Settings scope form at all five widths; screenshots were visually inspected with no page overflow.

## Rollout and rollback

After review, the owner runs `pnpm exec supabase db push` to apply `20261017155410_transfer_handoff_read_api.sql`, then deploys the web build. The additive migration expands the allowed scope set, retains guarded key creation and adds a private projection plus two service-only read RPCs. No saved data or existing key permission is rewritten. The key constraint replacement uses a five-second lock timeout; retry during a quieter window if needed.

Rollback can restore the preceding web build while retaining the additive schema and evidence. Revoke newly issued transfer-reading keys if disabling the capability. Hosted migrations and deployment are outside local development verification.
