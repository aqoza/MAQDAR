import type { Database } from '@zeespare/shared/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { searchPatterns } from './search'

export type LocationCodeOption = {
  code: string
  name_en: string
  name_ar: string | null
  is_active: boolean
}

export const LOCATION_LOOKUP_LIMIT = 20
export const LOCATION_LOOKUP_QUERY_LIMIT = 100

/**
 * Bounded code/name suggestions for the active organization. The caller supplies the session's
 * server client, so the locations table's restrictive branch RLS remains authoritative. Historical
 * searches may include inactive catalog entries; this does not authorize a new planning run.
 */
export async function lookupLocations(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  query: string,
  includeInactive = false,
): Promise<LocationCodeOption[]> {
  let builder = supabase
    .from('locations')
    .select('code, name_en, name_ar, is_active')
    .eq('organization_id', organizationId)
  if (!includeInactive) builder = builder.eq('is_active', true)
  for (const pattern of searchPatterns(query.slice(0, LOCATION_LOOKUP_QUERY_LIMIT))) {
    builder = builder.like('search_text', pattern)
  }
  const { data, error } = await builder.order('code').limit(LOCATION_LOOKUP_LIMIT).retry(false)
  if (error) throw new Error(`lookupLocations failed: ${error.code}`)
  return data ?? []
}
