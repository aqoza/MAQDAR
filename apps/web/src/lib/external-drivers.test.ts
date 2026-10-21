import { describe, expect, it } from 'vitest'
import {
  DRIVER_FILE_BYTES,
  driverCoverage,
  driverDecimal,
  driverInputSchema,
  parseDriverCsv,
  type DriverReport,
} from './external-drivers'

const header = 'date,value,kind,available_on\n'
const row = '2026-10-01,-12.340000,observed,2026-10-02'
const input = {
  item_code: 'P1',
  location_code: 'L1',
  driver_name: 'Temperature',
  unit: 'degrees C',
  source: 'Supplier report',
  history_from: '2026-10-01',
  cutoff: '2026-10-02',
  forecast_to: '2026-10-04',
  confirmed: true,
  rows: [{ date: '2026-10-01', value: '-12.34', kind: 'observed', available_on: '2026-10-02' }],
}
describe('external driver evidence', () => {
  it('keeps precise signed decimals, zero and reordered quoted CSV fields', () => {
    expect(driverDecimal.parse('999999999999.999999')).toBe('999999999999.999999')
    expect(driverDecimal.parse('-00.000000')).toBe('0')
    expect(
      parseDriverCsv(
        '\uFEFFvalue,kind,available_on,date\r\n"-12.340000",observed,2026-10-02,2026-10-01\r\n',
      ),
    ).toEqual({ ok: true, rows: input.rows })
  })
  it.each([
    'NaN',
    'Infinity',
    '1e3',
    '+2',
    '1,000',
    '1.0000001',
    '1000000000000',
    '',
    '0x10',
    '١٢',
  ])('rejects unsupported numeric input %s', (value) => {
    expect(driverDecimal.safeParse(value).success).toBe(false)
  })
  it('rejects duplicate dates even across observed and planned rows', () => {
    expect(parseDriverCsv(header + row + '\n2026-10-01,3,planned,2026-09-01')).toEqual({
      ok: false,
      code: 'rows',
      row: 3,
    })
  })
  it.each([
    'date,value,kind,kind\n' + row,
    'date,value,kind,available_on,extra\n' + row,
    'date;value;kind;available_on\n' + row,
  ])('rejects ambiguous headers', (csv) => expect(parseDriverCsv(csv).ok).toBe(false))
  it.each([
    '2026-02-30,1,observed,2026-03-01',
    '2026-10-01,1,observed,2026-09-30',
    '2026-10-01,1,actual,2026-10-02',
    '2026-10-01,1,planned,',
    '2026-10-01,1,planned,2026-09-01,extra',
    '"2026-10-01,1,planned,2026-09-01',
  ])('rejects invalid daily evidence', (csv) => expect(parseDriverCsv(header + csv).ok).toBe(false))
  it('bounds input bytes and row count before saving', () => {
    expect(parseDriverCsv('x'.repeat(DRIVER_FILE_BYTES + 1))).toEqual({ ok: false, code: 'size' })
    expect(parseDriverCsv(header + Array(1187).fill(row).join('\n'))).toEqual({
      ok: false,
      code: 'rows',
    })
    expect(parseDriverCsv(header)).toEqual({ ok: false, code: 'rows' })
  })
  it('validates the selected windows and keeps gaps instead of inserting zeros', () => {
    expect(driverInputSchema.parse(input).rows).toHaveLength(1)
    expect(driverInputSchema.safeParse({ ...input, forecast_to: '2026-10-02' }).success).toBe(false)
    expect(driverInputSchema.safeParse({ ...input, forecast_to: '2027-10-02' }).success).toBe(false)
    expect(driverInputSchema.safeParse({ ...input, history_from: '2022-10-01' }).success).toBe(
      false,
    )
    expect(driverInputSchema.safeParse({ ...input, history_from: '2026-10-02' }).success).toBe(
      false,
    )
  })
  it('counts coverage and availability independently, never treating a missing value as observed zero', () => {
    const daily: DriverReport['daily'] = [
      {
        date: '2026-10-01',
        period: 'history',
        value: '0',
        kind: 'observed',
        available_on: '2026-10-01',
        availability: 'declared_available',
      },
      {
        date: '2026-10-02',
        period: 'history',
        value: null,
        kind: null,
        available_on: null,
        availability: 'missing',
      },
      {
        date: '2026-10-03',
        period: 'forecast',
        value: '2',
        kind: 'observed',
        available_on: '2026-10-04',
        availability: 'after_cutoff',
      },
      {
        date: '2026-10-04',
        period: 'forecast',
        value: '3',
        kind: 'planned',
        available_on: '2026-10-01',
        availability: 'declared_available',
      },
    ]
    const report = { daily } as DriverReport
    expect(driverCoverage(report, 'history')).toEqual({
      total: 2,
      observed: 1,
      planned: 0,
      missing: 1,
      declared_available: 1,
      after_cutoff: 0,
    })
    expect(driverCoverage(report, 'forecast')).toEqual({
      total: 2,
      observed: 1,
      planned: 1,
      missing: 0,
      declared_available: 1,
      after_cutoff: 1,
    })
  })
})
