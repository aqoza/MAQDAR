import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  explanationAnswerSchema,
  explanationEvidenceSchema,
  explanationRequestSchema,
  explanationStatus,
} from './policy-explainer'
import { executePolicyExplanation } from './policy-explainer-execution'
import {
  requestClaudePolicy,
  policyExplainerConfiguration,
  ExplanationProviderError,
  CLAUDE_API_VERSION,
} from './claude-policy.server'
const period = {
  days: 3,
  forecast: '3.001',
  quantile: '4.125',
  target: '4.125',
  safety_stock: '1.124',
}
const evidence = {
  method: 'policy-explainer-v1' as const,
  unit: 'EA',
  cutoff: '2026-10-01',
  policy_inputs: { lead_time_days: 3, review_interval_days: 4, cycle_service_target: '0.95' },
  lead_threshold: period,
  review_threshold: { ...period, days: 7, target: '8.125' },
  forecast: { method: 'expanded-v1' as const, model: 'naive', horizon_days: 28 },
  evidence_limits: {
    residual_count: 84,
    positive_days: 90,
    bootstrap_samples: 5000,
    interpretation: 'Calculated evidence only.',
  },
}
const answer = {
  paragraphs: [
    { text: 'The saved lead time is three calendar days.', references: ['policy_inputs' as const] },
  ],
}
const config = { key: 'test-only-provider-key-not-a-secret', model: 'claude-sonnet-5-5' }
const response = (changes = {}) =>
  new Response(
    JSON.stringify({
      model: config.model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      ...changes,
    }),
  )
