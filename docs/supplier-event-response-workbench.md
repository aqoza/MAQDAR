# Event supplier response workbench (Step 26h)

Internal members can open **Replenishment → Event supplier responses** to inspect explicitly published event purchase handoffs and batches. The workbench is read-only. Supplier grants, publication gates and response submission rules are unchanged.

## Reporting and search

Each row represents one exact event publication. Select the latest server-serialized response revision before status or text filtering. Show its captured author, timestamp, reference and decline reason; earlier responses remain accessible through **Summary and history**. Received confirms receipt only, without acceptance or a supply commitment. No response is absent evidence, not inferred delivery failure. Publication withdrawal remains independent of response status.

Filters use exact saved supplier/receiving codes, package kind, published/withdrawn state and latest Received/Declined/No response. Normalized-token search covers saved item/counterparty codes, publication/package IDs and the latest response author/reference/reason. Older responses do not match current-status searches. Up to 100 active permitted locations are suggested; historical codes can be typed. Order by publication creation descending, then kind/UUID, with bounded 25/50/100-row pages and last-page redirects.

## Access and retention

`public.supplier_event_response_workbench` is a stable security-invoker RPC with an empty search path. It requires current organization membership and reads only event publications and responses under existing tenant/receiving-location RLS. Counts and search use the same visible rows. Supplier grants alone confer no internal access; anon, service and worker roles have no execute privilege.

Copied publications are read without joins to current handoffs, supplier records or selection state. Retained event batches remain searchable with their response history after source-handoff deletion; individual publications follow their actual parent's deletion. Original author evidence survives account deletion. Event/ordinary, individual/batch and overlapping histories never propagate responses to one another. No changes to parent/organization/location cascades, audit behavior, approvals, orders, reservations or inbound.

## Interface and delivery

`/replenishment/events/supplier-responses` and the ordinary workbench share a server-rendered presentation and validated result contract. A fixed family configuration selects the separate RPC, navigation, translated context and evidence path; URLs cannot select arbitrary queries. Existing ordinary links and filters remain compatible. Event publication detail pages link back to their workbench. No new loading boundary masks hidden-record 404 responses.

The shared compact green PageHeader, navigation, help disclosure and focusable scroll region retain typography and keyboard access. English/Arabic labels cover the new event context. Browser verification covers 375/768/1024/1440/1920px in both directions, filters, empty/reset states, latest versus earlier history, source deletion and branch access.

The additive migration creates one read-only function, with no tables or policy changes. Apply through the repository migration workflow after review; a web rollback can leave the function installed. No hosted migration, supplier invitation or deployment is performed by this increment.

## Validation

- Full local pgTAP: 122 files / 7,380 assertions passed, including 55 new event-workbench assertions, ordinary/event isolation and the RPC permission inventory.
- A deliberate oldest-response mutation failed eight assertions. The transaction was rolled back and all 55 original workbench assertions passed again.
- Web: 209 files / 2,251 tests passed. The first run identified the shared header wrapper registration; after adding it, the full suite passed. The final header/URL contract checks also passed (8 tests).
- Engine units: 498 passed. Simulation worker: 13 passed.
- Formatting, lint, TypeScript, logical-direction checks and production Next.js build passed.
- Three authenticated production-build browser flows passed on their first attempts: event workbench, event supplier responses, and ordinary workbench. Coverage includes filtering, keyboard submission/scrolling, retained batch evidence, independent histories, current access and hidden-record 404s.
- Event and ordinary workbenches passed layout/title/overflow checks at all five widths in English and Arabic. All ten new event-workbench captures and representative ordinary captures were visually reviewed. Existing response pages also retained their responsive coverage.

All database/browser testing used the isolated local Supabase stack. The original local environment was restored and the stack stopped with its backup retained. Linux CI remains the full browser-suite and Cloudflare packaging gate.
