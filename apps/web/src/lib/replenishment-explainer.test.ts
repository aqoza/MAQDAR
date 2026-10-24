import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  replenishmentExplanationEvidenceSchema,
  replenishmentExplanationAnswerSchema,
} from './replenishment-explainer'
import { explanationAnswerSchema } from './policy-explainer'
import { forecastExplanationAnswerSchema } from './forecast-explainer'
import { requestClaudeReplenishment } from './claude-policy.server'
import { executePolicyExplanation } from './policy-explainer-execution'
const evidence = replenishmentExplanationEvidenceSchema.parse({
  method: 'replenishment-explainer-v1',
  unit: 'EA',
  draft_context: { cutoff: '2026-10-01', protection_end: '2026-10-08', maximum_basis: 'approved' },
  gap_calculation: {
    maximum: '100.001',
    available_stock: '-5.002',
    remaining_inbound: '80.003',
    additional_backorders: '3.004',
    inventory_position: '71.997',
    unrounded_gap: '28.004',
  },
  supply_timing: { open_line_count: 2, overdue_line_count: 1, late_line_count: 1 },
  draft_limits: { orders_confirmed: true, interpretation: 'Captured as-of evidence only.' },
})
const input = { question: 'Why this gap?', locale: 'en' as const, evidence }
const config = { key: 'test-only-provider-key-not-a-secret', model: 'claude-sonnet-5-5' }
const answer = {
  paragraphs: [
    {
      text: 'The saved gap is 28.004 EA.',
      references: ['gap_calculation' as const, 'supply_timing' as const],
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
describe('replenishment explanations', () => {
  it('retains approved basis, negative stock and exact captured quantities', () => {
    expect(evidence.draft_context.maximum_basis).toBe('approved')
    expect(evidence.gap_calculation).toEqual({
      maximum: '100.001',
      available_stock: '-5.002',
      remaining_inbound: '80.003',
      additional_backorders: '3.004',
      inventory_position: '71.997',
      unrounded_gap: '28.004',
    })
  })
  it.each(['orders', 'prices', 'accounts', 'approval_reason'])('rejects extra %s evidence', (key) =>
    expect(
      replenishmentExplanationEvidenceSchema.safeParse({ ...evidence, [key]: 'private' }).success,
    ).toBe(false),
  )
  it('rejects nested details and unknown timing counts rather than interpreting zero', () => {
    expect(
      replenishmentExplanationEvidenceSchema.safeParse({
        ...evidence,
        supply_timing: { ...evidence.supply_timing, late_line_count: null },
      }).success,
    ).toBe(false)
    expect(
      replenishmentExplanationEvidenceSchema.safeParse({
        ...evidence,
        gap_calculation: { ...evidence.gap_calculation, order_code: 'private' },
      }).success,
    ).toBe(false)
  })
  it('requires the saved complete-order attestation', () =>
    expect(
      replenishmentExplanationEvidenceSchema.safeParse({
        ...evidence,
        draft_limits: { ...evidence.draft_limits, orders_confirmed: false },
      }).success,
    ).toBe(false))
  it('keeps all three citation vocabularies separate', () => {
    expect(explanationAnswerSchema.safeParse(answer).success).toBe(false)
    expect(forecastExplanationAnswerSchema.safeParse(answer).success).toBe(false)
    for (const ref of ['policy_inputs', 'model_comparison'])
      expect(
        replenishmentExplanationAnswerSchema.safeParse({
          paragraphs: [{ text: 'bad', references: [ref] }],
        }).success,
      ).toBe(false)
  })
  it('sends only the validated draft summary with as-of and timing limitations', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(answer))
    expect(await requestClaudeReplenishment(input, config, fetcher)).toEqual({
      answer,
      model: config.model,
    })
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(JSON.parse(body.messages[0].content).evidence).toEqual(evidence)
    expect(body.system).toContain('never subtract receipts again')
    expect(body.system).toContain('zero gap does not guarantee timely supply')
    expect(body.tools).toBeUndefined()
  })
  it('rejects a provider citation from a different subject', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ paragraphs: [{ text: 'bad', references: ['policy_inputs'] }] }))
    await expect(requestClaudeReplenishment(input, config, fetcher)).rejects.toMatchObject({
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
          prompt_version: 'forecast-explainer-v1',
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
          prompt_version: 'replenishment-explainer-v1',
        }),
        provider: async () => ({ answer, model: config.model }),
        complete: async () => {
          throw new Error('revoked')
        },
      }),
    ).rejects.toThrow('revoked')
  })
})
