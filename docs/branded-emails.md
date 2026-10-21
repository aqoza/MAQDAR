# ZeeSpare branded emails

## Design contract

- Surface: transactional Supabase Auth emails. The recipient must immediately understand the event, the next action and whether a security response is needed.
- Reference: the approved Industrial Studio login and supplied Precision logo. Forest, emerald, signal lime and warm paper; a compact heading, readable content and one prominent action. The existing plain email in the supplied screenshot is the before reference.
- Hierarchy: Precision logo → event heading → explanation → action or verification code → expiry/security guidance → quiet brand footer.
- Layout: fluid 600px email card, presentation tables, inline styles, system fonts, real PNG logo with useful alt text. Essential content must survive blocked images and stripped media queries. No JavaScript, web fonts, tracking pixels or invented planning metrics.
- Type: 24/32px heading, 14/22px body, 14/20px action, 12/18px supporting text. This is an email-specific scale; application typography is unchanged.
- Viewports: 1440×900 desktop, 390×844 and 320×568 mobile. Check long content, images blocked and dark preference. Browser previews are not a substitute for Gmail/Outlook delivery certification.
- Coverage: all six Auth template slots; matching templates for all seven optional security notifications, with notification delivery remaining disabled. Confirmation keeps the existing sign-in-link contract.
- Safety: preserve invitation, sign-in and password-recovery token URLs verbatim; email change retains Supabase's ConfirmationURL and dual-confirmation behavior. No personal data or tokens in image URLs. No new email sending endpoints or hosted configuration changes.
- States: action-required, one-time-code and informational/security notices are applicable. Loading, empty and partial states are not applicable to fully rendered messages. Expired/invalid link handling remains in the application and must retain its existing tests.

## Implementation and review

`supabase/templates/content.en.json` holds the English copy and slot mapping. `scripts/render-email-templates.mjs` generates standalone, paste-ready HTML with a shared shell; `pnpm emails:check` detects drift. No email provider or dependency was added. Both Settings invitations and the enterprise-onboarding delivery worker already use Auth, so they use these same templates.

The supplied Precision master PNG was copied unchanged from `zeespare_web/design/precision/png/zeespare-horizontal-reversed-800px.png`. It is served publicly at `/images/email/zeespare-precision-reversed.png`; the email displays it at 176×38px. The source includes no recipient-specific image URL, tracking pixels, user metadata or remote fonts. Text links remain available when the styled button is not rendered.

### Coverage

| Supabase slot         | HTML file                    | Delivery policy                                                 |
| --------------------- | ---------------------------- | --------------------------------------------------------------- |
| Invite                | `invite.html`                | Existing invitation flow                                        |
| Magic link            | `sign-in-link.html`          | Existing-account invitation fallback / compatible sign-in links |
| Confirm signup        | `sign-in-link.html`          | Existing mapping retained; public signup remains disabled       |
| Recovery              | `recovery.html`              | Existing password recovery                                      |
| Change email          | `email-change.html`          | Requires confirmation from both addresses                       |
| Reauthentication      | `reauthentication.html`      | Code supplied by Auth; secure-password-change setting unchanged |
| Password changed      | `password-changed.html`      | Prepared, disabled locally                                      |
| Email changed         | `email-changed.html`         | Prepared, disabled locally                                      |
| Phone changed         | `phone-changed.html`         | Prepared, disabled locally                                      |
| Identity linked       | `identity-linked.html`       | Prepared, disabled locally                                      |
| Identity unlinked     | `identity-unlinked.html`     | Prepared, disabled locally                                      |
| MFA factor enrolled   | `mfa-factor-enrolled.html`   | Prepared, disabled locally                                      |
| MFA factor unenrolled | `mfa-factor-unenrolled.html` | Prepared, disabled locally                                      |

### Screenshots and visual review

