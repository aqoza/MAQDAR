import { describe, expect, it } from 'vitest'
import { ENTITY_NAMES, getEntity, type ColumnKind, type EntityName } from '../imports/contract'
import { checkMapping, hasBlockingIssues, type ColumnMapping } from '../imports/mapping'
import { EXAMPLES } from './examples'
import {
  ALWAYS_PROVIDED,
  acceptsJsonValue,
  validateUpsertBody,
  type UpsertBodyCheck,
} from './records'

const item = (overrides: Record<string, unknown> = {}) => ({
  item_code: 'A-1',
  name_en: 'Pad',
  unit_cost: '1.5',
  currency: 'SAR',
  ...overrides,
})

function failure(check: UpsertBodyCheck) {
  if (check.ok || check.code !== 'invalid_request') throw new Error('expected invalid_request')
  return check
}

function codes(check: UpsertBodyCheck) {
  return failure(check).errors.map((issue) => [issue.code, issue.pointer])
}

describe('validateUpsertBody: envelope and caps', () => {
  it('accepts records with one field set and returns the fields in contract order', () => {
    expect(validateUpsertBody('items', { records: [item(), item({ item_code: 'A-2' })] })).toEqual({
      ok: true,
      fields: ['item_code', 'name_en', 'unit_cost', 'currency'],
      records: 2,
    })
  })

  it('refuses bodies that are not {"records": [...]}', () => {
    expect(codes(validateUpsertBody('items', []))).toEqual([['not_an_object', '#']])
    expect(codes(validateUpsertBody('items', null))).toEqual([['not_an_object', '#']])
    expect(codes(validateUpsertBody('items', 'x'))).toEqual([['not_an_object', '#']])
    expect(codes(validateUpsertBody('items', {}))).toEqual([['missing_records', '#/records']])
    expect(codes(validateUpsertBody('items', { records: [] }))).toEqual([
      ['missing_records', '#/records'],
    ])
    expect(codes(validateUpsertBody('items', { records: {} }))).toEqual([
      ['missing_records', '#/records'],
    ])
    expect(codes(validateUpsertBody('items', { records: [item()], extra: 1, 'a/b': 2 }))).toEqual([
      ['unknown_field', '#/extra'],
      ['unknown_field', '#/a~1b'],
    ])
  })

  it('answers too_many_records above the cap, before reading the records', () => {
    const master = Array.from({ length: 1_001 }, () => 'not even an object')
    expect(validateUpsertBody('items', { records: master })).toEqual({
      ok: false,
      code: 'too_many_records',
      records: 1_001,
      limit: 1_000,
    })
    const demand = Array.from({ length: 2_500 }, (_, index) => ({
      item_code: 'A-1',
      location_code: 'L1',
      demand_date: '2026-01-01',
      quantity: index,
    }))
    expect(validateUpsertBody('demand_history', { records: demand }).ok).toBe(true)
    expect(validateUpsertBody('demand_history', { records: [...demand, demand[0]] })).toMatchObject(
      { ok: false, code: 'too_many_records', limit: 2_500 },
    )
  })

  it('reports records that are not objects', () => {
    expect(codes(validateUpsertBody('items', { records: [1, item(), null, [item()]] }))).toEqual([
      ['not_an_object', '#/records/0'],
      ['not_an_object', '#/records/2'],
      ['not_an_object', '#/records/3'],
    ])
  })
})

