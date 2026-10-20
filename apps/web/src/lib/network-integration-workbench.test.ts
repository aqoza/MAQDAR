import { describe, expect, it } from 'vitest'
import {
  integrationParams,
  integrationHref,
  integrationEvidenceHref,
  networkIntegrationResultSchema,
} from './integration-workbench'

describe('network workbench boundaries', () => {
  it('keeps warehouse/branch filters, exact labels and unavailable context through paging', () => {
    const params = integrationParams(
      {
        source: 'WAREHOUSE',
        branch: 'ZERO-BRANCH',
        supplier: 'SUP',
        location: 'OTHER',
        intent: 'scrap',
        selection: 'unavailable',
        system: ' ERP /+?& العربية ',
        status: 'no_report',
        kind: 'batch',
        q: 'ITEM',
        size: '50',
      },
      'network',
    )
    expect(params.filters).toEqual({
      source: 'WAREHOUSE',
      branch: 'ZERO-BRANCH',
      selection: 'unavailable',
      system: ' ERP /+?& العربية ',
      status: 'no_report',
      kind: 'batch',
    })
    const url = new URL(integrationHref(params, 3, 'network'), 'https://example.com')
    expect(url.pathname).toBe('/replenishment/network/integrations')
    expect(integrationParams(Object.fromEntries(url.searchParams), 'network')).toEqual({
      ...params,
      page: 3,
    })
    expect(integrationParams({ branch: 'ZERO-BRANCH', source: 'WAREHOUSE' }).filters).toEqual({})
    expect(
      integrationParams({ branch: 'bad\ncode', status: 'accepted', system: ' ' }, 'network')
        .filters,
    ).toEqual({})
  })

  it('links the exact network package to its own evidence and report history', () => {
    for (const kind of ['handoff', 'batch'] as const) {
      expect(integrationEvidenceHref({ kind, id: 'record' }, 'network')).toBe(
        `/replenishment/network/${kind === 'batch' ? 'batches' : 'handoffs'}/record#acknowledgements`,
      )
    }
  })

  it('keeps whole-package report status independent of missing live context and branch rows', () => {
    const row = {
      id: 'e2210000-0000-4000-8000-000000000001',
      kind: 'batch',
      created_at: '2026-10-20T00:00:00Z',
      item_code: null,
      source_code: 'WAREHOUSE',
      branch_codes: ['BRANCH-A', 'ZERO-BRANCH'],
      branch_row_count: 4,
      line_count: 2,
      dispatch_date: '2026-10-12',
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
    expect(networkIntegrationResultSchema.parse(result).rows[0]).toEqual(row)
    expect(
      networkIntegrationResultSchema.safeParse({
        ...result,
        rows: [{ ...row, status: 'accepted' }],
      }).success,
    ).toBe(false)
    expect(
      networkIntegrationResultSchema.safeParse({ ...result, rows: [{ ...row, branch_codes: [] }] })
        .success,
    ).toBe(false)
    expect(
      networkIntegrationResultSchema.safeParse({ ...result, rows: [{ ...row, selection: true }] })
        .success,
    ).toBe(false)
  })
})
