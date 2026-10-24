# Event supplier responses — Step 26g

Approved 2026-10-24. Current granted suppliers may record **Received** or **Declined** for one published event handoff or event batch. Received confirms receipt only; neither response accepts an order or commits supply. The full adjusted selection stays fixed. Baseline comparisons, event assumptions and internal planning evidence remain private.

## Contract and access

`public.supplier_event_responses` is independent of ordinary supplier responses. Each row belongs to exactly one actual event publication, with organization, supplier and receiving-location identities copied from that parent. Public submit/history functions resolve the parent under a current accepted organization/supplier grant, confirmed account, active supplier and nonwithdrawn publication. Supplier-only accounts receive no organization membership or direct table access. Internal readers require current organization and receiving-location access, including read-only members.

Reports are append-only: capture account ID/email, server timestamp, serialized publication revision, status, optional reference (120 characters), comment/reason (2,000 characters) and client request UUID. Declined requires a nonblank reason. The request identity is organization/account/UUID across event publications and grants; another account and the ordinary response family have independent namespaces. Identical retries return the original event and attribution; conflicting reuse fails. Retry authorization is checked before returning any prior result.

Submit locks the request identity, then current grant/account/supplier authority and the actual publication. It rechecks each locked row so a committed revocation, unconfirmation, supplier deactivation, withdrawal or deletion cannot slip through a waiting write. The publication row serializes new revisions across authors. Latest means the highest recorded revision for that exact publication, independent of pagination or client clocks. History returns an explicit allowlist in pages of 25; no response means absent evidence.

Batch responses do not report member handoffs, overlapping batches or ordinary publications. Current colleagues with the same supplier scope can inspect captured author/reference/reason history. Supplier text renders as text, never HTML. Revocation or withdrawal removes subsequent supplier reads/writes while preserving internal history. Account/grant deletion preserves author evidence. Responses follow their actual publication's deletion rules: copied-batch responses survive member-handoff deletion, but deletion of the actual batch or receiving location cascades. No approval, stock, inbound, reservation or order is changed.

## Interface and verification

Reuse the shared response form/history, exact event-only server action and bounded history schema. Internal event handoff/batch publication pages show history, including after withdrawal; external event details allow responses and show the latest author plus all earlier events. Existing ordinary endpoints, summaries, response workbench and histories retain their contracts.

- AC-001: Both actual parent kinds accept valid reports, require decline reasons, preserve exact retries and reject conflicts. Verify pgTAP, server-action tests and production browser flows.
- AC-002: Current grant/account/supplier/withdrawal, tenant and receiving-location boundaries hold on reads, writes and retries. Verify pgTAP and independent-connection lock races for both kinds.
- AC-003: Reports remain independent, immutable and audited; latest is serialized; copied history survives member deletion and follows actual-parent cascades. Verify database and browser tests, including safe literal supplier text and absence of operational changes.
- AC-004: Shared compact green screens, type roles, keyboard form use and no document overflow at 375, 768, 1024, 1440 and 1920px in English and Arabic RTL. Retain and inspect screenshots for supplier and internal history, both package kinds.

## Local verification — 2026-10-24

- Full pgTAP: 121 files, 7,324 assertions passed, including the 66-assertion event response contract and explicit table/function privilege inventory.
- New event and existing ordinary independent-session response tests: 42 passed, covering concurrent retries, serialized revisions and authority changes while waiting.
- Full web unit suite: 209 files, 2,250 tests passed; engine non-database suite: 498 passed.
- Format, lint, typecheck, logical utilities and production Next build passed.
- Production Playwright: all four event response, individual event publication, event batch publication and ordinary response flows passed on the first attempt. The new flow includes keyboard submission, required decline reason, literal supplier text, pagination, viewer/branch restrictions, retained copied history and withdrawal/revocation.
- Captured 40 new response screenshots across supplier/internal single/batch surfaces at all five widths in both locales. Inspected representative captures covering every width and both directions; shared type roles, readable wrapping and container-only table scrolling were preserved.

## Rollout

Apply additive migration `20261024060000_supplier_event_responses.sql` before deploying the new response controls. Roll back by hiding these controls and retaining additive response/audit history. Local verification uses only the task-owned loopback stack; no real supplier messages, hosted migration or deployment are part of this step.
