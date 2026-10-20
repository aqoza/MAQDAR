import { z } from 'zod'
import { redistributionInputSchema, redistributionReportSchema } from './redistribution'
import { comparisonSchema } from './stock-comparison'
import { firstParam, type RawSearchParams } from './master-data/list-params'

export const networkInputSchema = redistributionInputSchema
  .omit({ draft: true, lane: true })
  .extend({
    drafts: z
      .array(z.guid())
      .min(1)
      .max(20)
      .refine((v) => new Set(v).size === v.length),
    lanes: z.enum(['true', 'false']),
  })
export const networkSaveSchema = networkInputSchema.extend({
  commitments: z.literal('true'),
  lanes: z.literal('true'),
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function networkParams(raw: RawSearchParams) {
  return {
    policy: firstParam(raw.policy),
    drafts: typeof raw.draft === 'string' ? [raw.draft] : (raw.draft ?? []),
    maximum: firstParam(raw.maximum),
    backorders: firstParam(raw.backorders),
    commitments: firstParam(raw.commitments) ?? 'false',
    lanes: firstParam(raw.lanes) ?? 'false',
  }
}
export function networkRpcInput(input: z.infer<typeof networkInputSchema>) {
  return {
    p_draft_ids: input.drafts,
    p_source_policy_id: input.policy,
    p_basis: input.maximum === 'calculated' ? 'calculated' : 'approved',
    p_override_id: input.maximum === 'calculated' ? undefined : input.maximum,
    p_backorders: input.backorders,
    p_commitments_confirmed: input.commitments === 'true',
    p_lanes_confirmed: input.lanes === 'true',
  }
}
const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .nullable()
export const networkReportSchema = z.object({
  method: z.literal('network-allocation-v1'),
  status: z.enum([
    'available',
    'source_location_unavailable',
    'branch_location_unavailable',
    'line_unavailable',
  ]),
  source_policy_id: z.guid(),
  source_location_id: z.guid(),
  source_location_code: z.string(),
  source_location_type: z.string(),
  source_active: z.boolean(),
  item_id: z.guid(),
  source_policy: comparisonSchema.nullable(),
  basis: z.enum(['calculated', 'approved']),
  override_id: z.guid().nullable(),
  backorders: z.string(),
  commitments_confirmed: z.boolean(),
  lanes_confirmed: z.boolean(),
  source_surplus: decimal,
  total_gap: decimal,
  allocated: decimal,
  remaining_surplus: decimal,
  retained_available: decimal,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  lines: z
    .array(
      z.object({
        draft_id: z.guid(),
        location_id: z.guid(),
        location_code: z.string(),
        location_type: z.string(),
        active: z.boolean(),
        gap: decimal,
        quantity: decimal,
        remaining_gap: decimal,
        evidence: redistributionReportSchema,
      }),
    )
    .min(1)
    .max(20),
})
export type NetworkReport = z.infer<typeof networkReportSchema>
