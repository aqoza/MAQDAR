import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Log, LogLevel, Miniflare, Response, convertV4MiniflareOptions } from 'miniflare'

const delivery = await readFile(new URL('./onboarding-delivery.mjs', import.meta.url), 'utf8')
const job = {
  id: '00000000-0000-4000-8000-000000000001',
  lease: '00000000-0000-4000-8000-000000000002',
  invitation_id: '00000000-0000-4000-8000-000000000003',
  email: 'person@example.com',
  organization_id: '00000000-0000-4000-8000-000000000004',
}
const options = {
  url: 'https://auth.example.com',
  key: 'sb_secret_synthetic',
  tenantOrigins: { [job.organization_id]: 'https://ote.example.com' },
  maxMessages: 1,
}

async function runScheduled(responses) {
  const calls = []
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: `${delivery}\nexport default {
        scheduled(_event, _env, ctx) {
          ctx.waitUntil(deliverInvitations(${JSON.stringify(options)}))
        }
      }`,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      log: new Log(LogLevel.NONE),
      outboundService: async (request) => {
        const url = new URL(request.url)
        calls.push({ url: url.href, body: await request.json() })
        assert.equal(url.origin, options.url, 'credentials must stay on the fixed Supabase origin')
        assert.equal(request.headers.get('apikey'), options.key)
        const response = responses.shift()
        assert.ok(response, 'unexpected outbound request')
        return response.location
          ? new Response(null, { status: 302, headers: { Location: response.location } })
          : Response.json(response.body)
      },
    }),
  )
  try {
    const worker = await runtime.getWorker()
    const result = await worker.scheduled({ cron: '* * * * *' })
    return { result, calls }
  } finally {
    await runtime.dispose()
  }
}

test('Workers scheduled event handles an empty queue with native fetch and no email request', async () => {
  const { result, calls } = await runScheduled([{ body: null }])
  assert.equal(result.outcome, 'ok')
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ['/rest/v1/rpc/onboarding_claim'],
  )
})

test('Workers scheduled event sends one invitation and acknowledges its exact lease', async () => {
  const { result, calls } = await runScheduled([{ body: job }, { body: {} }, { body: true }])
  assert.equal(result.outcome, 'ok')
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ['/rest/v1/rpc/onboarding_claim', '/auth/v1/invite', '/rest/v1/rpc/onboarding_finish'],
  )
  assert.equal(calls[2].body.p_outcome, 'sent')
  assert.equal(calls[2].body.p_lease, job.lease)
})

test('Workers scheduled event stops at a queue redirect without forwarding credentials', async () => {
  const { result, calls } = await runScheduled([{ location: 'https://untrusted.example/queue' }])
  assert.equal(result.outcome, 'exception')
  assert.equal(calls.length, 1)
})

test('Workers scheduled event marks an Auth redirect failed without following it', async () => {
  const { result, calls } = await runScheduled([
    { body: job },
    { location: 'https://untrusted.example/invite' },
    { body: true },
  ])
  assert.equal(result.outcome, 'ok')
  assert.equal(calls.length, 3)
  assert.equal(calls[2].body.p_outcome, 'failed')
})