describe('validateUpsertBody: field set', () => {
  it('reports unknown fields once, on the first record', () => {
    const check = failure(
      validateUpsertBody('items', { records: [item({ colour: 'red' }), item({ colour: 'blue' })] }),
    )
    expect(check.errors).toEqual([
      {
        pointer: '#/records/0/colour',
        record: 0,
        field: 'colour',
        code: 'unknown_field',
        detail: 'Not a field of this resource.',
      },
    ])
  })

  it('reports records whose fields differ from the first one', () => {
    const check = failure(
      validateUpsertBody('items', {
        records: [
          item(),
          item({ name_ar: 'x' }),
          { item_code: 'A-3', name_en: 'x', unit_cost: '1' },
        ],
      }),
    )
    expect(check.errors.map((issue) => [issue.code, issue.pointer, issue.detail])).toEqual([
      [
        'inconsistent_fields',
        '#/records/1',
        'Every record must carry the same fields as record 0: extra name_ar.',
      ],
      [
        'inconsistent_fields',
        '#/records/2',
        'Every record must carry the same fields as record 0: missing currency.',
      ],
    ])
  })

  it('ignores updated_at everywhere, so listed records can be sent back', () => {
    expect(
      validateUpsertBody('items', {
        records: [item({ updated_at: '2026-10-01T00:00:00.000000Z' }), item({ item_code: 'A-2' })],
      }),
    ).toMatchObject({ ok: true, fields: ['item_code', 'name_en', 'unit_cost', 'currency'] })
    expect(validateUpsertBody('items', { records: [item({ updated_at: { any: 1 } })] }).ok).toBe(
      true,
    )
  })

  it('requires the natural key', () => {
    expect(codes(validateUpsertBody('items', { records: [{ name_en: 'x' }] }))).toEqual([
      ['missing_key_field', '#/records/0/item_code'],
    ])
    expect(
      codes(validateUpsertBody('supplier_items', { records: [{ supplier_code: 'S' }] })),
    ).toEqual([['missing_key_field', '#/records/0/item_code']])
  })

  it('requires column groups whole', () => {
    const check = failure(
      validateUpsertBody('items', { records: [{ item_code: 'A', unit_cost: '1' }] }),
    )
    expect(check.errors).toEqual([
      {
        pointer: '#/records/0/currency',
        record: 0,
        field: 'currency',
        code: 'incomplete_group',
        detail: 'Send unit_cost, currency together or not at all.',
      },
    ])
    expect(
      codes(
        validateUpsertBody('network_links', {
          records: [{ from_location_code: 'A', to_location_code: 'B', freight_basis: 'none' }],
        }),
      ),
    ).toEqual([
      ['incomplete_group', '#/records/0/freight_cost'],
      ['incomplete_group', '#/records/0/currency'],
    ])
  })

  it('requires a demand value field', () => {
    expect(
      codes(
        validateUpsertBody('demand_history', {
          records: [{ item_code: 'A', location_code: 'L', demand_date: '2026-01-01' }],
        }),
      ),
    ).toEqual([['value_field_required', '#/records/0']])
    expect(
      validateUpsertBody('demand_history', {
        records: [
          { item_code: 'A', location_code: 'L', demand_date: '2026-01-01', lost_sales_quantity: 1 },
        ],
      }).ok,
    ).toBe(true)
  })

  it('treats the holiday scope pair as always provided', () => {
    const base = { starts_on: '2026-12-31', ends_on: '2026-12-31', kind: 'closure', name_en: 'x' }
    const check = validateUpsertBody('holiday_overrides', {
      records: [
        { ...base, country_code: 'SA' },
        { ...base, work_calendar_code: 'SA-STD' },
        { ...base },
      ],
    })
    expect(check).toEqual({
      ok: true,
      fields: ['country_code', 'work_calendar_code', 'starts_on', 'ends_on', 'kind', 'name_en'],
      records: 3,
    })
    expect(ALWAYS_PROVIDED.holiday_overrides).toEqual(['country_code', 'work_calendar_code'])
  })
})

