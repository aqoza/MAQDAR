import { z } from 'zod'
import { comparisonSchema } from './stock-comparison'
import { workbenchRowSchema as purchaseSchema } from './purchase-review'
import { workbenchRowSchema as transferSchema } from './transfer-review'
import { qualityRowSchema } from './forecast-quality'
import { normalizeSearch } from './master-data/search'

export const ACTION_SOURCE_LIMIT = 25
export const STOCK_CHECK_LIMIT = 10
export const actionCategories = ['all', 'evidence', 'review', 'next'] as const
export type ActionCategory = (typeof actionCategories)[number]
export const actionSources = ['stock', 'purchase', 'transfer', 'forecast', 'handoff'] as const
export type ActionSource = (typeof actionSources)[number]
export type ActionKind = 'stock' | 'purchase' | 'transfer' | 'forecast' | 'handoff'
export type ActionFact = {
  label:
    | 'cutoff'
    | 'stockDate'
    | 'quantity'
    | 'maximum'
    | 'basis'
    | 'source'
    | 'supplier'
    | 'subtotal'
    | 'receipt'
    | 'historyEnd'
    | 'model'
    | 'horizon'
  value: string | null
  format?: 'date' | 'quantity' | 'money' | 'model' | 'basis'
  unit?: string | null
  currency?: string
  digits?: number
}
export type PlannerAction = {
  id: string
  kind: ActionKind
  category: Exclude<ActionCategory, 'all'>
  item: string
  name?: string
  location: string
  sourceLocation?: string
  timestamp: string
  href: string
  status?: z.infer<typeof comparisonSchema>['status']
  facts: ActionFact[]
}
export type ActionSourceState = { source: ActionSource; failed: boolean; limited: boolean }
export type PlannerActionData = {
  actions: PlannerAction[]
  sources: ActionSourceState[]
  checkedAt: string
}

export const actionForecastSchema = qualityRowSchema.pick({
  id: true,
  run_id: true,
  item_id: true,
  item_code: true,
  item_name: true,
  location_code: true,
  status: true,
  model: true,
  to_date: true,
  finished_at: true,
  horizon: true,
})

/** Only existing RPC outcomes produce evidence actions; no freshness/risk formula here. */
export function stockAction(
  report: z.infer<typeof comparisonSchema>,
  timestamp: string,
): PlannerAction | null {
  if (report.status === 'available') return null
  return {
    id: `stock:${report.policy_id}`,
    kind: 'stock',
    category: 'evidence',
    item: report.item_code,
    location: report.location_code,
    timestamp,
    href: `/forecasts/workbench/${report.policy_id}/stock?${new URLSearchParams({ day: report.day, basis: report.basis, ...(report.override_id ? { override: report.override_id } : {}) })}`,
    status: report.status,
    facts: [
      { label: 'cutoff', value: report.cutoff, format: 'date' },
      { label: 'basis', value: report.basis, format: 'basis' },
      { label: 'stockDate', value: report.snapshot?.date ?? null, format: 'date' },
      {
        label: 'quantity',
        value: report.snapshot?.quantity ?? null,
        unit: report.snapshot?.unit,
        format: 'quantity',
      },
    ],
  }
}

export function purchaseAction(
  row: z.infer<typeof purchaseSchema>,
  kind: 'purchase' | 'handoff',
): PlannerAction | null {
  if (kind === 'purchase' ? row.status !== 'pending' : row.status !== 'approved' || !row.selected)
    return null
  return {
    id: `${kind}:${row.id}`,
    kind,
    category: kind === 'purchase' ? 'review' : 'next',
    item: row.item_code,
    location: row.location_code,
    timestamp: row.created_at,
    href: `/replenishment/review/${row.id}`,
    facts: [
      { label: 'supplier', value: row.supplier_code },
      { label: 'quantity', value: row.quantity, unit: row.unit, format: 'quantity' },
      {
        label: 'subtotal',
        value: row.subtotal,
        currency: row.currency,
        digits: row.minor_units,
        format: 'money',
      },
      { label: 'receipt', value: row.receipt_date, format: 'date' },
    ],
  }
}

export function transferAction(row: z.infer<typeof transferSchema>): PlannerAction | null {
  if (row.status !== 'pending') return null
  return {
    id: `transfer:${row.id}`,
    kind: 'transfer',
    category: 'review',
    item: row.item_code,
    location: row.location_code,
    sourceLocation: row.source_code,
    timestamp: row.created_at,
    href: `/replenishment/redistribution/review/${row.id}`,
    facts: [
      { label: 'source', value: row.source_code },
      { label: 'quantity', value: row.quantity, unit: row.unit, format: 'quantity' },
      {
        label: 'subtotal',
        value: row.subtotal,
        currency: row.currency,
        digits: row.minor_units,
        format: 'money',
      },
      { label: 'receipt', value: row.typical_receipt, format: 'date' },
    ],
  }
}

export function forecastAction(row: z.infer<typeof actionForecastSchema>): PlannerAction | null {
  if (row.status !== 'selected') return null
  return {
    id: `forecast:${row.id}`,
    kind: 'forecast',
    category: 'next',
    item: row.item_code,
    name: row.item_name,
    location: row.location_code,
    timestamp: row.finished_at,
    href: `/forecasts/results/${row.run_id}?${new URLSearchParams({ item: row.item_id })}`,
    facts: [
      { label: 'historyEnd', value: row.to_date, format: 'date' },
      { label: 'model', value: row.model, format: 'model' },
      { label: 'horizon', value: row.horizon, format: 'quantity' },
    ],
  }
}

export function filterPlannerActions(
  actions: PlannerAction[],
  category: ActionCategory,
  location: string,
  search: string,
) {
  const tokens = normalizeSearch(search).split(' ').filter(Boolean)
  return actions.filter((action) => {
    const text = normalizeSearch(
      [action.item, action.name, action.location, action.sourceLocation].filter(Boolean).join(' '),
    )
    return (
      (category === 'all' || action.category === category) &&
      (!location || action.location === location || action.sourceLocation === location) &&
      tokens.every((token) => text.includes(token))
    )
  })
}

export function sortPlannerActions(actions: PlannerAction[]) {
  const rank = { evidence: 0, review: 1, next: 2 }
  return [...actions].sort(
    (a, b) =>
      rank[a.category] - rank[b.category] ||
      b.timestamp.localeCompare(a.timestamp) ||
      a.id.localeCompare(b.id),
  )
}
