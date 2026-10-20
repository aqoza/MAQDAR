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
