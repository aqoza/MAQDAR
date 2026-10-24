vi.mock('server-only', () => ({}))
import { describe, it, expect, vi } from 'vitest'
import {
  deliveryExplanationEvidenceSchema as schema,
  deliveryExplanationAnswerSchema,
} from './delivery-explainer'
export const evidence = {
  method: 'delivery-explainer-v1',
  unit: 'EA',
  outcome: 'available',
  delivery_context: {
    cutoff: '2026-10-01',
    quantity: '30.250',
    lead_time_days: 3,
    requested_date: '2026-10-01',
  },
  schedule: {
    order_date: '2026-10-03',
    nominal_receipt: '2026-10-06',
    receipt_date: '2026-10-07',
    policy_reference_date: '2026-10-04',
    elapsed_days: 6,
    policy_recalculation_required: true,
  },
  calendar_adjustments: {
    calendars_confirmed: true,
    supplier: {
      evaluated_days: 3,
      closed_days: 2,
      closed_reasons: { calendar_override: 0, country_override: 0, public_holiday: 1, weekend: 1 },
      selected_reason: 'weekly_pattern',
    },
    receiver: {
      evaluated_days: 2,
      closed_days: 1,
      closed_reasons: { calendar_override: 1, country_override: 0, public_holiday: 0, weekend: 0 },
      selected_reason: 'calendar_override',
    },
  },
  delivery_limits: { interpretation: 'Captured indicative schedule only.' },
}
const zero = {
  ...evidence,
  outcome: 'no_order_needed',
  delivery_context: { ...evidence.delivery_context, quantity: '0.000' },
  schedule: null,
  calendar_adjustments: null,
}
describe('captured delivery explanation contract', () => {
  it('preserves exact quantity, saved dates and a true timing warning', () => {
    const e = schema.parse(evidence)
    expect(e.delivery_context.quantity).toBe('30.250')
    expect(e.schedule?.policy_recalculation_required).toBe(true)
  })
  it('accepts explicit zero without implying calendars were evaluated', () =>
    expect(schema.parse(zero).schedule).toBeNull())
  it.each(['supplier', 'prices', 'accounts', 'calendar_notes'])('rejects extra %s', (key) =>
    expect(schema.safeParse({ ...evidence, [key]: 'private' }).success).toBe(false),
  )
  it('rejects nested notes and unidentified closure reasons', () => {
    const e = structuredClone(evidence)
    Object.assign(e.calendar_adjustments.supplier, { notes: 'private' })
    expect(schema.safeParse(e).success).toBe(false)
    e.calendar_adjustments.supplier.selected_reason = 'unknown_coverage'
    expect(schema.safeParse(e).success).toBe(false)
  })
  it('rejects invented zero schedules and positive no-order outcomes', () => {
    expect(schema.safeParse({ ...zero, schedule: evidence.schedule }).success).toBe(false)
    expect(schema.safeParse({ ...zero, delivery_context: evidence.delivery_context }).success).toBe(
      false,
    )
    expect(schema.safeParse({ ...evidence, delivery_context: zero.delivery_context }).success).toBe(
      false,
    )
  })
  it('rejects inconsistent dates, warnings and count totals', () => {
    for (const patch of [
      { nominal_receipt: '2026-10-05' },
      { elapsed_days: 5 },
      { policy_recalculation_required: false },
      { receipt_date: null },
    ])
      expect(
        schema.safeParse({ ...evidence, schedule: { ...evidence.schedule, ...patch } }).success,
      ).toBe(false)
    const e = structuredClone(evidence)
    e.calendar_adjustments.supplier.closed_days = 1
    expect(schema.safeParse(e).success).toBe(false)
  })
  it('requires known lead time and explicit applicability for a schedule', () => {
    expect(
      schema.safeParse({
        ...evidence,
        delivery_context: { ...evidence.delivery_context, lead_time_days: null },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...evidence,
        calendar_adjustments: { ...evidence.calendar_adjustments, calendars_confirmed: false },
      }).success,
    ).toBe(false)
  })
  it('keeps delivery citations separate', () => {
    for (const ref of [
      'rounding_calculation',
      'gap_calculation',
      'policy_inputs',
      'model_comparison',
      'https://example.com',
    ])
      expect(
        deliveryExplanationAnswerSchema.safeParse({
          paragraphs: [{ text: 'bad', references: [ref] }],
        }).success,
      ).toBe(false)
  })
})

import { requestClaudeDelivery } from './claude-policy.server'
import { executePolicyExplanation } from './policy-explainer-execution'
const config = { key: 'test-only-provider-key-not-a-secret', model: 'claude-sonnet-5-5' }
const answer = { paragraphs: [{ text: 'Captured dates only.', references: ['schedule' as const] }] }
const response = (a: unknown) =>
  new Response(
    JSON.stringify({
      model: config.model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(a) }],
    }),
  )
describe('delivery provider boundary', () => {
  it.each([evidence, zero])('sends only the validated captured outcome', async (raw) => {
    const e = schema.parse(raw),
      fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(answer))
    expect(
      await requestClaudeDelivery(
        { question: 'Why these dates?', locale: 'en', evidence: e },
        config,
        fetcher,
      ),
    ).toEqual({ answer, model: config.model })
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(JSON.parse(body.messages[0].content).evidence).toEqual(e)
    expect(body.system).toContain('No-order-needed means explicit zero quantity')
    expect(body.system).toContain('not supplier promises')
    expect(body.system).toContain('do not identify which specific date')
    expect(body.tools).toBeUndefined()
  })
  it('rejects foreign references from the provider', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ paragraphs: [{ text: 'bad', references: ['policy_inputs'] }] }))
    await expect(
      requestClaudeDelivery(
        { question: 'Why?', locale: 'en', evidence: schema.parse(evidence) },
        config,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it('checks dispatch version before provider access', async () => {
    const provider = vi.fn()
    await expect(
      executePolicyExplanation({
        dispatch: async () => ({
          dispatch: true,
          question: 'Why?',
          locale: 'en',
          evidence,
          prompt_version: 'supplier-explainer-v1',
        }),
        provider,
        complete: vi.fn(),
      }),
    ).rejects.toThrow('version mismatch')
    expect(provider).not.toHaveBeenCalled()
  })
  it('does not return text if publication authority was revoked', async () => {
    await expect(
      executePolicyExplanation({
        dispatch: async () => ({
          dispatch: true,
          question: 'Why?',
          locale: 'en',
          evidence,
          prompt_version: 'delivery-explainer-v1',
        }),
        provider: async () => ({ answer, model: config.model }),
        complete: async () => {
          throw new Error('revoked')
        },
      }),
    ).rejects.toThrow('revoked')
  })
})
