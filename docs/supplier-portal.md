# Supplier portal — Step 26

Approved 2026-10-23. One ordinary purchase handoff per explicitly published supplier summary.

## Contract

Owners/admins invite a verified account to a separate organization/supplier grant. Acceptance creates no organization membership. Editors preview and publish selected, currently price-valid handoffs; the supplier sees only item/supplier/receiving codes, exact quantity/unit, order/receipt dates and unit price/currency/subtotal, with a planning-only notice. Internal approval reasons, stock, forecasts, policies, event evidence and other suppliers remain inaccessible.

Summaries are immutable, one per handoff. Retries preserve originals and never undo withdrawal. Editors may withdraw access; owners/admins revoke grants. Both apply on subsequent requests. Old displayed/captured information cannot be recalled. Later prices/selections never silently rewrite a publication; changed values require a new handoff/publication. Source/supplier/location deletion follows handoff cascades. No supplier response, acceptance, order or inbound is recorded.

## Acceptance and verification

- AC-001: Owner/admin invites, verified matching identity accepts, supplier-only account signs in and sees its portal; no membership is added. Test database and real local Auth/Mailpit.
- AC-002: Wrong supplier, tenant, unaccepted/expired/revoked invitation and forged email/token claims reveal no packages. Assert database and browser direct-route boundaries.
- AC-003: An editor previews the exact shared allowlist and confirms publication; stale price, changed selection or fingerprint prevents first publication. Test first save, duplicate and lock-wait authority changes.
- AC-004: Revocation/withdrawal hide data on the next request; retries cannot restore withdrawn access. Internal history remains scoped and immutable. Assert counts and detail reads.
- AC-005: Compact shared headers/typography, keyboard use, local table scrolling and English/Arabic layouts at 375, 768, 1024, 1440 and 1920px. Inspect real production-browser screenshots.

Invitations use the existing Auth email verification/password flow, two-minute resend cooldown, ten sends per invitation and a 100-new-invitations/day organization cap. Pending acceptance expires after seven days; accepted grants remain until revoked. Supplier-only routes use current grants, not JWT organization claims. The existing workspace hostname boundary and optional Arabic setting apply.

Migration is additive and owner-run before deployment. This development step sends no real supplier invitations and performs no hosted changes. Batches, event packages, responses and execution remain separate increments.

## Verification results

Verified locally on a fresh disposable Supabase stack:

- Full pgTAP: 114 files / 6,954 assertions passed, including the new portal contract and tenant/privilege inventory.
- Independent-session database tests: all 7 passed (concurrent publication, post-wait price/selection/role/membership/source changes and invitation revocation).
- Web unit tests: 202 files / 2,202 tests passed, including exact summary allowlisting, callback scope, supplier locale authority and reviewed secret-client import boundaries.
- Production Playwright: all 9 tests passed across the new supplier portal, existing staff invitations and mobile/desktop sidebar regression suites. Real local email links were accepted for both new and existing accounts; a supplier password return visit reached its portal without staff membership.
- Inspected 40 access/publication/list/summary screenshots in English and Arabic at 375, 768, 1024, 1440 and 1920px. No page overflow; shared 16px title typography and keyboard mobile navigation passed. Quantity display removes redundant zeros without changing saved decimal strings.
- Repository format/lint, workspace type checking, RTL logical-utility check and production build passed.

The full SQL suite was isolated from another checkout's newer local schema; no shared database was reset or repaired. No hosted migration or deployment was performed. CI retains the portal screenshots as `supplier-portal-visuals`.
