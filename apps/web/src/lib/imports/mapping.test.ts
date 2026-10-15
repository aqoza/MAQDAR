import { describe, expect, it } from 'vitest'
import ar from '../../../messages/ar.json'
import en from '../../../messages/en.json'
import { CONTRACT, columnLabels, getEntity } from './contract'
import {
  BUILT_IN_SYNONYMS,
  autoMap,
  checkMapping,
  hasBlockingIssues,
  headerKey,
  providedColumns,
  setMapping,
  sourceIndexes,
  storedMapping,
  type ColumnMapping,
  type MappingIssue,
} from './mapping'

const codes = (issues: MappingIssue[]) => issues.map((issue) => issue.code)
const errors = (issues: MappingIssue[]) => issues.filter((issue) => issue.level === 'error')

describe('headerKey', () => {
  it('ignores case, spaces, underscores and punctuation', () => {
    expect(headerKey('item_code')).toBe('itemcode')
    expect(headerKey(' Item Code ')).toBe('itemcode')
    expect(headerKey('ITEM-CODE')).toBe('itemcode')
    expect(headerKey('Lead time (p50, days)')).toBe('leadtimep50days')
    expect(headerKey('﻿item_code')).toBe('itemcode')
  })

  it('folds Arabic spelling variants and digits', () => {
    expect(headerKey('رقم القطعة المستبدَلة')).toBe(headerKey('رقم القطعه المستبدله'))
    expect(headerKey('الإثنين')).toBe(headerKey('الاثنين'))
    expect(headerKey('مهلة التوريد (p٥٠، أيام)')).toBe(headerKey('مهله التوريد p50 ايام'))
    expect(headerKey('المورد المفضّل')).toBe(headerKey('المورد المفضل'))
    expect(headerKey('ــــ')).toBe('')
  })

  it('keeps contract column names distinct within each entity', () => {
    for (const entity of CONTRACT.entities) {
      const keys = entity.columns.map((column) => headerKey(column.name))
      expect(new Set(keys).size, entity.name).toBe(keys.length)
    }
  })
})

describe('labels', () => {
  it('give every entity unambiguous English and Arabic labels', () => {
    for (const entity of CONTRACT.entities) {
      const labels = columnLabels(entity.name, en, ar)
      const owners = new Map<string, Set<string>>()
      for (const column of entity.columns) {
        const texts = [...(labels[column.name] ?? []), ...(BUILT_IN_SYNONYMS[column.name] ?? [])]
        for (const text of texts) {
          const set = owners.get(headerKey(text)) ?? new Set()
          set.add(column.name)
          owners.set(headerKey(text), set)
        }
      }
      const shared = [...owners].filter(([, columns]) => columns.size > 1)
      expect(shared, entity.name).toEqual([])
    }
  })
})

