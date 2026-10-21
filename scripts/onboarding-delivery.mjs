/** Bounded cron consumer. Fixed endpoints only; no session cookies or credentials in diagnostics. */
export async function deliverInvitations({
  url,
  key,
  tenantOrigins,
  fetcher = fetch,
  maxMessages = 5,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const base = new URL(url)
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))
  )
    throw new Error('Invalid Supabase origin')
  if (!key || !Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 5)
    throw new Error('Invalid delivery configuration')
  const headers = { apikey: key, 'Content-Type': 'application/json' }
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`
  async function request(path, body) {
    return fetcher(new URL(path, base), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // Workers supports manual redirects; never forward credentials to a redirect destination.
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
  }
  async function rpc(name, body) {
    const response = await request(`/rest/v1/rpc/${name}`, body)
    if (!response.ok) throw new Error('Invitation queue request failed')
    return response.json()
  }
  let sent = 0
  for (let index = 0; index < maxMessages; index++) {
    if (index) await pause(12000)
    const job = await rpc('onboarding_claim', {})
    if (!job) break
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (
      ![job.id, job.lease, job.invitation_id, job.organization_id].every(
        (id) => typeof id === 'string' && uuid.test(id),
      ) ||
      typeof job.email !== 'string' ||
      job.email.length > 254 ||
      /[\r\n]/.test(job.email)
    )
      throw new Error('Invalid queue response')
    let outcome = 'failed'
    const tenant = tenantOrigins[job.organization_id]
    if (tenant) {
      const destination = new URL(tenant)
      const localTest =
        ['localhost', '127.0.0.1'].includes(base.hostname) &&
        ['localhost', '127.0.0.1'].includes(destination.hostname)
      if (
        (destination.protocol !== 'https:' && !(localTest && destination.protocol === 'http:')) ||
        destination.username ||
        destination.password ||
        destination.pathname !== '/' ||
        destination.search ||
        destination.hash
      )
        throw new Error('Invalid tenant origin')
      const redirectTo = `${destination.origin}/auth/email/invitations/${job.invitation_id}`
      try {
        let response = await request(
          `/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`,
          { email: job.email },
        )
        if (response.status === 422 || response.status === 400) {
          const error = await response.json()
          // Auth's unversioned wire response uses error_code; versioned responses use code.
          if ((error.error_code ?? error.code) === 'email_exists') {
            response = await request(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
              email: job.email,
              create_user: false,
            })
          }
        }
        outcome = response.ok
          ? 'sent'
          : response.status === 429
            ? 'retry'
            : response.status >= 500
              ? 'uncertain'
              : 'failed'
        if (!response.bodyUsed) await response.body?.cancel()
      } catch {
        // A timeout may follow SMTP acceptance. Never blindly retry an uncertain send.
        outcome = 'uncertain'
      }
    }
    await rpc('onboarding_finish', { p_job_id: job.id, p_lease: job.lease, p_outcome: outcome })
    if (outcome === 'sent') sent++
    if (outcome === 'retry' || outcome === 'uncertain') break
  }
  return sent
}
