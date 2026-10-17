import { describe, expect, it } from 'vitest'
import { capacityInputSchema, capacityParams, capacitySaveSchema } from './container-capacity'
import { supplierItemSchema } from './master-data/entities/supplier-items'

const id = '99000000-0000-4000-8000-000000000001'
const input = { batch: id, volume: '0.000001', payload: '999999999.123456', confirmed: 'true' }
describe('capacity input', () => {
  it('preserves six-decimal limits and normalizes localized digits', () => {
    expect(capacityInputSchema.parse(input)).toEqual(input)
    expect(capacityInputSchema.parse({ ...input, volume: '١٢٫٢٥' }).volume).toBe('12.25')
    expect(capacityParams({ batch: [id, 'ignored'] })).toEqual({
      batch: id,
      volume: '',
      payload: '',
      confirmed: 'false',
    })
  })
  it.each(['0', '-1', 'NaN', 'Infinity', '1e6', '0.0000001', '1000000000', '1,23'])(
    'rejects invalid limit %s',
    (volume) => {
      expect(capacityInputSchema.safeParse({ ...input, volume }).success).toBe(false)
    },
  )
  it('requires an explicit valid save identity and confirmation value', () => {
    expect(capacitySaveSchema.safeParse(input).success).toBe(false)
    expect(capacityInputSchema.safeParse({ ...input, confirmed: 'yes' }).success).toBe(false)
  })
})
describe('supplier shipping evidence', () => {
  const supplier = {
    supplier_id: id,
    item_code: 'P1',
    supplier_part_number: '',
    lead_time_days: '3',
    lead_time_days_p90: '',
    min_order_quantity: '0',
    pack_size: '1',
    unit_price: '1',
    currency: 'SAR',
    is_preferred: false,
    valid_from: '',
    unit_of_measure: 'EA',
  }
  it('keeps legacy records unknown and dates independent', () => {
    expect(supplierItemSchema.parse(supplier)).toMatchObject({
      shipping_weight_kg: null,
      shipping_volume_m3: null,
      shipping_valid_from: null,
    })
    expect(
      supplierItemSchema.parse({
        ...supplier,
        shipping_weight_kg: '0.000001',
        shipping_volume_m3: '0.123456',
        shipping_valid_from: '2026-01-01',
      }),
    ).toMatchObject({
      shipping_weight_kg: 0.000001,
      shipping_volume_m3: 0.123456,
      shipping_valid_from: '2026-01-01',
      valid_from: null,
    })
  })
  it.each(['0', '-1', 'NaN', '0.1234567'])('rejects invalid measurements %s', (value) => {
    expect(supplierItemSchema.safeParse({ ...supplier, shipping_weight_kg: value }).success).toBe(
      false,
    )
  })
})
