import { z } from 'zod'
import { simulationEvidenceSchema } from './policy-simulation'

const quantity = z.string().regex(/^[0-9]{1,15}(\.[0-9]{1,3})?$/)
const normalize = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  const tail = fraction.replace(/0+$/, '')
  return `${whole.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`
}
const milliunits = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
}
export const alternativeMaximaSchema = z
  .array(quantity)
  .min(1)
  .max(10)
  .transform((values) =>
    values
      .map(normalize)
      .sort((a, b) => (milliunits(a) < milliunits(b) ? -1 : milliunits(a) > milliunits(b) ? 1 : 0)),
  )
  .refine((values) => new Set(values).size === values.length)

export const sensitivityRequestSchema = z.object({
  source_run_id: z.guid(),
  request_id: z.uuid(),
  maxima: z
    .string()
    .max(220)
    .transform((text) => text.split(/[,\n]/).map((value) => value.trim()))
    .pipe(alternativeMaximaSchema),
  reuse_confirmed: z.literal('on'),
})

const originalVariant = simulationEvidenceSchema.shape.output.shape.variants.element
export const sensitivityEvidenceSchema = simulationEvidenceSchema.extend({
  method: z.literal('periodic-sensitivity-v1'),
  options: simulationEvidenceSchema.shape.options.omit({ alternative_maximum: true }).extend({
    alternative_maxima: alternativeMaximaSchema,
    reuse_confirmed: z.literal(true),
    source_run_id: z.guid(),
  }),
  source_simulation: z.object({
    id: z.guid(),
    run_id: z.guid(),
    evidence: simulationEvidenceSchema,
  }),
  output: z.object({
    method: z.literal('periodic-sensitivity-v1'),
    variants: z
      .array(
        originalVariant.extend({ name: z.string().regex(/^(baseline|alternative-([1-9]|10))$/) }),
      )
      .min(2)
      .max(11),
  }),
})

export type SensitivityEvidence = z.infer<typeof sensitivityEvidenceSchema>
