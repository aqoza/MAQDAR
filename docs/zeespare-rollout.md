# ZeeSpare rebrand and domain cutover

The public product is ZeeSpare at https://zeespare.com. The existing Cloudflare Worker is renamed in place to zeespare-web; its immutable identity, deployment history, encrypted secret, rate limit bindings and database remain intact. WORKER_SELF_REFERENCE must target zeespare-web. Keep maqdar.org as a legacy custom-domain alias and attach www.zeespare.com as an additional alias. Preserve the domain's existing MX/TXT records.

## Deployment settings

Wrangler declares the three custom domains and NEXT_PUBLIC_SITE_URL=https://zeespare.com. Set the same public site URL in Cloudflare's production build variables. Retain the current Supabase URL and publishable key, PNPM_VERSION and encrypted SUPABASE_SECRET_KEY. The repository and production branch stay aqoza/MAQDAR and main. Do not create a second Worker with missing secrets.

In Supabase Auth URL Configuration, change Site URL to https://zeespare.com and add the exact https://zeespare.com/dashboard and https://www.zeespare.com/dashboard return destinations used by sign-in links. Keep existing legacy and development destinations during transition. Also allow https://zeespare.com/invitations/* (one invitation ID segment) and https://www.zeespare.com/invitations/*, because invitation delivery supplies an absolute return URL for the invitation. The template uses SiteURL for its token-hash entry route; maintain that route and mail-gateway-safe POST confirmation.

Mirror the branded invitation and sign-in templates and subjects from supabase/templates and supabase/config.toml into hosted Auth email templates. Change the display sender name to ZeeSpare if supported without changing verified sender credentials. Do not claim a zeespare.com sending address is ready until its mail provider verifies it; this cutover does not replace SMTP credentials or DNS mail authentication.

## Compatibility

The domain cutover kept internal identifiers stable; the internal-name retirement below replaces them. SQLSTATEs (`MQ401` …) are unchanged. Historical reports and the GitHub repository (aqoza/MAQDAR) retain their original identity. Existing browser sessions remain scoped to their original domain; users sign in normally on zeespare.com.

## Internal name retirement (2026-10-23)

MAQDAR is retired as an internal name. Applied migrations keep their original text; everything else uses ZeeSpare. This is a breaking change for API integrators and worker deployments.

- **Database** (`20261023130000_rename_zeespare.sql`, one transaction): roles `maqdar_worker` / `maqdar_simulation_worker` become `zeespare_worker` / `zeespare_simulation_worker` (same OIDs, so grants and login memberships stay); advisory-lock keys and custom settings move from `maqdar.*` to `zeespare.*` in every function at once; cron jobs become `zeespare-demand-partitions` and `zeespare-import-housekeeping`.
- **REST API**: keys are `zeespare_sk_` + 43 + 6 characters (61 in all). The migration revokes every active `maqdar_sk_` key; old display prefixes stay valid for history only. OpenAPI extensions are `x-zeespare-*` and problem types `urn:zeespare:problem:*`.
- **Engine**: the Python package is `zeespare-engine` (`zeespare_engine`), with commands `zeespare-worker`, `zeespare-simulation-worker` and `zeespare-synth`. The JavaScript workspace package is `@zeespare/shared`.
- **Environment**: `ZEESPARE_WORKER_DSN`, `ZEESPARE_DATABASE_CA`, `ZEESPARE_EXPECTED_ORGANIZATION` and `ZEESPARE_TEST_DSN` replace the `MAQDAR_*` names, with no fallback.
- **Local stack**: `project_id = "zeespare"` creates new containers and volumes. Run `pnpm db:stop` in the old checkout first, then `pnpm db:start`, `pnpm db:env` and `pnpm synth:small`.
- **Not renamed**: the Cloudflare services `maqdar-acme-simulation` and the `maqdar-web.aqozatechnologies.workers.dev` hostname, the `maqdar.org` legacy domain and `acme@maqdar.org` demo account, and existing hosted login roles such as `maqdar_acme_simulation` (`scripts/simulation-worker-bind.sql` now creates `zeespare_acme_simulation` for new bindings).

Owner-run rollout order:

1. Pause hosted workers. Rename their secrets (`MAQDAR_*` → `ZEESPARE_*`) on the worker host and in Cloudflare; the new build reads only the new names.
2. Run `pnpm exec supabase db push` after review. Keys are revoked and roles renamed in the same transaction.
3. In the hosted Dashboard, confirm the two `zeespare-*` cron jobs exist and no `maqdar-*` job remains.
4. Deploy the web build and the worker image built from this commit, then resume workers.
5. Owners/admins create new API keys in Settings and send them to integrators, who must also update `x-zeespare-*` and `urn:zeespare:problem:*` handling.

Rollback: redeploy the previous builds and restore the previous function bodies and role names with a forward migration; revoked keys cannot be reactivated.

## Validation

Local production build and TypeScript passed. Web lint and logical-layout checks passed. All 1,658 web unit tests passed; all eight existing login layout / anonymous redirect browser tests passed. Screenshots cover 320x568, 390x844 and 1440x900. Both mobile sign-in choices remain visible. Mocked sign-in pending/error/success states are exercised without delivering external email. Inspect the final hosted domains, redirects and favicon after deployment. Keep the previous Cloudflare version available for rollback; avoid reverting the primary Auth Site URL unless reverting the domain cutover too.
