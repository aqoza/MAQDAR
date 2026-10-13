import { describe, expect, it } from 'vitest'
import ar from '../../../messages/ar.json'
import en from '../../../messages/en.json'
import {
  COLUMN_KINDS,
  COLUMN_LABEL_PATHS,
  CONTRACT,
  ENTITY_NAMES,
  IMPORT_LIMITS,
  columnGroups,
  columnIndex,
  columnLabels,
  compareLoadOrder,
  entitiesInLoadOrder,
  errorLevel,
  getColumn,
  getEntity,
  guessEntityFromFileName,
  importErrorCodes,
  isEntityName,
  isImportErrorCode,
  naturalKeyColumns,
  sourceFormatFor,
  type EntityName,
} from './contract'

describe('contract shape', () => {
  it('is import format v1 with the entities in load order', () => {
    expect(CONTRACT.format_version).toBe(1)
    expect(CONTRACT.entities.map((entity) => entity.name)).toEqual([...ENTITY_NAMES])
    expect(CONTRACT.entities.map((entity) => entity.load_order)).toEqual(
      ENTITY_NAMES.map((_, index) => index + 1),
    )
    expect(entitiesInLoadOrder().map((entity) => entity.name)).toEqual([...ENTITY_NAMES])
  })

  it('knows every column kind the JSON declares', () => {
    expect(Object.keys(CONTRACT.kinds).sort()).toEqual([...COLUMN_KINDS].sort())
    for (const entity of CONTRACT.entities) {
      for (const column of entity.columns) {
        expect(COLUMN_KINDS, `${entity.name}.${column.name}`).toContain(column.kind)
      }
    }
  })

  it('has keys, groups and rules that name real columns', () => {
    for (const entity of CONTRACT.entities) {
      const names = entity.columns.map((column) => column.name)
      expect(new Set(names).size).toBe(names.length)
      for (const key of entity.natural_key) {
        expect(getColumn(entity.name, key)?.natural_key, `${entity.name}.${key}`).toBe(true)
      }
      expect(entity.columns.filter((column) => column.natural_key).map((c) => c.name)).toEqual(
        entity.natural_key,
      )
      for (const group of entity.column_groups) {
        for (const column of group) expect(names).toContain(column)
      }
      for (const rule of [...entity.row_rules, ...entity.set_rules]) {
        expect(names).toContain(rule.column)
        expect(isImportErrorCode(rule.code), rule.code).toBe(true)
      }
      if (entity.columns.some((column) => column.omittable)) {
        const firstOmittable = entity.columns.findIndex((column) => column.omittable)
        expect(entity.columns.slice(firstOmittable).every((column) => column.omittable)).toBe(true)
      }
    }
  })

  it('looks references up in entities loaded earlier', () => {
    for (const entity of CONTRACT.entities) {
      for (const column of entity.columns) {
        if (column.lookup === null) continue
        expect(isEntityName(column.lookup)).toBe(true)
        expect(compareLoadOrder(column.lookup, entity.name)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('stages at most the approved rows per chunk', () => {
    for (const entity of CONTRACT.entities) {
      expect(entity.stage_rows).toBeGreaterThan(0)
      expect(entity.stage_rows).toBeLessThanOrEqual(entity.monthly_parts ? 20_000 : 5_000)
    }
    expect(getEntity('demand_history').stage_rows).toBe(10_000)
    expect(IMPORT_LIMITS.chunkBytes).toBe(1_000_000)
  })

  it('lets the database report too_long for every column', () => {
    const longest = Math.max(
      ...CONTRACT.entities.flatMap((entity) =>
        entity.columns.map((column) => column.max_length ?? 0),
      ),
    )
    expect(longest).toBe(1_000)
    expect(IMPORT_LIMITS.cellChars).toBe(4_000)
    expect(IMPORT_LIMITS.cellChars).toBeGreaterThan(longest)
  })

  it('exposes keys, groups and positions', () => {
    expect(naturalKeyColumns('holiday_overrides')).toEqual([
      'country_code',
      'work_calendar_code',
      'starts_on',
    ])
    expect(columnGroups('items')).toEqual([['unit_cost', 'currency']])
    expect(columnGroups('supplier_items')).toEqual([['unit_price', 'currency']])
    expect(columnIndex('demand_history', 'quantity')).toBe(3)
    expect(columnIndex('items', 'nope')).toBe(-1)
    expect(() => getEntity('nope' as EntityName)).toThrow()
  })

  it('lists the stable error codes with their levels', () => {
    const codes = importErrorCodes()
    expect(codes).toContain('invalid_decimal')
    expect(codes).toContain('date_outside_history_window')
    expect(codes).not.toContain('column_group_incomplete')
    expect(codes).not.toContain('demand_negative')
    expect(new Set(codes).size).toBe(codes.length)
    expect(errorLevel('zero_row_new_key')).toBe('warning')
    expect(errorLevel('required')).toBe('error')
    expect(errorLevel('nope')).toBeUndefined()
    for (const kind of Object.values(CONTRACT.kinds)) {
      if (kind.error_code !== null) expect(codes).toContain(kind.error_code)
    }
  })
})

describe('sourceFormatFor', () => {
  it('accepts delimited text and XLSX only', () => {
    expect(sourceFormatFor('items.csv')).toBe('csv')
    expect(sourceFormatFor('Items.TSV')).toBe('csv')
    expect(sourceFormatFor('export.txt')).toBe('csv')
    expect(sourceFormatFor('book.xlsx')).toBe('xlsx')
    for (const name of ['book.xls', 'book.xlsm', 'data.json', 'items', 'items.csv.zip']) {
      expect(sourceFormatFor(name), name).toBeNull()
    }
  })
})

describe('guessEntityFromFileName', () => {
  it.each([
    ['items.csv', 'items'],
    ['ITEMS.CSV', 'items'],
    ['Supplier Items (2).xlsx', 'supplier_items'],
    ['supplier-items.tsv', 'supplier_items'],
    ['supplier_items_export.csv', 'supplier_items'],
    ['demand_history/2026-01.csv', 'demand_history'],
    ['bundle\\demand_history\\2025-12.csv', 'demand_history'],
    ['2026-01.csv', 'demand_history'],
    ['demand_history.csv', 'demand_history'],
    ['demand_history_2026-01.csv', 'demand_history'],
    ['demand.csv', 'demand_history'],
    ['holidays.csv', 'holiday_overrides'],
    ['item_supersessions.csv', 'item_supersessions'],
    ['Interchanges.xlsx', 'item_interchanges'],
    ['fx rates.csv', 'fx_rates'],
    ['work_calendars.csv', 'work_calendars'],
    ['network_links.csv', 'network_links'],
  ] as const)('%s → %s', (name, entity) => {
    expect(guessEntityFromFileName(name)).toBe(entity)
  })

  it('returns null when nothing fits', () => {
    for (const name of ['export.csv', 'Book1.xlsx', '.csv', '', 'orders/2026.csv']) {
      expect(guessEntityFromFileName(name), name).toBeNull()
    }
  })
})

function messageExists(messages: unknown, path: string): boolean {
  let node: unknown = messages
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(key in node)) return false
    node = (node as Record<string, unknown>)[key]
  }
  return typeof node === 'string'
}

describe('column labels', () => {
  it('points every label path at an English message', () => {
    for (const [entity, columns] of Object.entries(COLUMN_LABEL_PATHS)) {
      for (const [column, paths] of Object.entries(columns)) {
        expect(getColumn(entity as EntityName, column), `${entity}.${column}`).toBeDefined()
        for (const path of paths) expect(messageExists(en, path), path).toBe(true)
      }
    }
  })

  it('labels every master-data column in English', () => {
    for (const entity of CONTRACT.entities) {
      if (entity.name === 'demand_history') continue
      const labels = columnLabels(entity.name, en)
      for (const column of entity.columns) {
        expect(labels[column.name]?.length, `${entity.name}.${column.name}`).toBeGreaterThan(0)
      }
    }
  })

  it('merges English and Arabic labels without duplicates', () => {
    const labels = columnLabels('items', en, ar)
    expect(labels.item_code).toEqual(['Part code', 'رقم القطعة'])
    expect(labels.brand_code).toEqual(['Brand', 'العلامة التجارية'])
    expect(columnLabels('items', en, en).item_code).toEqual(['Part code'])
  })

  it('reads ImportColumns labels when present', () => {
    const messages = { ImportColumns: { demand_history: { quantity: 'Units sold' } } }
    // Only the Items namespace of en.json (which itself has ImportColumns labels now).
    const labels = columnLabels('demand_history', { Items: en.Items }, messages)
    expect(labels.quantity).toEqual(['Units sold'])
    expect(labels.item_code).toEqual(['Part code'])
    expect(labels.demand_date).toEqual([])
    expect(columnLabels('demand_history', en, messages).quantity).toEqual([
      'Quantity',
      'Units sold',
    ])
  })
})
