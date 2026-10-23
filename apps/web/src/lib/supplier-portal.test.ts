import { describe, it, expect } from 'vitest'
import { supplierSummarySchema, portalGrantFromPath } from './supplier-portal'
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
