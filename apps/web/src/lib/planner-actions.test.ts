import { describe, expect, it } from 'vitest'
import {
  filterPlannerActions,
  forecastAction,
  purchaseAction,
  sortPlannerActions,
  stockAction,
  transferAction,
} from './planner-actions'
import { workbenchRowSchema } from './purchase-review'
import { comparisonSchema } from './stock-comparison'
import { en, ar } from '@/i18n/messages'

const id = '00000000-0000-4000-8000-000000000001'
export const purchase = workbenchRowSchema.parse({
  id,
  estimate_id: id,
  draft_id: id,
  revision: 1,
  created_at: '2026-10-23T00:00:00Z',
  status: 'pending',
  selected: false,
  item_code: 'BRG-1',
  location_code: 'MCT',
  supplier_code: 'SUP',
  quantity: '12.125',
  unit: 'KG',
  currency: 'OMR',
  subtotal: '12.329375',
  minor_units: 3,
  order_date: '2026-10-23',
  receipt_date: '2026-10-30',
})
const comparison = comparisonSchema.parse({
  status: 'stock_missing',
  policy_id: id,
  run_id: id,
  forecast_id: id,
  item_code: 'BRG-1',
  location_code: 'MCT',
  day: '2026-10-10',
  cutoff: '2026-10-10',
  unit: 'EA',
  unit_provenance: null,
  basis: 'calculated',
  override_id: null,
  revision: null,
  maximum: '20',
  quantity_above: null,
  value_above: null,
  snapshot: null,
})

describe('Planner Action Centre semantics', () => {
  it('has complete Arabic copy, including every reused stock outcome', () => {
    function leaves(value: object, prefix = ''): string[] {
      return Object.entries(value).flatMap(([key, entry]) =>
        typeof entry === 'string' ? [`${prefix}${key}`] : leaves(entry, `${prefix}${key}.`),
      )
    }
    expect(leaves(ar.PlannerActions).sort()).toEqual(leaves(en.PlannerActions).sort())
    for (const status of comparisonSchema.shape.status.options) {
      expect(ar.PlannerActions.stockTitles[status]).toMatch(/[\u0600-\u06ff]/)
      expect(ar.StockComparison.statuses[status]).toMatch(/[\u0600-\u06ff]/)
    }
    expect(ar.StockComparison.calculated).toMatch(/[\u0600-\u06ff]/)
  })
  it('does not turn completed/rejected proposals or superseded approvals into actions', () => {
    expect(purchaseAction({ ...purchase, status: 'rejected' }, 'purchase')).toBeNull()
    expect(purchaseAction({ ...purchase, status: 'approved' }, 'handoff')).toBeNull()
    expect(
      purchaseAction({ ...purchase, status: 'approved', selected: true }, 'handoff')?.category,
    ).toBe('next')
    expect(
      transferAction({
        ...purchase,
        source_code: 'SOH',
        dispatch_date: '2026-10-23',
        typical_receipt: '2026-10-24',
        slow_receipt: '2026-10-25',
        status: 'approved',
      }),
    ).toBeNull()
  })
  it('uses the RPC outcome, date and basis; never calculates a new stock threshold', () => {
    expect(stockAction({ ...comparison, status: 'available' }, purchase.created_at)).toBeNull()
    for (const status of [
      'stock_missing',
      'stock_stale',
      'unit_mismatch',
      'policy_unit_unknown',
    ] as const) {
      const action = stockAction({ ...comparison, status }, purchase.created_at)!
      expect(action.status).toBe(status)
      expect(action.href).toContain('day=2026-10-10&basis=calculated')
      expect(action.facts.find((fact) => fact.label === 'quantity')?.value).toBeNull()
    }
    expect(
      stockAction({ ...comparison, basis: 'approved', override_id: id }, purchase.created_at)?.href,
    ).toContain(`override=${id}`)
  })
  it('preserves exact decimal strings, supplied units and currency precision', () => {
    const action = purchaseAction(purchase, 'purchase')!
    expect(action.facts.find((fact) => fact.label === 'subtotal')).toMatchObject({
      value: '12.329375',
      currency: 'OMR',
      digits: 3,
    })
    expect(action.facts.find((fact) => fact.label === 'quantity')).toMatchObject({
      value: '12.125',
      unit: 'KG',
    })
  })
  it('links selected forecast evidence to the exact run/item, not a new forecast', () => {
    const row = {
      id,
      run_id: id,
      item_id: id,
      item_code: 'BRG-1',
      item_name: 'Bearing',
      location_code: 'MCT',
      status: 'selected' as const,
      model: 'mean' as const,
      to_date: '2026-10-10',
      finished_at: purchase.created_at,
      horizon: '30',
    }
    expect(forecastAction(row)?.href).toBe(`/forecasts/results/${id}?item=${id}`)
    expect(forecastAction({ ...row, status: 'insufficient' })).toBeNull()
  })
  it('searches normalized tokens and both transfer endpoints, with stable immutable sorting', () => {
    const review = {
      ...purchaseAction(purchase, 'purchase')!,
      name: 'قِطْعَة أمان ١٢',
      sourceLocation: 'SOH',
    }
    const evidence = stockAction(comparison, purchase.created_at)!
    const original = [review, evidence]
    expect(filterPlannerActions(original, 'review', 'SOH', 'قطعه امان 12')).toEqual([review])
    expect(filterPlannerActions(original, 'all', 'OTHER', '')).toEqual([])
    expect(sortPlannerActions(original)).toEqual([evidence, review])
    expect(original).toEqual([review, evidence])
  })
})
