# Purchase-cost estimates (Step 13d)

From a saved available delivery scenario, choose **Estimate purchase cost**. Inspect the supplied unit price, its currency and valid-from date alongside the saved quantity and adjusted order date. Confirm that the price applies to that quantity and date, preview, then save. The source delivery page lists saved estimates with pagination.

## Approved calculation and evidence

The quoted-price subtotal is the saved order quantity multiplied by the supplied unit price, rounded **once, half-up**, to `currencies.minor_units`. SQL `numeric` preserves the exact product before rounding; the browser displays decimal strings without converting through binary floating-point numbers. Unit prices retain their supplied three-decimal precision even for a two-decimal currency. For example, 2.500 × 1.234 = 3.085000, giving SAR 3.09 or KWD 3.085. A rounded subtotal beyond the `numeric(18,3)` monetary range is unavailable.

The estimate requires the exact supplier-item row captured by the saved supplier scenario, matching supplier/item identities and known source-supplied units. Recreating the same supplier/item pair does not substitute a new record. The supplier must be active, the price must be a finite nonnegative value, and its known finite valid-from date must be no later than the **adjusted order date**, which may be later than the policy cutoff. An explicitly supplied zero price is valid only with the same applicability confirmation.

Supplier prices are unversioned current source records. Confirmation attests applicability to the saved quantity and date; it does not reconstruct historical prices, infer volume discounts, or establish a supplier commitment. No price-valid-through is recorded. Missing dates or units and incompatible evidence remain unavailable. A saved zero-quantity delivery gives `no_order_needed`, with no price, confirmation or subtotal required. Other unavailable deliveries cannot produce a priced estimate. Unavailable diagnoses can still be saved for inspection.

The immutable report preserves source identities and fingerprints, quantity, unit, dates, the policy-recalculation flag, supplier status, the exact price row and timestamp, supplied price text, currency precision, valid-from date, confirmation, exact product and rounded subtotal. Later stock, MOQ, lead-time, price or calendar edits do not change the saved estimate. The report retains any late-delivery policy warning; it does not recalculate policy, quantity or dates.

This is a quoted-price subtotal, not landed cost or an invoice total. Taxes, freight, duty, discounts, FX, prepared-group purchasing and order execution remain outside this increment. Totals are never combined across currencies.

## Persistence and access

`purchase_cost_preview` uses invoker rights and explicitly checks membership, the active organization claim and branch scope, including when invoked by the definer save function. Only owners, admins and planners can save. The save RPC takes an organization advisory lock, checks live editor rights again, recomputes the price fingerprint and rejects changed evidence with MQ409. Concurrent identical retries create one estimate and one audit entry. Replay identity binds organization, author, delivery, confirmation and fingerprint; an identical retry returns its original record after later edits.

`purchase_cost_estimates` is select-only for authenticated members, with restrictive location RLS and an audit trigger. `purchase_cost_list` is a narrow invoker view for paginated source history. API roles and the worker cannot mutate the table directly. Existing ingestion contracts and worker behavior are unchanged.

## Verification

pgTAP 0041 covers arithmetic, currency precision, fractional quantities, zero prices/orders, unsupported amounts, provenance, date boundaries, stale evidence, idempotency, immutability, tenant/claim/branch isolation and direct-write denial. Independent Python transactions verify concurrent retries and price/authority changes during lock waits. Web tests cover input validation, guarded actions and exact display. The browser journey verifies missing-date diagnosis, confirmation, stale-save recovery, saved history, immutable totals, preserved warnings and viewer access.

## Owner-run rollout and rollback

After review, the owner runs `pnpm exec supabase db push` for `20261016110722_purchase_cost_estimates.sql`, then deploys the web build. This adds objects and indexes on a new empty table without rewriting existing records. The existing application remains usable during database-first rollout. No new credential, background job or worker upgrade is required.

Roll back by restoring the prior web build while retaining the additive database objects and saved evidence. No hosted migration or deployment is performed by this development task.
