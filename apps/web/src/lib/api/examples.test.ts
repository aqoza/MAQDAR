import { describe, expect, it } from 'vitest'
import { ENTITY_NAMES, getEntity } from '../imports/contract'
import { EXAMPLES } from './examples'

describe('examples', () => {
  it('cover every entity with contract columns only', () => {
    for (const entity of ENTITY_NAMES) {
      const records = EXAMPLES[entity]
      expect(records.length, entity).toBeGreaterThan(0)
      const columns = getEntity(entity).columns.map((column) => column.name)
      for (const record of records) expect(Object.keys(record), entity).toEqual(columns)
    }
  })

  it('reference only codes of earlier examples (or of the same request), in load order', () => {
    for (const entity of ENTITY_NAMES) {
      const contract = getEntity(entity)
      for (const record of EXAMPLES[entity]) {
        for (const column of contract.columns) {
          const value = record[column.name]
          if (!column.lookup || value === null || value === '') continue
          const target = getEntity(column.lookup)
          expect(target.load_order, `${entity}.${column.name}`).toBeLessThanOrEqual(
            contract.load_order,
          )
          const key = target.natural_key[0] ?? ''
          const codes = EXAMPLES[column.lookup].map((example) => example[key])
          expect(codes, `${entity}.${column.name}`).toContain(value)
        }
      }
    }
  })

  it('match the contract patterns, enums and decimal digits', () => {
    for (const entity of ENTITY_NAMES) {
      for (const record of EXAMPLES[entity]) {
        for (const column of getEntity(entity).columns) {
          const value = record[column.name]
          if (value === null || value === undefined) {
            expect(column.required, `${entity}.${column.name}`).toBe(false)
            continue
          }
          if (typeof value === 'string' && column.pattern) {
            expect(new RegExp(column.pattern).test(value), `${entity}.${column.name}`).toBe(true)
          }
          if (column.enum) expect(column.enum).toContain(value)
          if ((column.kind === 'decimal' || column.kind === 'money') && typeof value === 'string') {
            const [whole = '', fraction = ''] = value.split('.')
            expect(whole.replace('-', '').length).toBeLessThanOrEqual(column.integer_digits ?? 0)
            expect(fraction.length).toBeLessThanOrEqual(column.scale ?? 0)
            expect(fraction.endsWith('0'), 'canonical decimals').toBe(false)
          }
        }
      }
    }
  })

  it('keep the demand date inside the seeded partitions and not in the future', () => {
    for (const record of EXAMPLES.demand_history) {
      const date = String(record.demand_date)
      expect(date >= '2023-01-01' && date <= '2027-12-31').toBe(true)
      expect(date <= new Date().toISOString().slice(0, 10)).toBe(true)
    }
  })
})
