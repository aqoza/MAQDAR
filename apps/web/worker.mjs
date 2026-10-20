import nextWorker from './.open-next/worker.js'
import { deliverInvitations } from '../../scripts/onboarding-delivery.mjs'

// OpenNext's generated request handler is unchanged. Cron has no public HTTP endpoint.
const worker = {
  fetch: nextWorker.fetch,
  async scheduled(_event, env, ctx) {
    if (env.ONBOARDING_EMAIL_DELIVERY !== 'enabled') return
    ctx.waitUntil(
      deliverInvitations({
        url: env.ONBOARDING_SUPABASE_URL,
        key: env.SUPABASE_SECRET_KEY,
        tenantOrigins: {
          [env.OTE_ORGANIZATION_ID]: 'https://ote.zeespare.com',
          [env.ACME_ORGANIZATION_ID]: 'https://acme.zeespare.com',
        },
      }).catch(() => {
        throw new Error('Invitation delivery failed; inspect queue status and configuration')
      }),
    )
  },
}
export default worker
