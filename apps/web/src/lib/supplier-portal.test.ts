import { describe, it, expect } from 'vitest'
import {
  supplierSummarySchema,
  supplierEventPackagesSchema,
  supplierBatchSummarySchema,
  supplierPublicationsSchema,
  portalGrantFromPath,
} from './supplier-portal'
import { emailReturnPath, emailDestination } from './auth/email-destination'
const id = 'bc260000-0000-4000-8000-000000000001'
const summary = {
  schema_version: 'supplier-proposal-v1',
  purpose: 'planning_only',
  item_code: '001',
  supplier_code: 'SUP',
  location_code: 'L0',
  quantity: '12.000',
  unit: 'EA',
  order_date: '2026-10-10',
  receipt_date: '2026-10-13',
  unit_price: '1.005',
  currency: 'SAR',
  subtotal: '12.06',
}
describe('supplier portal contract', () => {
  it('preserves exact supplied strings and rejects internal evidence', () => {
    expect(supplierSummarySchema.parse(summary)).toEqual(summary)
    for (const field of ['estimate', 'stock', 'forecast', 'approval_reason', 'evidence'])
      expect(supplierSummarySchema.safeParse({ ...summary, [field]: 'private' }).success).toBe(
        false,
      )
    expect(supplierSummarySchema.safeParse({ ...summary, quantity: 12 }).success).toBe(false)
    expect(supplierSummarySchema.safeParse({ ...summary, purpose: 'order' }).success).toBe(false)
  })
  it('allows only scoped supplier invitation callbacks', () => {
    expect(emailReturnPath(`/supplier-portal/${id}`)).toBe(`/auth/email/supplier-portal/${id}`)
    expect(emailDestination(['supplier-portal', id])).toBe(`/supplier-portal/${id}`)
    expect(emailDestination(['supplier-portal', id, 'extra'])).toBeNull()
    expect(() => emailReturnPath('/supplier-portal/../dashboard')).toThrow()
  })
  it('uses route metadata only as a bounded locale lookup hint', () => {
    expect(portalGrantFromPath(`/supplier-portal/${id}/record`)).toBe(id)
    for (const path of [
      '/dashboard',
      '/supplier-portal',
      '/supplier-portal/bad',
      `/supplier-portal/${id}extra`,
      null,
    ])
      expect(portalGrantFromPath(path)).toBeNull()
  })
})

it('bounds batch summaries and rejects internal evidence in every line', () => {
  const batch = {
    schema_version: 'supplier-batch-proposal-v1',
    purpose: 'planning_only',
    supplier_code: 'SUP',
    location_code: 'L0',
    order_date: summary.order_date,
    currency: 'SAR',
    subtotal: '24.12',
    lines: [summary, { ...summary, item_code: '002', unit: 'KG' }],
  }
  expect(supplierBatchSummarySchema.parse(batch)).toEqual(batch)
  for (const lines of [
    [],
    Array(51).fill(summary),
    [{ ...summary, evidence: { stock: 'private' } }],
  ])
    expect(supplierBatchSummarySchema.safeParse({ ...batch, lines }).success).toBe(false)
  expect(supplierBatchSummarySchema.safeParse({ ...batch, handoff_ids: [id] }).success).toBe(false)
  expect(supplierBatchSummarySchema.safeParse({ ...batch, subtotal: 24.12 }).success).toBe(false)
  const row = {
    id,
    created_at: '2026-10-23',
    kind: 'batch',
    summary: batch,
    overlap_count: 1,
    overlaps: [{ id, kind: 'handoff' }],
  }
  expect(
    supplierPublicationsSchema.safeParse({ total: 1, page: 1, size: 25, rows: [row] }).success,
  ).toBe(true)
  expect(
    supplierPublicationsSchema.safeParse({
      total: 1,
      page: 1,
      size: 25,
      rows: [{ ...row, members: [id] }],
    }).success,
  ).toBe(false)
})

it('event packages preserve full selected decimal strings and reject internal event fields', () => {
  const row = {
    id,
    created_at: '2026-10-24T00:00:00Z',
    summary: { ...summary, quantity: '9007199254740.123', subtotal: '999999999999.999' },
  }
  const result = { total: 1, page: 1, size: 25, rows: [row] }
  expect(supplierEventPackagesSchema.parse(result)).toEqual(result)
  for (const field of [
    'baseline',
    'event_name',
    'event_before_receipt',
    'forecast',
    'approval_reason',
  ]) {
    expect(
      supplierEventPackagesSchema.safeParse({
        ...result,
        rows: [{ ...row, summary: { ...row.summary, [field]: 'private' } }],
      }).success,
    ).toBe(false)
  }
  expect(
    supplierEventPackagesSchema.safeParse({ ...result, rows: [{ ...row, handoff_id: id }] })
      .success,
  ).toBe(false)
  expect(portalGrantFromPath(`/supplier-portal/${id}/events/${id}`)).toBe(id)
})
