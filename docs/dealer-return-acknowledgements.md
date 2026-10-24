# Dealer-return acknowledgement reports (Step 27f)

API clients can report `received` or `rejected` for one complete saved dealer-return
handoff or batch. Received means the external system reports receipt of the package;
it does not confirm physical receipt, return eligibility, a credit or a stock movement.
Members with access to both locations can inspect the report history beneath the
original authorization evidence. No policy, approval, inbound or reservation changes.

## API contract

Use `dealer-return-handoffs` or `dealer-return-handoff-batches` as `{resource}`.

| Route                                                         | Permission                           | Result                           |
| ------------------------------------------------------------- | ------------------------------------ | -------------------------------- |
| `POST /api/v1/{resource}/{id}/acknowledgements`               | `dealer_return_handoffs:acknowledge` | 201 created; 200 identical retry |
| `GET/HEAD /api/v1/{resource}/{id}/acknowledgements`           | `dealer_return_handoffs:read`        | Bounded report history           |
| `GET/HEAD /api/v1/{resource}/{id}/acknowledgements/{eventId}` | `dealer_return_handoffs:read`        | Exact parent-bound event         |

Only owners/admins issue the new explicit organization-wide permission. Existing
keys and other resource scopes gain no access. Reads and writes independently check
expiry, revocation and the current creator role; reporting does not imply read access.
Cookies cannot authenticate these routes. Events have no update/delete endpoints.

POST accepts at most 8192 bytes, with only `client_event_id` (UUID), `external_system`
(1–80 characters), `external_reference` (1–200), `status` (`received`/`rejected`) and
an optional nullable `reason` (1–1000). Text must be nonblank and control-free.
Rejected requires a reason. Exact text is preserved; absent and null reason are
equivalent. A client UUID is unique across the organization's dealer-return reports,
including single/batch resources and rotated keys. Same target/content returns the
original event, key attribution and server timestamp; conflicting reuse returns 409.
Creation/retry includes the event's `Location` header. Foreign/missing parents and
events return 404. Errors use existing safe problem responses and rate limits.

History accepts only `limit` (1–100, default 25) and `cursor`. Ordering is server
`recorded_at` descending, then event UUID ascending. Cursors bind organization,
resource, parent and a creation-time upper bound. They are not transaction snapshots:
concurrent commits/deletions can affect traversal. Reconcile with overlapping reads
and deduplicate by event ID. Responses are private and no-store; OpenAPI includes
the input, output, scope and error contracts.

## Evidence and lifecycle

The database serializes the organization/client UUID, locks the actual parent and
rechecks key authority after lock waits, including retries. Direct writes are denied
to all API roles. Browser RLS requires membership plus both captured locations for
rows and counts; browser pagination is 20 reports per page.

Reports apply only to their exact parent. Single, batch and overlapping-batch histories
remain independent. Silence means no report, never failed delivery or acceptance.
Copied batches remain reportable after source-request deletion; their saved JSON/CSV
and declared quantities, conditions and requested dates stay unchanged. Single reports
follow request/handoff deletion; batch reports follow the actual batch and its
organization/location cascades. Insert/cascade-delete audits remain. Deleting an API
key does not erase its saved attribution. Requested return dates remain unscheduled.

## Verification and rollout

Run `0126_dealer_return_acknowledgements.test.sql`, the full pgTAP suite,
`test_dealer_return_acknowledgements_db.py` and existing return read API regressions.
Coverage includes independent concurrent retries, key rotation, conflicting UUIDs,
current authority after event/parent lock waits, actual-parent deletion, both-location
RLS, strict inputs, paging and absence of operational writes. API unit/OpenAPI tests
cover safe routing, status codes, Location, HEAD, methods and scope separation.
`dealer-return-acknowledgements.spec.ts` exercises real requests/approvals/handoffs,
reports, retained downloads, pagination, keyboard use and Settings/history at
375/768/1024/1440/1920px in English and Arabic RTL. Keep shared compact green type roles.

Local verification on 2026-10-24 passed: all 128 pgTAP files (7,701 assertions),
105 return/report database regressions, 2,313 web unit tests and 498 non-database
engine tests. Production build, typecheck, lint, formatting and logical CSS checks
passed. Three focused production browser flows passed, including the new return
report flow with retries disabled. Settings and single/batch history screenshots
were inspected at all five widths in English and Arabic RTL. A deliberate removal
of post-parent-lock authorization failed four concurrency tests; the function was
restored before the passing database run. CI remains the Linux packaging gate.

After review, the owner runs `pnpm exec supabase db push` to apply
`20261024200000_dealer_return_acknowledgements.sql` before deploying callers. No
hosted migration/deployment is included. Roll back callers and revoke reporter keys
if needed; retain the additive schema and report history. An integration workbench,
external dealer access, credits and physical receiving remain separate increments.
