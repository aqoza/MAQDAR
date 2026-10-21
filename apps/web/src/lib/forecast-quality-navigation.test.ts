import { describe, expect, it } from 'vitest'
import { qualityParams } from './forecast-quality'
import { forecastQualityHref, forecastQualityResetHref } from './forecast-quality-navigation'

describe('forecast quality navigation', () => {
  const params = qualityParams({
    q: 'bearing & seal',
    location: 'OM-MCT',
    model: 'naive',
    method: 'expanded-v1',
    size: '50',
    dir: 'asc',
    page: '3',
  })

  it('retains validated filters and display settings when paging inside the workspace', () => {
    const url = new URL(forecastQualityHref(params, { page: 4 }, true), 'https://example.test')
    expect(url.pathname).toBe('/forecasts')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'bearing & seal',
      location: 'OM-MCT',
      model: 'naive',
      method: 'expanded-v1',
      dir: 'asc',
      size: '50',
      page: '4',
      tab: 'quality',
    })
  })

  it('removes only the selected filter and resets paging', () => {
    const url = new URL(
      forecastQualityHref(params, { filters: { location: null } }, true),
      'https://example.test',
    )
    expect(url.searchParams.has('location')).toBe(false)
    expect(url.searchParams.has('page')).toBe(false)
    expect(url.searchParams.get('q')).toBe('bearing & seal')
    expect(url.searchParams.get('method')).toBe('expanded-v1')
    expect(url.searchParams.get('size')).toBe('50')
    expect(url.searchParams.get('tab')).toBe('quality')
  })

  it('keeps standalone links standalone and reset destinations fixed', () => {
    expect(forecastQualityHref(params, { q: '' })).toMatch(/^\/forecasts\/quality\?/)
    expect(forecastQualityResetHref()).toBe('/forecasts/quality')
    expect(forecastQualityResetHref(true)).toBe('/forecasts?tab=quality')
  })
})