describe('autoMap', () => {
  it('matches contract names exactly, ignoring case and separators', () => {
    const header = ['Item Code', 'LOCATION_CODE', 'demand-date', 'Quantity', 'lost sales quantity']
    expect(autoMap('demand_history', header)).toEqual({
      item_code: { index: 0, source: 'name' },
      location_code: { index: 1, source: 'name' },
      demand_date: { index: 2, source: 'name' },
      quantity: { index: 3, source: 'name' },
      lost_sales_quantity: { index: 4, source: 'name' },
    })
  })

  it('matches English and Arabic labels after names', () => {
    const labels = columnLabels('items', en, ar)
    const header = [
      'Part code',
      'الاسم (بالعربية)',
      'Name (English)',
      'العلامة التجارية',
      'Unit cost',
      'العملة',
      'Remarks',
    ]
    const mapping = autoMap('items', header, { labels })
    expect(mapping).toEqual({
      item_code: { index: 0, source: 'label' },
      name_en: { index: 2, source: 'label' },
      name_ar: { index: 1, source: 'label' },
      brand_code: { index: 3, source: 'label' },
      // "Unit cost" is the contract name with a space.
      unit_cost: { index: 4, source: 'name' },
      currency: { index: 5, source: 'label' },
    })
  })

  it('uses built-in synonyms for demand exports', () => {
    const header = ['الصنف', 'الفرع', 'التاريخ', 'الكمية']
    expect(autoMap('demand_history', header)).toEqual({
      item_code: { index: 0, source: 'label' },
      location_code: { index: 1, source: 'label' },
      demand_date: { index: 2, source: 'label' },
      quantity: { index: 3, source: 'label' },
    })
  })

  it('never lets a label override a name match', () => {
    const labels = columnLabels('items', en)
    const mapping = autoMap('items', ['Part code', 'item_code'], { labels })
    expect(mapping.item_code).toEqual({ index: 1, source: 'name' })
    expect(Object.keys(mapping)).toEqual(['item_code'])
  })

  it('fills the rest from the previous mapping, exact text first', () => {
    const header = ['Part', 'Desc EN', 'Grp', 'grp']
    const previous = { item_code: 'ignored', name_en: 'Desc EN', product_group: 'Grp', nope: 'x' }
    const mapping = autoMap('items', header, { previous })
    expect(mapping).toEqual({
      item_code: { index: 0, source: 'label' },
      name_en: { index: 1, source: 'previous' },
      product_group: { index: 2, source: 'previous' },
    })
  })

  it('skips an ambiguous previous header and blank headers', () => {
    const mapping = autoMap('items', ['', 'GRP', 'grp '], { previous: { product_group: 'Grp' } })
    expect(mapping).toEqual({})
  })

  it('gives each header to the first column that claims it', () => {
    const mapping = autoMap('demand_history', ['item_code', 'item_code', 'qty'])
    expect(mapping).toEqual({
      item_code: { index: 0, source: 'name' },
      quantity: { index: 2, source: 'label' },
    })
  })
})

describe('setMapping', () => {
  it('maps by hand and moves a header off its previous column', () => {
    let mapping: ColumnMapping = autoMap('demand_history', ['item_code', 'x', 'demand_date'])
    mapping = setMapping(mapping, 'location_code', 1)
    expect(mapping.location_code).toEqual({ index: 1, source: 'manual' })
    mapping = setMapping(mapping, 'quantity', 1)
    expect(mapping.location_code).toBeUndefined()
    expect(mapping.quantity).toEqual({ index: 1, source: 'manual' })
    mapping = setMapping(mapping, 'quantity', null)
    expect(mapping.quantity).toBeUndefined()
    expect(mapping.item_code).toEqual({ index: 0, source: 'name' })
  })
})

