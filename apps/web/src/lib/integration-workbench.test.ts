import { describe, expect, it } from 'vitest'
import {
  integrationParams,
  integrationHref,
  integrationEvidenceHref,
  dispositionIntegrationResultSchema,
} from './integration-workbench'

describe('integration workbench URL state', () => {
  it('preserves exact system labels across pagination, including spaces and reserved URL characters', () => {
    const system = ' ERP + /?& العربية ' + 'x'.repeat(50)
    const params = integrationParams({
      system,
      status: 'no_report',
      selection: 'historical',
      page: '2',
      size: '50',
    })
    const url = new URL(integrationHref(params, 3), 'https://example.com')
    expect(url.searchParams.get('system')).toBe(system)
    expect(integrationParams(Object.fromEntries(url.searchParams))).toMatchObject({
      page: 3,
      size: 50,
      filters: { system, status: 'no_report', selection: 'historical' },
    })
  })
  it('bounds page, size, search and filters without interpreting raw URL values as columns', () => {
    expect(
      integrationParams({
        page: '999999999',
        size: '1000',
        q: 'x'.repeat(200),
        kind: 'orders',
        status: 'failed',
        system: 'x'.repeat(81),
        sort: 'reason',
        dir: 'asc',
      }),
    ).toMatchObject({
      page: 100000,
      size: 25,
      q: 'x'.repeat(100),
      sort: 'created_at',
      dir: 'desc',
      filters: {},
    })
    expect(integrationParams({ system: '  ', supplier: 'bad\ncode', q: 'a\u0000b' })).toMatchObject(
      { q: 'a b', filters: {} },
    )
  })
  it('retains independent package evidence links', () => {
    expect(integrationEvidenceHref({ kind: 'handoff', id: 'one' })).toBe(
      '/replenishment/handoffs/one#acknowledgements',
    )
    expect(integrationEvidenceHref({ kind: 'batch', id: 'two' })).toBe(
      '/replenishment/batches/two#acknowledgements',
    )
  })

  it('keeps transfer endpoint filters and evidence separate from purchasing', () => {
    const params = integrationParams(
      { source: 'SOURCE', location: 'DEST', supplier: 'SUP', system: ' ERP ', status: 'no_report' },
      'transfer',
    )
    expect(params.filters).toEqual({
      source: 'SOURCE',
      location: 'DEST',
      system: ' ERP ',
      status: 'no_report',
    })
    const url = new URL(integrationHref(params, 2, 'transfer'), 'https://example.com')
    expect(url.pathname).toBe('/replenishment/redistribution/integrations')
    expect(integrationParams(Object.fromEntries(url.searchParams), 'transfer')).toMatchObject({
      page: 2,
      filters: params.filters,
    })
    expect(integrationParams({ source: 'SOURCE', supplier: 'SUP' }).filters).toEqual({
      supplier: 'SUP',
    })
    expect(integrationEvidenceHref({ kind: 'handoff', id: 'one' }, 'transfer')).toBe(
      '/replenishment/redistribution/handoffs/one#acknowledgements',
    )
    expect(integrationEvidenceHref({ kind: 'batch', id: 'two' }, 'transfer')).toBe(
      '/replenishment/redistribution/batches/two#acknowledgements',
    )
  })
})

describe('event integration URL boundaries', () => {
  it('retains exact system identity, receiving filters and event routes through paging', () => {
    const params = integrationParams(
      {
        supplier: 'SUP',
        location: 'DC',
        source: 'hidden',
        system: ' ERP /+?& العربية ',
        selection: 'historical',
        status: 'no_report',
      },
      'event',
    )
    expect(params.filters).toEqual({
      supplier: 'SUP',
      location: 'DC',
      system: ' ERP /+?& العربية ',
      selection: 'historical',
      status: 'no_report',
    })
    const url = new URL(integrationHref(params, 2, 'event'), 'https://example.com')
    expect(url.pathname).toBe('/replenishment/events/integrations')
    expect(integrationParams(Object.fromEntries(url.searchParams), 'event')).toMatchObject({
      page: 2,
      filters: params.filters,
    })
  })
  it('links each event package to its own history', () => {
    expect(integrationEvidenceHref({ kind: 'handoff', id: 'one' }, 'event')).toBe(
      '/replenishment/events/handoffs/one#acknowledgements',
    )
    expect(integrationEvidenceHref({ kind: 'batch', id: 'two' }, 'event')).toBe(
      '/replenishment/events/batches/two#acknowledgements',
    )
  })
})

