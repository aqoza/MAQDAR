import {
  deliveryExplanationEvidenceSchema,
  deliveryExplanationAnswerSchema,
  type DeliveryExplanationEvidence,
  type DeliveryExplanationAnswer,
} from './delivery-explainer'
import {
  supplierExplanationEvidenceSchema,
  supplierExplanationAnswerSchema,
  type SupplierExplanationEvidence,
  type SupplierExplanationAnswer,
} from './supplier-explainer'
import {
  replenishmentExplanationEvidenceSchema,
  replenishmentExplanationAnswerSchema,
  type ReplenishmentExplanationEvidence,
  type ReplenishmentExplanationAnswer,
} from './replenishment-explainer'
import { z } from 'zod'
import {
  explanationEvidenceSchema,
  explanationAnswerSchema,
  type ExplanationAnswer,
  type ExplanationEvidence,
} from './policy-explainer'
import {
  forecastExplanationEvidenceSchema,
  forecastExplanationAnswerSchema,
  type ForecastExplanationEvidence,
  type ForecastExplanationAnswer,
} from './forecast-explainer'
const dispatchSchema = z.discriminatedUnion('dispatch', [
  z.object({ dispatch: z.literal(false) }),
  z.object({
    dispatch: z.literal(true),
    question: z.string().min(1).max(2000),
    locale: z.enum(['en', 'ar']),
    evidence: z.union([
      explanationEvidenceSchema,
      forecastExplanationEvidenceSchema,
      replenishmentExplanationEvidenceSchema,
      supplierExplanationEvidenceSchema,
      deliveryExplanationEvidenceSchema,
    ]),
    prompt_version: z.enum([
      'policy-explainer-v1',
      'forecast-explainer-v1',
      'replenishment-explainer-v1',
      'supplier-explainer-v1',
      'delivery-explainer-v1',
    ]),
  }),
])
export type ExplanationPorts = {
  dispatch: () => Promise<unknown>
  provider: (input: {
    question: string
    locale: 'en' | 'ar'
    evidence:
      | ExplanationEvidence
      | ForecastExplanationEvidence
      | ReplenishmentExplanationEvidence
      | SupplierExplanationEvidence
      | DeliveryExplanationEvidence
  }) => Promise<{
    answer:
      | ExplanationAnswer
      | ForecastExplanationAnswer
      | ReplenishmentExplanationAnswer
      | SupplierExplanationAnswer
      | DeliveryExplanationAnswer
    model: string
  }>
  complete: (result: {
    answer:
      | ExplanationAnswer
      | ForecastExplanationAnswer
      | ReplenishmentExplanationAnswer
      | SupplierExplanationAnswer
      | DeliveryExplanationAnswer
      | null
    model: string | null
    error: 'provider_error' | 'provider_timeout' | 'invalid_response' | null
  }) => Promise<void>
}
/** Dispatch and publication independently enforce current database authority. Never return uncommitted provider text. */
export async function executePolicyExplanation(ports: ExplanationPorts): Promise<void> {
  const dispatch = dispatchSchema.parse(await ports.dispatch())
  if (!dispatch.dispatch) return
  if (dispatch.prompt_version !== dispatch.evidence.method)
    throw new Error('Evidence version mismatch')
  let result: Parameters<ExplanationPorts['complete']>[0]
  try {
    const output = await ports.provider({
      question: dispatch.question,
      locale: dispatch.locale,
      evidence: dispatch.evidence,
    })
    result = {
      answer: (dispatch.evidence.method === 'delivery-explainer-v1'
        ? deliveryExplanationAnswerSchema
        : dispatch.evidence.method === 'supplier-explainer-v1'
          ? supplierExplanationAnswerSchema
          : dispatch.evidence.method === 'replenishment-explainer-v1'
            ? replenishmentExplanationAnswerSchema
            : dispatch.evidence.method === 'forecast-explainer-v1'
              ? forecastExplanationAnswerSchema
              : explanationAnswerSchema
      ).parse(output.answer),
      model: z
        .string()
        .regex(/^[a-z0-9.-]{1,80}$/)
        .parse(output.model),
      error: null,
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    result = {
      answer: null,
      model: null,
      error: code === 'provider_timeout' || code === 'invalid_response' ? code : 'provider_error',
    }
  }
  await ports.complete(result)
}
