import { describe, expect, it } from 'vitest'
import { workbenchParams } from './policy-workbench'
import { forecastWorkbenchHref, forecastWorkbenchResetHref } from './forecast-workbench-navigation'

describe('forecast workbench navigation', () => {
  const params = workbenchParams({
    q: 'bearing & seal',
    location: 'OM-MCT',
    status: 'available',
    review: 'approved',
    size: '50',
    dir: 'asc',
    page: '3',
  })

  it('retains validated filters and display settings when paging inside the workspace', () => {
    const url = new URL(forecastWorkbenchHref(params, { page: 4 }, true), 'https://example.test')
    expect(url.pathname).toBe('/forecasts')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'bearing & seal',
      location: 'OM-MCT',
      status: 'available',
      review: 'approved',
      dir: 'asc',
      size: '50',
      page: '4',
      tab: 'workbench',
    })
  })

  it('removes only the selected filter and resets paging', () => {
    const url = new URL(
      forecastWorkbenchHref(params, { filters: { location: null } }, true),
      'https://example.test',
    )
    expect(url.searchParams.has('location')).toBe(false)
    expect(url.searchParams.has('page')).toBe(false)
    expect(url.searchParams.get('q')).toBe('bearing & seal')
    expect(url.searchParams.get('review')).toBe('approved')
    expect(url.searchParams.get('size')).toBe('50')
    expect(url.searchParams.get('tab')).toBe('workbench')
  })

  it('keeps standalone links standalone and reset destinations fixed', () => {
    expect(forecastWorkbenchHref(params, { q: '' })).toMatch(/^\/forecasts\/workbench\?/)
    expect(forecastWorkbenchResetHref()).toBe('/forecasts/workbench')
    expect(forecastWorkbenchResetHref(true)).toBe('/forecasts?tab=workbench')
  })
})
