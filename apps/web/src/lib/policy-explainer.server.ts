import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@zeespare/shared/database.types'
import { env } from './env'
import { serverEnv } from './env.server'
import { executePolicyExplanation } from './policy-explainer-execution'
import {
  requestClaudePolicy,
  requestClaudeForecast,
  requestClaudeReplenishment,
  requestClaudeSupplier,
  requestClaudeDelivery,
  type ClaudeConfiguration,
} from './claude-policy.server'
/** Privileged client is confined to two guarded RPCs; it never reads tenant tables directly. */
export async function generatePolicyExplanation(
  id: string,
  actor: string,
  config: ClaudeConfiguration,
) {
  const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  await executePolicyExplanation({
    dispatch: async () => {
      const { data, error } = await db.rpc('policy_explainer_dispatch', {
        p_id: id,
        p_actor: actor,
        p_model: config.model,
      })
      if (error) throw new Error('Explanation dispatch unavailable')
      return data
    },
    provider: (input) =>
      input.evidence.method === 'delivery-explainer-v1'
        ? requestClaudeDelivery({ ...input, evidence: input.evidence }, config)
        : input.evidence.method === 'supplier-explainer-v1'
          ? requestClaudeSupplier({ ...input, evidence: input.evidence }, config)
          : input.evidence.method === 'replenishment-explainer-v1'
            ? requestClaudeReplenishment({ ...input, evidence: input.evidence }, config)
            : input.evidence.method === 'forecast-explainer-v1'
              ? requestClaudeForecast({ ...input, evidence: input.evidence }, config)
              : requestClaudePolicy({ ...input, evidence: input.evidence }, config),
    complete: async (result) => {
      const { error } = await db.rpc('policy_explainer_complete', {
        p_id: id,
        p_actor: actor,
        p_answer: result.answer,
        p_response_model: result.model ?? '',
        p_error: result.error ?? '',
      })
      if (error) throw new Error('Explanation publication unavailable')
    },
  })
}
