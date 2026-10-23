# Supplier batch publications — Step 26b

Approved 2026-10-23. Open an ordinary purchase batch and choose **Share supplier batch summary**. An editor previews all lines and explicitly confirms publication. Supplier accounts use the separate organization/supplier grants introduced in Step 26; no staff membership or raw batch access is granted.

## Publication contract

A complete saved batch contains 1–50 handoffs. First publication requires every original member to remain visible, selected, positive, free of the saved policy-recalculation flag, and price-valid under the existing publication checks. Copied member evidence must match each original payload. All checks use one statement snapshot after the purchase-review lock; current role and location authority are rechecked after waits. A changed preview or any invalid member prevents the entire publication.

The versioned `supplier-batch-proposal-v1` summary contains only purpose, saved supplier/receiving codes, order date, currency, exact saved subtotal and ordered supplier-facing line summaries. Each line uses the original 12-field `supplier-proposal-v1` allowlist. Quantities, units and receipt dates remain separate. The total is the saved sum of rounded line subtotals, without new rounding or price calculation. Internal handoff IDs, approval reasons, forecasts, policies, stock and commitments never enter the summary.

## Access and lifecycle

One immutable publication per batch. Retries require current editor and batch-location access; they return the original publication after later evidence changes or member deletion and never reverse withdrawal. Publishing a batch creates no individual-handoff publication. Editors may withdraw it; owner/admin grant revocation and inactive suppliers block subsequent supplier requests. Changed values require a new batch/publication.

`supplier_portal_publications` is the bounded supplier feed for both package kinds. It verifies the current accepted grant and confirmed account on every request. Detail reads use the same function. Only currently visible publications for that exact organization/supplier contribute to overlap counts and links; at most 25 links are returned with an exact count. Neither unpublished nor withdrawn packages are disclosed. Overlap follows original handoff identity, not similar item codes. The original single-handoff reader remains compatible.

Batch copies survive deletion of a member handoff. Individual publications follow their handoff's cascade; the batch publication follows its actual batch, organization and location deletion rules. A deleted supplier removes its access grants, while the internal copied publication remains with its batch. Direct application writes are denied; guarded mutations produce audit history. No supplier acceptance, reservations, purchase orders, inbound or external transmission occurs.

## Acceptance and rollout

- All-or-nothing validation, current authority, tenant/location/grant isolation, exact allowlisting and 50-line bounds: pgTAP plus independent-session database tests.
- Preview/publish/read, separate individual and batch overlap, retained copy, withdrawal and revocation: production Playwright; all five widths in English and Arabic RTL with shared typography.
- Strict runtime schemas, existing invitation/single-publication compatibility, lint/type/format and production build checks.

Migration `20261023170000_supplier_batch_publications.sql` is additive. Owner applies hosted migrations before deploying; this task uses only an isolated local database. Roll back the web build and withdraw publications/revoke grants if needed; retain additive tables and audit evidence. No hosted publication or supplier invitation is sent during development.

## Verification results

- All 115 pgTAP files were validated across the full run and targeted repairs. The first run passed the existing invitation stress case but hit missing local JSON fixtures in three older files and a teardown constraint in the new test; those four files passed after the local setup/teardown corrections. The final targeted run includes all-member/header consistency, exact totals, the 50-line statement budget, authority/grant isolation, immutable retries, overlap, withdrawal and parent deletion.
- All 13 independent-session supplier publication tests passed, including concurrent creation and post-wait price, selection, role, membership and source changes.
- All 204 web unit files / 2,214 tests passed after rebasing onto the merged Planner Action Centre changes. Format, lint, workspace types, RTL utility checks and the final production build passed.
- Both production Playwright workflows passed (new batches and existing supplier invitations/publication). Inspected the 30 new publication/list/detail screenshots at 375, 768, 1024, 1440 and 1920px in English and Arabic; title/value typography and page overflow assertions passed. Existing single-publication coverage also retained its 40 screenshots and keyboard navigation checks.

CI retains screenshots through the existing `supplier-portal-visuals` artifact. The Supabase job limit increases from 60 to 90 minutes after PR #152 completed every substantive check but timed out in cleanup; no suite or assertion is removed. No runtime database setting is changed.
