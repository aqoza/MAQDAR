# Enterprise onboarding verification

Acceptance journeys were derived from the owner's request to onboard OTE's 1,000+ users while retaining security protections. Behavior and owner rollout are documented in [enterprise-onboarding.md](enterprise-onboarding.md).

## Recorded local evidence

| Guarantee/check                                                                                                                                 | Evidence                                                                                                                                           | Result                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Bulk input accepts 1,001 recipients and rejects duplicates, invalid addresses, extra columns and oversized input                                | `onboarding.test.ts`, Vitest                                                                                                                       | PASS                     |
| Per-tenant policy is operator-only; defaults, expiry, role ceilings, address cooldowns and resend caps remain                                   | pgTAP invitation/cross-tenant suites plus `0092_enterprise_onboarding.test.sql`                                                                    | PASS                     |
| Queueing is idempotent, isolates tenants, creates no accounts before delivery, respects leases and cancellation, and rechecks inviter authority | New pgTAP suite: 36 assertions                                                                                                                     | PASS                     |
| Earlier active batches remain visible after newer completed batches                                                                             | New pgTAP assertion, reproduced RED then verified GREEN                                                                                            | PASS                     |
| Competing addresses cannot race past inviter or organization quotas                                                                             | `uv run --project engine pytest engine/tests/test_tenancy_concurrency.py -q` against isolated loopback DB: 6 passed                                | PASS                     |
| New and existing accounts receive tenant-specific emails; known throttles retry, ambiguous sends are held, endpoints/origins stay bounded       | `node --experimental-test-coverage --test --test-coverage-include=scripts/onboarding-delivery.mjs scripts/onboarding-delivery.test.mjs`: 10 passed | PASS                     |
| Consumer coverage                                                                                                                               | Native Node coverage: 99.04% lines, 93.44% branches, 80% functions; full-repository coverage was not measured                                      | PASS for measured module |
| Optional IP forwarding preserves user JWTs and adds no secret to data, Storage, admin or other-host requests                                    | Auth transport tests and source-import isolation tests; 28 focused assertions including bulk input                                                 | PASS                     |
| Web regression suite                                                                                                                            | `pnpm --filter web test --maxWorkers=2 --testTimeout=30000`: 165 files, 1,864 tests passed                                                         | PASS                     |
| Hosted-size directories remain searchable and paged                                                                                             | Local browser fixture: 1,002 members and 1,001 pending invitations; page 11 and email search checked                                               | PASS                     |
| Queue delivery works with actual Auth and SMTP responses                                                                                        | Local Auth + Mailpit: new invitation and existing-account OTP both delivered; new user accepts and reaches dashboard as Viewer                     | PASS                     |
| 1,001 queued recipients can be cancelled; feedback remains visible                                                                              | `enterprise-onboarding.spec.ts`: complete journey passed in 56.2s, including 375px and 1440px overflow checks                                      | PASS                     |
| Existing invitation flows remain intact                                                                                                         | `invitations.spec.ts`: 4 browser tests passed                                                                                                      | PASS                     |
| Types, production Next.js build, lint and logical-direction utilities                                                                           | Repository commands run locally; responsive screenshots inspected                                                                                  | PASS                     |
| Database security advisors                                                                                                                      | No errors. One existing warning for `app.import_nk`'s mutable search path; that function is unchanged                                              | No new finding           |
| Cloudflare packaging                                                                                                                            | Next.js compilation passes; Windows adapter packaging hits EPERM when creating a traced dependency symlink                                         | Linux CI required        |

The full local pgTAP run covered 94 files. It exposed three old cross-tenant fixture assertions that inserted invitation rows without send-attempt records, and one unrelated handoff test hit a statement timeout under load. The fixtures now seed their matching ledger rows. The five-suite rerun passed all 231 assertions, including the timed-out file; the final expanded onboarding suite then passed all 36 assertions. The initial web run similarly hit source-scan timeouts under local load; its complete rerun passed with two workers and an explicit 30-second timeout, without changing repository test defaults.

## TDD checkpoints and meaningful failures

