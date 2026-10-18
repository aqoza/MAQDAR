import { describe, expect, it } from 'vitest'
import {
  integrationParams,
  integrationHref,
  integrationEvidenceHref,
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
