import { describe, expect, it } from 'vitest'
import {
  DEPRECATIONS,
  checkDeprecations,
  deprecationFor,
  deprecationHeaders,
  type DeprecationEntry,
} from './versioning'

const ENTRY: DeprecationEntry = {
  operationId: 'listItems',
  deprecatedAt: '2027-01-01T00:00:00Z',
  sunsetAt: '2027-07-01T00:00:00Z',
  link: 'https://github.com/aqoza/MAQDAR/blob/main/docs/api.md#deprecations',
}

describe('deprecations', () => {
  it('ships an empty, valid table', () => {
    expect(DEPRECATIONS).toEqual([])
    expect(checkDeprecations()).toEqual([])
    expect(deprecationHeaders('listItems')).toEqual({})
  })

  it('emits Deprecation (RFC 9745), Sunset (RFC 8594) and Link for a listed operation', () => {
    const table = [ENTRY]
    expect(deprecationFor('listItems', table)).toBe(ENTRY)
    expect(deprecationFor('upsertItems', table)).toBeNull()
    expect(deprecationHeaders('listItems', table)).toEqual({
      Deprecation: '@1798761600',
      Sunset: 'Thu, 01 Jul 2027 00:00:00 GMT',
      Link: '<https://github.com/aqoza/MAQDAR/blob/main/docs/api.md#deprecations>; rel="deprecation"; type="text/html"',
    })
    const withoutSunset = { ...ENTRY, sunsetAt: undefined }
    expect(deprecationHeaders('listItems', [withoutSunset])).not.toHaveProperty('Sunset')
    expect(checkDeprecations(table)).toEqual([])
  })

  it('refuses a sunset before the deprecation and other mistakes', () => {
    expect(
      checkDeprecations([
        { ...ENTRY, sunsetAt: '2026-12-31T00:00:00Z' },
        { ...ENTRY, operationId: 'listWidgets', deprecatedAt: 'soon', link: 'http://x' },
        { ...ENTRY, sunsetAt: 'never' },
      ]),
    ).toEqual([
      'listItems: sunset before deprecation',
      'listWidgets: unknown operation',
      'listWidgets: bad deprecatedAt',
      'listWidgets: link not https',
      'listItems: listed twice',
      'listItems: bad sunsetAt',
    ])
  })
})
