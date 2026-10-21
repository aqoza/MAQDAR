import Papa from 'papaparse'
import { z } from 'zod'

export const POPULATION_FILE_BYTES = 524288
export const POPULATION_MAX_ROWS = 1000
export const populationColumns = [
  'group_code',
  'group_name',
  'installed_on',
  'active_assets',
  'parts_per_asset',
] as const
export const populationTemplate =
  'group_code,group_name,installed_on,active_assets,parts_per_asset\nFLEET-A,Known-age equipment,2020-01-01,125,2\nFLEET-B,Unknown-age equipment,,40,1\n'

const calendarDate = z.iso.date().refine((value) => !value.startsWith('0000'))
const canonicalDecimal = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  const tail = fraction.replace(/0+$/, '')
  return `${whole.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`
}
const assetCount = z
  .string()
  .trim()
  .regex(/^\d{1,15}$/)
  .transform(canonicalDecimal)
const partQuantity = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,3})?$/)
  .transform(canonicalDecimal)
  .refine((value) => value !== '0')
// Products and sums can exceed the precision of a source quantity. Keep strings
// through SQL, JSON and display; never parse these values as JavaScript numbers.
const totalCount = z.string().regex(/^\d{1,18}$/)
const totalQuantity = z.string().regex(/^\d{1,33}(\.\d{1,3})?$/)
export const populationRowSchema = z.object({
  group_code: z.string().trim().min(1).max(100),
  group_name: z.string().trim().min(1).max(200),
  installed_on: calendarDate.nullable(),
  active_assets: assetCount,
  parts_per_asset: partQuantity,
})
const rowsSchema = z
  .array(populationRowSchema)
  .min(1)
  .max(POPULATION_MAX_ROWS)
  .refine((rows) => new Set(rows.map((r) => r.group_code)).size === rows.length)
  .transform((rows) =>
    [...rows].sort((a, b) =>
      a.group_code < b.group_code ? -1 : a.group_code > b.group_code ? 1 : 0,
    ),
  )
export const populationInputSchema = z
  .object({
    item_code: z.string().trim().min(1).max(100),
    location_code: z.string().trim().min(1).max(100),
    dataset_name: z.string().trim().min(1).max(200),
    unit: z.string().trim().min(1).max(80),
    source: z.string().trim().min(1).max(2000),
    as_of: calendarDate,
    available_on: calendarDate,
    confirmed: z.boolean(),
    non_overlapping: z.boolean(),
    rows: rowsSchema,
  })
  .refine(
    (v) =>
      v.available_on >= v.as_of &&
      v.rows.every((r) => r.installed_on === null || r.installed_on <= v.as_of),
  )
export const populationReportSchema = z.object({
  method: z.literal('installed-base-v1'),
  input: populationInputSchema,
  source: z.object({
    item_id: z.guid(),
    item_code: z.string(),
    item_name: z.string(),
    item_status: z.string(),
    unit_of_measure: z.string(),
    location_id: z.guid(),
    location_code: z.string(),
    location_name: z.string(),
    time_zone: z.string(),
  }),
  groups: z
    .array(
      populationRowSchema.extend({
        installed_quantity: totalQuantity,
        age_days: z.number().int().nonnegative().nullable(),
      }),
    )
    .min(1)
    .max(POPULATION_MAX_ROWS),
  totals: z.object({
    groups: z.number().int().min(1).max(POPULATION_MAX_ROWS),
    active_assets: totalCount,
    installed_quantity: totalQuantity,
    known_age_assets: totalCount,
    unknown_age_assets: totalCount,
  }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type PopulationInput = z.infer<typeof populationInputSchema>
export type PopulationReport = z.infer<typeof populationReportSchema>
export type PopulationRow = z.infer<typeof populationRowSchema>
export type PopulationCsvResult =
  | { ok: true; rows: PopulationRow[] }
  | { ok: false; code: 'size' | 'headers' | 'rows'; row?: number }

/** Empty installation cells alone represent unknown dates. No numeric inference. */
export function parsePopulationCsv(text: string): PopulationCsvResult {
  if (new TextEncoder().encode(text).length > POPULATION_FILE_BYTES)
    return { ok: false, code: 'size' }
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter: ',',
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  })
  if (parsed.errors.length) return { ok: false, code: 'rows', row: (parsed.errors[0].row ?? 0) + 1 }
  const [header, ...raw] = parsed.data
  if (
    !header ||
    header.length !== 5 ||
    new Set(header).size !== 5 ||
    populationColumns.some((c) => !header.includes(c))
  )
    return { ok: false, code: 'headers' }
  if (!raw.length || raw.length > POPULATION_MAX_ROWS) return { ok: false, code: 'rows' }
  const rows: PopulationRow[] = [],
    seen = new Set<string>()
  for (const [index, cells] of raw.entries()) {
    const values = Object.fromEntries(header.map((key, i) => [key, cells[i]?.trim()]))
    const result = populationRowSchema.safeParse({
      ...values,
      installed_on: values.installed_on === '' ? null : values.installed_on,
    })
    if (cells.length !== 5 || !result.success || seen.has(result.data.group_code))
      return { ok: false, code: 'rows', row: index + 2 }
    seen.add(result.data.group_code)
    rows.push(result.data)
  }
  return { ok: true, rows: rowsSchema.parse(rows) }
}
