# Supplier response workbench (Step 26d)

Internal members can open **Replenishment → Supplier responses** to inspect explicitly published ordinary purchase handoffs and batches. The workbench is read-only; supplier grants, portal visibility and response submission rules are unchanged.

## Reporting and search

Each row represents one exact publication. The latest server-serialized response revision is selected before status or text filtering; previous responses remain available through **Summary and history**. Received means receipt only, never acceptance or supply commitment. No response means absent evidence, never inferred delivery failure. Published/withdrawn state is separate from response status.

Filters include exact saved supplier/receiving-location codes, package kind, publication state and latest Received/Declined/No response. Text search uses the existing normalized-token search over saved item/counterparty codes, publication/package IDs and the latest author/reference/reason. It does not search older response events. Location suggestions use up to 100 active RLS-permitted locations; historical codes can be entered manually. Ordering is publication creation descending with kind/UUID tie-breaks; page sizes are 25/50/100 and out-of-range pages redirect to the last page.

## Access and retention

`public.supplier_response_workbench` is a stable security-invoker RPC. It requires a current member and reads publication and response tables under their existing tenant and receiving-location RLS. Supplier grants alone confer no workbench access. Service keys and worker roles have no execute permission. Counts, filters and search operate only on visible rows.

The query reads copied publications without joining current handoffs, suppliers or selection records. Retained batch summaries and response history remain searchable after member-handoff deletion; deleted individual publications disappear. Author evidence survives responding-account deletion. Batch, member and overlapping publications never inherit responses from each other. Actual-parent, organization and location cascades remain unchanged. No new writes, audit events, alerts, acceptance, approvals, reservations, orders or inbound changes occur.

## Delivery and verification

Shared PageHeader, ReplenishmentNav, help disclosure and keyboard-focusable table region retain compact green typography. English and Arabic translations cover all new text. The browser regression checks filtering, keyboard submission, empty/reset states, member-only access, withdrawal, retained evidence and 375/768/1024/1440/1920 widths in both locales.

The additive migration creates one read-only function, no tables or policy changes. Apply through the repository migration workflow after review. Web rollback may leave the function installed for compatibility.

## Validation record

- Full local pgTAP: 118 files / 7,133 assertions passed, including 51 new workbench assertions and the reviewed RPC permission inventory.
- Web: 206 files / 2,221 unit tests passed; the complete rerun used two workers after a filesystem contract timed out during a concurrent build.
- Engine unit suite: 498 passed. Simulation worker: 13 passed.
- Formatting, lint, TypeScript, logical-direction checks and production Next.js build passed.
- Four authenticated local browser flows passed: single publication/invitations, batch publication, supplier responses and the new workbench. The invitation flow passed after aligning the temporary local redirect allowlist with the built localhost origin; no application fix was required. Workbench coverage includes keyboard table scrolling, filters, evidence retention and English/Arabic at 375, 768, 1024, 1440 and 1920px. All ten captured workbench layouts were visually reviewed.

Tests use an isolated local Supabase stack. No hosted migrations, production invitations or deployment are performed by this increment. Linux CI remains the Cloudflare packaging gate.
