import { describe, expect, it } from 'vitest'
import { comparisonParams, unitProvenanceSchema } from './stock-comparison'
import { validateUpsertBody } from './api/records'

describe('explicit stock comparison inputs', () => {
  it('requires an explicit date and consistent basis; repeated values use the first', () => {
    expect(comparisonParams({}).success).toBe(false)
    expect(comparisonParams({ day: '2026-02-30', basis: 'calculated' }).success).toBe(false)
    expect(comparisonParams({ day: '2026-10-10', basis: 'approved' }).success).toBe(false)
    const id = '96000000-0000-4000-8000-000000000061'
    expect(comparisonParams({ day: '2026-10-10', basis: 'calculated', override: id }).success).toBe(
      false,
    )
    expect(
      comparisonParams({ day: ['2026-10-10', 'bad'], basis: 'approved', override: id }).success,
    ).toBe(true)
  })
  it('preserves unknown provenance without inventing a unit', () => {
    expect(
      unitProvenanceSchema.parse({
        method: 'source-units-v1',
        status: 'unknown',
        unit: null,
        rows: 2,
        unknown_rows: 1,
        units: ['EA'],
      }).unit,
    ).toBeNull()
  })
  it('keeps demand quantity mandatory even when only a unit is supplied', () => {
    expect(
      validateUpsertBody('demand_history', {
        records: [
          { item_code: 'I', location_code: 'L', demand_date: '2026-10-10', unit_of_measure: 'EA' },
        ],
      }).ok,
    ).toBe(false)
    expect(
      validateUpsertBody('demand_history', {
        records: [
          {
            item_code: 'I',
            location_code: 'L',
            demand_date: '2026-10-10',
            quantity: '3',
            unit_of_measure: 'EA',
          },
        ],
      }).ok,
    ).toBe(true)
  })
})
