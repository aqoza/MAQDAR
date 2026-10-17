# Purchase handoff acknowledgements (Step 15d)

Status: merged in PR #36 as `6d99f9d` on 2026-10-17 after all three CI jobs passed. The owner approved this scope after PR #35 merged as `d6c04b3` on 2026-10-17.

## Contract and acceptance

- AC-001: A valid key with the explicit organization-wide `purchase_handoffs:acknowledge` permission can append a received/rejected report to an existing single handoff or batch in its organization. A rejection requires a reason. Verify through PostgreSQL and HTTP tests. Reports never create orders, change inbound, approvals, selection or saved export JSON.
- AC-002: Only owners/admins issue keys; old keys gain no permission. Expiry, revocation and creator authority apply to every request, including retries. `purchase_handoffs:read` is required to read history through the API. Verify role, scope, tenant and direct-write denials.
- AC-003: A client event UUID identifies a request across the organization, including across key rotation. An identical normalized request returns the original event; reuse for another target or different contents returns 409. Concurrent identical requests create one event and audit entry. Verify concurrent independent sessions and conflicting retries.
- AC-004: Historical packages accept reports without rechecking selection or price. A batch report belongs only to that package, never its constituent handoffs or overlapping batches. Verify saved payload equality and independent histories after selection changes.
- AC-005: Authorized members inspect paginated history on handoff/batch details within existing organization/location access. Keep the compact green style, keyboard navigation and contained overflow at 375, 768, 1024, 1440 and 1920px. Verify browser workflow and responsive layout.
- AC-006: Document bounded input, list pagination, safe errors and source attribution in OpenAPI. Preserve existing read endpoints and v1 downloads. Run web, PostgreSQL, Python and browser checks against synthetic local data.

## Semantics

Events are reports supplied by the key holder, not independently verified ERP acceptance. `external_system` is a caller-supplied label, not a separately authenticated identity. `received` means the external system reports receiving the package; `rejected` means it reports rejecting the package. Neither status means a purchase order exists. Reports are ordered by server recording time; this is not the time of an external event and no single global delivery state is inferred across systems.

New event UUIDs can record subsequent reports. Existing events cannot be edited or deleted through the API or member privileges. Parent handoff/batch and organization/location deletion follows existing cascading retention; the existing administrator audit trail retains the change record. No outbound transport, webhook, supplier contact, purchase-order creation, inbound update or external credentials are introduced.

## Interface

`GET` and `POST /api/v1/{purchase-handoffs|purchase-handoff-batches}/{id}/acknowledgements`; `GET .../acknowledgements/{eventId}` reads one event. GET/HEAD use the read scope; POST uses the acknowledgement scope. Mutation of existing events is refused. Browser cookies never authenticate the API.

POST fields: `client_event_id` (UUID), `external_system` (1–80 characters), `external_reference` (1–200), `status` (`received` or `rejected`), optional `reason` (null or 1–1,000 characters, required for rejected). Unknown fields, blank text and control characters are rejected. Body cap: 8 KiB. Omitted reason and explicit null are equivalent; UUID letter case is normalized. Other text is preserved exactly. First creation returns 201; an identical retry returns 200 with the original data. Conflict returns 409 without mutation.

Lists default to 25, maximum 100, newest recorded time then UUID ascending, using a resource/organization/parent-bound cursor and a first-page time bound. Like the handoff read API, this is not a transactional snapshot or exactly-once consumption guarantee. Read with overlap and deduplicate by event ID when reconciling concurrent changes.

Example POST body (synthetic identifiers):

```json
{
  "client_event_id": "98000000-0000-4000-8000-000000000001",
  "external_system": "Warehouse ERP",
  "external_reference": "IMPORT-000123",
  "status": "rejected",
  "reason": "Item code is not mapped in the receiving system."
}
```

Send the existing Bearer API-key header and `Content-Type: application/json`. The response is `{ "data": { ...event }, "replayed": false }`; `data` includes the stored event ID, client event ID, reporting key ID, resource/record ID, recorded time and supplied fields. The `Location` header links to that event. Keep the same client event ID and request contents when retrying an uncertain response, even after key rotation. Use a fresh client event ID for a subsequent report. Read history with `?limit=25`, then pass `next_cursor` unchanged until null. A GET detail returns `{ "data": { ...event } }`; a list returns `{ "data": [...], "next_cursor": null, "as_of": "..." }`.

The common per-key/IP request limits and no-store/error/logging rules apply. This endpoint does not use the import write ledger or its per-day upsert quota.

## Rollout and rollback

Apply the additive migration before deploying the web build. Hosted rollout remains owner-run after review. Roll back by restoring the prior web build and retaining the new table and saved evidence; revoke acknowledgement keys to disable writes. All development fixtures and concurrency checks use loopback Supabase only.

The migration `20261017054803_purchase_handoff_acknowledgements.sql` adds the RLS-protected event table and service-only RPCs, expands permitted scopes, and separates API authorization checks from usage bookkeeping. Writers check authority before the event lock and again afterward, then record usage. This avoids holding the key usage row lock while waiting, allowing revocation to commit during a retry wait. Existing API operations retain usage updates and the same scope/role checks; expiry is checked against wall-clock time.

After review, the owner runs `pnpm exec supabase db push`, then deploys the web build. No worker changes or external integration credentials are required. Open a saved handoff or batch to inspect its history; expand Event details for event/client/key identifiers. Reports do not change the original CSV/JSON downloads.

## Verification record (2026-10-17)

- Web: 1,194 unit tests across 91 files; lint, TypeScript, logical CSS, formatting and the production build passed.
- Python: 293 unit tests and 106 database tests passed, including concurrent identical/conflicting events and revocation, expiry, creator-role and parent-deletion changes during lock waits.
- PostgreSQL: the full 47-file, 2,666-assertion run identified one outdated internal-helper count. After correcting that expectation, the key and acknowledgement suites passed all 130 assertions. The new event suite contains 58 assertions covering privileges, tenant/location isolation, strict input, replay, pagination, audit history and unchanged planning evidence.
- Browser: the full suite passed 53 tests, with three opt-in scale tests skipped. The acknowledgement workflow used synthetic local data and covered keyboard disclosure, pagination, escaped supplied text and no page overflow at 375, 768, 1024, 1440 and 1920px. The existing application-wide responsive checks also passed at all five widths. Desktop and mobile screenshots were inspected; event metadata uses 12px text.
- Three import-retention script tests passed. Hosted migrations and deployment were not performed. Linux CI supplies the Cloudflare packaging check.