describe('checkMapping', () => {
  it('requires every natural-key column', () => {
    const header = ['country_code', 'starts_on', 'ends_on', 'kind', 'name_en']
    const issues = checkMapping('holiday_overrides', header, autoMap('holiday_overrides', header))
    expect(errors(issues)).toEqual([
      { code: 'key_unmapped', level: 'error', column: 'work_calendar_code' },
    ])
    expect(hasBlockingIssues(issues)).toBe(true)
  })

  it('requires column groups to be mapped together', () => {
    const header = ['item_code', 'unit_cost', 'introduced_on', 'discontinued_on']
    const issues = checkMapping('items', header, autoMap('items', header))
    expect(errors(issues)).toEqual([
      {
        code: 'group_incomplete',
        level: 'error',
        group: ['unit_cost', 'currency'],
        missing: ['currency'],
      },
    ])
  })

  it('lets a file map one side of a two-column rule (the other keeps its stored value)', () => {
    const items = ['item_code', 'discontinued_on']
    expect(errors(checkMapping('items', items, autoMap('items', items)))).toEqual([])
    const supplierItems = ['supplier_code', 'item_code', 'lead_time_days_p90']
    expect(
      errors(
        checkMapping('supplier_items', supplierItems, autoMap('supplier_items', supplierItems)),
      ),
    ).toEqual([])
  })

  it('refuses one header feeding two columns and unknown indexes', () => {
    const header = ['item_code', 'location_code', 'demand_date', 'q']
    const mapping: ColumnMapping = {
      ...autoMap('demand_history', header),
      quantity: { index: 3, source: 'manual' },
      lost_sales_quantity: { index: 3, source: 'manual' },
    }
    expect(codes(errors(checkMapping('demand_history', header, mapping)))).toEqual([
      'duplicate_source',
    ])
    const unknown = { ...mapping, lost_sales_quantity: { index: 9, source: 'manual' as const } }
    expect(errors(checkMapping('demand_history', header, unknown))).toEqual([
      { code: 'unknown_source', level: 'error', column: 'lost_sales_quantity', index: 9 },
    ])
  })

  it('requires a value column for demand', () => {
    const header = ['item_code', 'location_code', 'demand_date']
    const issues = checkMapping('demand_history', header, autoMap('demand_history', header))
    expect(errors(issues)).toEqual([
      {
        code: 'value_column_required',
        level: 'error',
        columns: ['quantity', 'lost_sales_quantity'],
      },
    ])
    const withLostSales = [...header, 'lost_sales_quantity']
    const ok = checkMapping(
      'demand_history',
      withLostSales,
      autoMap('demand_history', withLostSales),
    )
    expect(hasBlockingIssues(ok)).toBe(false)
  })

  it('explains unmapped columns and ignored headers', () => {
    const header = ['brand_code', 'Remarks']
    const issues = checkMapping('brands', header, autoMap('brands', header))
    expect(hasBlockingIssues(issues)).toBe(false)
    expect(issues).toContainEqual({
      code: 'required_for_new_unmapped',
      level: 'warning',
      column: 'name_en',
    })
    expect(issues).toContainEqual({
      code: 'unmapped_optional',
      level: 'info',
      column: 'is_active',
      default: 'true',
    })
    expect(issues).toContainEqual({
      code: 'unmapped_header',
      level: 'info',
      index: 1,
      header: 'Remarks',
    })
  })

  it('refuses more header columns than an import stores', () => {
    const header = ['brand_code', ...Array.from({ length: 64 }, (_, index) => `extra${index}`)]
    expect(codes(errors(checkMapping('brands', header, autoMap('brands', header))))).toEqual([
      'too_many_columns',
    ])
  })

  it('accepts the full template header of every entity', () => {
    for (const entity of CONTRACT.entities) {
      const header = entity.columns.map((column) => column.name)
      const mapping = autoMap(entity.name, header)
      expect(Object.keys(mapping)).toEqual(header)
      expect(errors(checkMapping(entity.name, header, mapping)), entity.name).toEqual([])
    }
  })
})

describe('mapping outputs', () => {
  const header = ['qty', 'Part', 'date', 'branch']
  const mapping = autoMap('demand_history', header)

  it('lists provided columns in contract order', () => {
    expect(providedColumns('demand_history', mapping)).toEqual([
      'item_code',
      'location_code',
      'demand_date',
      'quantity',
    ])
  })

  it('gives a source index per contract column', () => {
    expect(sourceIndexes('demand_history', mapping)).toEqual([1, 3, 2, 0, null, null])
    expect(sourceIndexes('demand_history', mapping)).toHaveLength(
      getEntity('demand_history').columns.length,
    )
  })

  it('stores the header text for reuse and reapplies it', () => {
    const stored = storedMapping('demand_history', header, mapping)
    expect(stored).toEqual({
      item_code: 'Part',
      location_code: 'branch',
      demand_date: 'date',
      quantity: 'qty',
    })
    const again = autoMap('demand_history', ['Branch', 'QTY', 'DATE', 'PART'], { previous: stored })
    expect(sourceIndexes('demand_history', again)).toEqual([3, 0, 2, 1, null, null])
  })
})
