import { z } from 'zod'
import { constraintsEvidenceSchema } from './policy-constraints'
import { calendarEvidenceSchema, calendarSearchSchema } from './delivery-scenarios'

export const calendarPreviewInput = z.object({ source: z.guid(), calendar: z.guid() })
export const calendarEnqueueInput = calendarPreviewInput.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal('on'),
})
const search = calendarSearchSchema.omit({ days: true }).extend({
  status: z.enum(['resolved', 'outside_window', 'calendar_unknown', 'search_exhausted']),
  checked_through: z.iso.date().nullable(),
})
const originalVariant = constraintsEvidenceSchema.shape.output.shape.variants.element
const calendarVariant = originalVariant.extend({
  review_schedule: z
    .array(search.extend({ nominal_date: z.iso.date() }))
    .min(1)
    .max(90),
  ledger: z
    .array(
      originalVariant.shape.ledger.element.extend({
        nominal_reviews: z.array(z.iso.date()).max(90),
        nominal_receipt: z.iso.date().nullable(),
        receipt_search: search.nullable(),
      }),
    )
    .min(1)
    .max(90),
})
export const calendarPreviewSchema = constraintsEvidenceSchema
  .omit({
    output: true,
    computed_at: true,
    source_simulation: true,
  })
  .extend({
    method: z.literal('periodic-calendars-v1'),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    options: constraintsEvidenceSchema.shape.options.extend({
      calendars_confirmed: z.boolean(),
      ordering_calendar_id: z.guid(),
    }),
    source_comparison: z.object({
      id: z.guid(),
      run_id: z.guid(),
      evidence: constraintsEvidenceSchema,
    }),
    calendars: z.object({
      ordering: calendarEvidenceSchema.extend({ country: z.string().nullable() }),
      receiving: calendarEvidenceSchema.extend({ country: z.string().nullable() }),
      ordering_days: z.record(z.iso.date(), calendarSearchSchema.shape.days.element),
      receiving_days: z.record(z.iso.date(), calendarSearchSchema.shape.days.element),
      receiver: z.object({
        id: z.guid(),
        code: z.string(),
        active: z.literal(true),
        updated_at: z.string(),
      }),
    }),
  })
export const calendarEvidenceSchemaFull = calendarPreviewSchema.extend({
  options: calendarPreviewSchema.shape.options.extend({ calendars_confirmed: z.literal(true) }),
  computed_at: z.iso.datetime({ offset: true }),
  output: z.object({
    method: z.literal('periodic-calendars-v1'),
    status: z.enum(['available', 'calendar_unknown', 'search_exhausted']),
    variants: z.array(calendarVariant).max(10),
    failure: search
      .extend({
        variant: z.number().int().min(1).max(10),
        stage: z.enum(['ordering', 'receiving']),
        nominal_date: z.iso.date(),
        order_date: z.iso.date().optional(),
      })
      .nullable(),
  }),
})
export type CalendarPreview = z.infer<typeof calendarPreviewSchema>
export type CalendarEvidence = z.infer<typeof calendarEvidenceSchemaFull>
