import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  supplierExplanationEvidenceSchema,
  supplierExplanationAnswerSchema,
} from './supplier-explainer'
import { explanationAnswerSchema } from './policy-explainer'
import { forecastExplanationAnswerSchema } from './forecast-explainer'
import { replenishmentExplanationAnswerSchema } from './replenishment-explainer'
import { requestClaudeSupplier } from './claude-policy.server'
import { executePolicyExplanation } from './policy-explainer-execution'
const evidence = supplierExplanationEvidenceSchema.parse({
  method: 'supplier-explainer-v1',
  unit: 'EA',
  scenario_context: { cutoff: '2026-10-01' },
  rounding_calculation: {
    gap: '28.004',
    moq: '30.001',
    pack: '0.250',
    quantity: '30.250',
    overage: '2.246',
  },
  lead_time_evidence: { policy_days: 3, supplier_days: 3 },
  scenario_limits: { terms_confirmed: true, interpretation: 'Saved terms only.' },
})
const input = { question: 'Why this rounding?', locale: 'en' as const, evidence }
const config = { key: 'test-only-provider-key-not-a-secret', model: 'claude-sonnet-5-5' }
const answer = {
  paragraphs: [
    {
      text: 'The saved quantity is 30.250 EA.',
      references: ['rounding_calculation' as const, 'lead_time_evidence' as const],
    },
  ],
}
const response = (a: unknown) =>
  new Response(
    JSON.stringify({
      model: config.model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(a) }],
    }),
  )
describe('supplier scenario explanations', () => {
  it('retains exact fractional packs and saved rounding results', () => {
    expect(evidence.rounding_calculation).toEqual({
      gap: '28.004',
      moq: '30.001',
      pack: '0.250',
      quantity: '30.250',
      overage: '2.246',
    })
  })
  it('retains zero-gap quantities and large exact decimal strings without float conversion', () => {
    const parse = (gap: string, quantity: string) =>
      supplierExplanationEvidenceSchema.parse({
        ...evidence,
        rounding_calculation: { ...evidence.rounding_calculation, gap, quantity, overage: '0' },
      })
    expect(parse('0', '0').rounding_calculation.quantity).toBe('0')
    expect(parse('999999999999999.999', '999999999999999.999').rounding_calculation.quantity).toBe(
      '999999999999999.999',
    )
  })
  it.each(['orders', 'prices', 'accounts', 'supplier'])('rejects extra %s evidence', (key) =>
    expect(
      supplierExplanationEvidenceSchema.safeParse({ ...evidence, [key]: 'private' }).success,
    ).toBe(false),
  )
  it('rejects missing lead times and nested supplier identifiers', () => {
    expect(
      supplierExplanationEvidenceSchema.safeParse({
        ...evidence,
        lead_time_evidence: { policy_days: 3, supplier_days: null },
      }).success,
    ).toBe(false)
    expect(
      supplierExplanationEvidenceSchema.safeParse({
        ...evidence,
        rounding_calculation: { ...evidence.rounding_calculation, supplier_code: 'private' },
      }).success,
    ).toBe(false)
  })
  it('requires the captured applicability confirmation', () =>
    expect(
      supplierExplanationEvidenceSchema.safeParse({
        ...evidence,
        scenario_limits: { ...evidence.scenario_limits, terms_confirmed: false },
      }).success,
    ).toBe(false))
  it('keeps all four citation vocabularies separate', () => {
    for (const schema of [
      explanationAnswerSchema,
      forecastExplanationAnswerSchema,
      replenishmentExplanationAnswerSchema,
    ])
      expect(schema.safeParse(answer).success).toBe(false)
    for (const ref of ['policy_inputs', 'model_comparison', 'gap_calculation'])
      expect(
        supplierExplanationAnswerSchema.safeParse({
          paragraphs: [{ text: 'bad', references: [ref] }],
        }).success,
      ).toBe(false)
  })
  it('sends only the validated summary with zero-gap and as-of limitations', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(answer))
    expect(await requestClaudeSupplier(input, config, fetcher)).toEqual({
      answer,
      model: config.model,
    })
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(JSON.parse(body.messages[0].content).evidence).toEqual(evidence)
    expect(body.system).toContain('Zero gap means zero quantity even when MOQ is positive')
    expect(body.system).toContain('Overage is quantity minus the original gap, not minus MOQ')
    expect(body.system).toContain('not a delivery schedule or promise')
    expect(body.tools).toBeUndefined()
  })
  it('rejects a provider citation from replenishment evidence', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ paragraphs: [{ text: 'bad', references: ['gap_calculation'] }] }),
      )
    await expect(requestClaudeSupplier(input, config, fetcher)).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })
  it('rejects a mismatched dispatch prompt before sending', async () => {
    const provider = vi.fn()
    await expect(
      executePolicyExplanation({
        dispatch: async () => ({
          dispatch: true,
          ...input,
          prompt_version: 'replenishment-explainer-v1',
        }),
        provider,
        complete: vi.fn(),
      }),
    ).rejects.toThrow('version mismatch')
    expect(provider).not.toHaveBeenCalled()
  })
  it('publishes only under current authority', async () => {
    await expect(
      executePolicyExplanation({
        dispatch: async () => ({
          dispatch: true,
          ...input,
          prompt_version: 'supplier-explainer-v1',
        }),
        provider: async () => ({ answer, model: config.model }),
        complete: async () => {
          throw new Error('revoked')
        },
      }),
    ).rejects.toThrow('revoked')
  })
})
