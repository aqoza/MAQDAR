# Transfer handoffs (Step 16e)

**Status:** Implemented; review pending. The owner approved this scope on 2026-10-17 after the review of PR #43 (merged as `2f0a331`).

Open a selected approved transfer proposal and choose **Save transfer handoff**. The resulting record offers CSV and JSON downloads, the complete saved freight/date/quantity evidence, and links to its approval and estimate. **Transfer proposal review → Transfer handoffs** searches items and source/destination locations and filters current versus historical selection. The compact green interface supports 375, 768, 1024, 1440 and 1920px, keyboard controls and contained table scrolling.

## Approved rules

Owners, admins and planners create handoffs. Members, including viewers and branch users, inspect and download only with current access to both locations. The request accepts only the proposal identity; approved values cannot be edited during export.

New handoffs require a positive available estimate, the original redistribution draft's currently selected approval, current matching freight/lane/location evidence, and both saved receipt timing-review flags explicitly false. Missing flags fail closed. Changed evidence requires a new estimate and approval. Stock commitments and calendars remain as-of evidence, with the approved quantities, dates and freight fixed.

One immutable handoff exists per proposal. The save shares transfer review's organization lock and rechecks live authority and both endpoints after waiting. Existing retries return the original handoff after later selection or freight changes, without claiming to revalidate its evidence. They still require current editor authority and access. A later approval can have its own handoff and makes the older record historical; it never changes older downloads.

Exports are planning packages. Creating or downloading them does not refresh commitments, reserve stock, create transfer orders or inbound, consolidate shipments, transmit to an external system or guarantee arrival. Separate drafts may propose the same stock. A handoff ID is not an external order ID and does not prevent duplicate external execution. Batches, transmission, acknowledgements and execution require later steps.

## File contract: `transfer-handoff-v1`

JSON contains the stable handoff identity, organization, creation actor/time, approval identity/revision/reasons, original redistribution and estimate references, and the complete saved estimate. Its nested evidence contains both policy/forecast references, destination replenishment draft, source commitments, quantities/units, date scenario, source/destination calendar evidence, separate p50/p90 receipt scenarios, lane terms, freight subtotal and fingerprints. Quantities, rates and costs remain decimal strings. Dates stay date-only; timestamps retain saved instants. The purpose is `planning_only`, with an explicit notice.

JSON uses UTF-8, deterministic field order and a trailing newline. CSV contains one header and one flattened planning line, UTF-8 BOM, CRLF endings and quoted fields. The existing spreadsheet-safe writer prefixes formula-like text with an apostrophe; JSON preserves it verbatim. CSV includes separate typical/slow dates, freight basis/unit/effective date, exact product, rounded subtotal, approval reasons and evidence references. Spreadsheet applications may reinterpret leading-zero codes, numbers and dates: JSON is the lossless format. Neither format is an executable order or an `open_orders` import file.

Versioned snapshot tests pin names, order and encoding, including nested report evidence. Future schema/serializer changes must retain v1 download behavior or introduce a new contract version. Current selection and current freight checks are UI context, excluded from the immutable file. A failed live check is shown as unknown without hiding saved downloads.

## Persistence, access and compatibility

`transfer_handoffs` is additive and RPC-only, with tenant-composite proposal/location references, a unique organization/proposal identity, explicit grants, business audit and two restrictive endpoint read policies. `transfer_handoff_list` uses invoker rights. Source/organization deletion follows the planning chain's existing cascade semantics.

Downloads use the signed-in session and active organization with RLS, private/no-store attachment headers and `nosniff`. Missing or inaccessible records return 404; signed-out requests return 401. API keys and workers gain no permissions. Purchase export formats, REST scopes and import contracts remain unchanged.

## Acceptance and verification

- AC-001: An editor saves a selected compatible positive approval; stale selection/freight, unavailable/zero quantity and unknown/flagged timing fail without an export. Verify local pgTAP, separate-session races and stale browser forms.
- AC-002: Tenant, active-organization and both-endpoint access apply to saving, retrying, history/counts and downloading. Verify pgTAP privileges/RLS, route tests and viewer/branch browser journeys.
- AC-003: Concurrent saves yield one record and audit; later approval/evidence changes preserve the original payload and downloads. Verify independent database sessions and byte-for-byte browser downloads.
- AC-004: JSON retains exact decimals and full evidence; CSV retains approved references and neutralizes formula-like text. Verify versioned snapshots, parsing and actual download bytes.
- AC-005: The five requested widths contain the page and tables, with usable keyboard controls, searchable history and visible current/historical state. Verify Playwright and screenshot inspection.

Local checks passed 1,263 web unit tests, 365 pgTAP assertions across the handoff and tenant/privilege suites, and 10 independent-session database tests. Lint, TypeScript, logical CSS, formatting and the production build passed. The new authenticated browser journey verifies actual file bytes, historical preservation, stale-save rejection, viewer/branch access, keyboard controls and both screens at all five widths; the existing transfer-review journey also passed. Screenshots were inspected and the desktop context/approval panels were compacted. The PR runs the complete repository suites and Linux Cloudflare packaging in CI.

All verification targets synthetic data in the local test stack or CI.

## Rollout and rollback

After review, the owner runs `pnpm exec supabase db push` for `20261017141325_transfer_handoffs.sql`, then deploys the web build. The migration creates an empty table, indexes, one guarded function and one invoker view without rewriting existing data. No worker change is required. This step does not deploy or apply hosted migrations. Rollback restores the earlier web build and retains the additive schema and immutable evidence.
