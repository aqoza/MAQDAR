# Event purchase handoff acknowledgements (Step 19k)

Status: merged in PR #83 as `60aea87` on 2026-10-19 (Asia/Dubai), after review without blocking findings and all three CI jobs passing. Approved by the owner on 2026-10-18 after PR #81 was reviewed and merged as `4ed941c` with all three CI jobs passing.

## Contract and acceptance

- AC-001: A valid key with explicit organization-wide `event_purchase_handoffs:acknowledge` can append received/rejected reports to an existing event handoff or batch in its organization. Rejection requires a reason. Verify with SQL and HTTP tests; reports must not change quantities, costs, baseline comparisons, event assumptions, selection, stock or inbound.
- AC-002: Only owners/admins issue the new scope. Existing keys, ordinary purchase and transfer scopes gain no event access. Reads require `event_purchase_handoffs:read`. Expiry, revocation and current creator authority apply on every request, including after waiting for a retry lock. Verify tenant, role, scope and direct-write denial plus concurrent authority changes.
- AC-003: A client event UUID identifies one request across the organization's event purchase reports, including key rotation. Identical normalized retries return the original event; different contents or target return 409 without mutation. Ordinary purchase and transfer report identities remain independent. Verify concurrent identical/conflicting submissions and one audit insertion per original report.
- AC-004: Historical packages accept reports without current selection or pricing checks. Batch reports stay on that exact batch and do not update member handoffs or overlapping batches. Verify unchanged JSON/CSV and independent histories after later approvals and price changes.
- AC-005: Members with receiving-location access can inspect paginated history on event handoff and batch detail pages. Use shared compact green typography, escaped supplied text and expandable attribution. Verify keyboard controls, RTL, and 375, 768, 1024, 1440 and 1920px layouts without page overflow.
- AC-006: GET/HEAD list and detail routes use the event read scope, bounded pagination and organization/resource/parent-bound cursors. Preserve original package read/download contracts. Verify generated OpenAPI, handler dispatch and database traversal.
- AC-007: API/member roles cannot update or delete reports. Existing parent, organization and receiving-location deletion cascades still apply and are audited. Key IDs remain attribution after key deletion; no credentials are stored in reports. Verify privileges and deletion lifecycle.

## Meaning and lifecycle

These are statements supplied by an API key holder. `external_system` is a caller-supplied label, not a separately authenticated system identity. “Received” or “rejected” does not verify acceptance, prove that transmission happened, or mean a purchase order exists. `recorded_at` is ZeeSpare's server recording time, not an externally asserted event time. No single delivery status is inferred across different systems.

A report concerns the complete saved package, including its full event-adjusted selection. Baseline quantities and costs remain comparison evidence. Reports never select a proposal, refresh commitments, recalculate a policy, transmit a package, reserve stock, create an order or update inbound. Individual, batch and overlapping-batch histories remain independent.

Reports are append-only through application and integration roles. New client UUIDs record later reports; old records cannot be edited. Parent package, organization and receiving-location deletion follows existing cascading retention. The existing audit trail records cascaded changes. Deleting a key does not remove its report attribution.

## API

Resources: `event-purchase-handoffs` and `event-purchase-handoff-batches`.

- `POST /api/v1/{resource}/{id}/acknowledgements`: requires `event_purchase_handoffs:acknowledge`.
- `GET`/`HEAD /api/v1/{resource}/{id}/acknowledgements`: requires `event_purchase_handoffs:read`.
- `GET`/`HEAD /api/v1/{resource}/{id}/acknowledgements/{eventId}`: requires the same read scope and binds the event to that exact package.

Use the existing Bearer key header and JSON content type. Browser cookies do not authenticate these routes. Write-only keys cannot read history; read-only keys cannot append reports.

POST fields are `client_event_id` (UUID), `external_system` (1–80 characters), `external_reference` (1–200), `status` (`received` or `rejected`) and optional `reason` (null or 1–1,000 characters; required for rejection). Text must be nonblank and contain no control characters. Unknown fields are refused; the body cap is 8 KiB. UUID case is normalized; omitted/null reasons are equivalent. Other text is preserved exactly.

```json
{
  "client_event_id": "99700000-0000-4000-8000-000000000001",
  "external_system": "Example ERP",
  "external_reference": "EVENT-IMPORT-000123",
  "status": "rejected",
  "reason": "The item code has no mapping in the receiving system."
}
```

First creation returns 201 with `{ "data": { ...event }, "replayed": false }` and a relative `Location` header. An identical retry returns 200 with the original event, time and reporting-key attribution, including after key rotation. Conflicting UUID reuse returns 409. Use a new UUID for a later report, not for retrying an uncertain response.

List pages default to 25 and allow at most 100. Records sort by newest server recording time, then UUID ascending. Pass `next_cursor` unchanged until null. The cursor is tied to organization, resource, parent and the first page's time bound; concurrent commits/deletions can still affect traversal. It is not a transactional snapshot or exactly-once delivery guarantee. Reconcile with overlap and deduplicate by recorded event ID. Only `limit` and `cursor` are accepted; detail and POST routes accept no query parameters.

Missing and other-organization package/event IDs return 404. Existing request limits, safe problem responses, private/no-store responses and redacted logging apply. Acknowledgements do not consume the import upsert ledger or its daily write quota. Full endpoint schemas are in the generated OpenAPI document.

## Implementation and rollout

`20261018191730_event_purchase_handoff_acknowledgements.sql` adds the event-specific RLS table, private helpers and two service-only RPCs. Browser reads retain organization and receiving-location restrictions; integration access is explicitly organization-wide. Writers check key authority before waiting on the event identity lock and again afterward, then record usage, so a revocation can commit while a retry waits. Parent existence is rechecked after the wait.

After review, the owner applies migrations with `pnpm exec supabase db push` before deploying the web build. No worker changes, external credentials or outbound transport are needed. Roll back by restoring the prior web build and retaining the additive table and evidence; revoke acknowledgement keys to disable writes. Development fixtures and verification target loopback Supabase only.

## Verification

- Complete pgTAP suite: 4,497 assertions in 72 files, including 79 new event-report assertions.
- Database concurrency: 35 passing tests across event, purchase and transfer acknowledgements and API regressions, including 16 new event cases. Tests cover rotated-key retries, conflicting requests and revocation, expiry, creator-role changes and parent deletion while a writer waits.
- Web unit suite: 1,541 passing tests in 132 files. OpenAPI generation and all 15 contract tests pass; generated types remain current.
- Python non-database suite: 301 passing local tests, including seven unrelated local ACME tests that are not part of this change. A workspace temporary directory avoids an existing Windows shared-temp permission error.
- Lint, logical utilities, TypeScript, scoped formatting and production build pass. The branch includes PR #82's download-link changes and the combined production build passes.
- Eight targeted browser workflows pass across the two final test groups: five existing event/purchase/transfer read and acknowledgement regressions, plus the corrected event acknowledgement workflow and both event repeated-download flows against the rebased production build. The first event run exposed a test-only locale reset issue after all 12 layout captures; reloading and asserting LTR before English navigation fixes it. The corrected workflow passes with retries disabled, including key revocation.
- All 12 history captures were visually inspected: individual and batch views at 375, 768, 1024, 1440 and 1920px, plus RTL batch views at 375 and 1440px. Long references wrap, rejection text is escaped, and mobile controls retain 44px targets with no page-level overflow.
- Manual code/security review found no blocking issues. No independent agent review or automated security scanner was run. Hosted migrations and deployment were not performed.

Step 19l adds the member-facing [event integration workbench](event-integration-workbench.md).
