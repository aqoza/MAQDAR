import { expect, it } from 'vitest'
import {
  formatCostDecimal,
  formatPurchaseCost,
  purchaseCostInputSchema,
  purchaseCostParams,
  purchaseCostSaveSchema,
} from './purchase-costs'
const id = '99000000-0000-4000-8000-000000000001'
it('requires a saved source and explicit confirmation without accepting alternate truthy values', () => {
  expect(purchaseCostParams({ delivery: [id, 'ignored'] })).toEqual({
    delivery: id,
    confirmed: 'false',
  })
  expect(purchaseCostInputSchema.parse({ delivery: id, confirmed: 'true' }).delivery).toBe(id)
  for (const confirmed of [undefined, 'yes', '1', true])
    expect(purchaseCostInputSchema.safeParse({ delivery: id, confirmed }).success).toBe(false)
  expect(purchaseCostInputSchema.safeParse({ delivery: 'bad', confirmed: 'true' }).success).toBe(
    false,
  )
  expect(purchaseCostSaveSchema.safeParse({ delivery: id, confirmed: 'false' }).success).toBe(false)
  expect(
    purchaseCostSaveSchema.safeParse({
      delivery: id,
      confirmed: 'false',
      request_id: id,
      fingerprint: 'a'.repeat(64),
    }).success,
  ).toBe(true)
})
it('displays exact decimal evidence without binary-float conversion or early currency rounding', () => {
  expect(formatCostDecimal('999999999999999.999', 'en-US', 3)).toBe('999,999,999,999,999.999')
  expect(formatCostDecimal('3.085000', 'en-US')).toBe('3.085')
  expect(formatCostDecimal('1.005', 'en-US', 3)).toBe('1.005')
  expect(formatPurchaseCost('999999999999999.99', 'SAR', 2, 'en-US')).toContain(
    '999,999,999,999,999.99',
  )
  expect(formatPurchaseCost('3.090', 'SAR', 2, 'en-US')).toContain('3.09')
  expect(formatPurchaseCost('3.085', 'KWD', 3, 'en-US')).toContain('3.085')
  expect(formatPurchaseCost('3', 'JPY', 0, 'en-US')).toContain('3')
  expect(formatPurchaseCost('0', 'SAR', 2, 'en-US')).toContain('0.00')
  expect(formatPurchaseCost(null, 'SAR', 2, 'en-US')).toBe('—')
  expect(formatPurchaseCost('0', null, null, 'en-US')).toBe('—')
  expect(formatCostDecimal('1234.005', 'ar-u-nu-latn')).toContain('1,234.005')
})
