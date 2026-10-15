import { describe, expect, it } from 'vitest'
import { qualityParams, qualityRowSchema, formatScore, formatCoverage } from './forecast-quality'

describe('saved quality filters and evidence', () => {
  it('allow-lists filters, bounds pages and takes the first repeated value', () => {
    expect(
      qualityParams({
        status: 'selected',
        model: 'auto_ets',
        method: 'regional-v1',
        location: 'DXB-1',
        page: ['2', '3'],
        size: '50',
      }),
    ).toMatchObject({
      page: 2,
      size: 50,
      filters: { status: 'selected', model: 'auto_ets', method: 'regional-v1', location: 'DXB-1' },
    })
    expect(
      qualityParams({
        status: 'fake',
        model: 'oops',
        method: 'x',
        location: '(bad)',
        page: '999999999',
        size: '999',
        sort: 'rmse',
        q: 'x'.repeat(120),
      }),
    ).toMatchObject({
      page: 100000,
      size: 25,
      sort: 'finished_at',
      filters: {},
      q: 'x'.repeat(100),
    })
  })
  it('preserves exact signed scores and distinguishes missing evidence from zero', () => {
    expect(formatScore('123456789012345678.123', 'en-US')).toBe('123,456,789,012,345,678.123')
    expect(formatScore('-1.125', 'en-US')).toBe('-1.125')
    expect(formatScore('0.000', 'en-US')).toBe('0')
    expect(formatScore(null, 'en-US')).toBe('—')
    expect(formatCoverage('0.875', 'en-US')).toBe('87.5%')
    expect(formatCoverage(undefined, 'en-US')).toBe('—')
  })
  it('retains the separate evaluation model and fixed-group interpretation', () => {
    const row = qualityRowSchema.parse({
      id: '93000000-0000-4000-8000-000000000001',
      run_id: '93000000-0000-4000-8000-000000000002',
      item_id: '93000000-0000-4000-8000-000000000003',
      item_code: 'A',
      item_name: 'Group',
      location_code: 'L1',
      status: 'selected',
      model: 'mean',
      from_date: '2026-01-01',
      to_date: '2026-10-01',
      finished_at: '2026-10-02T00:00:00Z',
      method: 'regional-v1',
      horizon: '28',
      comparison: 'fixed-group-v1',
      unit: 'EA',
      rmse: '1',
      mae: '1',
      bias: '-1',
      folds: [],
      evaluation: {
        status: 'available',
        model: 'naive',
        train_to: '2026-09-03',
        test_from: '2026-09-04',
        test_to: '2026-10-01',
        count: 28,
        coverage80: '0.75',
        coverage95: '0.9',
      },
    })
    expect(row.evaluation.model).toBe('naive')
    expect(row.comparison).toBe('fixed-group-v1')
    expect(qualityRowSchema.safeParse({ ...row, rmse: 'NaN' }).success).toBe(false)
  })
})
