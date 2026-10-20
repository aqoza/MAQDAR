# Public website and OTEGROUP workspace

Approved 20 October 2026. Public `zeespare.com`; private `ote.zeespare.com`. Shared deployment
and existing tenant database. Pilot: three months; business dates and measurable scope still
to be agreed. Oman / OMR. Amazon SES deliberately deferred by the owner.

## Acceptance contract

- Public homepage is accessible without signing in. No customer logos, invented metrics or endorsements.
- Public design uses the existing ZeeSpare mark, forest/lime/paper palette and planning illustration.
  Editorial product headline, workflow explanation, clear client-workspace entry. Review at
  1440x900 and 390x844; workspace login also 320x568. Existing app typography stays unchanged.
- Only explicit approved hosts resolve. Unknown/reserved slugs fail closed; forwarded headers
  cannot select an organization or generate an email origin.
- OTE requests are pinned to `OTE_ORGANIZATION_ID`, including organization lists, active context,
  switching, invitation acceptance and organization creation. Membership and RLS remain authoritative.
  Missing binding denies tenant access. Shared legacy entry remains available to existing users.
- Host-only session cookies; no parent-domain SSO. Stale active claims require opening the correct
  organization through the existing Server Action, then refresh exactly once.
- Email callbacks originate on the requesting workspace. Narrow production allow-list includes
  `/auth/email/dashboard` and `/auth/email/invitations/*`. Invite tokens are consumed only by POST.
  Old `/auth/confirm` and `/auth/invite` URLs stay supported.
- Cookie API mutations reject sibling-site origins; REST API keys keep their existing contract.
- Private pages are no-store/noindex; password and token values never enter source, logs or evidence.

## Deployment sequence

1. Create the authorized administrator through Supabase Auth and create the organization through
   the existing authenticated `create_organization` RPC (no schema migration or direct table writes).
2. Bind the resulting organization UUID as the Worker variable `OTE_ORGANIZATION_ID`; preserve
   existing secrets and bindings. Add the explicit OTE custom domain.
3. Deploy reviewed code after checks. Mirror both email templates and add the narrow callback paths
   for the approved apex, www, legacy and OTE hosts. Keep old URLs during rollout.
4. Verify password sign-in, OTE context, logout, public homepage and unauthorized requests.
5. Customer email delivery remains unverified/unavailable until SES is configured and tested.

## UI states

Public homepage is static editorial content; data loading, empty and partial states do not apply.
Workspace finder rejects unknown names inline and provides a corrective action. Login retains
existing pending, invalid, expired-link and neutral-email feedback. A valid user without OTE
membership sees a restricted workspace explanation and can sign out; no other tenant is shown.

References: [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
