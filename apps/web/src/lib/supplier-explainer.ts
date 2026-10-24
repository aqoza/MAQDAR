import { z } from 'zod'
import { explanationRequestSchema } from './policy-explainer'
export const supplierEvidenceReferences = [
  'scenario_context',
  'rounding_calculation',
  'lead_time_evidence',
  'scenario_limits',
] as const
const decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .max(100)
export const supplierExplanationEvidenceSchema = z.strictObject({
  method: z.literal('supplier-explainer-v1'),
  unit: z.enum(['EA', 'SET', 'L', 'KG']),
  scenario_context: z.strictObject({ cutoff: z.iso.date() }),
  rounding_calculation: z.strictObject({
    gap: decimal,
    moq: decimal,
    pack: decimal,
    quantity: decimal,
    overage: decimal,
  }),
  lead_time_evidence: z.strictObject({
    policy_days: z.number().int().nonnegative(),
    supplier_days: z.number().int().nonnegative(),
  }),
  scenario_limits: z.strictObject({
    terms_confirmed: z.literal(true),
    interpretation: z.string().min(1).max(700),
  }),
})
export const supplierExplanationPreviewSchema = z.strictObject({
  evidence: supplierExplanationEvidenceSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scenario_id: z.guid(),
  location_id: z.guid(),
})
export const supplierExplanationRequestSchema = explanationRequestSchema
  .omit({ policy_id: true })
  .extend({ scenario_id: z.guid() })
export const supplierExplanationAnswerSchema = z.strictObject({
  paragraphs: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(2000),
        references: z.array(z.enum(supplierEvidenceReferences)).min(1).max(4),
      }),
    )
    .min(1)
    .max(8),
})
export type SupplierExplanationEvidence = z.infer<typeof supplierExplanationEvidenceSchema>
export type SupplierExplanationAnswer = z.infer<typeof supplierExplanationAnswerSchema>
