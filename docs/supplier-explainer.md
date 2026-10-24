# Supplier scenario explainer (Step 28d)

An editor can ask about one available saved individual-item MOQ/pack scenario from its saved detail. The page previews the precise summary sent to Claude. Explanations interpret the existing result; they do not refresh terms or create a new order recommendation. Members inspect saved answers within receiving-location access.

## Evidence and calculation

`supplier-explainer-v1` reads only the immutable `supplier-rounding-v1` report. Its explicit projection includes the saved unit/cutoff, gap, MOQ, pack multiple, rounded quantity, overage, matching supplier/policy calendar-day leads and terms-applicability confirmation. Prices, supplier identities/names, account details, raw orders, source UUIDs and approval text are excluded. The question is explicitly confirmed and is not automatically redacted; the existing form warns against including sensitive details.

For zero gap the saved quantity stays zero, even with positive MOQ. Otherwise quantity is max(gap, MOQ) rounded upward to a pack multiple; overage is quantity minus gap. Exact decimal strings preserve fractional packs and quantity precision. The explainer never replaces these calculated values with a new calculation. Matching leads establish compatibility only, not a scheduled receipt or timely supply. Terms are captured as-of evidence with a planner attestation, not verified current supplier commitments. The original draft's stock and inbound remain unchanged.

The preview rejects unavailable scenarios, missing/unknown/mismatched units, unconfirmed applicability and missing/mismatched lead-time evidence. Later catalog or supplier changes do not rewrite the saved scenario. There is no live supplier, stock or order lookup in the explanation flow.

## Authority and lifecycle

Reuse the existing owner/admin opt-in, server-only provider configuration and shared limits: one attempt/editor/minute, 20/editor/UTC day, 100/organization/UTC day and two active attempts/organization. Failures count. Request UUIDs share the organization namespace with policy, forecast and replenishment explanations. Current editor authority is rechecked after lock waits and before dispatch/publication; branch members can inspect only permitted locations and cannot generate answers.

A nullable source ID and subject constraint extend the existing RLS table. Provider transport remains confined to the fixed Anthropic endpoint, with no tools, 45-second timeout, 4,096 output-token cap and 64 KiB response limit. Only the guarded dispatch/completion RPCs use privileged credentials. Both TypeScript and SQL validate subject-specific evidence references; text is escaped and links are constructed locally. AI interpretation can be wrong even when references are valid.

Questions, evidence, model/API/prompt versions and answers remain captured and immutable. Identical retries return the original attempt without another provider call; conflicting identities fail. Terminal retries survive later opt-out/source deletion under current authority. Organization/location deletion follows existing cascades. Source scenario/draft deletion retains explanation evidence and history; its original-source link may then return unavailable. Policies, supplier scenarios, stock, approvals and orders are unchanged.

## Verification and rollout

- Unit tests cover exact quantities, zero-gap representation, private-field exclusion, provider projection, citation isolation and publication authority.
- pgTAP covers tenant/branch access, current authority, quotas, retries, captured rounding, missing evidence and source-cascade retention.
- Independent database sessions test duplicate requests, dispatch once and authority/opt-out changes during lock waits.
- The isolated loopback provider browser suite covers all four explainers. New supplier acceptance verifies saved-scenario entry, opt-in, preview/confirmation, escaped output, evidence navigation, English/Arabic responses, branch access, source retention and 375/768/1024/1440/1920px layouts plus keyboard use.
- Run shared lint/typecheck/unit checks, full pgTAP, production build and existing supplier/Settings regressions. CI packages the Cloudflare Worker without deployment.

Owner-run rollout follows the reviewed migration process for `20261024235000_supplier_explainer.sql` before deploying the matching application. Configuration stays opt-in and no hosted credentials, migrations or deployment are changed by this task. The additive migration uses a five-second lock timeout, makes no backfill and adds no index to the existing history table. Rollback is application/feature disablement with saved evidence retained; schema corrections use forward migrations. A controlled staging check with the configured Claude model is still required before enabling hosted use; CI uses only the mock provider.
