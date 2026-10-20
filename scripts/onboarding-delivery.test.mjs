import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliverInvitations } from './onboarding-delivery.mjs'

const origin = 'https://auth.example.com'
const job = {
  id: '00000000-0000-4000-8000-000000000001',
  lease: '00000000-0000-4000-8000-000000000002',
  invitation_id: '00000000-0000-4000-8000-000000000003',
  email: 'person@example.com',
  organization_id: '00000000-0000-4000-8000-000000000004',
}
function harness(responses) {
  const calls = []
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url: String(url), ...options, body: JSON.parse(options.body) })
      const response = responses.shift()
      if (response instanceof Error) throw response
      assert.ok(response, 'unexpected network call')
      return Response.json(response.body, { status: response.status ?? 200 })
    },
  }
}
const config = {
  url: origin,
  key: 'sb_secret_synthetic',
  tenantOrigins: { [job.organization_id]: 'https://ote.example.com' },
  maxMessages: 1,
}

test('sends a claimed invitation to its trusted tenant return URL, then acknowledges the lease', async () => {
  const h = harness([{ body: job }, { body: {} }, { body: true }])
  assert.equal(await deliverInvitations({ ...config, ...h }), 1)
  assert.equal(new URL(h.calls[1].url).pathname, '/auth/v1/invite')
  assert.equal(
    new URL(h.calls[1].url).searchParams.get('redirect_to'),
    `https://ote.example.com/auth/email/invitations/${job.invitation_id}`,
  )
  assert.equal(h.calls[2].body.p_outcome, 'sent')
  assert.equal(h.calls[2].body.p_lease, job.lease)
})
test('existing accounts receive an OTP without public signup or session mutation', async () => {
  const h = harness([
    { body: job },
    { status: 422, body: { code: 422, error_code: 'email_exists' } },
    { body: {} },
    { body: true },
  ])
  await deliverInvitations({ ...config, ...h })
  assert.equal(new URL(h.calls[2].url).pathname, '/auth/v1/otp')
  assert.equal(h.calls[2].body.create_user, false)
  assert.equal(h.calls[3].body.p_outcome, 'sent')
})
test('known throttling requests a retry and immediately stops the drain', async () => {
  const h = harness([
    { body: job },
    { status: 429, body: { code: 'over_email_send_rate_limit' } },
    { body: true },
  ])
  assert.equal(await deliverInvitations({ ...config, ...h, maxMessages: 5 }), 0)
  assert.equal(h.calls[2].body.p_outcome, 'retry')
  assert.equal(h.calls.length, 3)
})
test('ambiguous transport failures are held for review rather than automatically sending twice', async () => {
  const h = harness([{ body: job }, new Error('network'), { body: true }])
  await deliverInvitations({ ...config, ...h })
  assert.equal(h.calls[2].body.p_outcome, 'uncertain')
})
test('does not send for an unknown tenant or accept a redirect origin from a queue row', async () => {
  const h = harness([
    {
      body: {
        ...job,
        organization_id: '00000000-0000-4000-8000-000000000099',
        redirect_to: 'https://evil.example',
      },
    },
    { body: true },
  ])
  await deliverInvitations({ ...config, ...h })
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].body.p_outcome, 'failed')
})
test('empty or paced queue makes no email request', async () => {
  const h = harness([{ body: null }])
  assert.equal(await deliverInvitations({ ...config, ...h }), 0)
  assert.equal(h.calls.length, 1)
})
test('will not transmit a secret to an insecure or credential-bearing origin', async () => {
  for (const url of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/untrusted',
  ]) {
    const h = harness([])
    await assert.rejects(() => deliverInvitations({ ...config, ...h, url }))
    assert.equal(h.calls.length, 0)
  }
})

test('consumer is bounded and preserves the interval between messages', async () => {
  const h = harness(
    Array.from({ length: 5 }, () => [{ body: job }, { body: {} }, { body: true }]).flat(),
  )
  const pauses = []
  assert.equal(
    await deliverInvitations({
      ...config,
      ...h,
      maxMessages: 5,
      pause: async (ms) => {
        pauses.push(ms)
      },
    }),
    5,
  )
  assert.deepEqual(pauses, Array(4).fill(12000))
})
test('server-side errors are uncertain, permanent errors fail, and queue errors stop delivery', async () => {
  for (const [status, outcome] of [
    [503, 'uncertain'],
    [403, 'failed'],
  ]) {
    const h = harness([{ body: job }, { status, body: {} }, { body: true }])
    await deliverInvitations({ ...config, ...h })
    assert.equal(h.calls[2].body.p_outcome, outcome)
  }
  const h = harness([{ status: 500, body: {} }])
  await assert.rejects(() => deliverInvitations({ ...config, ...h }))
  assert.equal(h.calls.length, 1)
})
test('invalid configuration or malformed queue rows cannot initiate an email', async () => {
  await assert.rejects(() => deliverInvitations({ ...config, key: '' }))
  await assert.rejects(() => deliverInvitations({ ...config, maxMessages: 9 }))
  const h = harness([{ body: { ...job, email: 'header\r\ninjection@example.com' } }])
  await assert.rejects(() => deliverInvitations({ ...config, ...h }))
  assert.equal(h.calls.length, 1)
  const tenant = harness([{ body: job }])
  await assert.rejects(() =>
    deliverInvitations({
      ...config,
      ...tenant,
      tenantOrigins: { [job.organization_id]: 'http://evil.example' },
    }),
  )
  assert.equal(tenant.calls.length, 1)
})
