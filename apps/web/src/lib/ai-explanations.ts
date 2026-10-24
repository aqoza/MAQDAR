import {
  replenishmentExplanationEvidenceSchema,
  replenishmentExplanationAnswerSchema,
} from './replenishment-explainer'
import { z } from 'zod'
import { explanationRecordSchema } from './policy-explainer'
import {
  forecastExplanationEvidenceSchema,
  forecastExplanationAnswerSchema,
} from './forecast-explainer'
export const aiExplanationRecordSchema = z.discriminatedUnion('subject_kind', [
  explanationRecordSchema.extend({
    subject_kind: z.literal('policy'),
    forecast_id: z.null(),
    replenishment_draft_id: z.null(),
  }),
  explanationRecordSchema.extend({
    subject_kind: z.literal('forecast'),
    replenishment_draft_id: z.null(),
    forecast_id: z.guid(),
    policy_id: z.null(),
    policy_run_id: z.null(),
    evidence: forecastExplanationEvidenceSchema,
    answer: forecastExplanationAnswerSchema.nullable(),
  }),
  explanationRecordSchema.extend({
    subject_kind: z.literal('replenishment'),
    replenishment_draft_id: z.guid(),
    policy_id: z.null(),
    policy_run_id: z.null(),
    forecast_id: z.null(),
    forecast_run_id: z.null(),
    item_id: z.null(),
    evidence: replenishmentExplanationEvidenceSchema,
    answer: replenishmentExplanationAnswerSchema.nullable(),
  }),
])
