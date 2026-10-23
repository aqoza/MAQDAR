# ACME-only simulation worker: review and owner-run rollout

Prepared 20 October 2026 (Asia/Dubai). **Implementation and local preparation only: do not run the hosted steps until the migration, credential, Cloudflare resource/cost and canary plan are approved.** The existing `zeespare-web` service is not redeployed. No hosted schema, role, password, binding, secret, container or test run was changed during implementation.

## What this release does

The separate `zeespare-simulation-worker` entry point can execute recorded-sales replay, sensitivity and configuration comparisons. A private database binding maps the actual `session_user` **OID and name** to one organization. Its five scoped RPCs provide connection-only identity, claim, task, failure and publication. The runtime cannot call the global worker RPCs, select raw tables, assume another role or choose its tenant using JWT claims or environment variables. `ZEESPARE_EXPECTED_ORGANIZATION` is an additional startup assertion, not authorization.

Claim filters the shared queue before changing message visibility/read count. Foreign messages, including stale/exhausted runs, are excluded; the global consumer skips every bound organization's simulations. Other organizations and other job kinds retain their existing processing rules and lease durations. Scope changes serialize with claims/publication through a routing advisory lock. Identity/routing changes require an idle simulation organization. Disablement immediately blocks new scoped claims, task reads, failure acknowledgements and publication, while retaining routing ownership: **paused work never falls back to a global consumer**. A paused identity can still run the connection-only `--check`.

The migration installs no binding or LOGIN and moves/deletes no existing messages or business records. Operators activate routing separately while ACME simulations are idle. Existing global workers retain their ordinary privileges; do not give their capability to the new login.

## Exact hosted migrations

Read-only hosted history checked during implementation has `20261019180044_policy_simulations.sql` already applied, and no active ACME simulations. That snapshot is not a substitute for rollout-time preflight. For the current release's three simulation methods, the reviewed rollout is these **three files, in this order**:

