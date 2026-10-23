import { z } from 'zod'
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/)
export const supplierSummarySchema = z.strictObject({
  schema_version: z.literal('supplier-proposal-v1'),
  purpose: z.literal('planning_only'),
  item_code: z.string(),
  supplier_code: z.string(),
  location_code: z.string(),
  quantity: decimal,
  unit: z.string(),
  order_date: z.iso.date(),
  receipt_date: z.iso.date(),
  unit_price: decimal,
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotal: decimal,
})
export type SupplierSummary = z.infer<typeof supplierSummarySchema>
export const supplierPreviewSchema = z.object({
  summary: supplierSummarySchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export const supplierPortalsSchema = z.array(
  z.object({
    id: z.guid(),
    organization_id: z.guid(),
    organization_name: z.string(),
    supplier_code: z.string(),
    accepted: z.boolean(),
    expires_at: z.string(),
    arabic_enabled: z.boolean(),
    default_locale: z.enum(['en', 'ar']),
    numbering_system: z.enum(['latn', 'arab']),
  }),
)
export const supplierPackageSchema = z.object({
  id: z.guid(),
  created_at: z.string(),
  summary: supplierSummarySchema,
})
export const supplierPackagesSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.number().int().positive(),
  rows: z.array(supplierPackageSchema).max(100),
})
export function portalGrantFromPath(path: string | null) {
  const id = /^\/supplier-portal\/([0-9a-f-]{36})(?:\/|$)/i.exec(path ?? '')?.[1]
  return id && z.guid().safeParse(id).success ? id.toLowerCase() : null
}

export const supplierBatchSummarySchema = z.strictObject({
  schema_version: z.literal('supplier-batch-proposal-v1'),
  purpose: z.literal('planning_only'),
  supplier_code: z.string(),
  location_code: z.string(),
  order_date: z.iso.date(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotal: decimal,
  lines: z.array(supplierSummarySchema).min(1).max(50),
})
export type SupplierBatchSummary = z.infer<typeof supplierBatchSummarySchema>
export const supplierBatchPreviewSchema = z.object({
  summary: supplierBatchSummarySchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
const publicationMetadata = {
  id: z.guid(),
  created_at: z.string(),
  overlap_count: z.number().int().nonnegative(),
  overlaps: z.array(z.strictObject({ id: z.guid(), kind: z.enum(['handoff', 'batch']) })).max(25),
}
export const supplierPublicationsSchema = supplierPackagesSchema.extend({
  rows: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          ...publicationMetadata,
          kind: z.literal('handoff'),
          summary: supplierSummarySchema,
        }),
        z.strictObject({
          ...publicationMetadata,
          kind: z.literal('batch'),
          summary: supplierBatchSummarySchema,
        }),
      ]),
    )
    .max(100),
})
