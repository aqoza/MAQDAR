import { describe, expect, it } from 'vitest'
import {
  POPULATION_FILE_BYTES,
  parsePopulationCsv,
  populationInputSchema,
  populationReportSchema,
} from './installed-base'

const header = 'group_code,group_name,installed_on,active_assets,parts_per_asset\n'
const row = 'A,Known group,2020-02-29,12,2.500'
const input = {
  item_code: 'P1',
  location_code: 'L1',
  dataset_name: 'Population',
  unit: 'EA',
  source: 'Synthetic source',
  as_of: '2026-01-01',
  available_on: '2026-01-02',
  confirmed: true,
  non_overlapping: true,
  rows: [
    {
      group_code: 'A',
      group_name: 'Known group',
      installed_on: '2020-02-29',
      active_assets: '12',
      parts_per_asset: '2.5',
    },
  ],
}
describe('installed-base CSV and evidence', () => {
  it('preserves exact counts and quantities, trims fields and accepts reordered quoted headers', () => {
    expect(
      parsePopulationCsv(
        '\uFEFFparts_per_asset,active_assets,installed_on,group_name,group_code\r\n"2.500",0012,2020-02-29,Known group, A \r\n',
      ),
    ).toEqual({ ok: true, rows: input.rows })
    const result = parsePopulationCsv(header + 'B,Large group,,999999999999999,999999999999999.999')
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          group_code: 'B',
          group_name: 'Large group',
          installed_on: null,
          active_assets: '999999999999999',
          parts_per_asset: '999999999999999.999',
        },
      ],
    })
  })
  it('retains zero active counts and explicitly unknown installation dates', () => {
    expect(parsePopulationCsv(header + 'A,Inactive population,,0,0.001')).toEqual({
      ok: true,
      rows: [
        {
          group_code: 'A',
          group_name: 'Inactive population',
          installed_on: null,
          active_assets: '0',
          parts_per_asset: '0.001',
        },
      ],
    })
  })
  it.each([
    'NaN',
    'Infinity',
    '1e3',
    '+2',
    '1,000',
    '1000000000000000',
    '',
    '0x10',
    '١٢',
    '-1',
    '1.2',
  ])('rejects invalid asset count %s', (value) => {
    expect(parsePopulationCsv(header + `A,Group,,${value},1`).ok).toBe(false)
  })
  it.each(['0', '0.000', 'NaN', '1e3', '-1', '1.0001', '1000000000000000', ''])(
    'rejects invalid fitted part quantity %s',
    (value) => {
      expect(parsePopulationCsv(header + `A,Group,,1,${value}`).ok).toBe(false)
    },
  )
  it.each(['2026-02-30', '0000-01-01', '2025-02-29', 'unknown', '2026-1-1'])(
    'does not replace invalid date %s with unknown',
    (date) => {
      expect(parsePopulationCsv(header + `A,Group,${date},1,1`).ok).toBe(false)
    },
  )
  it('rejects duplicate trimmed codes but keeps distinct case-sensitive codes', () => {
    expect(parsePopulationCsv(header + row + '\n A ,Second group,,1,1')).toEqual({
      ok: false,
      code: 'rows',
      row: 3,
    })
    expect(parsePopulationCsv(header + row + '\na,Second group,,1,1').ok).toBe(true)
  })
  it.each([
    'group_code,group_name,installed_on,active_assets,active_assets\n' + row,
    header + 'A,Group,,1,1,extra',
    header + 'A,Group,,1',
    header + '"A,Group,,1,1',
  ])('rejects malformed CSV', (text) => {
    expect(parsePopulationCsv(text).ok).toBe(false)
  })
  it('bounds bytes and rows atomically', () => {
    expect(parsePopulationCsv('x'.repeat(POPULATION_FILE_BYTES + 1))).toEqual({
      ok: false,
      code: 'size',
    })
    expect(parsePopulationCsv(header + Array(1001).fill(row).join('\n'))).toEqual({
      ok: false,
      code: 'rows',
    })
    expect(parsePopulationCsv(header)).toEqual({ ok: false, code: 'rows' })
  })
  it('validates as-of and availability and canonicalizes group order without inferring rows', () => {
    expect(populationInputSchema.parse(input).rows).toHaveLength(1)
    expect(populationInputSchema.safeParse({ ...input, available_on: '2025-12-31' }).success).toBe(
      false,
    )
    expect(populationInputSchema.safeParse({ ...input, as_of: '2019-12-31' }).success).toBe(false)
    expect(
      populationInputSchema.safeParse({ ...input, rows: [{ ...input.rows[0], active_assets: 12 }] })
        .success,
    ).toBe(false)
    expect(
      populationInputSchema
        .parse({ ...input, rows: [{ ...input.rows[0], group_code: 'B' }, ...input.rows] })
        .rows.map((r) => r.group_code),
    ).toEqual(['A', 'B'])
  })
  it('reads products and totals larger than source precision without losing digits', () => {
    const report = populationReportSchema.parse({
      method: 'installed-base-v1',
      input,
      source: {
        item_id: '11111111-1111-4111-8111-111111111111',
        location_id: '22222222-2222-4222-8222-222222222222',
        item_code: 'P1',
        item_name: 'Part',
        item_status: 'active',
        unit_of_measure: 'EA',
        location_code: 'L1',
        location_name: 'Location',
        time_zone: 'UTC',
      },
      groups: [
        {
          ...input.rows[0],
          installed_quantity: '999999999999999998999000000000000.001',
          age_days: 2133,
        },
      ],
      totals: {
        groups: 1,
        active_assets: '999999999999999999',
        installed_quantity: '999999999999999998999000000000000.001',
        known_age_assets: '0',
        unknown_age_assets: '999999999999999999',
      },
      fingerprint: 'a'.repeat(64),
    })
    expect(report.totals.installed_quantity).toBe('999999999999999998999000000000000.001')
  })
})