describe('validateUpsertBody: JSON types', () => {
  it('reports invalid_type per kind with a pointer to the value', () => {
    const check = failure(
      validateUpsertBody('work_calendars', {
        records: [
          {
            work_calendar_code: 7,
            name_en: { en: 'x' },
            weekend_days: [5, '6'],
            observe_public_holidays: 'true',
            is_active: true,
          },
        ],
      }),
    )
    expect(check.errors.map((issue) => [issue.pointer, issue.code, issue.detail])).toEqual([
      ['#/records/0/work_calendar_code', 'invalid_type', 'Expected a string (or null).'],
      ['#/records/0/name_en', 'invalid_type', 'Expected a string (or null).'],
      [
        '#/records/0/weekend_days',
        'invalid_type',
        'Expected an array of whole numbers, ISO weekdays 1-7 (or null).',
      ],
      ['#/records/0/observe_public_holidays', 'invalid_type', 'Expected true or false (or null).'],
    ])
  })

  it('accepts null and "" for every kind', () => {
    const kinds = new Set(ENTITY_NAMES.flatMap((e) => getEntity(e).columns.map((c) => c.kind)))
    for (const kind of kinds) {
      expect(acceptsJsonValue(kind, null), kind).toBe(true)
      expect(acceptsJsonValue(kind, ''), kind).toBe(true)
      expect(acceptsJsonValue(kind, {}), kind).toBe(false)
    }
  })

  it('applies the per-kind table of decision 6', () => {
    const table: [ColumnKind, unknown, boolean][] = [
      ['integer', 3, true],
      ['integer', 3.0, true],
      ['integer', 3.5, false],
      ['integer', '3', true],
      ['integer', true, false],
      ['decimal', 1.5, true],
      ['decimal', '1.50', true],
      ['decimal', 1e3, true],
      ['money', 0.30000000000000004, true],
      ['decimal', [1], false],
      ['boolean', true, true],
      ['boolean', false, true],
      ['boolean', 'true', false],
      ['boolean', 1, false],
      ['weekdays', [], true],
      ['weekdays', [6, 5], true],
      ['weekdays', [5.5], false],
      ['weekdays', '5;6', false],
      ['code', 'A-1', true],
      ['code', 12, false],
      ['item_code', ['A'], false],
      ['date', '2026-01-01', true],
      ['date', 20260101, false],
      ['enum', 'EA', true],
      ['text', 'any text', true],
      ['text', 5, false],
      ['currency', 'SAR', true],
      ['country', 'SA', true],
      ['timezone', 'Asia/Riyadh', true],
    ]
    for (const [kind, value, expected] of table) {
      expect(acceptsJsonValue(kind, value), `${kind} ${JSON.stringify(value)}`).toBe(expected)
    }
  })

  it('keeps at most 100 issues and counts them all', () => {
    const records = Array.from({ length: 150 }, (_, index) => item({ item_code: index }))
    const check = failure(validateUpsertBody('items', { records }))
    expect(check.errors).toHaveLength(100)
    expect(check.errorCount).toBe(150)
    expect(check.truncated).toBe(true)
  })
})

describe('validateUpsertBody: parity with checkMapping', () => {
  /** Every subset of an entity's columns, up to 2^12 per entity. */
  function* subsets(columns: string[]): Generator<string[]> {
    for (let mask = 0; mask < 1 << columns.length; mask++) {
      yield columns.filter((_, index) => mask & (1 << index))
    }
  }

  it('blocks exactly the field sets the wizard blocks (with the holiday scope always mapped)', () => {
    let cases = 0
    for (const entity of ENTITY_NAMES as readonly EntityName[]) {
      const columns = getEntity(entity).columns.map((column) => column.name)
      const always = ALWAYS_PROVIDED[entity] ?? []
      for (const subset of subsets(columns)) {
        const record = Object.fromEntries(subset.map((column) => [column, null]))
        const header = columns.filter(
          (column) => subset.includes(column) || always.includes(column),
        )
        const mapping: ColumnMapping = Object.fromEntries(
          header.map((column, index) => [column, { index, source: 'name' as const }]),
        )
        const wizard = hasBlockingIssues(checkMapping(entity, header, mapping))
        const check = validateUpsertBody(entity, { records: [record] })
        expect(!check.ok, `${entity}: ${subset.join(',')}`).toBe(wizard)
        cases += 1
      }
    }
    expect(cases).toBeGreaterThan(5_000)
  })
})

describe('examples', () => {
  it('pass the request checks for every resource', () => {
    for (const entity of ENTITY_NAMES) {
      expect(validateUpsertBody(entity, { records: EXAMPLES[entity] }).ok, entity).toBe(true)
    }
  })
})
