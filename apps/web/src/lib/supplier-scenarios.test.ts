import { expect, it } from 'vitest'
import {
  supplierScenarioInputSchema,
  supplierScenarioSaveSchema,
  supplierScenarioParams,
} from './supplier-scenarios'
import { supplierItemSchema } from './master-data/entities/supplier-items'
const id = '99000000-0000-4000-8000-000000000001'
const input = { draft: id, supplier: 'SUP-01', confirmed: 'true' }
it('requires an explicit valid supplier and confirmation value', () => {
  expect(supplierScenarioInputSchema.parse({ ...input, supplier: ' SUP-01 ' }).supplier).toBe(
    'SUP-01',
  )
  for (const supplier of ['', 'SUP/1', 'x'.repeat(65), 'a<script>'])
    expect(supplierScenarioInputSchema.safeParse({ ...input, supplier }).success).toBe(false)
  expect(supplierScenarioInputSchema.safeParse({ ...input, confirmed: 'yes' }).success).toBe(false)
  expect(supplierScenarioInputSchema.safeParse({ ...input, draft: 'bad' }).success).toBe(false)
})
it('treats an unchecked box as false and requires a save identity/fingerprint', () => {
  expect(supplierScenarioParams({ draft: id, supplier: ['SUP-01', 'OTHER'] })).toEqual({
    ...input,
    confirmed: 'false',
  })
  expect(supplierScenarioSaveSchema.safeParse(input).success).toBe(false)
  expect(
    supplierScenarioSaveSchema.safeParse({ ...input, request_id: id, fingerprint: 'a'.repeat(64) })
      .success,
  ).toBe(true)
})
it('accepts only supplied supplier units and leaves legacy values unknown', () => {
  const base = {
    supplier_id: id,
    item_code: 'ITEM',
    supplier_part_number: '',
    lead_time_days: '3',
    lead_time_days_p90: '',
    min_order_quantity: '10',
    pack_size: '6',
    unit_price: '1',
    currency: 'SAR',
    is_preferred: false,
    valid_from: '',
  }
  expect(supplierItemSchema.parse(base).unit_of_measure).toBeNull()
  expect(supplierItemSchema.parse({ ...base, unit_of_measure: '' }).unit_of_measure).toBeNull()
  expect(supplierItemSchema.parse({ ...base, unit_of_measure: 'KG' }).unit_of_measure).toBe('KG')
  expect(supplierItemSchema.safeParse({ ...base, unit_of_measure: 'BOX' }).success).toBe(false)
})
