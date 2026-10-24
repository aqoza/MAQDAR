# Step 28e: saved delivery-date explanations

Status: implementation and verification complete; all scope, evidence and lifecycle/access rules approved 2026-10-25. PR #174 is already merged as a4af38b, and all four CI jobs passed. This plan follows the existing read-only AI explanation architecture.

## Scope

Explain one saved ordinary individual-item delivery scenario. Eligible outcomes are available scheduling results and explicit zero-quantity no-order-needed results. Preserve captured values and do not read current calendars to reconstruct them. Unknown, inactive, exhausted or otherwise unavailable schedules are not eligible.

Preview an allowlisted summary of cutoff, unit/quantity, fixed calendar-day lead, requested and adjusted order dates, nominal and adjusted receipts, the saved policy timing reference/flag, calendar applicability and bounded counts of captured calendar-search reasons. Keep zero-quantity outcomes separate: no dates or confirmation are inferred. Exclude entity identities, prices, account details, raw orders, calendar names and free-text notes. Exact decimal strings remain strings.

Reuse organization opt-in, editor-only requests, location-scoped inspection, quotas shared with all existing explanation subjects, request identity, guarded dispatch/completion and immutable results. Validate delivery-specific references in both application and SQL. No operational data, credentials, hosted migrations or deployment changes.

## Implementation order

The detailed checklist is in todo.md. First define the evidence projection and negative cases, then request authority/history and the provider boundary. Add the source-page action, request form and captured result rendering using the existing components. Finish English/Arabic copy and browser regression coverage. Retain one complete feature PR.

## Risks and mitigations

- Saved zero-quantity reports have null scheduled order/receipt dates and a null timing flag, but may retain the cutoff-plus-lead policy reference date. Use a separate validated outcome; never label that reference as a scheduled delivery or infer confirmation.
- Calendar searches contain identifying/free-text evidence. Project only enumerated outcomes and bounded reason counts; never send raw report objects.
- Counts do not establish which specific date had each reason. Explain them as aggregate saved evidence and link to the original detailed scenario locally.
- Calendar applicability is an attestation; dates are indicative, not supply commitments. Keep the saved policy-recalculation warning visible without recalculating policy.
- Shared AI paths affect four existing subjects. Preserve their schemas, reference sets, quotas and browser regressions.

## Verification

Run focused schema/provider/action tests and a mutation experiment; database authority, quotas, retries, missing-evidence, zero-quantity and retention assertions; independent concurrency checks; production browser acceptance with the isolated mock provider; existing delivery and Settings flows. Inspect 375, 768, 1024, 1440 and 1920px in English and Arabic RTL, keyboard access, escaped output and no page overflow. Complete repository format, lint, typecheck, logical-style and build gates. Real-provider staging remains separate.

## Open decisions

All decisions are approved; implementation may proceed.

## Confirmed source behavior and acceptance cases

- A positive available result has two resolved searches. Each search includes closed dates followed by its selected working date, with at most 90 evaluated days. Closure counts and the selected-day reason must remain distinct.
- A resolved explicit working-day override can be outside general holiday coverage. Do not equate a false coverage flag with an unknown working outcome or claim that all holidays are verified.
- If any required date is unknown, the original search stops immediately. The explainer must not invent the skipped dates or a completed schedule.
- A positive result can legitimately have a true policy-recalculation flag. Explain the saved warning without blocking read-only explanation or changing the policy.
- Zero quantity is resolved before supplier/receiver availability and calendar confirmation gates. Its explanation must not imply active counterparties, evaluated calendars, affirmative confirmation, or a timing verdict.
- A cutoff-plus-lead reference may exist for zero quantity even though actual order/receipt dates are null. This is a policy reference only; no delivery is scheduled.
