import { z } from 'zod'
import { comparisonSchema } from './stock-comparison'
import {
  firstParam,
  parseListParams,
  type ListSpec,
  type RawSearchParams,
} from './master-data/list-params'

const choiceSchema = z
  .object({ policy_id: z.guid(), maximum: z.union([z.literal('calculated'), z.guid()]) })
  .strict()
export const excessSelectionsSchema = z
  .array(choiceSchema)
  .min(1)
  .max(50)
  .refine((rows) => new Set(rows.map((row) => row.policy_id.toLowerCase())).size === rows.length)
export function excessChoices(tokens: string[]) {
  return excessSelectionsSchema.safeParse(
    tokens.map((token) => {
      const parts = token.split(':')
      return parts.length === 2 ? { policy_id: parts[0], maximum: parts[1] } : null
    }),
  )
}
export function excessTokens(raw: RawSearchParams): string[] {
  const saved =
    raw.choice === undefined ? [] : Array.isArray(raw.choice) ? raw.choice : [raw.choice]
  const picked = Object.entries(raw)
    .filter(([key]) => /^pick\.[0-9a-f-]{36}$/i.test(key))
    .flatMap(([, value]) => (value === undefined ? [] : Array.isArray(value) ? value : [value]))
  return [...saved, ...picked]
}
export function excessHref(tokens: string[], path = '/replenishment/excess/new') {
  const query = new URLSearchParams()
  tokens.forEach((token) => query.append('choice', token))
  return query.size ? `${path}?${query}` : path
}
export const excessSaveSchema = z.object({
  selections: z
    .string()
    .max(10000)
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid selection' })
        return z.NEVER
      }
    })
    .pipe(excessSelectionsSchema),
  reason: z.string().trim().min(1).max(2000),
  confirmed: z.literal('true'),
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const excessTotalsSchema = z.array(z.object({ currency: z.string(), value: decimal }))
export const excessReportSchema = z.object({
  method: z.literal('excess-stock-v1'),
  status: z.enum(['available', 'unavailable']),
  location_id: z.guid(),
  location_code: z.string(),
  cutoff: z.iso.date(),
  selections: excessSelectionsSchema,
  totals: excessTotalsSchema.nullable(),
  lines: z
    .array(
      z.object({
        item_id: z.guid(),
        comparison: comparisonSchema,
        policy: z.object({
          status: z.string(),
          summary: z.record(z.string(), z.unknown()),
          evidence: z.record(z.string(), z.unknown()),
        }),
        override: z
          .object({
            id: z.guid(),
            revision: z.number(),
            submitted_by: z.guid(),
            reason: z.string(),
            decided_by: z.guid(),
            decided_at: z.string(),
            decision_reason: z.string(),
            reorder_point: decimal,
            order_up_to: decimal,
          })
          .nullable(),
      }),
    )
    .min(1)
    .max(50),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type ExcessReport = z.infer<typeof excessReportSchema>
export const excessCandidateSchema = z.object({
  id: z.string(),
  policy_id: z.guid(),
  item_id: z.guid(),
  location_id: z.guid(),
  item_code: z.string(),
  location_code: z.string(),
  cutoff: z.iso.date(),
  unit: z.string().nullable(),
  finished_at: z.string(),
  maximum: z.string(),
  quantity: decimal.nullable(),
  revision: z.number().nullable(),
})
export const excessHistorySchema = z.object({
  id: z.guid(),
  location_code: z.string(),
  cutoff: z.iso.date(),
  created_at: z.string(),
  reason: z.string(),
  line_count: z.number(),
  totals: excessTotalsSchema,
})
export const excessListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    { param: 'location', column: 'location_code', kind: 'pattern', pattern: /^[\w.-]{1,64}$/ },
  ],
}
export const excessCandidateSpec: ListSpec = {
  ...excessListSpec,
  sorts: ['finished_at'],
  defaultSort: 'finished_at',
}
export const excessListParams = (raw: RawSearchParams, candidates = false) =>
  parseListParams(raw, candidates ? excessCandidateSpec : excessListSpec)
export function excessCutoff(raw: RawSearchParams) {
  return z.iso.date().safeParse(firstParam(raw.cutoff)).data
}
