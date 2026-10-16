# Purchase-proposal review (Step 14)

Open a saved available purchase-cost estimate and submit a reasoned proposal. **Replenishment → Purchase proposal review** searches item codes, filters exact supplier/location codes and proposal status, and pages through decision history. A proposal links to the immutable estimate and original draft; the estimate links through delivery, supplier, policy and forecast evidence.

## Approved workflow

Owners, admins and planners submit. A different owner, admin or approver approves or rejects. The author may withdraw while still a member with source-location access, including after becoming a viewer. Reasons are trimmed and limited to 1–2,000 characters. Available estimates require positive quantity; a zero price remains valid.

There is one pending proposal per **original replenishment draft**, across alternative supplier, delivery and price scenarios. Every proposal has a per-draft revision and one terminal decision. The newest approved revision is selected for that draft; earlier approvals remain historical records. Rejection, withdrawal and a newer pending proposal leave an existing approval selected. The list labels the selected approval separately from proposal status.

Approval records a planning selection only. It does not create an order, reserve stock, count quantities as inbound, contact suppliers or export to an ERP. Selection is scoped to the exact saved draft, not a duplicate-order guard across drafts. Taxes, freight, FX, prepared-group purchasing, automatic approval and execution remain separate increments.

## Price and policy gates

At submission and approval, SQL recomputes `purchase_cost_preview` with confirmed applicability and compares its fingerprint with the saved estimate. This checks the exact current supplier-item row, supplier state, units, unit price, currency precision, valid-from date and captured timestamps. Changed evidence requires a new estimate, even if the rounded subtotal is unchanged. A changed or deleted source cannot silently substitute a new price row. This checks current evidence against the saved quantity/date; it does not reconstruct historical prices or refresh stock, inbound, calendar or policy evidence.

Approval requires saved `policy_recalculation_required` to be explicitly false. True, missing or null blocks approval. Flagged estimates can be submitted, inspected, rejected or withdrawn; submit a compatible replacement scenario for approval. There is no warning bypass or automatic policy recalculation. Unavailable and zero-quantity estimates remain inspectable but cannot be submitted.

Pending pages display current checks; the RPC checks again when approving. Rejection and withdrawal remain available after price changes. Identical retries return the original result after later price edits, subject to current authority and location access; they cannot rewrite history.

## Persistence and access

`purchase_proposals` references immutable estimates, drafts and locations with tenant-composite foreign keys. SQL derives lineage from saved rows. API roles and the worker have no direct write privilege; authenticated members have tenant/branch-scoped reads. `purchase_review_list` uses invoker rights and decimal strings. An organization advisory lock serializes submit/decide operations and request-key checks. Membership, role and scope are rechecked after waiting. Unique indexes enforce one pending proposal per draft and request identities. Each successful transition produces one audit record.

## Verification

pgTAP 0042 covers roles, independent review, tenant/branch isolation, direct-write denial, reasons, request conflicts, pending limits, selected history, stale prices, missing/flagged policy evidence and immutability. Python uses independent sessions for submissions across estimates, competing decisions, retries and price/role/membership changes during lock waits. Web tests cover validation, filters, session-derived organization identity and safe errors. Production Playwright covers independent approval, flagged/stale failures, withdrawal, viewer reads, history filters/pagination and unchanged stock/inbound.

## Owner-run rollout and rollback

After review, the owner runs `pnpm exec supabase db push` for `20261016122453_purchase_review.sql`, then deploys the web build. The migration adds an empty table, its indexes, two RPCs and an invoker view without rewriting source records or changing import/API contracts. No credentials, background job or worker upgrade are needed.

Rollback restores the prior web build while retaining additive database objects and review evidence. This task does not apply hosted migrations or deploy.
