# Simulation Container readiness verification

The deployment probe reached database-ready but exited before its private health listener started. The resulting native port error, `instance unavailable`, hid a Python health-server startup failure. `HTTPServer.server_bind()` performs a reverse-DNS lookup even when binding `0.0.0.0`. A runtime-generated 64-character hostname causes Python's IDNA codec to raise `UnicodeError: label too long`. The original release image reproduces that failure locally with a 64-character hostname and no network access.

The private listener now binds TCP directly and uses a fixed internal server name; it needs no reverse DNS. The repaired image returns HTTP 200 under the same hostname/network conditions. The first dedicated hosted probe also passed its native private-port health check with the database consumption binding disabled. Repeated health, restart and consumption outcomes are recorded separately in the operator's deployment evidence; a single probe is not a long-term availability certification.

The controller also permits sixty bounded startup checks, attaches one background lifecycle monitor per Durable Object, and reattaches on a restored running process. Already running instances still stop after one unhealthy check. Diagnostics expose only bounded exit codes, HTTP status numbers, fixed stages/categories or SQLSTATE; provider messages and response bodies are never logged. No migrations, database grants, public routes or shared web changes are included.

## TDD evidence

Journeys were derived from the deployment failure: an operator can distinguish HTTP failure from unavailable transport without exposing secrets, and a cold instance can reach readiness after more than twenty immediate refusals.

- `90d7c8f`: RED, two missing-diagnostic tests failed for the expected generic error.
- `93d406c`: GREEN, all seven controller tests passed; typecheck and dry-run build passed.
- `87576e5`: RED, delayed readiness after twenty refusals caused premature termination.
- `806057e`: GREEN, all eight controller tests passed, including delayed readiness and immediate unhealthy-running shutdown.
- `276fdab` / `18463e3`: RED/GREEN for fixed native error categories; unknown provider text remains hidden.
- `pnpm --filter simulation-worker exec node --test --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-branches=80 src/controller.test.ts`: final nine tests passed; controller coverage 98.91% lines, 93.75% branches and 100% functions.
- `pnpm --filter simulation-worker typecheck`, `pnpm --filter simulation-worker build` and focused Prettier checks passed.
- `9613021` / `730753d`: RED/GREEN for immediate background lifecycle monitoring, coalescing repeated ticks, reattachment after exit and redacted native failures. Twelve controller tests pass, with 99.29% line / 96% branch / 100% function coverage.
- `da22177` / `e5aaf81`: RED/GREEN for fixed worker failure categories without server text or credentials.
- `4c4be77` / `c454543`: RED/GREEN for a private health listener that remains usable when hostname DNS raises a Unicode error. Nineteen focused Python tests pass.
- Original Linux image: `docker run --rm --network none --hostname <64-character-runtime-id> ...` fails in Python's `HTTPServer.server_bind()` with the IDNA label error. Repaired image under the identical conditions returns `200 {"status":"ready"}`.
- Full local engine verification with a new workspace-owned pytest base directory: 459 passed, 496 deselected. An initial run using the restricted default temporary directory encountered fixture permission errors; rerunning with the explicit writable base directory passed.
- `3929fe5`: RED for a current paused cron calling a resident Durable Object with its previous enabled environment. Forwarding the current fixed runtime configuration over the private RPC makes all thirteen controller/cron tests pass. No public configuration endpoint is introduced. Hosted rollout verification must confirm the old process stops before switching mode.

The pure controller suite covers lifecycle decisions. Durable Object integration and real Cloudflare startup are separate hosted checks; unit coverage alone does not certify deployment health. CI and hosted outcomes must be checked before declaring the rollout complete.

## Hosted outcome and limits

The dedicated Cloudflare probe connected to the database and logged ready, but its native port API repeatedly reported that no Container instance could be provided. Increasing the bounded startup grace did not repair that platform symptom. A temporary fixed private-command check also encountered native instance/network errors; it was removed. A fresh fixed Durable Object identity showed the same failure and was retired, restoring the original stable instance name. Those checkpoints are retained in Git; neither experiment is part of the final implementation.

The background monitor subsequently established that the process exited with code 1 before the final port error. Fixed worker-stage diagnostics narrowed this to health-listener startup, and the 64-character hostname reproduction identified the cause described above. The repaired hosted probe passed. Earlier operator-controlled Docker canaries against the database are separate evidence and are not represented as Cloudflare consumption tests.
