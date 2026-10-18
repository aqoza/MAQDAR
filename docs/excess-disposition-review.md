# Excess disposition review — Step 20b

Owner-approved scope, 2026-10-19. From a positive saved excess-assessment line, propose **supplier return** or **scrap**, an explicit quantity and a reason. Review records planning intent only. It does not establish obsolescence, supplier eligibility or live availability, and does not create a return, reservation, write-off, transfer or order.

## Quantity and evidence

The proposed quantity must be positive and no greater than the selected line's saved quantity above maximum, in its saved unit. Quantity input preserves up to 15 integer and three fractional digits; excess precision is rejected rather than rounded. Reference inventory value is exact `quantity × saved snapshot unit cost`, in that snapshot's currency, without currency rounding. It is neither expected supplier proceeds nor an accounting write-off. Quantities and values across proposals are not pooled or automatically summed.

Submission and approval recheck the selected assessment line against `excess_stock_preview`, using the original policy, explicit calculated/approved maximum, cutoff, and latest stock on or before that cutoff. The complete saved line—including policy summary/evidence, override decision and stock identity/version, quantities, units, cost and currency—must still match. A change or missing source requires a new assessment. A correction to another item in the assessment does not invalidate the selected line. Later observations after the original cutoff are not used to claim current availability.

Original assessments and submitted line evidence are never rewritten. Pending proposals with changed evidence remain inspectable and may be rejected or withdrawn. Terminal decisions retain their original evidence, quantity and value. Supplier selection, return eligibility, recovery proceeds, accounting treatment and execution remain separate work.

## Review lifecycle and access

Owners, admins and planners submit. A different owner, admin or approver approves or rejects. Authors may withdraw a pending proposal while they retain organization membership and location access, including after demotion. Every submission and decision requires a trimmed reason of 1–2,000 characters.

There is one pending proposal per assessment/item, across disposition kinds. Revision order is shared by that assessment/item; the latest approved revision is selected. Later pending, rejected or withdrawn proposals do not change the existing selection. Earlier approvals remain historical. Separate assessments can propose the same stock: selections are not cumulative and do not prevent duplicate external execution.

Identical submission and decision request retries return the original record under current authority and location scope, even after source changes. Conflicting request reuse is rejected. An organization advisory lock serializes transitions, and authority/evidence are reread after waiting. Each successful submission and terminal decision is audited once. Application roles cannot mutate the table directly.

`excess_disposition_proposals` stores the chosen line, bounded quantity, exact reference value, reason, actor, revision and one terminal decision. Composite assessment/location foreign keys prevent cross-tenant lineage. The item identifier is copied evidence rather than a live catalog foreign key. Policy, override and catalog changes do not remove review history; deleting its parent assessment, location or organization cascades. Existing audit rules remain unchanged. API keys and workers gain no privileges.

## Interface and verification

Open **Replenishment → Excess stock → Disposition review**, or **Propose disposition** on a positive saved assessment line. The workbench searches copied item/location codes and proposal/decision reasons, filters location, intent and status, and supports exact assessment/item history links. Ordering and 25/50/100-row paging use URL state. Members inspect within receiving-location scope; only authorized actors see submission/decision forms.

Use shared illustrated headers, compact green panels, expandable original inputs and the existing help side panel. Page titles remain 20px, section/evidence values 16px and body text 14px. Tables scroll locally. Browser verification covers 375, 768, 1024, 1440 and 1920px, keyboard help and Arabic RTL using the existing English-message fallback.

Required evidence:

- pgTAP: quantity/intent bounds, exact values, independent review, pending uniqueness, selection history, retry conflicts, stale/missing evidence, unrelated-line corrections, role/tenant/claim/branch scope, audits and unchanged stock.
- Python database tests: competing submissions/decisions, identical retries, corrections to stock/policy/override evidence while waiting, and live permission changes after lock waits.
- Unit tests: decimal strings, Arabic digit normalization, explicit input requirements and bounded list filters.
- Production browser tests: assessment-to-proposal workflow, independent decisions, stale evidence, original/historical evidence, search and scoped access, five viewport widths and RTL; retain existing assessment and purchase-review regressions.

## Verification record — 2026-10-19

- Full pgTAP: **4,692 assertions across 75 files passed**, including 58 disposition assertions.
- Real database races: **28 passed**, covering competing/identical retries, ten source-evidence corrections at submission and approval, and live authority changes while waiting.
- Web: **1,569 tests in 135 files passed**; full lint, strict types, logical utilities and production build passed. The final form changes also passed targeted lint and the integrated production build.
- Production Chromium: the existing excess-assessment, purchase-review and event purchase-review workflows passed. The new disposition workflow passed with retries disabled, including correction/resubmission without losing the selected intent, independent decisions, replacement history, changed-evidence rejection, viewer/branch access and unchanged stock quantities.
- Detail and history overflow checks passed at **375, 768, 1024, 1440 and 1920px**. Inspected detail screenshots at all five widths, history at mobile/laptop/desktop, and RTL detail at 375/1440px. Page headings were verified at 20px and reference values at 16px; keyboard help returns focus after Escape. No page errors were recorded.
- Manual authorization/evidence review found no blocking issue. No independent-agent review or automated security scan is claimed.

## Rollout and rollback

Apply additive migration `20261018213926_excess_disposition_review.sql` before deploying the reviewed web build. The owner runs `pnpm exec supabase db push` against the linked hosted project after review. Development applies it only to local loopback Supabase. There is no backfill, worker change or new integration permission. Roll back the web build while retaining these additive objects and review history; destructive removal requires a separate reviewed migration.
