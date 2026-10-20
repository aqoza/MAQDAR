# Network package acknowledgements — Step 22h

API clients can append `received` or `rejected` reports to one complete network
handoff or copied batch. Reports describe the external system's statement about
that package; they do not establish branch acceptance, transmit anything, reserve
stock, create transfers, change inbound or alter the original approved evidence.

## Permissions and endpoints

Owners/admins explicitly issue the organization-wide `network_handoffs:acknowledge`
permission. Existing keys and purchase, transfer, event and disposition scopes gain
no network report access. `network_handoffs:read` is required for history; neither
permission implies the other. Expiry, revocation and the creator's current
owner/admin membership are checked for every request, including retries and again
after event/parent lock waits.

For each resource `network-handoffs` and `network-handoff-batches`:

| Endpoint                                                      | Permission                     | Result                           |
| ------------------------------------------------------------- | ------------------------------ | -------------------------------- |
| `POST /api/v1/{resource}/{id}/acknowledgements`               | `network_handoffs:acknowledge` | 201 created; 200 identical retry |
| `GET/HEAD /api/v1/{resource}/{id}/acknowledgements`           | `network_handoffs:read`        | Paginated history                |
| `GET/HEAD /api/v1/{resource}/{id}/acknowledgements/{eventId}` | `network_handoffs:read`        | One parent-bound report          |

The JSON body is limited to 8 KiB and accepts only `client_event_id` (UUID),
`external_system` (1–80 characters), `external_reference` (1–200), `status`
(`received`/`rejected`) and optional nullable `reason` (1–1000). Text must be
nonblank and control-free. Rejections require a reason. Exact system/reference
text is preserved; omitted and null reasons have the same retry meaning.

The client UUID identifies one event across the organization's network reports,
including both resource kinds and rotated API keys. Identical retries return the
original ID, attribution and server recording time with `replayed: true`.
Different target/content using that UUID returns 409. Creation and retry responses
include a readable `Location`. Missing/foreign packages or events return 404;
events have no update/delete routes. Cookies are not API credentials.

History defaults to 25 rows (maximum 100), ordered by server `recorded_at`
descending then UUID ascending. Only `limit` and `cursor` are accepted. Cursors
bind tenant, resource and parent; their creation-time upper bound is not a
transactional snapshot. Clients should overlap traversal and deduplicate by event
ID when reconciling concurrent commits/deletions. All responses are no-store, use
request IDs and existing rate limits/problem responses. OpenAPI documents all routes.

## Evidence, access and lifecycle

Reports are append-only through guarded service RPCs, with no direct API-role
writes. Browser history uses the existing shared compact component and 20-row
pagination, with access to the warehouse and **every included branch**, including
zero allocations. Counts are subject to the same RLS. API keys are deliberately
organization-wide, independent of browser branch assignments.

Historical handoffs and copied batches with unavailable live source context remain
eligible. A report applies to the whole package, never to individual branches,
member handoffs or overlapping batches. Absence of a report is not failed delivery.
Original CSV/JSON and currency-separated freight totals remain unchanged.

The event records its actual parent and captured required-location set. Single
reports cascade with their handoff; copied-batch reports survive deletion of source
handoffs and follow the copied batch's organization/location cascades. Insert and
cascade-delete audits remain. Key deletion does not erase original key attribution.

## Verification and rollout

The database suite checks scopes, tenants, all-location RLS, strict validation,
pagination, retries and parent/audit cascades. Committed-session tests cover
concurrent UUID reuse across key rotation and authority changes during event and
parent lock waits. Browser tests exercise real planning/review/export inputs,
HTTP contracts, hidden zero-branch history, immutable downloads, pagination,
retained batches and the compact green design at 375, 768, 1024, 1440 and 1920px
in English and Arabic RTL.

After review, the owner applies `pnpm exec supabase db push` for
`20261021010000_network_handoff_acknowledgements.sql` before deploying callers.
No hosted migration or deployment is part of this PR. Roll back callers and revoke
reporter keys if needed; retain the additive schema and original evidence.