describe('disposition integration boundaries', () => {
  it('preserves intent, unavailable context and exact system identity without unrelated scopes', () => {
    const params = integrationParams(
      {
        supplier: 'SUP',
        source: 'SOURCE',
        location: 'DC',
        intent: 'scrap',
        kind: 'batch',
        selection: 'unavailable',
        system: ' ERP /+?& العربية ',
        status: 'no_report',
      },
      'disposition',
    )
    expect(params.filters).toEqual({
      location: 'DC',
      intent: 'scrap',
      kind: 'batch',
      selection: 'unavailable',
      system: ' ERP /+?& العربية ',
      status: 'no_report',
    })
    const url = new URL(integrationHref(params, 2, 'disposition'), 'https://example.com')
    expect(url.pathname).toBe('/replenishment/excess/integrations')
    expect(integrationParams(Object.fromEntries(url.searchParams), 'disposition')).toMatchObject({
      page: 2,
      filters: params.filters,
    })
    for (const family of ['purchase', 'event', 'transfer'] as const) {
      expect(
        integrationParams({ intent: 'scrap', selection: 'unavailable' }, family).filters,
      ).toEqual({})
    }
    expect(
      integrationParams({ intent: 'write_off', selection: 'selected' }, 'disposition').filters,
    ).toEqual({})
  })
  it('opens the actual disposition package history', () => {
    expect(integrationEvidenceHref({ kind: 'handoff', id: 'one' }, 'disposition')).toBe(
      '/replenishment/excess/handoffs/one#acknowledgements',
    )
    expect(integrationEvidenceHref({ kind: 'batch', id: 'two' }, 'disposition')).toBe(
      '/replenishment/excess/batches/two#acknowledgements',
    )
  })
  it('keeps unavailable context independent of reported status', () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'batch',
      created_at: '2026-10-19',
      item_code: null,
      location_code: 'DC',
      line_count: 2,
      disposition_kind: 'supplier_return',
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
    const result = { total: 1, page: 1, size: 25, as_of: '2026-10-19', rows: [row] }
    expect(dispositionIntegrationResultSchema.parse(result).rows[0]).toMatchObject({
      selection: 'unavailable',
      status: 'no_report',
    })
    for (const status of ['received', 'rejected']) {
      expect(
        dispositionIntegrationResultSchema.safeParse({ ...result, rows: [{ ...row, status }] })
          .success,
      ).toBe(true)
    }
    expect(
      dispositionIntegrationResultSchema.safeParse({
        ...result,
        rows: [{ ...row, selection: undefined, selected: false }],
      }).success,
    ).toBe(false)
    expect(
      dispositionIntegrationResultSchema.safeParse({
        ...result,
        rows: [{ ...row, status: 'failed' }],
      }).success,
    ).toBe(false)
  })
})

describe('dealer-return integration boundaries', () => {
  it('keeps source availability independent from reports and unrelated selection filters', () => {
    const params = integrationParams(
      {
        source: 'BR',
        location: 'HUB',
        sources: 'unavailable',
        kind: 'batch',
        status: 'no_report',
        system: ' ERP /+?& العربية ',
        selection: 'historical',
        supplier: 'SUP',
        intent: 'scrap',
      },
      'return',
    )
    expect(params.filters).toEqual({
      source: 'BR',
      location: 'HUB',
      sources: 'unavailable',
      kind: 'batch',
      status: 'no_report',
      system: ' ERP /+?& العربية ',
    })
    const url = new URL(integrationHref(params, 2, 'return'), 'https://example.com')
    expect(url.pathname).toBe('/replenishment/returns/integrations')
    expect(integrationParams(Object.fromEntries(url.searchParams), 'return')).toMatchObject({
      page: 2,
      filters: params.filters,
    })
    expect(integrationParams({ sources: 'historical' }, 'return').filters).toEqual({})
    for (const family of [
      'purchase',
      'transfer',
      'event',
      'disposition',
      'network',
      'regional',
    ] as const)
      expect(integrationParams({ sources: 'available' }, family).filters).toEqual({})
  })
  it('opens only the actual return package history', () => {
    expect(integrationEvidenceHref({ kind: 'handoff', id: 'one' }, 'return')).toBe(
      '/replenishment/returns/handoffs/one#acknowledgements',
    )
    expect(integrationEvidenceHref({ kind: 'batch', id: 'two' }, 'return')).toBe(
      '/replenishment/returns/batches/two#acknowledgements',
    )
  })
})
