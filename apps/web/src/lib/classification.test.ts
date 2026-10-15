import { expect, it } from 'vitest'
import { CLASSIFICATION_DEFAULTS, classificationOptionsSchema } from './classification'

it('accepts approved defaults and editable ordered thresholds', () => {
  expect(classificationOptionsSchema.safeParse(CLASSIFICATION_DEFAULTS).success).toBe(true)
  expect(
    classificationOptionsSchema.safeParse({ ...CLASSIFICATION_DEFAULTS, adi: '2', cv2: '0.75' })
      .success,
  ).toBe(true)
})
it.each([
  { adi: '0.99' },
  { cv2: '0' },
  { abc_a: '0.95' },
  { abc_b: '1' },
  { xyz_y: '0.5' },
  { cv2: 'NaN' },
  { cv2: '1e2' },
  { cv2: '0.1234567' },
  { cv2: '1000001' },
  { cv2: '-1' },
])('rejects invalid thresholds %o', (change) => {
  expect(
    classificationOptionsSchema.safeParse({ ...CLASSIFICATION_DEFAULTS, ...change }).success,
  ).toBe(false)
})
