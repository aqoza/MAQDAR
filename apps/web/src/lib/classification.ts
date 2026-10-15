import { z } from 'zod'

export const CLASSIFICATION_DEFAULTS = {
  adi: '1.32',
  cv2: '0.49',
  abc_a: '0.8',
  abc_b: '0.95',
  xyz_x: '0.5',
  xyz_y: '1',
} as const
export const CLASSIFICATION_FIELDS = ['adi', 'cv2', 'abc_a', 'abc_b', 'xyz_x', 'xyz_y'] as const
const threshold = z
  .string()
  .max(20)
  .regex(/^\d+(\.\d{1,6})?$/)
  .refine((v) => Number(v) > 0 && Number(v) <= 1_000_000)
export const classificationOptionsSchema = z
  .object({
    adi: threshold,
    cv2: threshold,
    abc_a: threshold,
    abc_b: threshold,
    xyz_x: threshold,
    xyz_y: threshold,
  })
  .refine(
    (o) =>
      Number(o.adi) >= 1 &&
      Number(o.abc_a) < Number(o.abc_b) &&
      Number(o.abc_b) < 1 &&
      Number(o.xyz_x) < Number(o.xyz_y),
  )

const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const classificationEvidenceSchema = z.object({
  source: z.object({
    quantity: decimal,
    lost_sales_quantity: decimal,
    unit_cost: decimal,
    days: z.number().int().nonnegative(),
    positive_days: z.number().int().nonnegative(),
    status: z.enum(['new', 'active', 'phase_out', 'discontinued']),
    introduced_on: z.string().nullable(),
    discontinued_on: z.string().nullable(),
    last_sale: z.string().nullable(),
    days_since_last_sale: z.number().int().nonnegative().nullable(),
  }),
  metrics: z.object({
    adi: decimal.nullable(),
    cv2: decimal.nullable(),
    daily_cv: decimal.nullable(),
    value: decimal,
  }),
})
export const CLASSIFICATION_PATTERNS = [
  'smooth',
  'erratic',
  'intermittent',
  'lumpy',
  'no_sales',
  'insufficient',
  'outside_lifecycle',
] as const