const input = { question: 'Why this maximum?', locale: 'en' as const, evidence }
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
describe('captured policy evidence and reference validation', () => {
  it('retains exact decimal text and rejects added sensitive fields at every level', () => {
    expect(explanationEvidenceSchema.parse(evidence).lead_threshold.target).toBe('4.125')
    for (const bad of [
      { ...evidence, email: 'private@example.com' },
      { ...evidence, forecast: { ...evidence.forecast, transactions: [] } },
      { ...evidence, policy_inputs: { ...evidence.policy_inputs, unit_cost: '20' } },
    ])
      expect(explanationEvidenceSchema.safeParse(bad).success).toBe(false)
  })
  it('excludes groups and unknown units', () => {
    expect(explanationEvidenceSchema.safeParse({ ...evidence, unit: null }).success).toBe(false)
    expect(
      explanationEvidenceSchema.safeParse({
        ...evidence,
        forecast: { ...evidence.forecast, method: 'regional-v1' },
      }).success,
    ).toBe(false)
  })
  it.each(['https://attacker.example', 'stock', 'approvals', ''])(
    'rejects unknown reference %s',
    (reference) => {
      expect(
        explanationAnswerSchema.safeParse({
          paragraphs: [{ text: 'Claim', references: [reference] }],
        }).success,
      ).toBe(false)
    },
  )
  it('rejects oversized and empty responses', () => {
    expect(explanationAnswerSchema.safeParse({ paragraphs: [] }).success).toBe(false)
    expect(
      explanationAnswerSchema.safeParse({ paragraphs: Array(9).fill(answer.paragraphs[0]) })
        .success,
    ).toBe(false)
    expect(
      explanationAnswerSchema.safeParse({
        paragraphs: [{ text: 'x'.repeat(2001), references: ['policy_inputs'] }],
      }).success,
    ).toBe(false)
  })
  it('requires confirmation, bounded questions and stable identifiers', () => {
    const request = {
      policy_id: '00000000-0000-4000-8000-000000000001',
      request_id: '00000000-0000-4000-8000-000000000002',
      fingerprint: 'a'.repeat(64),
      question: 'Why?\nExplain assumptions.',
      confirmed: true,
    }
    expect(explanationRequestSchema.safeParse(request).success).toBe(true)
    for (const change of [
      { confirmed: false },
      { question: '' },
      { question: 'x'.repeat(2001) },
      { question: '\u0001bad' },
      { fingerprint: 'bad' },
    ])
      expect(explanationRequestSchema.safeParse({ ...request, ...change }).success).toBe(false)
  })
  it('labels abandoned requests separately without pretending the provider failed', () => {
    expect(
      explanationStatus('running', '2026-10-01T00:00:00Z', Date.parse('2026-10-01T00:04:00Z')),
    ).toBe('expired')
    expect(
      explanationStatus('succeeded', '2026-10-01T00:00:00Z', Date.parse('2026-10-01T00:04:00Z')),
    ).toBe('succeeded')
  })
})
describe('Claude boundary', () => {
  it('remains unconfigured without both explicit server values', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ZEESPARE_CLAUDE_MODEL', config.model)
    expect(policyExplainerConfiguration()).toBeNull()
    vi.stubEnv('ANTHROPIC_API_KEY', config.key)
    vi.stubEnv('ZEESPARE_CLAUDE_MODEL', '')
    expect(policyExplainerConfiguration()).toBeNull()
  })
  it('sends only the projected evidence and question to a fixed endpoint without tools or identifiers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response())
    expect(await requestClaudePolicy(input, config, fetcher)).toEqual({
      answer,
      model: config.model,
    })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init).toMatchObject({
      redirect: 'error',
      cache: 'no-store',
      headers: { 'anthropic-version': CLAUDE_API_VERSION },
    })
    const body = JSON.parse(String(init?.body))
    expect(body.tools).toBeUndefined()
    expect(body.max_tokens).toBe(4096)
    expect(JSON.parse(body.messages[0].content)).toEqual({
      question: input.question,
      language: 'en',
      evidence,
    })
    expect(body.system).toContain('untrusted data')
    expect(body.output_config.format.type).toBe('json_schema')
    expect(String(init?.body)).not.toContain(config.key)
  })
  it.each(['max_tokens', 'refusal', 'tool_use', 'pause_turn'])(
    'rejects incomplete or unsafe stop reason %s',
    async (stop_reason) => {
      await expect(
        requestClaudePolicy(input, config, vi.fn().mockResolvedValue(response({ stop_reason }))),
      ).rejects.toMatchObject({ code: 'invalid_response' })
    },
  )
  it.each([401, 429, 500])('sanitizes HTTP %s without retrying', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private upstream detail', { status }))
    await expect(requestClaudePolicy(input, config, fetcher)).rejects.toThrow('provider_error')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed JSON and unrecognized evidence references', async () => {
    for (const reply of [
      new Response('{'),
      response({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ paragraphs: [{ text: 'bad', references: ['unknown'] }] }),
          },
        ],
      }),
    ]) {
      await expect(
        requestClaudePolicy(input, config, vi.fn().mockResolvedValue(reply)),
      ).rejects.toMatchObject({ code: 'invalid_response' })
    }
  })
  it('bounds response bytes before parsing', async () => {
    await expect(
      requestClaudePolicy(
        input,
        config,
        vi.fn().mockResolvedValue(new Response('x'.repeat(65_537))),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it('aborts slow calls and does not retry', async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))),
          ),
      )
    const result = requestClaudePolicy(input, config, fetcher)
    const check = expect(result).rejects.toMatchObject({ code: 'provider_timeout' })
    await vi.advanceTimersByTimeAsync(45_001)
    await check
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
describe('authority and immutable provider publication', () => {
  const dispatch = { dispatch: true, ...input, prompt_version: 'policy-explainer-v1' }
  it('does not call provider after revoked authority or on an already dispatched retry', async () => {
    for (const fn of [
      vi.fn().mockResolvedValue({ dispatch: false }),
      vi.fn().mockRejectedValue(new Error('revoked')),
    ]) {
      const provider = vi.fn(),
        complete = vi.fn()
      await executePolicyExplanation({ dispatch: fn, provider, complete }).catch(() => {})
      expect(provider).not.toHaveBeenCalled()
      expect(complete).not.toHaveBeenCalled()
    }
  })
  it('validates dispatch evidence before any external request', async () => {
    const provider = vi.fn(),
      complete = vi.fn()
    await expect(
      executePolicyExplanation({
        dispatch: async () => ({ ...dispatch, evidence: { ...evidence, account: 'private' } }),
        provider,
        complete,
      }),
    ).rejects.toThrow()
    expect(provider).not.toHaveBeenCalled()
  })
  it('returns no generated answer when publication authorization fails', async () => {
    const provider = vi.fn().mockResolvedValue({ answer, model: config.model })
    const complete = vi.fn().mockRejectedValue(new Error('revoked before publication'))
    await expect(
      executePolicyExplanation({ dispatch: async () => dispatch, provider, complete }),
    ).rejects.toThrow('revoked before publication')
    expect(complete).toHaveBeenCalledWith({ answer, model: config.model, error: null })
  })
  it('persists only a safe failure code', async () => {
    const complete = vi.fn()
    await executePolicyExplanation({
      dispatch: async () => dispatch,
      provider: async () => {
        throw new ExplanationProviderError('provider_timeout')
      },
      complete,
    })
    expect(complete).toHaveBeenCalledWith({ answer: null, model: null, error: 'provider_timeout' })
  })
})
