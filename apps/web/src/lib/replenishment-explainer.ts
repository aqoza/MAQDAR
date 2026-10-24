import { z } from 'zod'
import { explanationRequestSchema } from './policy-explainer'
export const replenishmentEvidenceReferences = [
  'draft_context',
  'gap_calculation',
  'supply_timing',
  'draft_limits',
] as const
const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .max(100)
export const replenishmentExplanationEvidenceSchema = z.strictObject({
  method: z.literal('replenishment-explainer-v1'),
  unit: z.enum(['EA', 'SET', 'L', 'KG']),
  draft_context: z.strictObject({
    cutoff: z.iso.date(),
    protection_end: z.iso.date(),
    maximum_basis: z.enum(['calculated', 'approved']),
  }),
  gap_calculation: z.strictObject({
    maximum: decimal,
    available_stock: decimal,
    remaining_inbound: decimal,
    additional_backorders: decimal,
    inventory_position: decimal,
    unrounded_gap: decimal,
  }),
  supply_timing: z.strictObject({
    open_line_count: z.number().int().min(0).max(1000),
    overdue_line_count: z.number().int().min(0).max(1000),
    late_line_count: z.number().int().min(0).max(1000),
  }),
  draft_limits: z.strictObject({
    orders_confirmed: z.literal(true),
    interpretation: z.string().min(1).max(700),
  }),
})
export const replenishmentExplanationPreviewSchema = z.strictObject({
  evidence: replenishmentExplanationEvidenceSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  draft_id: z.guid(),
  location_id: z.guid(),
})
export const replenishmentExplanationRequestSchema = explanationRequestSchema
  .omit({ policy_id: true })
  .extend({ draft_id: z.guid() })
export const replenishmentExplanationAnswerSchema = z.strictObject({
  paragraphs: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(2000),
        references: z.array(z.enum(replenishmentEvidenceReferences)).min(1).max(4),
      }),
    )
    .min(1)
    .max(8),
})
export type ReplenishmentExplanationEvidence = z.infer<
  typeof replenishmentExplanationEvidenceSchema
>
export type ReplenishmentExplanationAnswer = z.infer<typeof replenishmentExplanationAnswerSchema>
