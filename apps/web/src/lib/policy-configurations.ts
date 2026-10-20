import { z } from 'zod'
import { alternativeMaximaSchema } from './policy-sensitivity'
import { simulationEvidenceSchema } from './policy-simulation'

const configurationSchema = z.strictObject({
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
export const configurationsSchema = z
  .array(configurationSchema)
  .min(1)
  .max(10)
  .transform((values) =>
    values.sort((a, b) =>
      milliunits(a.maximum) < milliunits(b.maximum)
        ? -1
        : milliunits(a.maximum) > milliunits(b.maximum)
          ? 1
          : a.lead_time - b.lead_time || a.review_interval - b.review_interval,
    ),
  )
  .refine((values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length)

export const configurationsRequestSchema = z.object({
  source_run_id: z.guid(),
  request_id: z.uuid(),
  configurations: z
    .string()
    .max(2000)
    .transform((text, context) => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        context.addIssue({ code: 'custom', message: 'Invalid configurations' })
        return z.NEVER
      }
    })
    .pipe(configurationsSchema),
  reuse_confirmed: z.literal('on'),
})

export const configurationsEvidenceSchema = simulationEvidenceSchema.extend({
  method: z.literal('periodic-configurations-v1'),
  options: simulationEvidenceSchema.shape.options.omit({ alternative_maximum: true }).extend({
    configurations: configurationsSchema,
    reuse_confirmed: z.literal(true),
    source_run_id: z.guid(),
  }),
  source_simulation: z.object({
    id: z.guid(),
    run_id: z.guid(),
    evidence: simulationEvidenceSchema,
  }),
  output: z.object({
    method: z.literal('periodic-configurations-v1'),
    variants: z
      .array(
        simulationEvidenceSchema.shape.output.shape.variants.element.extend({
          name: z.string().regex(/^(baseline|alternative-([1-9]|10))$/),
          lead_time: z.number().int().min(0).max(365),
          review_interval: z.number().int().min(1).max(365),
        }),
      )
      .min(2)
      .max(11),
  }),
})
export type ConfigurationsEvidence = z.infer<typeof configurationsEvidenceSchema>
