# Step 28e task checklist

Implementation and verification complete; ready for review.

- [x] Owner confirms delivery scope, including zero-quantity outcomes.
- [x] Owner confirms bounded evidence rules.
- [x] Owner confirms lifecycle and access rules.

## 1. Evidence contract

Define a discriminated available/no-order-needed summary and explicit SQL projection. Keep exact quantities, saved dates and bounded enumerated reason counts; reject other statuses and malformed evidence. Likely files: new migration, delivery-explainer.ts, delivery-explainer.test.ts and pgTAP test. Verify positive, zero, missing-calendar, privacy and reference-isolation cases. Approved.

## 2. Request authority and captured history

Extend the subject constraint, guarded request/complete path and record schema; regenerate database types. Preserve shared quotas, UUID identity, post-lock authority and source deletion retention. Likely files: migration, ai-explanations.ts, generated types and new database concurrency tests. Verify tenant/location access and duplicate/authority races. Depends on task 1.

## Checkpoint: evidence and authority

- [x] Focused unit, pgTAP and concurrency tests pass.
- [x] Projection contains only approved fields.

## 3. Provider orchestration

Add delivery-specific instructions and answer parsing within the existing fixed-endpoint, bounded server adapter. Preserve dispatch version matching and publication authority. Likely files: claude-policy.server.ts, policy-explainer-execution.ts, policy-explainer.server.ts and unit tests. Verify zero-outcome limitations, wrong references and refused publication. Depends on task 2.

## 4. Request entry

Add a saved-scenario action and request page with exact preview and explicit sharing confirmation, using existing form/action guards. Likely files: saved delivery detail, new explanation page, shared actions and form. Verify supported source links, disabled/unconfigured states and editor-only requests. Depends on task 3.

## 5. Evidence and result rendering

Add compact evidence sections, source links, subject labels and English/Arabic messages. Likely files: evidence component, explanation detail/history and both message files. Verify escaped text, local reference links, fixed shared typography and both outcome presentations. Depends on task 4.

## Checkpoint: complete flow

- [x] Mocked generation, saved history and authority failures pass.
- [x] Original delivery records remain unchanged.

## 6. Browser and regression coverage

Add the delivery fixture/spec and mock-provider case; include the isolated suite and screenshot retention. Verify the new flow and existing subjects, delivery and Settings regressions. Inspect both locales at all five widths, keyboard access and overflow. Depends on task 5.

## 7. Delivery

Complete repository verification and review, update docs/PLAN.md and the feature/rollout documentation, then commit and open one PR. Record mocked-provider limitations and leave hosted settings unchanged. Stop after this step. Depends on task 6.

## Verification record

- 2026-10-25: 2,394 web unit tests passed; all 7,965 pgTAP assertions passed across 134 files.
- All 45 explanation concurrency tests and all five isolated production-browser flows passed. All six existing replenishment/supplier/delivery and Settings browser regressions also passed.
- Production build, type checking, lint, logical-layout checks and repository formatting passed.
- Citation mutation admitted a foreign policy reference and produced two expected test failures. Restored source then passed the full web suite.
- Five-axis self-review found no remaining blocking correctness, security, architecture, readability or performance issues. Database privilege inventory was corrected after the first focused audit identified the new private helper.

- Visually inspected ten delivery screenshots: English/Arabic at 375, 768, 1024, 1440 and 1920px. Verified wrapping, typography, visible timing warning and expandable evidence; automated overflow and keyboard checks passed.
