import { z } from 'zod'
import {
  explanationEvidenceSchema,
  explanationAnswerSchema,
  type ExplanationAnswer,
  type ExplanationEvidence,
} from './policy-explainer'
const dispatchSchema = z.discriminatedUnion('dispatch', [
  z.object({ dispatch: z.literal(false) }),
  z.object({
    dispatch: z.literal(true),
    question: z.string().min(1).max(2000),
    locale: z.enum(['en', 'ar']),
    evidence: explanationEvidenceSchema,
    prompt_version: z.literal('policy-explainer-v1'),
  }),
])
export type ExplanationPorts = {
  dispatch: () => Promise<unknown>
  provider: (input: {
    question: string
    locale: 'en' | 'ar'
    evidence: ExplanationEvidence
  }) => Promise<{ answer: ExplanationAnswer; model: string }>
  complete: (result: {
    answer: ExplanationAnswer | null
    model: string | null
    error: 'provider_error' | 'provider_timeout' | 'invalid_response' | null
  }) => Promise<void>
}
/** Dispatch and publication independently enforce current database authority. Never return uncommitted provider text. */
export async function executePolicyExplanation(ports: ExplanationPorts): Promise<void> {
  const dispatch = dispatchSchema.parse(await ports.dispatch())
  if (!dispatch.dispatch) return
  let result: Parameters<ExplanationPorts['complete']>[0]
  try {
    const output = await ports.provider({
      question: dispatch.question,
      locale: dispatch.locale,
      evidence: dispatch.evidence,
    })
    result = {
      answer: explanationAnswerSchema.parse(output.answer),
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