1. `20261019194823_policy_sensitivity.sql` — merged sensitivity schema/RPC/validation support.
2. `20261019210852_policy_configurations.sql` — merged configuration comparisons and validation support (PR #105).
3. `20261019220301_scoped_simulation_worker.sql` — new private binding, simulation capability and scoped routing/RPCs.

The first two are existing merged prerequisites; the third is new work awaiting review. **Exclude** `20261019153205_disposition_integration_workbench.sql`, seeds, `roles.sql`, Vault updates and any later unreviewed migrations. The existing original simulation migration is not rerun. All migrations remain additive/forward-only; preserve history on rollback. The new scope table is private with RLS, no API grants or policies; the new role is NOLOGIN, non-inheriting and has no administrative flags. Existing keys/memberships gain nothing.

## Review checkout and bounded migration push

Use the reviewed release commit, not a moving `main`. Commands below are PowerShell, run from that release checkout after installing the pinned dependencies. Record `git rev-parse HEAD` and the generated migration hashes with the approval. Stop if the source has unreviewed modifications. These examples require the owner's existing authenticated Supabase CLI session; enter any database password only in its private prompt.

```powershell
pnpm install --frozen-lockfile
$releaseRoot = (Get-Location).Path
$revision = (git rev-parse --short=12 HEAD).Trim()
$rolloutRoot = Join-Path $releaseRoot ".tmp/simulation-rollout-$revision"
pwsh -NoProfile -File scripts/prepare-simulation-worker-rollout.ps1 -Destination $rolloutRoot
Get-Content (Join-Path $rolloutRoot 'migration-sha256.txt')

# Read-only. Confirm it lists EXACTLY the three filenames above.
pnpm exec supabase --workdir $rolloutRoot db push --project-ref dydxmuhfaqlycymdcxee --skip-vault --dry-run

# OWNER-APPROVED MUTATION ONLY, after reviewing that exact dry run:
pnpm exec supabase --workdir $rolloutRoot db push --project-ref dydxmuhfaqlycymdcxee --skip-vault
```

The preparation script only copies known baseline/history files plus the three named migrations to a new local directory, omits the unrelated pending workbench, disables seed execution and creates a SHA-256 manifest. It never connects to a database. If the dry run includes any other migration, or reports divergent remote history, stop and reconcile; do not add `--include-all`, repair history, push a seed/config or continue from the normal checkout.

Verify hosted migration history contains each version once. Check `app.scoped_simulation_*`, the new capability flags, table RLS/revokes and **zero bindings** before provisioning. Confirm pgmq 1.5.1's `q_planning` columns (`msg_id`, `read_ct`, `vt`, `message`, etc.) match the tested transport contract. Run advisors and investigate any new finding; the local cloned baseline has one pre-existing mutable-search-path warning on `app.import_nk`, outside this change.

## Dedicated runtime identity and paused binding

Inventory existing global consumers first. Confirm no ACME simulation is queued/running; do not stop other tenants' workers. No existing message is reassigned. If ACME already has active work, let its authorized consumer finish or obtain explicit approval to cancel only identified ACME runs before binding.

Use a private libpq service definition named `zeespare-admin` for the owner's administrative connection. The commands below refer to that service, never a password or DSN in a shell command. Set the reviewed ACME UUID from its verified organization row; the SQL also requires its name to be ACME. Do not choose by name alone when duplicates exist.

```powershell
$acmeOrganization = '<VERIFIED-ACME-UUID>'
psql 'service=zeespare-admin' -X -v ON_ERROR_STOP=1 -v "acme_organization=$acmeOrganization" -f scripts/simulation-worker-bind.sql
```

This is a **separately approved provisioning step**, not a migration. It creates only `zeespare_acme_simulation` with LOGIN/NOINHERIT, no superuser/BYPASSRLS/create-role/create-db, connection limit two, database CONNECT and membership only in `zeespare_simulation_worker`. It inserts a disabled binding, which reserves only that organization's simulations. The final `\password` prompts twice without putting the password in the SQL file/history. An existing login or active simulation aborts provisioning; inspect rather than overwriting it. Scope uses OID plus name, so dropping/recreating a login cannot reuse the prior binding. Provision no web/API keys, memberships, raw table grants or global worker membership.

Obtain the direct or **session-pooler** endpoint/custom-role username from the project's Connect dialog. Transaction pooling is unsuitable because this worker retains `SET ROLE` and session timeouts across autocommit calls. Require `sslmode=verify-full` and the correct trusted CA bundle **for the selected endpoint**; a session pooler's CA can differ from a direct database endpoint. Never disable verification to make the connection work. Validate connectivity/identity from the actual container network before enabling consumption.

## Cloudflare service preparation

This release proposes a new service **`maqdar-acme-simulation`**, with a Durable Object-managed Linux/amd64 Container. The controller uses only the fixed instance name `acme-simulations-v1`; no route accepts a tenant or instance name. There is no workers.dev URL, preview URL, public route or administration API. A fetch, if invoked, returns 404. Cron runs each minute; initial `ENABLED=false` means no container starts. The selected `basic` instance (1 GiB/quarter vCPU) is provisional pending workload/cost review. This scheduling policy does not support `max_instances`; the checked-in controller creates only the single fixed named instance rather than exposing a name router.

The image pins official CPython 3.12.15 and uv 0.12.23 by digest, installs dependencies from `engine/uv.lock` without development tools, runs as UID 10001 and copies source separately from the dependency layer. The build-context allowlist excludes all `.env`, `.tmp`, certificates and other local artifacts. No credentials are accepted as build arguments or baked into the image. The runtime materializes the supplied CA into a mode-0600 temporary file and execs only the scoped entry point. It defaults to **connection-only probe** mode, with consumption requiring explicit `MODE=consume`. Its private health listener exposes only ready/unavailable, with no tenant, task, token or DSN.

First run locally with no credentials to verify fail-closed bootstrap; then verify a restricted **loopback** fixture from the image. Hosted connectivity/canaries are not certified by the local build. After review, inspect the Cloudflare account and confirm the service name is unused, account entitlement/cost, region/network and monitoring owner. Leave `zeespare-web` unchanged.

```powershell
# Local-only validation; these do not deploy.
pnpm --filter simulation-worker typecheck
pnpm --filter simulation-worker test
pnpm --filter simulation-worker build
docker build --platform linux/amd64 -f engine/Dockerfile.simulation -t maqdar-acme-simulation:review .
docker inspect maqdar-acme-simulation:review --format '{{.Config.User}}'
docker run --rm --network none maqdar-acme-simulation:review
# Expected: user worker; exit 1 and one redacted bootstrap error with no credentials.
```

Review/update only the new service's `ZEESPARE_EXPECTED_ORGANIZATION` placeholder to the verified UUID. Keep `ENABLED=false` and `MODE=probe`. Do not put DSNs/CA contents into Wrangler vars or source. Once the new service/resource creation is approved:

```powershell
# HOSTED MUTATION: creates the separate paused service/container application.
pnpm --filter simulation-worker exec wrangler deploy

# HOSTED SECRET WRITES: enter each value privately at its prompt.
pnpm --filter simulation-worker exec wrangler secret put ZEESPARE_WORKER_DSN
pnpm --filter simulation-worker exec wrangler secret put ZEESPARE_DATABASE_CA

# Inspect only this service's deployment/container state and logs in Cloudflare.
pnpm --filter simulation-worker exec wrangler containers list
pnpm --filter simulation-worker exec wrangler tail
```

Secret writes can create a new Worker version; the service must remain paused throughout provisioning. Do not paste secrets into a terminal command or this report. Store the correct verified-TLS DSN and CA bundle in the new service's secret store only. A running Container retains its startup environment; secret/image updates need a reviewed restart of **only this named instance** before verification. The controller currently starts a stopped instance with its current pinned image; it does not silently replace a running image. Check the running digest/revision explicitly.

Use a private environment file (never source control) to run the image's connection-only check from an operator-controlled container host with the actual network path. `ZEESPARE_WORKER_DSN` must use the restricted login; its expected organization must match the binding. For this check, pass a CA-file path via the DSN/mount rather than starting the normal bootstrap, which consumes after startup. A successful check verifies session identity and TLS but **claims no message**:

```powershell
# Private file contains ZEESPARE_WORKER_DSN and ZEESPARE_EXPECTED_ORGANIZATION only.
# DSN references /run/zeespare/database-ca.pem, supplied by the read-only mount.
docker run --rm --env-file '<PRIVATE-ENV-FILE>' --mount 'type=bind,source=<TRUSTED-CA-FILE>,target=/run/zeespare/database-ca.pem,readonly' --entrypoint /app/engine/.venv/bin/python maqdar-acme-simulation:review -m zeespare_engine.scoped_worker --check
```

This local-host check alone cannot certify Cloudflare egress. Keep the database binding **disabled** and deploy the new controller in its explicit connection-only probe mode to verify the actual Cloudflare network, runtime and CA:

```powershell
pnpm --filter simulation-worker exec wrangler deploy --var ENABLED:true --var MODE:probe --var "ZEESPARE_EXPECTED_ORGANIZATION:$acmeOrganization"
pnpm --filter simulation-worker exec wrangler tail
# Expect the connection-only probe ready log and successful supervisor checks.
# Confirm no queue/read-count/lease/run mutation in the database.

# Stop the probe before switching mode; verify its Container has stopped.
pnpm --filter simulation-worker exec wrangler deploy --var ENABLED:false --var MODE:probe --var "ZEESPARE_EXPECTED_ORGANIZATION:$acmeOrganization"
pnpm --filter simulation-worker exec wrangler containers list
```

The probe revalidates identity/connection and health every five seconds and never calls a claim RPC. The disabled database binding independently prevents consumption. Wait for the stopped Container state before proceeding: Worker configuration/secret updates do not replace an already running process's environment. There is intentionally no public diagnostic/command-execution endpoint, and neither SSH nor a global runtime login is needed.

## Activation, canaries and stop procedure

After the separate identity/resource/diagnostic plan is approved, authorize at most **three new explicitly identified synthetic ACME runs**: successful replay plus canonical retry, UI cancellation/no late publication, and crash/restart recovery with token fencing. The earlier eight-run approval is exhausted and is not reused. Keep local exhaustion/malformed-output/foreign-token attacks local. Test all three calculation methods locally; add separately approved hosted comparisons if required rather than silently exceeding the manifest.

Immediately before activation, recheck the exact ACME UUID, no unexpected active ACME simulations, the dedicated runtime membership/grants, matching deployed image revision and no competing ACME consumer. Record the established business/reference fingerprints and foreign queue/read-count/lease/attempt/history state. Existing foreign workers may make legitimate changes during observation; do not stop them, and investigate changes by runtime/run attribution rather than attributing every global difference to this canary.

Enable only the known binding with an owner-run statement conditioned on both role name and the reviewed UUID:

```sql
update planning.simulation_worker_scopes set enabled=true
where login_name='zeespare_acme_simulation' and organization_id='<VERIFIED-ACME-UUID>'::uuid;
```

Verify exactly one row changed. Then deploy only the separate controller with consumption enabled and the reviewed UUID (keep all other configuration from the approved file):

```powershell
pnpm --filter simulation-worker exec wrangler deploy --var ENABLED:true --var MODE:consume --var "ZEESPARE_EXPECTED_ORGANIZATION:$acmeOrganization"
```

Cron starts/rechecks the fixed instance within its next scheduled invocation. It refreshes a three-minute inactivity watchdog, checks private health and requests SIGTERM on failure; the next minute can restart a stopped instance. SQL failures exit and visibility expiration recovers the run; a stale worker cannot publish. Health becomes unavailable if its loop has not progressed in 100 seconds. These are watchdogs, not an exactly-once guarantee or a CPU-time deadline. SIGTERM permits the current bounded operation to return; use the database fence first to prevent publication during an emergency stop.

Verify each canary's exact result, attempts, immutable captured inputs, output count, archive and staging/lease cleanup in ACME. Verify cancellation and token replacement prevent late output. Check zero foreign claims/writes attributable to this login, no source-policy/stock/inbound/order changes, unchanged prior simulation results and no extra credentials/grants. A successful process exit or green health is not proof of a successful simulation; read its terminal database evidence. Configure alerts for supervisor failures, queued age, exhausted attempts and missing completion, with no DSN/task/token logging. No external alert destination is configured by this release.

For pause/recovery, first set the same binding's `enabled=false` using both predicates above, then deploy this controller with `ENABLED=false` (and `MODE=probe` for the next diagnostic). The next tick terminates only its named Container; the watchdog also bounds loss of supervision. Preserve the binding, schema, queue, copied inputs and results. Do not delete/rebind it, purge messages, stop shared workers, roll back `zeespare-web` or change another tenant. Before resuming, verify revision/secrets, wait for the old process to stop and lease expiry, and enable the same reviewed identity. Cancel only explicitly approved synthetic run IDs if cleanup is required.

## Evidence and remaining limits

See [implementation verification](acme-simulation-worker-verification.md) for exact tests, RED/GREEN checkpoints and remaining runtime/host checks. Local/source verification prepares a release for review; **hosted migration application, login/secret creation, paid resource provisioning, actual Cloudflare runtime/TLS verification and canaries remain owner-approved rollout steps**.

Platform behavior was checked against official [Cloudflare Container API](https://developers.cloudflare.com/containers/api/durable-object-container/), [cron example](https://developers.cloudflare.com/containers/examples/cron/), [secret/lifecycle guidance](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/) and [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres). The Supabase CLI is the repository's pinned 2.120.0; its help verified `--workdir`, `--project-ref`, `--skip-vault` and dry-run support.