All 12 unique templates were rendered at 1440×900, 390×844 and 320×568. The original promotional headings were shortened to explicit transactional titles after the first visual pass. The final captures show no horizontal overflow, unbroken logo proportions and legible headings, body copy, code and action labels. Primary buttons measure 50px high and receive keyboard focus. The verification preview deliberately uses an eight-digit fixture to check fit; real code length remains controlled by Auth.

- [Sign-in, desktop](branded-email-visuals/sign-in-desktop.png)
- [Invitation, desktop](branded-email-visuals/invitation-desktop.png)
- [Password recovery, mobile](branded-email-visuals/recovery-mobile.png)
- [Verification code, narrow mobile](branded-email-visuals/code-narrow.png)
- [Security notification](branded-email-visuals/security-desktop.png)
- [Images blocked, responsive CSS removed, dark browser preference](branded-email-visuals/blocked-images.png)

The final fallback intentionally retains the light palette; browser dark preference does not emulate Gmail's forced color transformations. Supporting text has at least 5.18:1 contrast on its background, main body text 9.18:1 and the primary button 9.73:1. Layout tables are presentational, headings remain semantic and the logo has an accessible name. Browser screenshots verify HTML layout, not Outlook/Gmail certification: Outlook may render square corners, and clients can override colors or image display. No real-recipient mail was sent.

### Owner-run hosted rollout, after review

This PR does **not** deploy the app, change hosted Auth configuration or enable notifications. Supabase does not automatically apply local template files to hosted projects.

1. After separately approved deployment, verify that the configured Auth **Site URL** serves `/images/email/zeespare-precision-reversed.png` publicly over HTTPS. If the Site URL uses a separate website deployment, serve the supplied asset at that exact path there first. Do not change Site URL, workspace redirects or token parameters just to make the logo load. The alt text remains usable if images are blocked.
2. In hosted Auth → Email Templates, copy each generated HTML file and its subject from `supabase/config.toml` into the corresponding slot above. Preserve the existing invite/sign-in/recovery URL expressions and the native email-change `ConfirmationURL`.
3. Apply security-notification styling to any notices already enabled on the hosted project. Preserve each hosted enablement setting; the local `enabled = false` entries are not a request to disable hosted notices or enable new ones. Phone/identity/MFA templates are visual coverage, not new application capabilities.
4. Keep confirmation requirements, workspace callback allowlists, one-hour Auth link expiry and seven-day organization invitation validity unchanged. Email delivery remains English; localized delivery requires separate work rather than trusting locale/organization fields in Auth user metadata.
5. Use designated test recipients to verify actual Gmail and Outlook delivery, button destinations and blocked-image behavior before declaring client coverage. Retain the previous hosted templates for rollback. Do not use `supabase config push` to roll out this visual change.

Template configuration and variable behavior follow the [Supabase email template documentation](https://supabase.com/docs/guides/auth/auth-email-templates) and [local customization guide](https://supabase.com/docs/guides/local-development/customizing-email-templates).

### Verification

- Lint, typecheck, logical-utility checks and production Next.js build passed.
- All 1,907 web unit tests passed with `--maxWorkers=2 --testTimeout=30000`; the default parallel run hit three existing 5-second source-scan timeouts. The simulation worker's 13 tests and onboarding delivery's 10 safety tests also passed. No CI timeout or concurrency settings were changed.
- All 21 relevant Playwright tests passed against the production build: branded emails, invitations, password recovery and workspace hosts. These include real local Mailpit delivery of code/email-change messages, dual confirmation, invite acceptance/revocation, password reset/token reuse rejection and workspace callback preservation.
- The first browser run had two invitation failures because the isolated local database lacked the already-merged onboarding migration. Applied only the missing merged migrations to that local stack, then reran the full relevant browser set successfully.
- The [visual evidence record](branded-email-visuals/evidence.json) passed ECC's evidence checker. Saved production screenshots match the inspected HTML previews byte-for-byte. This is browser/local-delivery verification; hosted email client certification remains an owner-run rollout step.