- `b511c5b`: delivery safety tests referenced the missing consumer; RED captured before implementation.
- `ce27a40`: bulk input/paging tests referenced the missing module; subsequent runtime CSV failures exposed delimiter auto-detection and were fixed before GREEN.
- `a1fe02f`: Auth forwarding boundary tests preceded the transport implementation; 28 focused tests and the whole web suite pass afterward.
- `084be11` → `db907ea`: a realistic unversioned Auth `error_code` response reproduced existing-account delivery failure; compatibility handling restored the OTP fallback. Actual local SMTP verification also passes.
- `6aad60f`: complete browser workflow exposed cancellation feedback being unmounted after the pending count reached zero. Keeping the action state mounted makes the same workflow GREEN.
- `d54dae3`: the old active-batch visibility assertion failed before the status query was expanded; all 36 assertions pass afterward.

These checkpoint commits are preserved on the task branch. Do not claim the recorded commands measured 500 simultaneous users: they test onboarding correctness, bounded throughput, realistic race conditions and management of more than 1,000 records.

## Security and rollout limits

All runtime tests targeted the separate `ZeeSpare-onboarding` local stack and synthetic recipients. No hosted migration, production bulk invitation, password change, or production security-setting change was performed. Local test secrets were passed in memory; no credential file was created. No new dependency was added.

`AUTH_IP_FORWARDING` remains disabled until its separately reviewed Supabase setting is enabled. Per-IP protections, email confirmation, invitation-only signup and RLS remain enabled. The new queue runs only after an administrator submits a reviewed recipient list, and deployment requires the owner-run migration before the matching app/Worker rollout.

The responsive evidence is available as [desktop](enterprise-onboarding-visuals/en-1440.png) and [mobile](enterprise-onboarding-visuals/en-375.png). Linux CI must validate the final branch, including the Worker package, before release.

## Cloudflare scheduled delivery redirect regression (2026-10-21)

Journey: the operator enables scheduled onboarding, an empty queue completes without an email, and a reviewed queued invitation is delivered only through the configured Supabase origin.

The real Workers runtime rejects `fetch(..., { redirect: 'error' })` before any network request. Node's fetch accepts it, so the original mocked tests missed the deployment failure. The consumer now uses `manual`: queue redirects stop the drain and Auth redirects hold the current job as uncertain and stop the drain without forwarding credentials or following the Location header. This preserves review before a resend when a redirected POST might already have been accepted. Existing origin validation, pacing, lease and retry rules remain.

TDD evidence on `codex/onboarding-worker-redirect-fix`:

- RED checkpoint `43b93bc`: all four native scheduled-event tests failed against the original consumer. The isolated reproduction reported Workers' `Invalid redirect value` error and zero outbound requests.
- GREEN checkpoint `9aba70f`: `node --test --experimental-test-coverage --test-coverage-include=scripts/onboarding-delivery.mjs scripts/onboarding-delivery.test.mjs scripts/onboarding-worker-runtime.test.mjs` passed all 14 tests. Consumer coverage: 99.05% lines, 93.44% branches, 80% functions.
- Redirect-safety RED checkpoint `24fc3dd`: the native Auth-redirect drain continued and failed, and the Node assertion reported failed instead of uncertain. GREEN checkpoint `2c2a74b` passed the same 14 tests with 99.05% line, 93.55% branch and 80% function coverage. The native Auth-redirect case permits five messages but observes only one claim, one Auth request and one uncertain lease acknowledgement, proving that draining stops.
- Native tests cover an empty queue, a synthetic invitation and exact lease acknowledgement, a queue redirect, and an Auth redirect. Every outbound request is intercepted locally, restricted to the synthetic Supabase origin, and checked for the synthetic API key. No hosted account, recipient, or SMTP service is used by these tests.
- Miniflare is pinned as a development dependency to the same `5.20261006.1-alpha` version already required by Wrangler 4.149.0. No existing dependency version changed. CI runs the native tests with the delivery safety suite.

Hosted migration history, RLS/grants, tenant counts, login pages and the active scheduled handler were verified separately during rollout. The initial scheduled probe exposed this runtime defect; delivery remains paused until the fixed revision passes CI and its empty-queue production invocation succeeds. These checks do not constitute a real recipient cohort or a 500-user concurrency test.
