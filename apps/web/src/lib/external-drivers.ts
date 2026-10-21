import Papa from 'papaparse'
import { z } from 'zod'

export const DRIVER_FILE_BYTES = 524288
export const DRIVER_MAX_ROWS = 1186
export const driverColumns = ['date', 'value', 'kind', 'available_on'] as const
export const driverTemplate =
  'date,value,kind,available_on\n2026-10-01,32.5,observed,2026-10-02\n2026-10-03,33,planned,2026-10-01\n'

// Driver measurements are not stock quantities. Preserve signed decimal values exactly,
// with a documented 12 integer / 6 fractional digit bound and no implicit rounding.
export const driverDecimal = z
  .string()
  .trim()
  .regex(/^-?\d{1,12}(\.\d{1,6})?$/)
  .transform((value) => {
    const negative = value.startsWith('-')
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
    const integer = whole.replace(/^0+(?=\d)/, '')
    const tail = fraction.replace(/0+$/, '')
    return `${negative && (integer !== '0' || tail) ? '-' : ''}${integer}${tail ? `.${tail}` : ''}`
  })
export const driverRowSchema = z
  .object({
    date: z.iso.date(),
    value: driverDecimal,
    kind: z.enum(['observed', 'planned']),
    available_on: z.iso.date(),
  })
  .refine((row) => row.kind !== 'observed' || row.available_on >= row.date)
const rowsSchema = z
  .array(driverRowSchema)
  .min(1)
  .max(DRIVER_MAX_ROWS)
  .refine((rows) => new Set(rows.map((r) => r.date)).size === rows.length)
  .transform((rows) => [...rows].sort((a, b) => a.date.localeCompare(b.date)))
export const driverInputSchema = z
  .object({
    item_code: z.string().trim().min(1).max(100),
    location_code: z.string().trim().min(1).max(100),
    driver_name: z.string().trim().min(1).max(200),
    unit: z.string().trim().min(1).max(80),
    source: z.string().trim().min(1).max(2000),
    history_from: z.iso.date(),
    cutoff: z.iso.date(),
    forecast_to: z.iso.date(),
    confirmed: z.boolean(),
    rows: rowsSchema,
  })
  .refine((v) => {
    const history = (Date.parse(v.cutoff) - Date.parse(v.history_from)) / 86400000
    const horizon = (Date.parse(v.forecast_to) - Date.parse(v.cutoff)) / 86400000
    return (
      history >= 0 &&
      history < 1096 &&
      horizon >= 1 &&
      horizon <= 90 &&
      v.rows.every((r) => r.date >= v.history_from && r.date <= v.forecast_to)
    )
  })
export const driverReportSchema = z.object({
  method: z.literal('external-driver-v1'),
  input: driverInputSchema,
  source: z.object({
    item_id: z.guid(),
    item_code: z.string(),
    item_name: z.string(),
    item_status: z.string(),
    location_id: z.guid(),
    location_code: z.string(),
    location_name: z.string(),
    time_zone: z.string(),
  }),
  daily: z
    .array(
      z.object({
        date: z.iso.date(),
        period: z.enum(['history', 'forecast']),
        value: driverDecimal.nullable(),
        kind: z.enum(['observed', 'planned']).nullable(),
        available_on: z.iso.date().nullable(),
        availability: z.enum(['missing', 'declared_available', 'after_cutoff']),
      }),
    )
    .min(2)
    .max(DRIVER_MAX_ROWS),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type DriverInput = z.infer<typeof driverInputSchema>
export type DriverReport = z.infer<typeof driverReportSchema>
export type DriverRow = z.infer<typeof driverRowSchema>

export type DriverCsvResult =
  { ok: true; rows: DriverRow[] } | { ok: false; code: 'size' | 'headers' | 'rows'; row?: number }
/** Fixed UTF-8 comma CSV contract, no dynamic typing or permissive date/number conversion. */
export function parseDriverCsv(text: string): DriverCsvResult {
  if (new TextEncoder().encode(text).length > DRIVER_FILE_BYTES) return { ok: false, code: 'size' }
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter: ',',
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  })
  if (parsed.errors.length) return { ok: false, code: 'rows', row: (parsed.errors[0].row ?? 0) + 1 }
  const [header, ...raw] = parsed.data
  if (
    !header ||
    header.length !== 4 ||
    new Set(header).size !== 4 ||
    driverColumns.some((c) => !header.includes(c))
  )
    return { ok: false, code: 'headers' }
  if (!raw.length || raw.length > DRIVER_MAX_ROWS) return { ok: false, code: 'rows' }
  const rows: DriverRow[] = [],
    seen = new Set<string>()
  for (const [index, cells] of raw.entries()) {
    const result = driverRowSchema.safeParse(
      Object.fromEntries(header.map((key, i) => [key, cells[i]?.trim()])),
    )
    if (cells.length !== 4 || !result.success || seen.has(result.data.date))
      return { ok: false, code: 'rows', row: index + 2 }
    seen.add(result.data.date)
    rows.push(result.data)
  }
  return { ok: true, rows: rows.sort((a, b) => a.date.localeCompare(b.date)) }
}

export function driverCoverage(report: DriverReport, period: 'history' | 'forecast') {
  const days = report.daily.filter((day) => day.period === period)
  return {
    total: days.length,
    observed: days.filter((d) => d.kind === 'observed').length,
    planned: days.filter((d) => d.kind === 'planned').length,
    missing: days.filter((d) => d.availability === 'missing').length,
    declared_available: days.filter((d) => d.availability === 'declared_available').length,
    after_cutoff: days.filter((d) => d.availability === 'after_cutoff').length,
  }
}
