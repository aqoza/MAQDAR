import { z } from 'zod'
import { explanationRecordSchema } from './policy-explainer'
import {
  forecastExplanationEvidenceSchema,
  forecastExplanationAnswerSchema,
} from './forecast-explainer'
export const aiExplanationRecordSchema = z.discriminatedUnion('subject_kind', [
  explanationRecordSchema.extend({ subject_kind: z.literal('policy'), forecast_id: z.null() }),
  explanationRecordSchema.extend({
    subject_kind: z.literal('forecast'),
    forecast_id: z.guid(),
    policy_id: z.null(),
    policy_run_id: z.null(),
    evidence: forecastExplanationEvidenceSchema,
    answer: forecastExplanationAnswerSchema.nullable(),
  }),
])
