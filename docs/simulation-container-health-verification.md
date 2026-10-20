# Simulation Container readiness verification

The deployment probe reached database-ready but failed its private health checks. The controller previously allowed only twenty immediate connection failures (about ten seconds) before stopping a cold instance, and discarded the failure category. Keep the database binding disabled while diagnosing startup.

The change permits sixty bounded startup checks. Already running instances still stop after one unhealthy check. Diagnostics expose only HTTP status numbers or fixed transport categories; provider messages and response bodies are never logged. No migrations, database grants, public routes or shared web changes are included.

## TDD evidence

Journeys were derived from the deployment failure: an operator can distinguish HTTP failure from unavailable transport without exposing secrets, and a cold instance can reach readiness after more than twenty immediate refusals.

- `90d7c8f`: RED, two missing-diagnostic tests failed for the expected generic error.
- `93d406c`: GREEN, all seven controller tests passed; typecheck and dry-run build passed.
- `87576e5`: RED, delayed readiness after twenty refusals caused premature termination.
- `806057e`: GREEN, all eight controller tests passed, including delayed readiness and immediate unhealthy-running shutdown.
- `pnpm --filter simulation-worker exec node --test --experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-branches=80 src/controller.test.ts`: eight passed; controller line, branch and function coverage reported 100%.
- `pnpm --filter simulation-worker typecheck`, `pnpm --filter simulation-worker build` and focused Prettier checks passed.

The pure controller suite covers lifecycle decisions. Durable Object integration and real Cloudflare startup are separate hosted checks; unit coverage alone does not certify deployment health. CI and hosted outcomes must be checked before declaring the rollout complete.
