# Transfer date scenarios (Step 16b)

Status: implemented, review pending. PR #38 was reviewed without blocking findings and merged as `2888553` with all three CI jobs passing.

## Approved scope and calculation

`transfer-dates-v1` adds saved dates to an available individual-item redistribution draft. The owner approved this scope on 2026-10-17. Quantities and lane lead times stay fixed from that draft; freight costing, approval and execution follow separately.

1. Choose a requested dispatch date on or after the saved destination cutoff (1900-01-01 through 2100-12-31). Confirm that current source and destination calendars apply to the requested dates.
2. Find the next known source working day on or after the requested date.
3. Independently add the saved lane p50 and p90 lead times in calendar days. Shift each nominal receipt to the next known destination working day.
4. Compare each resolved receipt with the saved destination forecast cutoff plus its policy lead time. Show a timing-review warning when later; the policy review interval is not part of this reference. Keep the destination draft's existing overdue/late inbound warning.

Typical (p50) and slow (p90) are indicative scenarios. They do not claim calibrated probabilities, sufficient supply, stock reservations or guaranteed arrival. Dates do not recalculate policies or alter quantities. Multiple drafts can still propose the same stock.

Use the existing calendar precedence: assigned calendar settings override country defaults; calendar-specific date overrides precede country overrides, then verified all-sector holidays and weekly settings. Each dispatch/receipt search stops at the first unknown date or after 90 evaluated dates. Never infer a working day from missing holiday rows outside verified coverage. An explicitly configured calendar that ignores public holidays uses its weekly pattern and overrides. Reference coverage is unchanged by this step.

The same saved directed lane must remain active with matching p50/p90 lead times, and both locations must be active. A changed lane requires a new redistribution draft. Current freight terms do not affect this date calculation. A zero saved quantity produces “No transfer needed,” no scheduled dates and no calendar confirmation requirement. Positive scenarios with unresolved dispatch or either receipt cannot be saved; a resolved typical receipt remains inspectable if the slow receipt is unavailable.

## Evidence, access and retries

The report captures the complete immutable redistribution report, requested date and confirmation, destination policy lead-time reference, current location/lane identities and update timestamps, and separate calendar contexts with evaluated dates for dispatch and each receipt. Capture each receipt's nominal date through the 90-day search window independently, avoiding an unbounded holiday range between distant p50/p90 values. Saved calendar inputs and dates remain unchanged after later feed, calendar, location or lane edits.

Preview and save explicitly check organization membership and both location scopes before using the private calendar helpers. Saved table reads use tenant RLS plus two ANDed restrictive endpoint policies; the list view is security-invoker. Only owners/admins/planners save. Anonymous, service and worker roles gain no access. Authenticated direct writes are revoked. All application queries explicitly constrain the active organization, and the server action checks its rendered organization against the active session.

An organization advisory lock serializes saves and authority is checked again after waiting. New saves recompute the fingerprint. Changed input evidence requires refreshing the preview. Organization-scoped request UUIDs bind source draft, author, requested date, confirmation and fingerprint: identical retries return the original record, while conflicting reuse fails. Retries retain current editor and both-location access checks but do not recompute historical evidence. Each new record creates one audit event and changes no operational stock, inbound, receipt or order rows.

## Acceptance

- AC-001: A saved redistribution draft links to a date preview with an explicit requested date and calendar confirmation. Inspect dispatch and both receipt scenarios, preserving fractional quantity strings and destination timing concerns.
- AC-002: Weekends, closures, working-day overrides, unknown coverage, inactive calendars, zero lead/quantity, partial results and the 90-day bound follow the rules above. Date inputs before cutoff are rejected.
- AC-003: Current active lane/location checks and exact saved lead matching apply. Positive unresolved results cannot save; zero quantities produce no dates. Saved evidence remains immutable after subsequent input changes.
- AC-004: Tenant/active-organization and both-location scope apply to preview, save, retries, details and list counts. Editor authority and input fingerprints are rechecked after lock waits. Identical concurrent retries save/audit once; conflicts fail.
- AC-005: Searchable, paginated history and full evidence screens use the compact green standard at 375, 768, 1024, 1440 and 1920px. Calendar disclosures and contained tables support keyboard use. Methodology is expandable; required confirmations and actionable timing warnings remain visible.

## Rollout and rollback

After review, the owner runs `pnpm exec supabase db push` to apply `20261017093852_transfer_date_scenarios.sql` before deploying the web build. This additive migration creates one table, an invoker view and two guarded RPCs; it reuses existing private calendar helpers. Generated database types are committed. There is no data backfill, worker change or new API-key scope. Hosted migrations and deployment were not performed for this step.

Roll back the web build while retaining the additive schema and immutable reports. No destructive rollback is needed. Local tests use synthetic data and explicitly configured fixture calendars; production calendar settings and reference coverage remain unchanged.

## Verification

- Local pgTAP: 2,885 assertions across 50 files, including 77 transfer-date assertions and updated tenant/privilege invariants.
- Python: 293 engine unit tests pass. The database regression passed 118 checks and exposed an invalid ISO weekday in one new synthetic fixture; after correcting it, all six transfer-date concurrency checks pass. This covers all 119 database checks across the regression and focused rerun. No application change was required for that fixture correction.
- Web: 1,215 unit tests pass, with lint, TypeScript, logical CSS, formatting, the production build and all three retention-script tests. Database types were regenerated from the applied local migration.
- The authenticated transfer-date workflow passes at all five widths, including unknown-calendar blocking, explicit confirmation, stale-preview rejection, saved history after calendar/lane changes, viewer access and both-location scope. Keyboard disclosures and table scrolling work; screenshots at 375 and 1440px were visually reviewed with 64-character source codes and expanded calendar evidence.

- The full browser regression passed 55 checks and found one existing redistribution assertion that also matched Next.js's route announcer. Scoping it to the actual business warning fixes the ambiguity; that complete workflow passes on rerun. Together these cover all 56 active browser tests. Three opt-in scale tests remain intentionally skipped. The application-wide responsive sweep passes at all five widths, including the new history route and Arabic shell regression.

Database suites run sequentially because they share local Supabase tables and statistics. GitHub CI also runs the complete suites on Linux and packages the Cloudflare worker without deploying it.
