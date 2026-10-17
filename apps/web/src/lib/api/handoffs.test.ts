import { describe, expect, it } from 'vitest'
import { parseHandoffQuery } from './handoffs'

describe('saved handoff query contract', () => {
  it('uses bounded defaults and preserves a timestamp offset and opaque cursor', () => {
    expect(parseHandoffQuery(new URLSearchParams())).toEqual({
      ok: true,
      limit: 25,
      cursor: null,
      createdSince: null,
    })
    expect(
      parseHandoffQuery(
        new URLSearchParams({
          limit: '100',
          cursor: 'abc_DEF-123',
          created_since: '2026-10-01T12:00:00+04:00',
        }),
      ),
    ).toEqual({
      ok: true,
      limit: 100,
      cursor: 'abc_DEF-123',
      createdSince: '2026-10-01T12:00:00+04:00',
    })
  })
  it.each([
    'limit=0',
    'limit=101',
    'limit=-1',
    'limit=1.5',
    'limit=01',
    'limit=1e2',
    'limit=25&limit=50',
    'cursor=',
    'created_since=2026-02-30T00:00:00Z',
    'created_since=2026-10-01',
    'updated_since=2026-10-01T00:00:00Z',
    'selected=true',
    'organization_id=other',
  ])('rejects %s', (query) => {
    expect(parseHandoffQuery(new URLSearchParams(query))).toMatchObject({ ok: false })
  })
  it('reports malformed cursors separately and bounds their size', () => {
    for (const cursor of ['x=', 'a'.repeat(1025)])
      expect(parseHandoffQuery(new URLSearchParams({ cursor }))).toMatchObject({
        ok: false,
        code: 'invalid_cursor',
      })
  })
})
