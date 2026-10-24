# Policy explainer (Step 28)

An editor can ask about one available individual-item calculated policy from its review detail. The page previews the exact evidence summary sent with the question. A saved answer is AI-generated interpretation, not a new calculation, approved override or purchase recommendation. Members inspect captured answers within the policy location scope. Prepared groups and broader chat are outside this increment.

## Opt-in and provider boundary

Both server-only `ANTHROPIC_API_KEY` and `ZEESPARE_CLAUDE_MODEL` must be configured, then an owner/admin must enable the organization in Settings. There is no default model and organizations default off. This PR makes no hosted configuration, migration or provider-account changes. The configured model must support structured JSON output; validate it in a controlled staging account before enabling a hosted organization.

Only the confirmed question, language and allowlisted summary leave the server. The summary contains the unit/cutoff, saved lead/review/service parameters, lead/protection forecasts, empirical quantiles, calculated thresholds, safety stock, selected model/method/horizon and calibration counts/limitations. It excludes account identities, source UUIDs, prices, raw demand rows, transactions and credentials. The UI warns users not to put those details in the free-text question. Questions are not automatically redacted. Internal evidence links are constructed locally from captured IDs and are not provider-supplied URLs.

The adapter calls only `https://api.anthropic.com/v1/messages`, with redirects disabled, no tools, a 45-second timeout, 4,096 output-token cap and 64 KiB response cap. It uses API version `2026-10-21` and `output_config.format` JSON Schema. See the official [version contract](https://platform.claude.com/docs/en/api/versioning) and [structured-output contract](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). The configured model and returned model, API version and prompt version are saved separately. Provider errors and bodies are never exposed or logged.

## Authority, quotas and lifecycle

The authenticated reservation RPC checks the active editor, current preview fingerprint and explicit sharing confirmation. It serializes per organization and rechecks authority after lock waits. Database limits are one attempt per editor per rolling minute, 20 per editor per UTC day, 100 per organization per UTC day and two active attempts per organization. Failed attempts count. An identical organization/request UUID returns the original record; conflicting reuse fails.

A dedicated server adapter can call only guarded dispatch/completion RPCs. Dispatch and publication independently recheck the actor's current editor membership and organization opt-in. The service key has no direct grants on the new tables. Dispatch claims once; repeated HTTP submissions never resend a running or terminal attempt. There is no automatic provider retry after an uncertain network outcome. A pending reservation is dispatchable for two minutes; completion expires two minutes after dispatch. Stale pending/running records display as expired after three minutes and require a new, quota-controlled request. A late or unauthorized answer is not published. A revocation after dispatch cannot retract data already sent; it blocks later publication when observed by that check.

The answer is one to eight plain-text paragraphs with one to five allowlisted evidence references each. Both application and database validate the structure and references. Truncated/refused/malformed outputs fail closed. React escapes answer text, and citations navigate only to captured sections. Valid references do not prove that an interpretation is factually correct; users should check the displayed source values. Source summaries retain decimal strings without JavaScript numeric conversion.

Terminal answers/failures are immutable. Turning the feature off blocks new dispatch/publication but leaves authorized saved history readable and completed retries stable. Deleting the source policy, item or account does not erase captured evidence; organization/location deletion follows existing cascades. Audit records cover settings and attempt transitions. Policies, approvals, stock and orders are never mutated.

## Validation and rollout

- `pnpm --filter web test -- src/lib/policy-explainer.test.ts` covers projection schemas, provider payloads/limits, output validation and revoked publication.
- `supabase/tests/0128_policy_explainer.test.sql` covers RLS, opt-in, quotas, immutable retries, service-only capabilities and source retention; the shared privilege inventory includes the new objects.
- `uv run --project engine pytest engine/tests/test_policy_explainer_db.py` covers concurrent reservation/dispatch and authority changes during lock waits.
- Build, then run `pnpm --filter web exec playwright test --config playwright.policy-explainer.config.ts`. Its separate loopback-only Node preload substitutes a fake provider; it never uses real credentials or sends requests to Anthropic. The ordinary browser suite excludes this spec. CI runs both configurations sequentially and retains the ten English/Arabic viewport screenshots.

The browser flow verifies Settings opt-in, preview/confirmation, generation, escaped output, evidence links, branch restrictions, retained results and compact typography at 375, 768, 1024, 1440 and 1920px. Existing policy review and Settings workflows remain regression targets. A live Claude response is deliberately not part of automated CI.

Owner rollout after review: apply migrations through the normal reviewed process, deploy the application, configure server credentials/model, validate the selected provider/model in staging, then opt in an organization. Disable the organization setting or remove credentials to stop new use; retain saved records rather than destructively rolling back their tables.
