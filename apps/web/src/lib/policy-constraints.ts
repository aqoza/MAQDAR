import { z } from 'zod'
import { alternativeMaximaSchema } from './policy-sensitivity'
import { simulationEvidenceSchema } from './policy-simulation'

const inputQuantity = z
  .string()
  .transform((value) => [value])
  .pipe(alternativeMaximaSchema)
  .transform(([value]) => value)
const decimal = z.string().regex(/^\d{1,35}(\.\d{1,6})?$/)
const constraintSchema = z.strictObject({
  moq: inputQuantity,
  pack: inputQuantity.refine((value) => value !== '0'),
  maximum: z
    .string()
    .transform((value) => [value])
    .pipe(alternativeMaximaSchema)
    .transform(([value]) => value),
  lead_time: z.number().int().min(0).max(365),
  review_interval: z.number().int().min(1).max(365),
})
const milliunits = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
}
export const constraintsSchema = z
  .array(constraintSchema)
  .min(1)
  .max(10)
  .transform((values) =>
    values.sort((a, b) =>
      milliunits(a.maximum) < milliunits(b.maximum)
        ? -1
        : milliunits(a.maximum) > milliunits(b.maximum)
          ? 1
          : a.lead_time - b.lead_time ||
            a.review_interval - b.review_interval ||
            (milliunits(a.moq) < milliunits(b.moq)
              ? -1
              : milliunits(a.moq) > milliunits(b.moq)
                ? 1
                : milliunits(a.pack) < milliunits(b.pack)
                  ? -1
                  : milliunits(a.pack) > milliunits(b.pack)
                    ? 1
                    : 0),
    ),
  )
  .refine((values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length)

export const constraintsRequestSchema = z.object({
  source_run_id: z.guid(),
  request_id: z.uuid(),
  configurations: z
    .string()
    .max(3000)
    .transform((text, context) => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        context.addIssue({ code: 'custom', message: 'Invalid configurations' })
        return z.NEVER
      }
    })
    .pipe(constraintsSchema),
  reuse_confirmed: z.literal('on'),
})

export const constraintsEvidenceSchema = simulationEvidenceSchema.extend({
  method: z.literal('periodic-constraints-v1'),
  options: simulationEvidenceSchema.shape.options.omit({ alternative_maximum: true }).extend({
    configurations: constraintsSchema,
    reuse_confirmed: z.literal(true),
    source_run_id: z.guid(),
  }),
  source_simulation: z.object({
    id: z.guid(),
    run_id: z.guid(),
    evidence: simulationEvidenceSchema,
  }),
  output: z.object({
    method: z.literal('periodic-constraints-v1'),
    variants: z
      .array(
        simulationEvidenceSchema.shape.output.shape.variants.element.extend({
          name: z.string().regex(/^(baseline|alternative-([1-9]|10))$/),
          moq: inputQuantity.nullable(),
          pack: inputQuantity.nullable(),
          metrics:
            simulationEvidenceSchema.shape.output.shape.variants.element.shape.metrics.extend({
              rounding_extra_quantity: decimal.optional(),
            }),
          ledger: z
            .array(
              simulationEvidenceSchema.shape.output.shape.variants.element.shape.ledger.element.extend(
                {
                  order_gap: decimal.optional(),
                  rounding_extra: decimal.optional(),
                },
              ),
            )
            .min(1)
            .max(90),
          lead_time: z.number().int().min(0).max(365),
          review_interval: z.number().int().min(1).max(365),
        }),
      )
      .min(2)
      .max(11),
  }),
})
export type ConstraintsEvidence = z.infer<typeof constraintsEvidenceSchema>
