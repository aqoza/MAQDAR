# Regional integration workbench — Step 25k

Approved 2026-10-23. Route: `/replenishment/regional-stock/sourcing/integrations`.

## Acceptance rules

- Read-only member workbench for complete regional handoffs and batches. Search saved item/region names, package IDs and latest external references. Filter exact saved region definition, receiver code, included source code, kind, current/historical/unavailable context and received/rejected/no-report status.
- Region names in results link to their exact saved ID filter; the ID field supports copied links. English and Arabic saved names remain searchable after region archive/deletion. No live region join is needed.
- Latest server `recorded_at` per exact external-system label, with ascending event UUID breaking timestamp ties for display only. Determine latest before status/search. Case and spaces remain significant. A selected absent system yields No report, even when other systems reported. Silence never implies failed delivery.
- No propagation between whole packages, individual handoffs or overlapping batches. Source filtering neither implies source acceptance nor changes all-location access. Zero allocations still require location access.
- Live selection is separate from report status. Copied batches retain searchable payloads and reports after source deletion, with unavailable live context. Existing evidence/history routes and original JSON/CSV remain unchanged.
- One invoker-rights RPC queries public RLS-protected packages/views/reports. Both count and bounded page (25/50/100) share one statement. No new scope, writes or operational changes. Anonymous, foreign organizations and incomplete location access remain excluded.
- Shared compact green header, collapsed cross-workbench navigation and list-only loading boundary, keyboard-accessible disclosures/table scrolling, English and Arabic RTL at 375, 768, 1024, 1440 and 1920px.

## Validation

Database tests cover report selection, ties, exact labels, missing reports, filtering, pagination, all-location/tenant/role boundaries, retained evidence and unchanged operational state. Browser coverage uses real guarded fixture creation and reports, follows evidence links, checks selection changes, archive/deletion, copied downloads, keyboard access and screenshots at all ten locale/width combinations. Shared unit and existing integration workflows protect other families.

Local verification: 57 new pgTAP assertions and the privilege inventory passed, as did the production build, lint, workspace type checks, 2,196 web unit tests and logical-style/format checks. All six integration browser workflows passed on the final production build. All ten regional locale/width screenshots were inspected. The full local database suite was attempted but older queue/global-count fixtures encountered existing development rows (25 queued jobs, one policy input and existing network reports); those rows were preserved. Clean-stack CI remains the full-suite gate.

## Migration / rollback

`20261023090000_regional_integration_workbench.sql` is additive. Apply migrations before the web release. Roll back the web build while retaining the read-only RPC; no historical rows change. Hosted application is not part of this development step.
