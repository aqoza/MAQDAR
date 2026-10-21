import { describe, expect, it } from 'vitest'
import { installedEvaluationInputSchema } from './installed-base-evaluation'

const input = {
  scenario_id: 'ABCDEF00-0000-4000-8000-000000000001',
  evaluation_name: '  Comparison  ',
  confirmed: true,
}
describe('installed-base evaluation inputs', () => {
  it('canonicalizes identity and name without inventing confirmation', () => {
    expect(installedEvaluationInputSchema.parse(input)).toEqual({
      ...input,
      scenario_id: input.scenario_id.toLowerCase(),
      evaluation_name: 'Comparison',
    })
  })
  it.each([undefined, null, false, 'true', 1])(
    'rejects missing or non-boolean confirmation %s',
    (confirmed) => {
      expect(installedEvaluationInputSchema.safeParse({ ...input, confirmed }).success).toBe(false)
    },
  )
  it.each(['', ' ', 'x'.repeat(201)])('rejects invalid names', (evaluation_name) => {
    expect(installedEvaluationInputSchema.safeParse({ ...input, evaluation_name }).success).toBe(
      false,
    )
  })
  it('rejects malformed source identity and accepts multilingual names', () => {
    expect(
      installedEvaluationInputSchema.safeParse({ ...input, scenario_id: 'other' }).success,
    ).toBe(false)
    expect(
      installedEvaluationInputSchema.parse({ ...input, evaluation_name: 'تقييم' }).evaluation_name,
    ).toBe('تقييم')
  })
})
