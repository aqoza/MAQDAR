import { describe, expect, it } from 'vitest'
import { alternativeMaximaSchema, sensitivityRequestSchema } from './policy-sensitivity'

describe('sensitivity maxima', () => {
  it('normalizes and sorts without losing decimal precision', () => {
    expect(
      alternativeMaximaSchema.parse([
        '999999999999999.999',
        '02.000',
        '0.001',
        '10',
        '999999999999999.998',
      ]),
    ).toEqual(['0.001', '2', '10', '999999999999999.998', '999999999999999.999'])
  })
  it.each([
    [],
    Array(11).fill('1'),
    ['2', '02.00'],
    ['-1'],
    ['1e3'],
    ['0.0001'],
    [''],
    ['NaN'],
    ['1000000000000000'],
  ])('rejects invalid alternatives %j', (...values) => {
    expect(alternativeMaximaSchema.safeParse(values).success).toBe(false)
  })
  it('requires confirmation and accepts comma or newline separated values', () => {
    const input = {
      source_run_id: '11111111-1111-4111-8111-111111111111',
      request_id: '22222222-2222-4222-8222-222222222222',
      maxima: '8, 6\n0.125',
      reuse_confirmed: 'on',
    }
    expect(sensitivityRequestSchema.parse(input).maxima).toEqual(['0.125', '6', '8'])
    expect(sensitivityRequestSchema.safeParse({ ...input, reuse_confirmed: '' }).success).toBe(
      false,
    )
    expect(sensitivityRequestSchema.safeParse({ ...input, maxima: '8,' }).success).toBe(false)
  })
})
