import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@zeespare/shared'
import { kpiSchema } from './dashboard'
import { z } from 'zod'

export type DashboardKpis = z.infer<typeof kpiSchema>
export type DashboardLocation = { code: string; name_en: string; name_ar: string | null }
const locationSummarySchema = kpiSchema.pick({
  available_pairs: true,
  observed_pairs: true,
  unobserved_pairs: true,
  stale_pairs: true,
})
export type LocationAvailability = {
  location: DashboardLocation
  summary: z.infer<typeof locationSummarySchema> | null
}
export const LOCATION_PREVIEW_LIMIT = 5
export const LOCATION_SUGGESTION_LIMIT = 50

const locationSchema = z.object({
  code: z.string(),
  name_en: z.string(),
  name_ar: z.string().nullable(),
})
const projectionSchema = z.object({
  location_preview: z.object({
    organization_id: z.uuid(),
    day: z.iso.date(),
    location_code: z.string().nullable(),
    suggestions: z.array(locationSchema).max(LOCATION_SUGGESTION_LIMIT),
    rows: z
      .array(z.object({ location: locationSchema, summary: locationSummarySchema }))
      .max(LOCATION_PREVIEW_LIMIT),
    limited: z.boolean(),
  }),
})

/** Existing invoker contracts only. Never fan out over the entire location catalog. */
export async function loadDashboardLocations(
  db: SupabaseClient<Database>,
  organizationId: string,
  summary: DashboardKpis,
  rawSummary?: unknown,
) {
  const parsed = projectionSchema.safeParse(rawSummary)
  if (parsed.success) {
    const preview = parsed.data.location_preview
    const expectedCodes = summary.location_code
      ? [summary.location_code]
      : preview.suggestions.slice(0, LOCATION_PREVIEW_LIMIT).map((row) => row.code)
    if (
      preview.organization_id === organizationId &&
      preview.day === summary.day &&
      preview.location_code === summary.location_code &&
      preview.rows.length === expectedCodes.length &&
      preview.rows.every((row, index) => row.location.code === expectedCodes[index])
    ) {
      return {
        suggestions: preview.suggestions,
        rows: preview.rows,
        limited: preview.limited,
        unavailable: false,
      }
    }
  }
  // Compatibility with the previous hosted function. These reads keep the same tenant,
  // location authority, payload bounds and unavailable states until the reviewed rollout.
  const { data, error } = await db
    .from('locations')
    .select('code, name_en, name_ar')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('code')
    .limit(LOCATION_SUGGESTION_LIMIT + 1)
    .then(
      (result) => result,
      () => ({ data: null, error: true }),
    )
  const suggestions: DashboardLocation[] = error
    ? []
    : (data ?? []).slice(0, LOCATION_SUGGESTION_LIMIT)
  const selected = summary.location_code
  const preview = selected
    ? [
        suggestions.find((row) => row.code === selected) ?? {
          code: selected,
          name_en: selected,
          name_ar: null,
        },
      ]
    : suggestions.slice(0, LOCATION_PREVIEW_LIMIT)
  const rows: LocationAvailability[] = await Promise.all(
    preview.map(async (location) => {
      if (location.code === selected) return { location, summary }
      try {
        const result = await db.rpc('dashboard_kpis', {
          p_organization_id: organizationId,
          p_day: summary.day,
          p_location_code: location.code,
        })
        const parsed = kpiSchema.safeParse(result.data)
        return { location, summary: !result.error && parsed.success ? parsed.data : null }
      } catch {
        return { location, summary: null }
      }
    }),
  )
  return {
    suggestions,
    rows,
    unavailable: Boolean(error),
    limited: (data?.length ?? 0) > LOCATION_SUGGESTION_LIMIT,
  }
}

export function dashboardLocationHref(day: string, location: string) {
  return `/dashboard?${new URLSearchParams({ day, location })}`
}
