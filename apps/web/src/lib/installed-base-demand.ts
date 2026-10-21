import Papa from 'papaparse'
import { z } from 'zod'
import {
  populationReportSchema,
  POPULATION_FILE_BYTES,
  POPULATION_MAX_ROWS,
} from './installed-base'

export const RATE_FILE_BYTES = POPULATION_FILE_BYTES
const date = z.iso.date().refine((value) => !value.startsWith('0000'))
export const replacementRateSchema = z.object({
  group_code: z.string().trim().min(1).max(100),
  daily_rate: z
    .string()
    .trim()
    .regex(/^\d{1,6}(\.\d{1,9})?$/)
    .transform((value) => {
      const [whole, fraction = ''] = value.split('.')
      const tail = fraction.replace(/0+$/, '')
      return `${whole.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`
    }),
  source: z.string().trim().min(1).max(1000),
  available_on: date,
})
const ratesSchema = z
  .array(replacementRateSchema)
  .min(1)
  .max(POPULATION_MAX_ROWS)
  .refine((rows) => new Set(rows.map((r) => r.group_code)).size === rows.length)
  .transform((rows) =>
    [...rows].sort((a, b) =>
      a.group_code < b.group_code ? -1 : a.group_code > b.group_code ? 1 : 0,
    ),
  )
export const installedDemandInputSchema = z
  .object({
    dataset_id: z.guid().transform((id) => id.toLowerCase()),
    scenario_name: z.string().trim().min(1).max(200),
    cutoff: date,
    horizon_days: z.number().int().min(1).max(90),
    confirmed: z.boolean(),
    rates: ratesSchema,
  })
  .refine((value) => value.rates.every((r) => r.available_on <= value.cutoff))
// Population products (33 integer/3 fractional), rates (6/9), and up to 90 days.
const demandQuantity = z.string().regex(/^\d{1,41}(\.\d{1,12})?$/)
export const installedDemandReportSchema = z.object({
  method: z.literal('installed-base-demand-v1'),
  input: installedDemandInputSchema,
  source: z.object({
    dataset_id: z.guid(),
    population_imported_at: z.string().min(1),
    population: populationReportSchema,
  }),
  groups: z
    .array(
      populationReportSchema.shape.groups.element.extend({
        rate: replacementRateSchema,
        daily_demand: demandQuantity,
        total_demand: demandQuantity,
      }),
    )
    .min(1)
    .max(POPULATION_MAX_ROWS),
  days: z
    .array(z.object({ date, expected_demand: demandQuantity }))
    .min(1)
    .max(90),
  daily_demand: demandQuantity,
  total_demand: demandQuantity,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type InstalledDemandInput = z.infer<typeof installedDemandInputSchema>
export type InstalledDemandReport = z.infer<typeof installedDemandReportSchema>
export type ReplacementRate = z.infer<typeof replacementRateSchema>
export const rateColumns = ['group_code', 'daily_rate', 'source', 'available_on'] as const

export function rateTemplate(groupCodes: string[]) {
  // A uniform spreadsheet text marker protects even formula-like group codes.
  // The importer accepts the complete original set or the complete marked set,
  // never resolves ambiguous aliases one row at a time.
  return (
    Papa.unparse({
      fields: [...rateColumns],
      data: groupCodes.map((code) => [`'${code}`, '', '', '']),
    }) + '\n'
  )
}

export function parseReplacementRates(
  text: string,
  groupCodes: string[],
):
  | { ok: true; rates: ReplacementRate[] }
  | { ok: false; code: 'size' | 'headers' | 'rows' | 'groups'; row?: number } {
  if (new TextEncoder().encode(text).length > RATE_FILE_BYTES) return { ok: false, code: 'size' }
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
    rateColumns.some((c) => !header.includes(c))
  )
    return { ok: false, code: 'headers' }
  if (!raw.length || raw.length > POPULATION_MAX_ROWS) return { ok: false, code: 'rows' }
  const codeIndex = header.indexOf('group_code')
  const suppliedCodes = raw.map((cells) => cells[codeIndex]?.trim() ?? '')
  const matches = (codes: string[]) =>
    codes.length === groupCodes.length &&
    new Set(codes).size === groupCodes.length &&
    groupCodes.every((code) => codes.includes(code))
  const marked =
    !matches(suppliedCodes) &&
    suppliedCodes.every((code) => code.startsWith("'")) &&
    matches(suppliedCodes.map((code) => code.slice(1)))
  const rates: ReplacementRate[] = [],
    seen = new Set<string>()
  for (const [index, cells] of raw.entries()) {
    const row = replacementRateSchema.safeParse(
      Object.fromEntries(
        header.map((key, i) => [
          key,
          key === 'group_code' && marked ? suppliedCodes[index].slice(1) : cells[i]?.trim(),
        ]),
      ),
    )
    if (cells.length !== 4 || !row.success || seen.has(row.data.group_code))
      return { ok: false, code: 'rows', row: index + 2 }
    rates.push(row.data)
    seen.add(row.data.group_code)
  }
  if (seen.size !== groupCodes.length || groupCodes.some((code) => !seen.has(code)))
    return { ok: false, code: 'groups' }
  return { ok: true, rates: ratesSchema.parse(rates) }
}
