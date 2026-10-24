# Delivery-date explainer (Step 28e)

Editors can explain one saved ordinary individual-item delivery scenario from its detail page. The request previews the precise evidence summary sent to Claude. Members inspect saved results within receiving-location access. This interprets existing schedules; it never reruns calendars or changes planning data.

## Evidence contract

`delivery-explainer-v1` reads only a captured `delivery-dates-v1` report. It carries the known unit, exact quantity string, cutoff, requested order date and fixed calendar-day lead. An available outcome adds saved adjusted order, nominal receipt, adjusted receipt, cutoff-plus-lead policy reference, elapsed days and the saved recalculation flag. True warnings remain explainable and visible; they do not establish a calculated shortage.

Both saved calendar searches must be complete, resolved, contiguous and bounded to 90 evaluated dates. The projection retains only evaluated/closed counts, closed-reason counts (calendar override, country override, holiday, weekend), final working-day reason and applicability confirmation. Counts do not map individual reasons to dates. A working override may resolve a date outside general holiday coverage; that does not verify all holidays. Raw notes, names, entity IDs/codes, accounts, prices and calendar objects never reach the provider. Saved date arithmetic is validated for consistency, not recomputed as a new schedule.

An explicit zero-quantity `no_order_needed` outcome has null schedule and calendar-adjustment sections. It implies neither calendar confirmation nor active counterparties. The original report may contain a cutoff-plus-lead reference, but the summary does not expose that as a scheduled receipt. Unknown, inactive, exhausted, unconfirmed or incomplete positive schedules are unavailable. No current supplier, stock, order or calendar lookup occurs.

The bounded prompt distinguishes indicative dates from supplier promises and captured evidence from current commitments. The question is explicitly confirmed; it is not automatically redacted. The form warns against sensitive question content. Valid references identify evidence, not independent verification of generated interpretations.

## Authority and lifecycle

The existing server-only opt-in adapter and shared `policy_explanations` RLS table gain a fifth subject, with a nullable source ID and mutually exclusive subject constraints. Source deletion retains captured explanation history; the original-source link may then be unavailable. Organization/location cascades remain unchanged.

Owner/admin opt-in, editor-only requests, receiving-location reads, organization-scoped request identity and all shared quotas remain: one attempt/editor/minute, 20/editor/UTC day, 100/organization/UTC day and two active attempts/organization. Failed attempts count. Current authority is checked after lock waits and before dispatch and publication. Identical retries preserve the original attempt, including after source deletion or opt-out under current authority; conflicting identities fail. Dispatch cannot call the provider twice.

Transport retains the fixed Anthropic endpoint, no tools, 45-second timeout, 4,096 output-token cap and 64 KiB response cap. SQL and TypeScript validate the delivery reference vocabulary: `delivery_context`, `schedule`, `calendar_adjustments`, `delivery_limits`. Text is escaped and evidence links are constructed locally. Questions, evidence, model/API/prompt versions and answers remain immutable. Existing policies, scenarios, stock, approvals and orders are unchanged.

## Verification and rollout

Unit and database tests cover positive warnings, zero outcomes, incomplete dates/searches, private-field rejection, citation isolation, source retention, tenant/location reads, shared quotas and stable retries. Independent database sessions exercise duplicate requests, single dispatch, revocation and opt-out during lock waits. The isolated loopback mock-provider browser suite covers all five explanation subjects; delivery acceptance includes both outcomes, five widths (375/768/1024/1440/1920), English and Arabic RTL, keyboard access and escaped output. Existing delivery and Settings workflows remain regression gates.

Apply `20261025010000_delivery_explainer.sql` through the reviewed owner-run migration process before the matching application. It is additive, forward-only, uses a five-second lock timeout and requires no backfill or history-table index. Prefer disabling organization AI opt-in while retaining the current history reader; older application builds do not understand delivery explanation records. Keep saved evidence, and use forward migrations for schema corrections. This PR changes no hosted configuration, credentials, migrations or deployment. A controlled real-provider staging check remains required before enabling hosted use; automated tests use the local mock.
