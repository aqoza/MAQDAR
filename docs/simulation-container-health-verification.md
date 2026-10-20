# Simulation Container readiness verification

The deployment probe reached database-ready but failed its private health checks. The controller previously allowed only twenty immediate connection failures (about ten seconds) before stopping a cold instance, and discarded the failure category. Keep the database binding disabled while diagnosing startup.

The change permits sixty bounded startup checks. Already running instances still stop after one unhealthy check. Diagnostics expose only HTTP status numbers or fixed native transport categories; provider messages and response bodies are never logged. No migrations, database grants, public routes or shared web changes are included.

## TDD evidence

Journeys were derived from the deployment failure: an operator can distinguish HTTP failure from unavailable transport without exposing secrets, and a cold instance can reach readiness after more than twenty immediate refusals.

- `90d7c8f`: RED, two missing-diagnostic tests failed for the expected generic error.
- `93d406c`: GREEN, all seven controller tests passed; typecheck and dry-run build passed.
- `87576e5`: RED, delayed readiness after twenty refusals caused premature termination.
- `806057e`: GREEN, all eight controller tests passed, including delayed readiness and immediate unhealthy-running shutdown.
- `276fdab` / `18463e3`: RED/GREEN for fixed native error categories; unknown provider text remains hidden.
- `pnpm --filter simulation-worker exec node --test --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-branches=80 src/controller.test.ts`: final nine tests passed; controller coverage 98.91% lines, 93.75% branches and 100% functions.
- `pnpm --filter simulation-worker typecheck`, `pnpm --filter simulation-worker build` and focused Prettier checks passed.

The pure controller suite covers lifecycle decisions. Durable Object integration and real Cloudflare startup are separate hosted checks; unit coverage alone does not certify deployment health. CI and hosted outcomes must be checked before declaring the rollout complete.

## Hosted outcome and limits

The dedicated Cloudflare probe connected to the database and logged ready, but its native port API repeatedly reported that no Container instance could be provided. Increasing the bounded startup grace did not repair that platform symptom. A temporary fixed private-command check also encountered native instance/network errors; it was removed. A fresh fixed Durable Object identity showed the same failure and was retired, restoring the original stable instance name. Those checkpoints are retained in Git; neither experiment is part of the final implementation.

The service is paused and the database binding is disabled outside bounded synthetic verification. The exact release image independently reached HTTP 200 ready and completed a synthetic run from an operator-controlled Docker host. This does not certify Cloudflare health or permanent consumption. The draft PR improves diagnostics and startup tolerance; it does not claim to fix the unresolved native instance-association failure.
