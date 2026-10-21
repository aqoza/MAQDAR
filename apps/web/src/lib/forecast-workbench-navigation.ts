import { workbenchSpec } from './policy-workbench'
import { listHref, type ListParams, type ListPatch } from './master-data/list-params'

/** Workbench filters keep the current surface and a fixed application-owned destination. */
export function forecastWorkbenchHref(
  params: ListParams,
  patch: ListPatch = {},
  embedded = false,
): string {
  const href = listHref('/forecasts/workbench', workbenchSpec, params, patch)
  if (!embedded) return href
  const search = new URLSearchParams(href.split('?')[1])
  search.set('tab', 'workbench')
  return `/forecasts?${search}`
}

export function forecastWorkbenchResetHref(embedded = false): string {
  return embedded ? '/forecasts?tab=workbench' : '/forecasts/workbench'
}
