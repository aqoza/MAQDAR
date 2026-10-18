# Excess-stock assessments (Step 20)

Open **Replenishment → Excess stock → New assessment**. Choose one saved individual-item policy and either its calculated maximum or a particular approved revision for each of 1–50 distinct items. After the first choice the picker narrows to that location and forecast cutoff. Search, cutoff/location filters, ordering and 25/50/100-row pages retain explicit choices. Different runs for the same item cannot be combined. Prepared groups and event-adjusted maxima are excluded.

Preview shows each item's stock evidence, selected maximum, quantity above maximum and exact value. Supply a reason and acknowledge the as-of interpretation to save. Every line must be comparable. History searches reasons, copied location codes and item codes; details retain original policy, override and stock inputs in expandable evidence. Main guidance uses the shared help panel and compact green typography.

## Calculation and evidence

- `quantity_above = max(snapshot.quantity − snapshot.allocated_quantity − selected maximum, 0)`.
- `value_above = quantity_above × snapshot.unit_cost`. Use the snapshot's supplied currency, without substituting catalog costs, rounding products or converting currencies. Sum exact decimal products separately per currency; never sum quantities across distinct items. SQL numeric values travel as strings and the UI preserves their decimal precision.
- Select the latest snapshot on or before the common policy cutoff **before** checking provenance/freshness. Its supplied unit must match the policy's known consistent demand unit, and it must be at most seven calendar days old. A newer incompatible snapshot does not fall back to an older compatible one. Future snapshots are excluded. Missing/stale/incompatible evidence is unavailable; explicit zero remains valid.
- Only available policies from successful policy runs can be chosen in the UI. Preview rechecks sources and common location/cutoff, with each explicitly selected approved revision still belonging to that policy. There is no implicit latest policy or latest approval.
- One unavailable line blocks complete totals and the entire save. Changed snapshot, policy or override inputs require a refreshed preview. These are comparisons of dated observations with selected saved maxima, not a reconstruction of historically active policies.

These quantities do not establish transferable surplus or obsolescence. Inbound, unrecorded backorders and disposition decisions are not inferred. Saving makes no reservation, write-off, order or other operational change.

## Storage and access

`excess_stock_assessments` stores one immutable report, reason, confirmation, actor, cutoff and request identity. `excess_stock_preview` is SECURITY INVOKER, with explicit active-organization and location checks that also protect its use from the definer save RPC. `excess_stock_save` is editor-only, serializes organization retries and rechecks live authority and source evidence after the lock. The bounded pure selection validator canonicalizes ordering and rejects unknown keys, malformed identities and duplicate policy choices. Item identity is checked separately.

Identical actor/request/selection/reason/fingerprint retries return the original record, including after later source changes or deletion. Conflicting reuse fails. Retries still require live editor/location authority. There is one insert audit event and no authenticated direct table mutation. Ordinary members may preview/read subject to organization and location access; branch access removal immediately hides history and candidates. API keys and workers gain no privileges.

Reports copy original policy summary/evidence, explicit override reasons/decision/quantities and snapshot identity/version/units/quantities/cost/currency. History does not join live sources. Policy deletion leaves copied evidence intact; organization/location deletion cascades through the composite location foreign key. Existing audit rules remain in force.

## Validation and rollout

Database tests: `supabase/tests/0073_excess_stock_assessments.test.sql`, plus tenant-invariant and privilege snapshots. Transaction races: `engine/tests/test_excess_stock_db.py`. Input/precision tests: `apps/web/src/lib/excess-stock.test.ts`. Browser workflow: `apps/web/e2e/excess-stock.spec.ts`, covering the five approved widths, keyboard evidence access, stale previews, immutable history, viewer/branch permissions and Arabic RTL.

Migration: `20261018203726_excess_stock_assessments.sql`. Review and merge the PR, then the owner runs `pnpm exec supabase db push` against the linked hosted project before deploying the web build. Implementation applied the migration to loopback Supabase only. Rollback restores the previous web build and retains these additive objects and saved history; do not drop historical assessments.
