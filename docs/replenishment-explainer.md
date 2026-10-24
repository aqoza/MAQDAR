# Replenishment explainer (Step 28c)

Editors can ask about one available saved individual-item replenishment draft from its detail page. The preview uses the draft's captured evidence, without refreshing stock or inbound. Prepared groups, unsupported versions, unknown units, unconfirmed inbound and missing timing flags remain unavailable. Supplier scenarios and planning changes are outside this increment.

## Captured evidence

The database projects only the saved unit, cutoff, protection-period end, calculated-versus-approved maximum basis, selected maximum, stock after allocations, aggregate remaining open inbound, additional unallocated backorders, inventory position and unrounded gap. Quantities remain exact decimal strings, including negative stock balances. Separate counts identify open, overdue and late inbound lines. Missing timing evidence is rejected rather than presented as zero.

Inventory position is the saved stock after allocations plus all remaining open inbound minus additional unallocated backorders. The saved gap is max(selected maximum minus position, zero). Inbound includes overdue and late lines; receipts are not subtracted again. The model explains these recorded values rather than recalculating policy or refreshing commitments. A zero gap does not guarantee timely supply.

Raw order lines, prices, currency values, account details, item/supplier codes and approval reasons are excluded. Internal source IDs support authorized navigation but are not sent to Claude. The confirmed question and chosen language accompany the preview; users must not put secrets or personal details in their question.

## Authority and lifecycle

Replenishment, policy and forecast explanations share the existing owner/admin opt-in, server configuration, quotas and organization/request UUID namespace. Settings names all three uses. Requests require an editor and confirmation; provider dispatch and completion recheck current authority and enablement. The existing one-per-minute/editor, twenty-per-day/editor, hundred-per-day/organization and two-active/organization limits apply across all subjects, including failures. Day boundaries use UTC.

One saved answer retains its question, projected evidence, prompt/API/model versions and validated subject-specific references. It uses the existing guarded server adapter, with no additional tenant-table grants, API-key scope or worker capability. Claimed requests are never implicitly redispatched. History survives deletion of the source draft under current location access, with organization/location cascades unchanged. Source IDs for unrelated policy/forecast subjects stay null rather than being invented.

AI text is escaped and citations can only link to captured replenishment sections. Valid links do not prove the explanation correct. Answers are labeled AI-generated and create no approval, purchase recommendation, reservation, inbound or operational order. Opting out stops new requests while retaining history. Revocation after dispatch cannot retract data already sent to the provider.

## Verification and rollout

Unit coverage checks exact projections, private-field exclusion, missing timing, confirmation, cross-subject references, prompt versions, provider bounds and revoked completion. Database coverage includes tenant/location isolation, shared quota/retry identity, unavailable drafts, immutable history, source deletion and authority changes while waiting on locks. The isolated loopback-provider browser suite covers all three subjects, opt-in, exact previews, references, retries, Arabic generation and five responsive widths. No live Claude call is needed for these checks.

Local verification passed: 2,365 web unit tests, 7,879 pgTAP assertions, 498 engine tests, 27 explainer database concurrency tests and 13 simulation-worker tests. All three mocked explainer browser flows passed, alongside the existing replenishment, policy-workbench and four Settings checks. English/Arabic screenshots were inspected at 375, 768, 1024, 1440 and 1920px. A deliberate cross-subject citation mutation caused two expected failures; restoring exact source bytes passed all 49 focused explainer tests. Formatting, lint, typecheck, logical utilities, production build and generated-type consistency passed.

The first Settings run was interrupted by the local Docker engine stopping. PostgreSQL recovered its log after restart, and all Settings checks passed on the healthy stack. No application change or weakened assertion was used to address that interruption. The live Claude service and hosted deployment were not exercised.

Apply `20261024233000_replenishment_explainer.sql` through the normal reviewed migration process before deploying the app. Existing enabled organizations gain the explicitly described replenishment use under the same quotas; disabling the existing setting stops all three uses. No hosted migration, credential, deployment or organization configuration is changed by this PR.
