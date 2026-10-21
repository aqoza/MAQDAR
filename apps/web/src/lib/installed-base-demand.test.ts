import { describe, expect, it } from 'vitest'
import {
  installedDemandInputSchema,
  parseReplacementRates,
  rateTemplate,
  replacementRateSchema,
  RATE_FILE_BYTES,
} from './installed-base-demand'

const rate = {
  group_code: 'A',
  daily_rate: '0.000000001',
  source: 'Explicit assumption',
  available_on: '2026-01-02',
}
const input = {
  dataset_id: '24000000-0000-4000-8000-000000000001',
  scenario_name: 'Demand',
  cutoff: '2026-01-03',
  horizon_days: 28,
  confirmed: true,
  rates: [rate],
}
const header = 'group_code,daily_rate,source,available_on\n'

describe('explicit replacement rates', () => {
  it('preserves exact decimals and canonicalizes zero and equivalent spellings', () => {
    expect(replacementRateSchema.parse(rate).daily_rate).toBe('0.000000001')
    expect(
      replacementRateSchema.parse({ ...rate, daily_rate: '000000.000000000' }).daily_rate,
    ).toBe('0')
    expect(
      replacementRateSchema.parse({ ...rate, daily_rate: '099999.123456780' }).daily_rate,
    ).toBe('99999.12345678')
    expect(
      replacementRateSchema.parse({ ...rate, daily_rate: '999999.999999999' }).daily_rate,
    ).toBe('999999.999999999')
  })
  it.each([
    '',
    ' ',
    '-1',
    '1e-3',
    'NaN',
    'Infinity',
    '.1',
    '1.',
    '1000000',
    '0.0000000001',
    0,
    null,
  ])('rejects invalid rate %s without substituting zero', (daily_rate) => {
    expect(replacementRateSchema.safeParse({ ...rate, daily_rate }).success).toBe(false)
  })
  it.each(['0000-01-01', '2026-02-30', '01/02/2026', ''])(
    'rejects invalid availability %s',
    (available_on) => {
      expect(replacementRateSchema.safeParse({ ...rate, available_on }).success).toBe(false)
    },
  )
  it('requires complete source evidence and source availability by cutoff', () => {
    for (const source of ['', ' ', 'x'.repeat(1001)])
      expect(replacementRateSchema.safeParse({ ...rate, source }).success).toBe(false)
    expect(installedDemandInputSchema.safeParse({ ...input, cutoff: '2026-01-01' }).success).toBe(
      false,
    )
    expect(
      installedDemandInputSchema.safeParse({ ...input, cutoff: rate.available_on }).success,
    ).toBe(true)
  })
  it.each([0, 91, 1.5, '28', null])('bounds whole-day horizons: %s', (horizon_days) => {
    expect(installedDemandInputSchema.safeParse({ ...input, horizon_days }).success).toBe(false)
  })
  it('keeps previews unconfirmed, rejects duplicate codes and canonicalizes ordering', () => {
    expect(installedDemandInputSchema.parse({ ...input, confirmed: false }).confirmed).toBe(false)
    expect(
      installedDemandInputSchema.safeParse({
        ...input,
        rates: [rate, { ...rate, group_code: ' A ' }],
      }).success,
    ).toBe(false)
    const rates = [{ ...rate, group_code: 'B' }, rate]
    expect(
      installedDemandInputSchema.parse({ ...input, rates }).rates.map((r) => r.group_code),
    ).toEqual(['A', 'B'])
    expect(installedDemandInputSchema.safeParse({ ...input, rates: [] }).success).toBe(false)
    expect(
      installedDemandInputSchema.safeParse({
        ...input,
        rates: Array.from({ length: 1001 }, (_, i) => ({ ...rate, group_code: String(i) })),
      }).success,
    ).toBe(false)
  })
})

describe('replacement rate CSV', () => {
  it('preserves quoted multilingual sources, exact decimals and explicit zero', () => {
    const result = parseReplacementRates(
      '\uFEFF' +
        header +
        'B,0,"مصدر, افتراض",2026-01-02\nA,0.000000001,"Line one\nLine two",2026-01-02\n',
      ['A', 'B'],
    )
    expect(result).toEqual({
      ok: true,
      rates: [
        { ...rate, source: 'Line one\nLine two' },
        { ...rate, group_code: 'B', daily_rate: '0', source: 'مصدر, افتراض' },
      ],
    })
  })
  it('downloads a blank template rather than inventing rates', () => {
    const text = rateTemplate(['A', 'B,quoted'])
    expect(text).toContain('A,,,')
    expect(text).toContain('"\'B,quoted",,,')
    expect(parseReplacementRates(text, ['A', 'B,quoted'])).toMatchObject({
      ok: false,
      code: 'rows',
    })
  })
  it('accepts column reordering but requires exact unique headers', () => {
    expect(
      parseReplacementRates(
        'source,available_on,daily_rate,group_code\nExplicit assumption,2026-01-02,0.000000001,A',
        ['A'],
      ),
    ).toEqual({ ok: true, rates: [rate] })
    for (const text of [
      'group_code,daily_rate,source,source\nA,0,a,a',
      header.trim() + ',extra\nA,0,a,2026-01-02,x',
    ])
      expect(parseReplacementRates(text, ['A'])).toMatchObject({ ok: false, code: 'headers' })
  })
  it('protects spreadsheet templates and resolves only complete marked group sets', () => {
    const codes = ['=SUM(1,2)', '\u200f=1+1', "'=SUM(1,2)", 'A'.repeat(100)]
    const template = rateTemplate(codes)
    expect(template).toContain('"\'=SUM(1,2)"')
    expect(template).toContain("'\u200f=1+1")
    const completed = template.replaceAll(',,,', ',0,Explicit zero,2026-01-02')
    const parsed = parseReplacementRates(completed, codes)
    expect(parsed.ok && parsed.rates.map((r) => r.group_code).sort()).toEqual([...codes].sort())
    // A literal apostrophe in a real code is not blindly stripped.
    expect(
      parseReplacementRates(header + "'A,1,Source,2026-01-02\nA,2,Source,2026-01-02", ["'A", 'A']),
    ).toMatchObject({
      ok: true,
      rates: [
        { group_code: "'A", daily_rate: '1' },
        { group_code: 'A', daily_rate: '2' },
      ],
    })
  })
  it('rejects duplicates, missing/extra groups and malformed rows', () => {
    const row = 'A,0,Assumption,2026-01-02\n'
    expect(parseReplacementRates(header + row + row, ['A'])).toMatchObject({
      ok: false,
      code: 'rows',
      row: 3,
    })
    expect(parseReplacementRates(header + row, ['A', 'B'])).toMatchObject({
      ok: false,
      code: 'groups',
    })
    expect(parseReplacementRates(header + row, ['B'])).toMatchObject({ ok: false, code: 'groups' })
    for (const text of [
      'A,,Assumption,2026-01-02',
      'A,0,,2026-01-02',
      'A,0,Assumption,2026-01-02,extra',
      'A,0,"unterminated,2026-01-02',
    ])
      expect(parseReplacementRates(header + text, ['A'])).toMatchObject({ ok: false, code: 'rows' })
  })
  it('enforces the UTF-8 byte cap', () => {
    expect(parseReplacementRates('ع'.repeat(RATE_FILE_BYTES / 2 + 1), ['A'])).toEqual({
      ok: false,
      code: 'size',
    })
  })
})
