# Scoped simulation worker: implementation evidence

20 October 2026, Asia/Dubai. Scope: local implementation and deployment preparation, with no hosted mutation. Based on main `5eb9719e421c4ce6ef2e076bb8989699fa58ba47` (including PR #105), integrated into `codex/acme-scoped-simulation-worker`. The primary checkout's existing UI/design changes and private sample-data files were preserved.

## Journeys and guarantees

| Guarantee                                                                                                   | Verification                                                                | Result |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| Runtime identity is database-owned; JWT/GUC changes cannot select another tenant                            | Real restricted LOGIN tests in `engine/tests/test_scoped_worker_db.py`      | PASS   |
| Foreign stale, canceled and exhausted messages retain visibility/read count, runs, leases and archive state | Before/after exact transport snapshots with foreign messages preceding ACME | PASS   |
| Shared consumer skips bound simulations before transport mutation; ACME non-simulation work stays separate  | Shared and scoped real-session claim tests                                  | PASS   |
| No raw queue/run/result/binding access, global RPC or global-role assumption                                | Real privilege denials and pgTAP privilege/RLS assertions                   | PASS   |
| Retry, concurrent claim, invalid publication, cancellation and expired/replaced token fencing               | Multi-connection PostgreSQL tests                                           | PASS   |
| Disablement, membership revocation, unexpected extra membership and recreated login fail closed             | Live-session/OID scope tests                                                | PASS   |
| Scope routing cannot move an active simulation                                                              | Database guard regression                                                   | PASS   |
| Replay, sensitivity and configuration comparisons publish through the same scoped identity                  | Real Python worker plus database publication                                | PASS   |
| Paused runtime can probe identity/health without claiming                                                   | Python unit and real Linux image test                                       | PASS   |
| Non-root image can publish and recover an expired synthetic lease without touching a foreign fixture        | `engine/tests/test_scoped_container_db.py`                                  | PASS   |
| Missing bootstrap secrets exit with only a redacted error                                                   | Real image with `--network none`                                            | PASS   |
| Controller pauses/stops, starts/probes and handles unhealthy processes without payload logging              | Six Node controller tests                                                   | PASS   |
| New service packages without upload, defaults to paused/probe and exposes no public control route           | Wrangler 4.149.0 dry run and type check                                     | PASS   |

The scope tests use newly generated synthetic organizations/logins in a **separate local database** `maqdar_worker_qa`, reached only through loopback. No hosted customer, policy, stock, demand, inbound or order data was used or changed. The initial schema/reference-only clone omitted the primary database's business data; pg_cron cannot be installed in a secondary database, so clone-time platform/default-privilege warnings were not treated as application results. The new migration was subsequently installed from its complete SQL file in the isolated database. Actual fresh-stack migration/full-regression validation is also included in CI.

## Commands actually run

- `uv run --project engine --with pytest-cov pytest engine/tests/test_scoped_worker.py engine/tests/test_scoped_worker_db.py engine/tests/test_worker_health.py --cov=maqdar_engine.scoped_worker --cov=maqdar_engine.worker_health --cov-report=term-missing --cov-fail-under=80 -q -x -p no:cacheprovider` with the isolated loopback DSN: **27 passed, 95.83% combined coverage** (94% scoped worker, 100% private health).
- `uv run --project engine pytest engine/tests -m 'not db' -q -p no:cacheprovider`: **385 passed, 426 database tests deselected** at that run. The optional container smoke is separately enabled and executed below; deselection is not a database pass.
- Legacy planning regression, `python -m pytest engine/tests/test_planning_db.py -q -x -p no:cacheprovider`: **13 passed**. An earlier broader run reached 52 passes before a loopback connection reset; the planning suite was rerun successfully rather than recording the interruption as a code failure/pass.
- `pnpm exec supabase test db --db-url <isolated-loopback-DSN> supabase/tests/0027_planning_runs.test.sql supabase/tests/0080_policy_simulations.test.sql supabase/tests/0081_policy_sensitivity.test.sql supabase/tests/0082_policy_configurations.test.sql supabase/tests/0083_scoped_simulation_worker.test.sql`: **232 assertions, five files, PASS**. A first iteration exposed missing pgTAP schema access under a restricted role and a concurrently running fixture; the test was corrected and final database runs were serialized.
- `pnpm --filter simulation-worker typecheck`, `test`, `build`: **PASS**, six lifecycle tests and a **2.61 KiB / 1.10 KiB gzip** no-upload Worker bundle. The CLI correctly rejected an unsupported `max_instances` setting for Durable Object scheduling during development; it was removed. The controller exposes only the fixed instance identity.
- `docker build --platform linux/amd64 -f engine/Dockerfile.simulation -t maqdar-acme-simulation:review .`: **PASS**. Tested local image ID `sha256:6941846f097fc77745eb4be4873764e5ccb62216dec135f966e40e39dbca1b06`, configured user `worker`, UID **10001** verified inside the running image. Dependency layers are cached independently from source. This is a local image identity, not a published Cloudflare registry digest.
- `uv run --project engine pytest engine/tests/test_scoped_container_db.py -q -x -p no:cacheprovider`, with `MAQDAR_CONTAINER_IMAGE=maqdar-acme-simulation:review`, `MAQDAR_TEST_DB_CONTAINER=supabase_db_MAQDAR` and the isolated DSN: **one full image smoke passed in 37.75 seconds**. Paused probe left both fixtures' transport unchanged; consumption published once; restarted consumption recovered a specifically expired synthetic lease on attempt two, rejected the old token and left no lease. Temporary image-test containers and `.env.local` credentials were removed in `finally`.
- `docker run --rm --network none maqdar-acme-simulation:review`: expected **exit 1**, exactly `Simulation bootstrap failed: check verified connection and CA.` No traceback or configuration was emitted.
- Web lint/typecheck and `pnpm --filter web test`: **PASS**, **1,687 tests across 144 files**. The production Next.js build succeeded, including TypeScript and all 103 static pages. Local OpenNext packaging then encountered a **Windows EPERM symlink permission error**; the existing Linux CI packaging gate remains required. No machine security setting was changed, and no Linux packaging result is claimed here.
- `pnpm exec supabase db advisors --db-url <isolated-loopback-DSN> --type security --level warn --fail-on error`: **zero errors**, one pre-existing mutable-search-path warning on `app.import_nk`; no finding on the new objects. A first connection attempt reset and the read-only check was rerun successfully.
- Runtime ACL enumeration found **exactly five normal SECURITY DEFINER RPCs** executable by `maqdar_simulation_worker`, all `app.scoped_simulation_*`. Direct global/internal helper access is revoked; inherited trigger-returning helpers are not normal worker entry points.
- `pwsh -NoProfile -File scripts/prepare-simulation-worker-rollout.ps1 -Destination .tmp/simulation-rollout-review`: **PASS**, local files/hash manifest only. Windows PowerShell 5 refused script execution under its existing policy; PowerShell 7 ran it without changing a policy.
- Prettier checks, `git diff --check`, pinned `uv lock --check` and manual security/diff review: **PASS**. No source credentials, hosted tenant UUID, certificate or local environment file is included in the change.

CI adds a separate native-container build/non-root/fail-closed-bootstrap job and runs the real image/database smoke against a fresh local Supabase stack. Existing jobs retain full pgTAP, generated public types, Python/database tests, browser regression and Linux web packaging. Local opt-in skips must not substitute for that image job.

## TDD checkpoint evidence

Journeys were derived from the owner's requested ACME-only worker and the earlier deployment review. Tests preceded implementation:

- `df212f2`: scoped-entry-point contract RED, missing `maqdar_engine.scoped_worker`; `3fc7c27`: initial GREEN with seven unit/six database tests.
- `94fe9e3`: container controller RED, missing `controller.ts`; `8a49bad`: GREEN, six lifecycle tests.
- `2e9927f`: health RED, missing `worker_health`; subsequent implementation is fully covered.
- `7b7ca13`: newly merged configuration-comparison regression RED; adding the missing scoped dispatch made both comparison tests GREEN.
- `6b3b272`: supervised probe RED, unrecognized `--probe`; the new connection-only loop and lifecycle contract now pass.

The final tests/coverage and this report preserve the evidence if the branch is later squash-merged. Initial failure counts above describe specific development checkpoints, not unresolved test failures.

## Hosted boundary and remaining review

Hosted activity consisted solely of **read-only migration-history and active-run queries**. No hosted schema, LOGIN, password, scope binding, API key, role membership, Vault secret, container, web deployment or new simulation was created/changed. No new 121-set hosted fingerprint comparison was performed in this implementation pass; earlier fingerprint evidence is separate and is not relabeled as a new verification.

The Cloudflare account was previously inspected through the browser and had no Containers/separate engine application. This implementation does not claim actual Cloudflare execution, egress/TLS, scheduling, restart timing, throughput or alert delivery. Those require the separately approved paused service, restricted credential, probe and bounded canaries in the [exact rollout guide](acme-simulation-worker-deployment.md). No paid resources or external alert destinations were selected/provisioned. The `basic` resource size is provisional, not a certified production load target.

The established eight-run hosted QA allowance has been exhausted. The proposed three-run canary manifest, migration application, credential/secret provisioning and Cloudflare activation remain for owner review. No old authorization was reused to perform them.
