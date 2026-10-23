import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@maqdar/shared/database.types'
import { workbenchRowSchema as purchaseSchema } from './purchase-review'
import { workbenchRowSchema as transferSchema } from './transfer-review'
import { comparisonSchema } from './stock-comparison'
import {
  ACTION_SOURCE_LIMIT,
  STOCK_CHECK_LIMIT,
  actionForecastSchema,
  forecastAction,
  purchaseAction,
  stockAction,
  transferAction,
  sortPlannerActions,
  type ActionSource,
  type ActionSourceState,
  type PlannerAction,
  type PlannerActionData,
} from './planner-actions'

const policySchema = z.object({ id: z.guid(), to_date: z.iso.date(), finished_at: z.string() })
type SourceResult = { actions: PlannerAction[]; state: ActionSourceState }
const present = (action: PlannerAction | null): action is PlannerAction => action !== null
const timeout = () => AbortSignal.timeout(15_000)

/** Session client only: security-invoker views and the comparison RPC retain all branch RLS. */
export async function loadPlannerActions(
  db: SupabaseClient<Database>,
  organizationId: string,
): Promise<PlannerActionData> {
  async function source(
    name: ActionSource,
    read: () => Promise<Omit<SourceResult, 'state'> & { limited: boolean; failed?: boolean }>,
  ): Promise<SourceResult> {
    try {
      const result = await read()
      return {
        actions: result.actions,
        state: { source: name, limited: result.limited, failed: result.failed ?? false },
      }
    } catch {
      // No raw database error, hidden identifiers or guessed zero totals reach the browser.
      return { actions: [], state: { source: name, failed: true, limited: false } }
    }
  }

  const results = await Promise.all([
    source('purchase', async () => {
      const result = await db
        .from('purchase_review_list')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .order('id')
        .limit(ACTION_SOURCE_LIMIT + 1)
        .abortSignal(timeout())
      if (result.error) throw result.error
      const rows = z.array(purchaseSchema).parse(result.data)
      return {
        actions: rows
          .slice(0, ACTION_SOURCE_LIMIT)
          .map((row) => purchaseAction(row, 'purchase'))
          .filter(present),
        limited: rows.length > ACTION_SOURCE_LIMIT,
      }
    }),
    source('transfer', async () => {
      const result = await db
        .from('transfer_review_list')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .order('id')
        .limit(ACTION_SOURCE_LIMIT + 1)
        .abortSignal(timeout())
      if (result.error) throw result.error
      const rows = z.array(transferSchema).parse(result.data)
      return {
        actions: rows.slice(0, ACTION_SOURCE_LIMIT).map(transferAction).filter(present),
        limited: rows.length > ACTION_SOURCE_LIMIT,
      }
    }),
    source('forecast', async () => {
      const result = await db
        .from('forecast_quality')
        .select(
          'id,run_id,item_id,item_code,item_name,location_code,status,model,to_date,finished_at,horizon',
        )
        .eq('organization_id', organizationId)
        .eq('status', 'selected')
        .order('finished_at', { ascending: false })
        .order('id')
        .limit(ACTION_SOURCE_LIMIT + 1)
        .abortSignal(timeout())
      if (result.error) throw result.error
      const rows = z.array(actionForecastSchema).parse(result.data)
      return {
        actions: rows.slice(0, ACTION_SOURCE_LIMIT).map(forecastAction).filter(present),
        limited: rows.length > ACTION_SOURCE_LIMIT,
      }
    }),
    source('handoff', async () => {
      const result = await db
        .from('purchase_review_list')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'approved')
        .eq('selected', true)
        .order('created_at', { ascending: false })
        .order('id')
        .limit(ACTION_SOURCE_LIMIT + 1)
        .abortSignal(timeout())
      if (result.error) throw result.error
      const rows = z.array(purchaseSchema).parse(result.data)
      const recent = rows.slice(0, ACTION_SOURCE_LIMIT)
      if (!recent.length) return { actions: [], limited: false }
      const handoffs = await db
        .from('purchase_handoffs')
        .select('proposal_id')
        .eq('organization_id', organizationId)
        .in(
          'proposal_id',
          recent.map((row) => row.id),
        )
        .limit(ACTION_SOURCE_LIMIT)
        .abortSignal(timeout())
      if (handoffs.error) throw handoffs.error
      const existing = new Set(handoffs.data.map((row) => row.proposal_id))
      return {
        actions: recent
          .filter((row) => !existing.has(row.id))
          .map((row) => purchaseAction(row, 'handoff'))
          .filter(present),
        limited: rows.length > ACTION_SOURCE_LIMIT,
      }
    }),
    source('stock', async () => {
      const result = await db
        .from('policy_workbench')
        .select('id,to_date,finished_at')
        .eq('organization_id', organizationId)
        .order('finished_at', { ascending: false })
        .order('id')
        .limit(STOCK_CHECK_LIMIT + 1)
        .abortSignal(timeout())
      if (result.error) throw result.error
      const rows = z.array(policySchema).parse(result.data)
      const outcomes: PromiseSettledResult<PlannerAction | null>[] = []
      // Bounded live checks in groups of five, never an unbounded RPC per policy history row.
      for (let start = 0; start < Math.min(rows.length, STOCK_CHECK_LIMIT); start += 5) {
        outcomes.push(
          ...(await Promise.allSettled(
            rows.slice(start, Math.min(start + 5, STOCK_CHECK_LIMIT)).map(async (row) => {
              const comparison = await db
                .rpc('policy_stock_comparison', {
                  p_organization_id: organizationId,
                  p_policy_id: row.id,
                  p_day: row.to_date,
                  p_basis: 'calculated',
                })
                .abortSignal(timeout())
              if (comparison.error) throw comparison.error
              return stockAction(comparisonSchema.parse(comparison.data), row.finished_at)
            }),
          )),
        )
      }
      return {
        actions: outcomes.flatMap((result) =>
          result.status === 'fulfilled' && result.value ? [result.value] : [],
        ),
        failed: outcomes.some((result) => result.status === 'rejected'),
        limited: rows.length > STOCK_CHECK_LIMIT,
      }
    }),
  ])
  return {
    actions: sortPlannerActions(results.flatMap((result) => result.actions)),
    sources: results.map((result) => result.state),
    checkedAt: new Date().toISOString(),
  }
}
