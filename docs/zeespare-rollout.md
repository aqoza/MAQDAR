# ZeeSpare rebrand and domain cutover

The public product is ZeeSpare at https://zeespare.com. The existing Cloudflare Worker is renamed in place to zeespare-web; its immutable identity, deployment history, encrypted secret, rate limit bindings and database remain intact. WORKER_SELF_REFERENCE must target zeespare-web. Keep maqdar.org as a legacy custom-domain alias and attach www.zeespare.com as an additional alias. Preserve the domain's existing MX/TXT records.

## Deployment settings

Wrangler declares the three custom domains and NEXT_PUBLIC_SITE_URL=https://zeespare.com. Set the same public site URL in Cloudflare's production build variables. Retain the current Supabase URL and publishable key, PNPM_VERSION and encrypted SUPABASE_SECRET_KEY. The repository and production branch stay aqoza/MAQDAR and main. Do not create a second Worker with missing secrets.

In Supabase Auth URL Configuration, change Site URL to https://zeespare.com and add the exact https://zeespare.com/dashboard and https://www.zeespare.com/dashboard return destinations used by sign-in links. Keep existing legacy and development destinations during transition. Also allow https://zeespare.com/invitations/* (one invitation ID segment) and https://www.zeespare.com/invitations/*, because invitation delivery supplies an absolute return URL for the invitation. The template uses SiteURL for its token-hash entry route; maintain that route and mail-gateway-safe POST confirmation.

Mirror the branded invitation and sign-in templates and subjects from supabase/templates and supabase/config.toml into hosted Auth email templates. Change the display sender name to ZeeSpare if supported without changing verified sender credentials. Do not claim a zeespare.com sending address is ready until its mail provider verifies it; this cutover does not replace SMTP credentials or DNS mail authentication.

## Compatibility

Existing maqdar_sk_ API keys, x-maqdar-* OpenAPI extensions, database roles/SQLSTATEs, engine modules, CLI names and workspace package names remain stable. Existing integrations do not need new keys. Historical reports and the GitHub repository retain their original identity. No data migration or tenant changes are needed. Existing browser sessions remain scoped to their original domain; users sign in normally on zeespare.com.

## Validation

Local production build and TypeScript passed. Web lint and logical-layout checks passed. All 1,658 web unit tests passed; all eight existing login layout / anonymous redirect browser tests passed. Screenshots cover 320x568, 390x844 and 1440x900. Both mobile sign-in choices remain visible. Mocked sign-in pending/error/success states are exercised without delivering external email. Inspect the final hosted domains, redirects and favicon after deployment. Keep the previous Cloudflare version available for rollback; avoid reverting the primary Auth Site URL unless reverting the domain cutover too.
