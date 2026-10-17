import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@maqdar/shared'
import { kpiSchema } from './dashboard'
import type { z } from 'zod'

export type DashboardKpis = z.infer<typeof kpiSchema>
export type DashboardLocation = { code: string; name_en: string; name_ar: string | null }
export type LocationAvailability = { location: DashboardLocation; summary: DashboardKpis | null }
export const LOCATION_PREVIEW_LIMIT = 5
export const LOCATION_SUGGESTION_LIMIT = 50

/** Existing invoker contracts only. Never fan out over the entire location catalog. */
export async function loadDashboardLocations(
  db: SupabaseClient<Database>,
  organizationId: string,
  summary: DashboardKpis,
) {
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
