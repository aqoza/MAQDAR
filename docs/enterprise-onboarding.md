# Enterprise onboarding

OTE's 1,000+ user POC uses the existing invitation-only Auth system and Mumbai SES SMTP. A durable, private Postgres queue lets administrators review and submit up to 2,000 unique email addresses, close the browser, and follow delivery progress later. No password or access token is stored in the queue.

## Behavior and protections

- The migration enables an explicit OTE-only allowance of **2,000 preparations per workspace and per inviter per rolling 24 hours**, valid for **90 days from migration application**. It matches the existing OTE deployment binding. Other workspaces, including ACME, retain **100/workspace and 50/inviter** and do not gain bulk onboarding automatically.
- Policy changes require a database operator. Tenant administrators cannot read or write the private policy/queue tables. Policies require a reason and expiry, and expiry restores the ordinary caps. Existing workspace data, members and passwords are retained.
- Every preparation, including a resend, consumes an append-only attempt ledger. Migration backfill preserves the former limiter's recent invitation rows. Organization and inviter advisory locks serialize competing requests. The 2-minute address cooldown, five invitation records/address/day, ten sends/invitation, role ceilings, confirmation, RLS and seven-day invitation expiry remain.
- Bulk roles exclude Owner; the default is Viewer. The upload accepts a single `email` column, optional header, at most 256 KiB and 2,000 unique valid addresses. A review checkbox confirms access intent. At most 20 new batches per workspace per rolling day are accepted, including cancelled batches, and at most 20 batches may remain active. Batches use a client UUID plus a canonical payload fingerprint; retries are idempotent, conflicting reuse and overlapping pending addresses are rejected. Enqueueing alone creates no Auth account or membership.
- A scheduled handler on the existing `zeespare-web` Worker processes at most five messages per minute. A database-global 12-second gate also protects overlapping cron executions. This is **at most 300/hour across all tenants**, leaving headroom within the shared 1,000 Auth emails/hour. Network latency, retries and provider limits can reduce throughput. Plan onboarding in waves rather than promising an exact completion time.
- Current inviter membership and role are checked again when a job is claimed. Removed/demoted inviters cannot continue sending. Existing members are skipped. The Worker maps organization IDs to fixed approved OTE/ACME origins; queue content cannot choose a redirect host. New users receive an invite; existing users receive an OTP with public signup disabled. Both use the existing tenant email confirmation paths.
- Each claimed job has a five-minute lease. Successful Auth acceptance marks it sent. Known 429s retry after an hour, at most five attempts, and pause the shared consumer for 15 minutes. Transport/5xx ambiguity and expired leases are held as **uncertain** for manual review, never blindly retried. Delivery is not an exactly-once SMTP guarantee: confirm mailbox/provider evidence before manually resending an uncertain result. No response body, recipient address, credential or link is logged.
- Cancelling a batch stops pending work and revokes any prepared in-flight invitation. An already emitted email may still arrive, but a revoked invitation cannot grant membership. Previously sent invitations remain independently revocable in Settings.
- Members and pending Invitations use server-side search and 100-row pages with exact totals. A single JSON response avoids truncation at the hosted 1,000-row response cap. API key creator status is fetched independently of the visible member page/search. Global Data API limits are retained.

## Owner-run rollout

The repository requires the owner to apply hosted migrations. Do not run `supabase config push` and do not paste migration SQL into production by hand.

1. Review the PR and CI. Confirm a current backup and inspect the linked project before applying. The migration is additive apart from replacing `invite_member` with the shared guarded implementation.
2. From the reviewed branch, run `pnpm exec supabase db push --linked --dry-run --include-all` and inspect the proposed migrations. The CLI-generated onboarding timestamp precedes later migration timestamps already present on main, so `--include-all` is required for this reviewed additive migration. If unrelated unapplied migrations appear, stop and reconcile them first.
3. Apply that reviewed set with `pnpm exec supabase db push --linked --include-all`. The new private policy row is inserted only if the existing OTE organization ID is present. Check the row and its expiry as the database owner. No real recipient batch is seeded by deployment.
4. Merge/deploy the matching Worker/app after the schema is present. Preserve the existing `SUPABASE_SECRET_KEY`, OTE and ACME bindings, production build variables and SMTP settings. `worker.mjs` delegates normal requests to the generated OpenNext fetch handler and adds cron. `ONBOARDING_SUPABASE_URL` is the non-secret production API origin. `ONBOARDING_EMAIL_DELIVERY=enabled` permits consumption; set it to `disabled` to stop new scheduled drains without deleting queue data (an already-running drain can finish its bounded work).
5. Verify Settings for both tenants before uploading real users. OTE should expose the bulk form, ACME should show that bulk requires an allowance, and both retain single invitations. Verify tenant-specific delivery with a small approved recipient cohort, then upload the reviewed OTE list. No production load test or real bulk email send is part of automated verification.

### Inspecting the rollout

As the database owner:

```sql
select organization_id, organization_daily, inviter_daily, valid_until, reason
from onboarding.policies;

select b.organization_id, j.state, count(*)
from onboarding.jobs j
join onboarding.batches b on b.id = j.batch_id
group by b.organization_id, j.state;
```

Owner/admin Settings shows all active batches plus the ten latest batches, and twenty recent issue recipients for the current workspace. A sent count means Auth accepted the request, not proof of inbox delivery; use SES/Supabase evidence for delivery investigations. Policies, queue records and attempts are private and retained until their parent records/organization are removed; this change does not invent a new customer data-retention policy.

## Auth client-IP forwarding

`AUTH_IP_FORWARDING` ships **disabled**. Enable it only in a separate, reviewed activation after the matching hosted Supabase IP Address Forwarding setting is enabled. Supabase requires a new-format `sb_secret_` API key; legacy service-role JWTs do not support this feature.

The optional server-only fetch transport accepts only Cloudflare's overwritten `cf-connecting-ip`, validates a single IPv4/IPv6 address, pins the Supabase origin and allow-lists ordinary Auth endpoints. It preserves user JWTs and never adds the secret to Data API, Storage, admin paths, other origins or redirects. Local Next.js requests ignore caller-supplied forwarding headers. RLS clients keep their publishable key and end-user authorization for all data requests.

Forwarding fixes server-egress aggregation; it does **not** distinguish people sharing the same office NAT. Keep the current per-IP limits, 60-second per-user cooldown and signup restrictions. Stagger first sign-ins per office; watch 429s before considering a separately approved targeted rate change. Supabase's token-bucket burst rules still apply even when its refill limit is raised. This feature is not a guarantee for 500 simultaneous sessions; test that workload separately in an isolated environment.

## Rollback

Disable `ONBOARDING_EMAIL_DELIVERY` to stop new scheduled drains; an already-running drain can finish its bounded work. Revert the app/Worker to the previous deployment if needed; the old single-invitation RPC signature remains compatible and the added schema can stay in place. Expire/delete only the OTE policy as the operator to restore ordinary caps. Cancel remaining batches through Settings before re-enabling delivery. Do not drop queue data or attempt records as a rollback shortcut. Disable the Worker forwarding flag first if rolling back its corresponding Supabase setting.

## References

- [Supabase Auth rate limits and IP forwarding](https://supabase.com/docs/guides/auth/rate-limits)
- [OpenNext custom Worker](https://opennext.js.org/cloudflare/howtos/custom-worker)
- [Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
