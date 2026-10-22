import { z } from 'zod'
import { capturedStockRegionSchema } from './stock-regions'
import { comparisonSchema } from './stock-comparison'
import { replenishmentReportSchema } from './replenishment'
import { redistributionReportSchema, redistributionStatuses } from './redistribution'
import { normalizeDigits } from './master-data/numbers'

export const regionalSourcingPath = '/replenishment/regional-stock/sourcing'
export const SOURCING_INPUT_BYTES = 16384
const guid = z.guid().transform((v) => v.toLowerCase())
export const sourcingSourceSchema = z.object({
  location_id: guid,
  policy_id: guid,
  maximum: z.union([z.literal('calculated'), guid]),
  backorders: z
    .string()
    .transform(normalizeDigits)
    .pipe(z.string().regex(/^\d{1,15}(\.\d{1,3})?$/))
    .transform((v) => {
      const [whole, fraction = ''] = v.split('.')
      return `${BigInt(whole)}.${fraction.padEnd(3, '0')}`
    }),
})
export const regionalSourcingInputSchema = z.object({
  region_id: guid,
  draft_id: guid,
  sources: z
    .array(sourcingSourceSchema)
    .min(1)
    .max(19)
    .refine((v) => new Set(v.map((s) => s.location_id)).size === v.length)
    .transform((v) => [...v].sort((a, b) => a.location_id.localeCompare(b.location_id))),
  commitments_confirmed: z.literal(true),
  lanes_confirmed: z.literal(true),
})
const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .nullable()
export const regionalSourcingReportSchema = z.object({
  method: z.literal('regional-sourcing-v1'),
  input: regionalSourcingInputSchema,
  status: z.enum(['available', 'unavailable']),
  region: capturedStockRegionSchema,
  locations: capturedStockRegionSchema.shape.definition.shape.locations,
  destination_location_id: guid,
  destination: replenishmentReportSchema,
  total_surplus: decimal,
  allocated: decimal,
  remaining_gap: decimal,
  lines: z
    .array(
      z.object({
        location_id: guid,
        location_code: z.string(),
        status: z.enum(redistributionStatuses),
        source_policy: comparisonSchema.nullable(),
        lane: redistributionReportSchema.shape.lane,
        backorders: z.string(),
        surplus: decimal,
        quantity: decimal,
        remaining_surplus: decimal,
        retained_available: decimal,
      }),
    )
    .min(1)
    .max(19),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type RegionalSourcingInput = z.infer<typeof regionalSourcingInputSchema>
export type RegionalSourcingReport = z.infer<typeof regionalSourcingReportSchema>
export type SourcingChoice = { id: string; maximum: string; saved: string }
export type SourcingChoices = {
  policies: SourcingChoice[]
  page: number
  pages: number
  revisions: { id: string; revision: number; maximum: string }[]
  revisionPage: number
  revisionPages: number
  policyId: string
}
