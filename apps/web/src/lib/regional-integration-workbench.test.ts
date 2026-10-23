import { describe, expect, it } from 'vitest'
import {
  integrationParams,
  integrationHref,
  integrationEvidenceHref,
  regionalIntegrationResultSchema,
} from './integration-workbench'

describe('regional workbench boundaries', () => {
  it('keeps region/source filters, exact labels and unavailable context through paging', () => {
    const params = integrationParams(
      {
        location: 'DEST',
        source: 'ZERO-SOURCE',
        region: 'e2210000-0000-4000-8000-000000000099',
        supplier: 'SUP',
        branch: 'OTHER',
        intent: 'scrap',
        selection: 'unavailable',
        system: ' ERP /+?& العربية ',
        status: 'no_report',
        kind: 'batch',
        q: 'ITEM',
        size: '50',
      },
      'regional',
    )
    expect(params.filters).toEqual({
      location: 'DEST',
      source: 'ZERO-SOURCE',
      region: 'e2210000-0000-4000-8000-000000000099',
      selection: 'unavailable',
      system: ' ERP /+?& العربية ',
      status: 'no_report',
      kind: 'batch',
    })
    const url = new URL(integrationHref(params, 3, 'regional'), 'https://example.com')
    expect(url.pathname).toBe('/replenishment/regional-stock/sourcing/integrations')
    expect(integrationParams(Object.fromEntries(url.searchParams), 'regional')).toEqual({
      ...params,
      page: 3,
    })
    expect(
      integrationParams({ region: 'e2210000-0000-4000-8000-000000000099', source: 'ZERO-SOURCE' })
        .filters,
    ).toEqual({})
    expect(
      integrationParams(
        { region: 'bad-id', source: 'bad\ncode', status: 'accepted', system: ' ' },
        'regional',
      ).filters,
    ).toEqual({})
  })

  it('links the exact regional package to its own evidence and report history', () => {
    for (const kind of ['handoff', 'batch'] as const) {
      expect(integrationEvidenceHref({ kind, id: 'record' }, 'regional')).toBe(
        `/replenishment/regional-stock/sourcing/${kind === 'batch' ? 'batches' : 'handoffs'}/record#acknowledgements`,
      )
    }
  })

  it('keeps whole-package report status independent of missing live context and source rows', () => {
    const row = {
      id: 'e2210000-0000-4000-8000-000000000001',
      kind: 'batch',
      created_at: '2026-10-20T00:00:00Z',
      item_code: null,
      location_code: 'DEST',
      region_id: 'e2210000-0000-4000-8000-000000000099',
      region_name: 'Saved region',
      region_name_ar: null,
      source_codes: ['BRANCH-A', 'ZERO-SOURCE'],
      source_row_count: 4,
      line_count: 2,
      requested_date: '2026-10-12',
      selection: 'unavailable',
      event_id: null,
      external_system: 'ERP',
      external_reference: null,
      status: 'no_report',
      reason: null,
      recorded_at: null,
      api_key_id: null,
      client_event_id: null,
    }
    const result = { total: 1, page: 1, size: 25, as_of: '2026-10-20T00:00:00Z', rows: [row] }
    expect(regionalIntegrationResultSchema.parse(result).rows[0]).toEqual(row)
    expect(
      regionalIntegrationResultSchema.safeParse({
        ...result,
        rows: [{ ...row, status: 'accepted' }],
      }).success,
    ).toBe(false)
    expect(
      regionalIntegrationResultSchema.safeParse({ ...result, rows: [{ ...row, source_codes: [] }] })
        .success,
    ).toBe(false)
    expect(
      regionalIntegrationResultSchema.safeParse({ ...result, rows: [{ ...row, selection: true }] })
        .success,
    ).toBe(false)
  })
})
