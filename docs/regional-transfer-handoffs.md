# Regional transfer handoffs — Step 25g

Approved 2026-10-23. Save one selected approved regional proposal as an immutable planning package. CSV/JSON and searchable history preserve every source quantity, its own dispatch and p50/p90 receipt dates, freight, separate currency totals and approval evidence. Zero sources remain explicit no-transfer context. Batching, transmission and execution follow separately.

## Acceptance and evidence

- **AC-001 — Complete export:** an editor saving a selected approval gets one package containing the complete approved estimate and lineage. Quantities and costs remain exact decimal strings, source dates remain distinct, and zero sources have no invented transfer dates or charges. Verify with database equality, serializer snapshots and browser downloads.
- **AC-002 — First-save validation:** reject a nonselected approval, archived/missing original region, inactive locations/lanes, changed leads/freight, or positive-source timing gates not explicitly clear. Share regional review serialization and lock locations, region, lanes and saved parents in the established order. Verify invalid-state and independent-session concurrency tests.
- **AC-003 — Current authority:** only editors create; members need the destination and every source, including zeros, to read/download. Recheck authority after lock waits and on retries. Cross-tenant or hidden records cannot be disclosed. Verify pgTAP, database role/access tests and real browser 404/401 responses.
- **AC-004 — Immutable retry/history:** repeated creation returns the existing handoff under current editor/access authority, even after archive, changed evidence or a later approval. Later approval marks old selection historical without rewriting files. Verify repeated bytes, concurrent retries and archive/history tests.
- **AC-005 — Parent lifecycle:** actual proposal/estimate/sourcing and organization/included-location cascades remove dependent handoffs with retained audit events. Deleting a region definition alone does not erase original evidence. Verify database cascade/audit tests.
- **AC-006 — Usable interface:** shared compact green typography, searchable saved labels, receiving-location and current/historical filters, locally scrolling tables, keyboard controls and English/Arabic RTL at 375, 768, 1024, 1440 and 1920px. Verify production browser tests and inspect screenshots.

## File contract

`regional-transfer-handoff-v1` is distinct from network and individual transfer packages. The database derives the payload; clients supply only organization/proposal identities, and the active session determines authority. JSON retains the captured estimate, source region definition, sourcing, stock/inbound/policy, dates/calendars, freight and independent approval. The pinned v1 fixtures must remain byte-stable in later increments.

CSV has one row per source, a UTF-8 BOM, CRLF rows, quoted fields and spreadsheet-formula neutralization. Each source has its own dispatch and receipt columns. Zero quantities keep blank transfer dates and calculated charges, with recorded lane terms retained as evidence. `package_totals_json` is repeated package metadata and must not be summed across rows. No FX, currency aggregation, fresh stock calculation or quantity rounding occurs on export.

Browser-session downloads: `/api/regional-handoffs/{id}/{json|csv}`, with attachment, private/no-store and no-sniff headers. These routes grant no API-key scope. Unauthenticated downloads return 401; hidden records return 404. Detail pages preserve real HTTP 404 responses.

## Screens and lifecycle

Open Replenishment → Regional stock → Regional transfer review. A selected approved proposal offers **Save regional handoff** to editors. An existing handoff remains linked after later approvals or archive. History lives at `/replenishment/regional-stock/sourcing/handoffs`, searching saved item, region and source/receiving labels. Live selection/current-evidence state is separate from the copied file.

Separate scenarios can propose the same stock. Saving or downloading does not refresh commitments, reserve stock, create transfer orders, update inbound, move stock or guarantee arrivals. Existing inbound warnings remain part of saved evidence.

## Rollout and verification

Apply additive migration `20261023010000_regional_handoffs.sql` before deploying routes. Hosted migration/deployment is separate; a web rollback retains saved handoff tables and evidence. No backfill, destructive migration or operational writes.

Coverage: `0108_regional_handoffs.test.sql`, `test_regional_handoffs_db.py`, serializer/route/action tests and `regional-handoffs.spec.ts`, shared tenant/ACL invariants, lint/typecheck/full unit suite, production build and CI. Synthetic fixtures use local Postgres; tests neither reset shared databases nor clear queues.
