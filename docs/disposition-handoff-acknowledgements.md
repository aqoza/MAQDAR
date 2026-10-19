# Disposition handoff acknowledgements (Step 20f)

Approved on 2026-10-19, after PR #97 merged. Integration clients can record receipt or rejection reports for saved disposition handoffs and batches. Members with location access can inspect the history beside the original evidence.

## Acceptance and access

- AC-001: `excess_disposition_handoffs:acknowledge` permits reports across the key's organization. Only current owners/admins issue keys; the permission is unchecked by default. Existing keys and ordinary purchase, transfer or event permissions gain no access. Expiry, revocation and current creator role are checked on writes and retries, including after waiting for a lock.
- AC-002: API history requires `excess_disposition_handoffs:read`. Browser members require organization and location access. Service-only RPCs derive the organization from the key; API roles cannot directly insert, update or delete report rows. Private helpers have no API execute grant.
- AC-003: append-only events contain an external system, reference, `received`/`rejected` status, optional reason and client event UUID. Rejections require a reason. Text is preserved exactly; control characters, blank values, unknown fields and oversized bodies fail. System/reference are caller assertions, not independently verified identities.
- AC-004: the client UUID is unique across the organization's disposition reports, including singles, batches and key rotation. Identical normalized retries return the original event, key attribution and recording time; changed target/content returns 409. Concurrent retries create one event and one audit insertion. Other package families have independent identities.
- AC-005: historical packages and retained copied batches with missing source context remain eligible. Reports belong only to their actual parent: no propagation to members or overlapping batches. Source deletion removes single history through existing cascades, while copied-batch reports survive. Deleting the actual batch or its location/organization cascades its reports and preserves existing audit behavior. Key deletion retains attribution.
- AC-006: saved quantities, units, exact reference inventory values and original CSV/JSON remain unchanged. Reports do not verify supplier acceptance, authorize scrap, create returns, reserve quantities, write off inventory or move stock. Silence is not failed delivery; reported receipt is not execution.
- AC-007: shared compact green history and Settings support keyboard use, English and Arabic RTL at 375, 768, 1024, 1440 and 1920px. Repeated methodology stays in expandable help; history includes explicit reported status, server time, reasons and event/key identity.

## HTTP contract

For each resource `excess-disposition-handoffs` and `excess-disposition-handoff-batches`:

| Method     | Route                                                | Required permission                       |
| ---------- | ---------------------------------------------------- | ----------------------------------------- |
| POST       | `/api/v1/{resource}/{id}/acknowledgements`           | `excess_disposition_handoffs:acknowledge` |
| GET / HEAD | `/api/v1/{resource}/{id}/acknowledgements`           | `excess_disposition_handoffs:read`        |
| GET / HEAD | `/api/v1/{resource}/{id}/acknowledgements/{eventId}` | `excess_disposition_handoffs:read`        |

Send a bearer API key and JSON body (8 KiB maximum):

```json
{
  "client_event_id": "24c92663-bb42-4eb1-9d16-33c746c05b40",
  "external_system": "Warehouse ERP",
  "external_reference": "000123",
  "status": "rejected",
  "reason": "Unknown item code"
}
```

First creation returns 201; an identical retry returns 200 with `replayed: true`. Both return `{data, replayed}` and a Location header for the event. UUID letter case is normalized; omitted and null reason are equivalent. Other text is compared exactly. Reuse across another target or with different content returns 409. Missing and foreign parent/event IDs return 404. Existing event mutation methods return 405. Cookie sessions do not authenticate these endpoints.

History defaults to 25 records, maximum 100; only `limit` and `cursor` are allowed. Ordering is server `recorded_at DESC, id ASC`. Cursors bind organization, resource and parent. `as_of` bounds recording time, not a transaction snapshot: late commits and deletion may affect traversal. Reconcile overlapping reads and deduplicate event IDs. All responses are private/no-store with request IDs, existing rate limits and RFC 9457 errors. See [generated OpenAPI](../apps/web/src/lib/api/openapi.json).

## Verification

- pgTAP `0078_disposition_handoff_acknowledgements.test.sql`: real assessment/approval/handoff/batch fixtures, twelve-scope issuance, isolation, validation, cursor boundaries, retries, history RLS, attribution, immutable exports and audited source/parent deletion.
- `engine/tests/test_disposition_handoff_acknowledgements_db.py`: committed-session races for simultaneous retries, conflicting reuse, key rotation, post-wait authorization and actual-parent versus source deletion.
- Web API handler and OpenAPI tests cover the new routes, independent read/write scope, raw response handling, errors and HTTP methods. Existing family tests protect shared behavior.
- `apps/web/e2e/disposition-handoff-acknowledgements.spec.ts`: real key issuance/revocation, HTTP reports/retries, pagination, historical reports, scoped member history, unchanged files, retained batch reports and all five English/RTL widths. The existing disposition read test now verifies empty history and read-only write denial.

Run database suites sequentially against local Supabase without resetting shared data. Record completed checks in the PR; CI validates a fresh migration stack and Cloudflare packaging.

## Rollout and rollback

Migration `20261019123000_excess_disposition_acknowledgements.sql` adds the report table, explicit privileges/RLS/audit, two private helpers and two guarded service RPCs. It extends the key scope allowlist from eleven to twelve without changing existing keys. The API-key constraint update has a five-second lock timeout; new-table indexes need no concurrent build or backfill. No production-scale migration test is claimed.

After review, apply the migration before deploying the matching web build. Create an explicitly scoped key and verify same-tenant reporting, foreign-ID rejection and retained batch history. Hosted rollout is separate from this PR. Rollback disables the new callers/revokes new keys while preserving schema and evidence; there is no destructive down migration.
