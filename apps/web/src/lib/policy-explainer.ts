import { z } from 'zod'
export const explanationPath = '/forecasts/explanations'
export const evidenceReferences = [
  'policy_inputs',
  'lead_threshold',
  'review_threshold',
  'forecast',
  'evidence_limits',
] as const
const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .max(100)
const period = z.strictObject({
  days: z.number().int().min(0).max(90),
  forecast: decimal,
  quantile: decimal,
  target: decimal,
  safety_stock: decimal,
})
export const explanationEvidenceSchema = z.strictObject({
  method: z.literal('policy-explainer-v1'),
  unit: z.string().min(1).max(32),
  cutoff: z.iso.date(),
  policy_inputs: z.strictObject({
    lead_time_days: z.number().int().min(0).max(89),
    review_interval_days: z.number().int().min(1).max(90),
    cycle_service_target: decimal,
  }),
  lead_threshold: period,
  review_threshold: period,
  forecast: z.strictObject({
    method: z.enum(['baseline-v1', 'expanded-v1']),
    model: z.string().min(1).max(80),
    horizon_days: z.number().int().min(1).max(90),
  }),
  evidence_limits: z.strictObject({
    residual_count: z.number().int().min(0),
    positive_days: z.number().int().min(0),
    bootstrap_samples: z.number().int().min(0),
    interpretation: z.string().min(1).max(500),
  }),
})
export const explanationPreviewSchema = z.strictObject({
  evidence: explanationEvidenceSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  policy_id: z.guid(),
  policy_run_id: z.guid(),
  forecast_run_id: z.guid(),
  item_id: z.guid(),
  location_id: z.guid(),
})
export const explanationRequestSchema = z.object({
  policy_id: z.guid(),
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  question: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v)),
  confirmed: z.literal(true),
})
export const explanationAnswerSchema = z.strictObject({
  paragraphs: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(2000),
        references: z.array(z.enum(evidenceReferences)).min(1).max(5),
      }),
    )
    .min(1)
    .max(8),
})
export const explanationRecordSchema = z.object({
  id: z.guid(),
  policy_id: z.guid(),
  policy_run_id: z.guid(),
  forecast_run_id: z.guid(),
  item_id: z.guid(),
  question: z.string(),
  locale: z.enum(['en', 'ar']),
  evidence: explanationEvidenceSchema,
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  created_at: z.string(),
  requested_model: z.string().nullable(),
  response_model: z.string().nullable(),
  prompt_version: z.string(),
  api_version: z.string(),
  answer: explanationAnswerSchema.nullable(),
  error_code: z.string().nullable(),
})
export type ExplanationEvidence = z.infer<typeof explanationEvidenceSchema>
export type ExplanationAnswer = z.infer<typeof explanationAnswerSchema>
export type EvidenceReference = (typeof evidenceReferences)[number]
export function explanationStatus(status: string, createdAt: string, now = Date.now()) {
  const valid = z.enum(['pending', 'running', 'succeeded', 'failed']).parse(status)
  return (status === 'pending' || status === 'running') && now - Date.parse(createdAt) > 180_000
    ? 'expired'
    : valid
}

export type EvidenceField =
  | keyof ExplanationEvidence['policy_inputs']
  | keyof ExplanationEvidence['lead_threshold']
  | keyof ExplanationEvidence['forecast']
  | keyof ExplanationEvidence['evidence_limits']
