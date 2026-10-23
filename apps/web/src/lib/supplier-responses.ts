import { z } from 'zod'
export const supplierResponseInput = z
  .object({
    grant_id: z.guid(),
    publication_id: z.guid(),
    kind: z.enum(['handoff', 'batch']),
    request_id: z.guid(),
    status: z.enum(['received', 'declined']),
    reference: z
      .string()
      .trim()
      .max(120)
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s)),
    reason: z.string().trim().max(2000),
  })
  .refine((v) => v.status !== 'declined' || v.reason.length > 0, { path: ['reason'] })
export const supplierResponseSchema = z.strictObject({
  id: z.guid(),
  revision: z.number().int().positive(),
  status: z.enum(['received', 'declined']),
  reference: z.string().max(120),
  reason: z.string().max(2000),
  author: z.string().max(254),
  created_at: z.string(),
})
export const supplierResponseHistorySchema = z.strictObject({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.literal(25),
  latest: supplierResponseSchema.nullable(),
  rows: z.array(supplierResponseSchema).max(25),
})
export type SupplierResponseHistory = z.infer<typeof supplierResponseHistorySchema>
export function responsePage(value: string | string[] | undefined) {
  return typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) && Number(value) <= 100000
    ? Number(value)
    : 1
}
