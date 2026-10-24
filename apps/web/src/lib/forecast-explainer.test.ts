import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  forecastExplanationEvidenceSchema,
  forecastExplanationAnswerSchema,
} from './forecast-explainer'
import { explanationAnswerSchema } from './policy-explainer'
import { executePolicyExplanation } from './policy-explainer-execution'
import { requestClaudeForecast } from './claude-policy.server'
const evidence = forecastExplanationEvidenceSchema.parse({
  method: 'forecast-explainer-v1',
  unit: 'EA',
  forecast_context: {
    method: 'expanded-v1',
    from_date: '2026-07-01',
    cutoff: '2026-10-01',
    horizon_days: 28,
    selected_model: 'naive',
  },
  model_comparison: {
    scores: [{ model: 'naive', rmse: '1.123456789012345678', mae: '1', bias: '-0.25' }],
    unavailable_models: [],
  },
  backtest_windows: {
    windows: [
      {
        train_from: '2026-07-01',
        train_to: '2026-07-09',
        test_from: '2026-07-10',
        test_to: '2026-08-06',
      },
      {
        train_from: '2026-07-01',
        train_to: '2026-07-09',
        test_from: '2026-07-10',
        test_to: '2026-08-06',
      },
      {
        train_from: '2026-07-01',
        train_to: '2026-07-09',
        test_from: '2026-07-10',
        test_to: '2026-08-06',
      },
    ],
  },
  uncertainty: { status: 'available', residual_count: 84 },
  held_out_coverage: {
    status: 'available',
    model: 'mean',
    train_to: '2026-09-03',
    test_from: '2026-09-04',
    test_to: '2026-10-01',
    count: 28,
    calibration: 84,
    coverage80: '0.8',
    coverage95: '0.95',
  },
  forecast_limits: { driver_conditioned: false, interpretation: 'Recorded forecast only.' },
})
const answer = {
  paragraphs: [
    { text: 'Historical model selection only.', references: ['model_comparison' as const] },
  ],
}
const input = { question: 'Why this model?', locale: 'en' as const, evidence }
const config = { key: 'test-only-provider-key-not-a-secret', model: 'claude-sonnet-5-5' }
describe('forecast explanations', () => {
  it('retains decimal score precision and separate coverage model', () => {
    expect(evidence.model_comparison.scores[0].rmse).toBe('1.123456789012345678')
    expect(evidence.held_out_coverage.model).not.toBe(evidence.forecast_context.selected_model)
  })
  it.each(['demand', 'account', 'driver', 'price'])('rejects unapproved %s evidence', (key) =>
    expect(
      forecastExplanationEvidenceSchema.safeParse({ ...evidence, [key]: 'private' }).success,
    ).toBe(false),
  )
  it('rejects nested additions and unbounded windows', () => {
    expect(
      forecastExplanationEvidenceSchema.safeParse({
        ...evidence,
        model_comparison: { ...evidence.model_comparison, raw: [] },
      }).success,
    ).toBe(false)
    expect(
      forecastExplanationEvidenceSchema.safeParse({
        ...evidence,
        backtest_windows: { windows: [] },
      }).success,
    ).toBe(false)
  })
  it('separates policy and forecast reference vocabularies', () => {
    expect(explanationAnswerSchema.safeParse(answer).success).toBe(false)
    expect(
      forecastExplanationAnswerSchema.safeParse({
        paragraphs: [{ text: 'bad', references: ['policy_inputs'] }],
      }).success,
    ).toBe(false)
  })
  it('sends limited summary with forecast instructions and no tools', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: config.model,
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(answer) }],
        }),
      ),
    )
    expect(await requestClaudeForecast(input, config, fetcher)).toEqual({
      answer,
      model: config.model,
    })
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(JSON.parse(body.messages[0].content).evidence).toEqual(evidence)
    expect(body.system).toContain('forecast minus recorded sold demand')
    expect(body.system).toContain('source-declared availability')
    expect(body.tools).toBeUndefined()
    expect(
      body.output_config.format.schema.properties.paragraphs.items.properties.references.items.enum,
    ).not.toContain('policy_inputs')
  })
  it('rejects wrong-family provider references', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: config.model,
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                paragraphs: [{ text: 'bad', references: ['policy_inputs'] }],
              }),
            },
          ],
        }),
      ),
    )
    await expect(requestClaudeForecast(input, config, fetcher)).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })
  it('rejects mismatched prompt versions before sending', async () => {
    const provider = vi.fn()
    await expect(
      executePolicyExplanation({
        dispatch: async () => ({ dispatch: true, ...input, prompt_version: 'policy-explainer-v1' }),
        provider,
        complete: vi.fn(),
      }),
    ).rejects.toThrow('version mismatch')
    expect(provider).not.toHaveBeenCalled()
  })
  it('does not publish a forecast answer after authority loss', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('revoked'))
    await expect(
      executePolicyExplanation({
        dispatch: async () => ({
          dispatch: true,
          ...input,
          prompt_version: 'forecast-explainer-v1',
        }),
        provider: async () => ({ answer, model: config.model }),
        complete,
      }),
    ).rejects.toThrow('revoked')
  })
  it('keeps absent uncertainty explicit rather than substituting zero', () => {
    const parsed = forecastExplanationEvidenceSchema.parse({
      ...evidence,
      uncertainty: { status: 'not_recorded', residual_count: null },
      held_out_coverage: {
        ...evidence.held_out_coverage,
        status: 'not_recorded',
        coverage80: null,
        coverage95: null,
      },
    })
    expect(parsed.held_out_coverage.coverage80).toBeNull()
  })
})
