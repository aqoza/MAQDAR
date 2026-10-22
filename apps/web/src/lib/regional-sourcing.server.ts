import 'server-only'
import { createClient } from './supabase/server'
import { replenishmentReportSchema } from './replenishment'
import type { SourcingChoices } from './regional-sourcing'

export async function sourcingContext(organizationId: string, regionId: string, draftId: string) {
  const db = await createClient()
  const region = await db
    .from('stock_regions')
    .select('id,name_en,name_ar,required_location_ids')
    .eq('organization_id', organizationId)
    .eq('id', regionId)
    .is('archived_at', null)
    .maybeSingle()
  if (region.error) throw new Error('Sourcing inputs unavailable')
  if (!region.data) return null
  const [locations, draft] = await Promise.all([
    db
      .from('locations')
      .select('id,code,name_en,name_ar')
      .eq('organization_id', organizationId)
      .in('id', region.data.required_location_ids)
      .eq('is_active', true)
      .order('code'),
    db
      .from('replenishment_drafts')
      .select('id,location_id,policy_id,report')
      .eq('organization_id', organizationId)
      .eq('id', draftId)
      .maybeSingle(),
  ])
  if (locations.error || draft.error) throw new Error('Sourcing inputs unavailable')
  if (
    locations.data.length !== region.data.required_location_ids.length ||
    !draft.data ||
    !region.data.required_location_ids.includes(draft.data.location_id)
  )
    return null
  const policy = await db
    .from('inventory_policies')
    .select('item_id')
    .eq('organization_id', organizationId)
    .eq('id', draft.data.policy_id)
    .maybeSingle()
  if (policy.error) throw new Error('Sourcing inputs unavailable')
  const report = replenishmentReportSchema.parse(draft.data.report)
  if (!policy.data?.item_id || report.status !== 'available' || !report.policy.unit) return null
  return {
    region: region.data,
    locations: locations.data,
    draft: draft.data,
    itemId: policy.data.item_id,
    report,
  }
}
export type SourcingContext = NonNullable<Awaited<ReturnType<typeof sourcingContext>>>

export async function sourcingChoices(
  organizationId: string,
  context: SourcingContext,
  locationId: string,
  page = 1,
  policyId = '',
  revisionPage = 1,
): Promise<SourcingChoices | null> {
  if (
    locationId === context.draft.location_id ||
    !context.locations.some((l) => l.id === locationId)
  )
    return null
  const db = await createClient()
  const base = () =>
    db
      .from('redistribution_source_options')
      .select('id,maximum,finished_at', { count: 'exact' })
      .eq('organization_id', organizationId)
      .eq('to_location_id', context.draft.location_id)
      .eq('location_id', locationId)
      .eq('item_id', context.itemId)
      .eq('unit', context.report.policy.unit!)
      .eq('cutoff', context.report.policy.cutoff)
  const count = await base().limit(0)
  if (count.error) throw new Error('Source policies unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25)),
    current = Math.min(page, pages)
  const policies = await base()
    .order('finished_at', { ascending: false })
    .order('id')
    .range((current - 1) * 25, current * 25 - 1)
  if (policies.error) throw new Error('Source policies unavailable')
  let choices = policies.data ?? []
  if (policyId && !choices.some((p) => p.id === policyId)) {
    const selected = await base().eq('id', policyId).maybeSingle()
    if (selected.error) throw new Error('Source policy unavailable')
    if (!selected.data) return null
    choices = [selected.data, ...choices]
  }
  let revisions: SourcingChoices['revisions'] = [],
    revisionPages = 1,
    selectedPage = 1
  if (policyId) {
    const revisionsBase = () =>
      db
        .from('policy_override_history')
        .select('id,revision,order_up_to', { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('policy_id', policyId)
        .eq('status', 'approved')
    const count = await revisionsBase().limit(0)
    if (count.error) throw new Error('Approved maxima unavailable')
    revisionPages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
    selectedPage = Math.min(revisionPage, revisionPages)
    const rows = await revisionsBase()
      .order('revision', { ascending: false })
      .order('id')
      .range((selectedPage - 1) * 25, selectedPage * 25 - 1)
    if (rows.error) throw new Error('Approved maxima unavailable')
    revisions = (rows.data ?? []).map((r) => ({
      id: r.id!,
      revision: r.revision!,
      maximum: String(r.order_up_to),
    }))
  }
  return {
    policies: choices.map((p) => ({
      id: p.id!,
      maximum: String(p.maximum),
      saved: p.finished_at!,
    })),
    page: current,
    pages,
    revisions,
    revisionPage: selectedPage,
    revisionPages,
    policyId,
  }
}
