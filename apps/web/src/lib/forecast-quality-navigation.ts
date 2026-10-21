import { qualitySpec } from './forecast-quality'
import { listHref, type ListParams, type ListPatch } from './master-data/list-params'

/** Quality filters keep their current surface; callers cannot supply an external destination. */
export function forecastQualityHref(
  params: ListParams,
  patch: ListPatch = {},
  embedded = false,
): string {
  const href = listHref('/forecasts/quality', qualitySpec, params, patch)
  if (!embedded) return href
  const search = new URLSearchParams(href.split('?')[1])
  search.set('tab', 'quality')
  return `/forecasts?${search}`
}

export function forecastQualityResetHref(embedded = false): string {
  return embedded ? '/forecasts?tab=quality' : '/forecasts/quality'
}
