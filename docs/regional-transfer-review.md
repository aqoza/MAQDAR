# Regional transfer proposal review — Step 25f

Review one complete saved regional freight estimate with at least one positive source allocation. Submission retains the entire quantity/date/freight evidence chain, including zero sources. Independent approval selects the whole proposal for its original sourcing scenario. Partial approvals, exports and execution remain outside this step.

Editors submit, a different owner/admin/approver approves or rejects, and member-authors may withdraw pending proposals. Every operation, retry and inspection requires the destination and every source, including zero allocations. Reasons are required and limited to 2,000 characters. One pending proposal per original sourcing scenario; revisioned terminal decisions are immutable. Later approvals supersede the selected proposal without erasing prior decisions. Other sourcing scenarios and network/individual transfers remain independent and may overlap.

New submission and approval require the original unarchived region and matching current freight, active locations and original active directed lanes with unchanged lead times. Current evidence is compared with the saved estimate fingerprint. Approvals additionally require every positive source's saved p50/p90 timing flags explicitly false and both receipt dates present. Zero sources need no receipts. The region, location and lane locks serialize new mutations with archive and evidence updates; authorization is rechecked after waits. Rejection/withdrawal remain available after archiving or evidence changes.

Request UUID retries return the original proposal/decision only for identical normalized inputs and the same actor under current authority. Decisions cannot be rewritten. Source estimate/sourcing, organization and included-location deletions cascade through the existing parent chain; audit events remain. Region definition deletion alone does not erase retained history. There are no new service-role privileges or direct API-role writes.

The compact green history and detail screens support English/Arabic RTL at 375, 768, 1024, 1440 and 1920px. Search covers saved item, region and location labels; filters cover receiving location, status and original sourcing. Missing/forbidden proposal details return HTTP 404. Archived-region evidence shows an approval warning while leaving valid rejection/withdrawal controls usable.

Approval does not refresh saved stock commitments, reserve stock, infer arrival guarantees or create operational orders. Existing inbound warnings remain visible without adding another approval gate.

Verification: `0107_regional_review.test.sql`, `test_regional_review_db.py`, web schema/action tests and `regional-review.spec.ts`, plus shared tenant/ACL invariants and full CI.
