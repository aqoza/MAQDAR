import type { Database } from '@maqdar/shared/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fieldForConstraint, placeWriteError } from '../errors'
import { formValuesFromRow } from '../form-values'
import type { EntityContext } from '../types'
import { fieldErrorsFrom, type ValidationTranslator } from '../../validation'
import { interchangeSchema, interchanges } from './interchanges'
import { supersessionSchema, supersessions } from './supersessions'
import { supplierItemSchema, supplierItems } from './supplier-items'

/** Supersessions, interchanges and supplier items: the master data that points at items by code. */

const t: ValidationTranslator = (key, values) =>
  values
    ? `${key}:${Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')}`
    : key

function errorsOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input)
  if (result.success) throw new Error('expected a validation failure')
  return fieldErrorsFrom(result.error, t).fieldErrors
}

const ORG = '0b3f5c3e-6b64-4f2c-9a59-3f5a4f0d2a10'
const SUPPLIER = '6a1f1d1e-2f0c-4b9a-8a5e-0e7c1f0b9c21'
const ROW = '9d7c2b1a-3e4f-4a5b-8c6d-7e8f9a0b1c2d'
const OTHER_ROW = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const ITEM_IDS: Record<string, string> = {
  'P-1': '11111111-1111-4111-8111-111111111111',
  'P-2': '22222222-2222-4222-8222-222222222222',
}

/* ------------------------------------------------------------------------------------------ */
/* A recording stand-in for the PostgREST builder chain                                        */
/* ------------------------------------------------------------------------------------------ */

type Call = { table: string; op: 'select' | 'update'; filters: string[]; values?: unknown }
type Result = { data: unknown; error: { code: string } | null }

class FakeQuery implements PromiseLike<Result> {
  constructor(
    private readonly call: Call,
    private readonly run: (call: Call) => Result,
  ) {}
  select() {
    return this
  }
  update(values: Record<string, unknown>) {
    this.call.op = 'update'
    this.call.values = values
    return this
  }
  eq(column: string, value: unknown) {
    this.call.filters.push(`${column}=${String(value)}`)
    return this
  }
  neq(column: string, value: unknown) {
    this.call.filters.push(`${column}!=${String(value)}`)
    return this
  }
  in(column: string, values: readonly string[]) {
    this.call.filters.push(`${column} in ${values.join(',')}`)
    return this
  }
  ilike(column: string, pattern: string) {
    this.call.filters.push(`${column}~${pattern}`)
    return this
  }
  limit() {
    return this
  }
  order() {
    return this
  }
  maybeSingle() {
    return this
  }
  retry() {
    return this
  }
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run(this.call)).then(onfulfilled, onrejected)
  }
}

type Fixture = {
  /** Existing supplier_items row for (supplier, item), if any. */
  existing?: { id: string } | null
  /** Whether the edited row still has the updated_at the form read. */
  unchanged?: boolean
}

function fakeContext(fixture: Fixture = {}, row: { id?: string; updatedAt?: string } = {}) {
  const calls: Call[] = []
  const run = (call: Call): Result => {
    calls.push(call)
    if (call.table === 'items') {
      const codes = call.filters.find((filter) => filter.startsWith('code in '))
      const wanted = codes ? codes.slice('code in '.length).split(',') : []
      return {
        data: wanted.filter((code) => ITEM_IDS[code]).map((code) => ({ id: ITEM_IDS[code], code })),
        error: null,
      }
    }
    if (call.op === 'update') return { data: null, error: null }
    if (call.filters.some((filter) => filter.startsWith('updated_at='))) {
      return { data: fixture.unchanged === false ? null : { id: row.id }, error: null }
    }
    return { data: fixture.existing ?? null, error: null }
  }
  const supabase = {
    from: (table: string) => new FakeQuery({ table, op: 'select', filters: [] }, run),
  } as unknown as SupabaseClient<Database>
  const ctx: EntityContext = {
    supabase,
    organizationId: ORG,
    id: row.id ?? null,
    updatedAt: row.updatedAt ?? null,
  }
  return { ctx, calls }
}

/* ------------------------------------------------------------------------------------------ */
/* Supersessions                                                                               */
/* ------------------------------------------------------------------------------------------ */

const validSupersession = {
  predecessor_item_code: 'P-1',
  successor_item_code: 'P-2',
  effective_on: '2026-01-01',
  quantity_factor: '١٫٥',
  note: '',
}

describe('supersessionSchema', () => {
  it('parses a valid supersession', () => {
    expect(supersessionSchema.parse(validSupersession)).toEqual({
      predecessor_item_code: 'P-1',
      successor_item_code: 'P-2',
      effective_on: '2026-01-01',
      quantity_factor: 1.5,
      note: null,
    })
  })

  it('needs two different parts', () => {
    expect(
      errorsOf(supersessionSchema, { ...validSupersession, successor_item_code: 'P-1' }),
    ).toEqual({ successor_item_code: 'mustDiffer' })
  })

  it('checks the factor, the date and the code format', () => {
    expect(errorsOf(supersessionSchema, { ...validSupersession, quantity_factor: '0' })).toEqual({
      quantity_factor: 'greaterThan:min=0',
    })
    expect(
      errorsOf(supersessionSchema, { ...validSupersession, quantity_factor: '1.2345' }),
    ).toEqual({ quantity_factor: 'decimal:scale=3' })
    expect(
      errorsOf(supersessionSchema, {
        ...validSupersession,
        effective_on: '',
        predecessor_item_code: 'P 1',
      }),
    ).toEqual({ effective_on: 'required', predecessor_item_code: 'itemCodeFormat' })
  })
})

describe('supersessions', () => {
  it('resolves both part codes to item ids', async () => {
    const { ctx } = fakeContext()
    const result = await supersessions.toRow(supersessionSchema.parse(validSupersession), ctx)
    expect(result).toEqual({
      ok: true,
      row: {
        predecessor_item_id: ITEM_IDS['P-1'],
        successor_item_id: ITEM_IDS['P-2'],
        effective_on: '2026-01-01',
        quantity_factor: 1.5,
        note: null,
      },
    })
  })

  it('reports an unknown code on its field', async () => {
    const { ctx } = fakeContext()
    const input = supersessionSchema.parse({ ...validSupersession, successor_item_code: 'P-9' })
    expect(await supersessions.toRow(input, ctx)).toEqual({
      ok: false,
      fieldErrors: { successor_item_code: 'unknownItem' },
    })
  })

  it('places the graph guards on the part fields', () => {
    expect(
      placeWriteError(supersessions, {
        code: 'MQ422',
        message: 'this supersession would create a cycle',
        hint: 'successor_item_code',
      }),
    ).toEqual({ scope: 'field', field: 'successor_item_code', key: 'cycle' })
    expect(
      placeWriteError(supersessions, {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "item_supersessions_one_successor_key"',
      }),
    ).toEqual({ scope: 'field', field: 'predecessor_item_code', key: 'duplicate' })
    expect(fieldForConstraint(supersessions, 'item_supersessions_quantity_factor_check')).toBe(
      'quantity_factor',
    )
  })

  it('fills the form from the spread item codes', () => {
    const values = formValuesFromRow(supersessions.fields, {
      id: ROW,
      predecessor_item_code: 'P-1',
      successor_item_code: 'P-2',
      effective_on: '2026-01-01',
      quantity_factor: 2,
      note: null,
      updated_at: '2026-10-11T08:00:00.123456+00:00',
    })
    expect(values).toEqual({
      predecessor_item_code: 'P-1',
      successor_item_code: 'P-2',
      effective_on: '2026-01-01',
      quantity_factor: '2',
      note: '',
    })
    expect(
      supersessions.titleOf({ predecessor_item_code: 'P-1', successor_item_code: 'P-2' }),
    ).toBe('P-1 → P-2')
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Interchanges                                                                                */
/* ------------------------------------------------------------------------------------------ */

const validInterchange = {
  item_code: 'P-1',
  alternate_item_code: 'P-2',
  direction: 'one_way',
  priority: '٣',
  note: ' fits the 2024 model ',
}

describe('interchangeSchema', () => {
  it('parses a valid interchange', () => {
    expect(interchangeSchema.parse(validInterchange)).toEqual({
      item_code: 'P-1',
      alternate_item_code: 'P-2',
      direction: 'one_way',
      priority: 3,
      note: 'fits the 2024 model',
    })
  })

  it('checks the priority range and the direction', () => {
    expect(errorsOf(interchangeSchema, { ...validInterchange, priority: '0' })).toEqual({
      priority: 'minValue:min=1',
    })
    expect(errorsOf(interchangeSchema, { ...validInterchange, priority: '100' })).toEqual({
      priority: 'maxValue:max=99',
    })
    expect(errorsOf(interchangeSchema, { ...validInterchange, priority: '1.5' })).toEqual({
      priority: 'integer',
    })
    expect(errorsOf(interchangeSchema, { ...validInterchange, direction: 'both' })).toEqual({
      direction: 'invalidChoice',
    })
  })

  it('needs two different parts', () => {
    expect(
      errorsOf(interchangeSchema, { ...validInterchange, alternate_item_code: 'P-1' }),
    ).toEqual({ alternate_item_code: 'mustDiffer' })
  })
})

describe('interchanges', () => {
  it('resolves the pair and puts a reversed duplicate on the alternate', async () => {
    const { ctx } = fakeContext()
    expect(await interchanges.toRow(interchangeSchema.parse(validInterchange), ctx)).toEqual({
      ok: true,
      row: {
        item_id: ITEM_IDS['P-1'],
        alternate_item_id: ITEM_IDS['P-2'],
        direction: 'one_way',
        priority: 3,
        note: 'fits the 2024 model',
      },
    })
    expect(
      placeWriteError(interchanges, {
        code: '23505',
        message: 'duplicate key value violates unique constraint "item_interchanges_pair_key"',
      }),
    ).toEqual({ scope: 'field', field: 'alternate_item_code', key: 'duplicate' })
    expect(
      placeWriteError(interchanges, {
        code: '23514',
        message: 'new row violates check constraint "item_interchanges_check"',
      }),
    ).toEqual({ scope: 'field', field: 'alternate_item_code', key: 'invalid' })
  })

  it('titles one-way and two-way pairs', () => {
    const row = { item_code: 'P-1', alternate_item_code: 'P-2' }
    expect(interchanges.titleOf({ ...row, direction: 'one_way' })).toBe('P-1 → P-2')
    expect(interchanges.titleOf({ ...row, direction: 'two_way' })).toBe('P-1 ⇄ P-2')
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Supplier items                                                                              */
/* ------------------------------------------------------------------------------------------ */

const validSupplierItem = {
  supplier_id: SUPPLIER.toUpperCase(),
  item_code: 'P-1',
  supplier_part_number: '',
  lead_time_days: '14',
  lead_time_days_p90: '',
  min_order_quantity: '0',
  pack_size: '12',
  unit_price: '1,250.125',
  currency: 'kwd',
  is_preferred: false,
  valid_from: '',
}

describe('supplierItemSchema', () => {
  it('parses a valid supplier item', () => {
    expect(supplierItemSchema.parse(validSupplierItem)).toEqual({
      supplier_id: SUPPLIER,
      item_code: 'P-1',
      supplier_part_number: null,
      lead_time_days: 14,
      lead_time_days_p90: null,
      min_order_quantity: 0,
      pack_size: 12,
      unit_of_measure: null,
      unit_price: 1250.125,
      currency: 'KWD',
      is_preferred: false,
      valid_from: null,
    })
  })

  it('keeps the slow lead time at or above the lead time', () => {
    expect(errorsOf(supplierItemSchema, { ...validSupplierItem, lead_time_days_p90: '7' })).toEqual(
      {
        lead_time_days_p90: 'p90BelowP50',
      },
    )
    expect(
      supplierItemSchema.parse({ ...validSupplierItem, lead_time_days_p90: '14' })
        .lead_time_days_p90,
    ).toBe(14)
  })

  it('mirrors the quantity, price and reference checks', () => {
    expect(
      errorsOf(supplierItemSchema, {
        ...validSupplierItem,
        supplier_id: '',
        pack_size: '0',
        min_order_quantity: '-1',
        unit_price: '1.0005',
        currency: '',
        supplier_part_number: 'X'.repeat(101),
      }),
    ).toEqual({
      supplier_id: 'required',
      pack_size: 'greaterThan:min=0',
      min_order_quantity: 'minValue:min=0',
      unit_price: 'decimal:scale=3',
      currency: 'required',
      supplier_part_number: 'tooLong:max=100',
    })
    expect(errorsOf(supplierItemSchema, { ...validSupplierItem, supplier_id: 'abc' })).toEqual({
      supplier_id: 'invalidChoice',
    })
  })
})

describe('supplierItems', () => {
  const parse = (overrides: Partial<typeof validSupplierItem> = {}) =>
    supplierItemSchema.parse({ ...validSupplierItem, ...overrides })

  it('saves a non-preferred row without touching other rows', async () => {
    const { ctx, calls } = fakeContext()
    const result = await supplierItems.toRow(parse(), ctx)
    expect(result).toMatchObject({
      ok: true,
      row: { item_id: ITEM_IDS['P-1'], is_preferred: false },
    })
    expect(result.ok && 'item_code' in result.row).toBe(false)
    expect(calls.map((call) => call.table)).toEqual(['items'])
  })

  it('clears the previous preferred row of the item before a new preferred row', async () => {
    const { ctx, calls } = fakeContext()
    const result = await supplierItems.toRow(parse({ is_preferred: true }), ctx)
    expect(result).toMatchObject({ ok: true, row: { is_preferred: true } })
    const update = calls.find((call) => call.op === 'update')
    expect(update).toEqual({
      table: 'supplier_items',
      op: 'update',
      values: { is_preferred: false },
      filters: [`organization_id=${ORG}`, `item_id=${ITEM_IDS['P-1']}`, 'is_preferred=true'],
    })
  })

  it('keeps the edited row out of the clearing update', async () => {
    const updatedAt = '2026-10-11T08:00:00.123456+00:00'
    const { ctx, calls } = fakeContext({ existing: { id: ROW } }, { id: ROW, updatedAt })
    expect(await supplierItems.toRow(parse({ is_preferred: true }), ctx)).toMatchObject({
      ok: true,
    })
    expect(calls.some((call) => call.filters.includes(`updated_at=${updatedAt}`))).toBe(true)
    expect(calls.find((call) => call.op === 'update')?.filters).toContain(`id!=${ROW}`)
  })

  it('clears nothing when the save is bound to fail', async () => {
    const duplicate = fakeContext({ existing: { id: OTHER_ROW } })
    expect(await supplierItems.toRow(parse({ is_preferred: true }), duplicate.ctx)).toEqual({
      ok: false,
      fieldErrors: { item_code: 'duplicate' },
    })
    expect(duplicate.calls.some((call) => call.op === 'update')).toBe(false)

    const stale = fakeContext(
      { existing: { id: ROW }, unchanged: false },
      { id: ROW, updatedAt: '2026-10-11T08:00:00+00:00' },
    )
    expect(await supplierItems.toRow(parse({ is_preferred: true }), stale.ctx)).toMatchObject({
      ok: true,
    })
    expect(stale.calls.some((call) => call.op === 'update')).toBe(false)
  })

  it('reports an unknown part code', async () => {
    const { ctx } = fakeContext()
    expect(await supplierItems.toRow(parse({ item_code: 'P-404' }), ctx)).toEqual({
      ok: false,
      fieldErrors: { item_code: 'unknownItem' },
    })
  })

  it('places constraint errors on their fields', () => {
    const unique = (constraint: string) => ({
      code: '23505',
      message: `duplicate key value violates unique constraint "${constraint}"`,
    })
    expect(
      placeWriteError(
        supplierItems,
        unique('supplier_items_organization_id_supplier_id_item_id_key'),
      ),
    ).toEqual({ scope: 'field', field: 'item_code', key: 'duplicate' })
    expect(placeWriteError(supplierItems, unique('supplier_items_one_preferred_key'))).toEqual({
      scope: 'field',
      field: 'is_preferred',
      key: 'duplicate',
    })
    expect(fieldForConstraint(supplierItems, 'supplier_items_check')).toBe('lead_time_days_p90')
    expect(
      fieldForConstraint(supplierItems, 'supplier_items_organization_id_supplier_id_fkey'),
    ).toBe('supplier_id')
    expect(fieldForConstraint(supplierItems, 'supplier_items_pack_size_check')).toBe('pack_size')
  })
})

describe('list selects', () => {
  it('spreads each embedded item through its own foreign key', () => {
    // Two spreads of the same table name collide in PostgREST's generated SQL (42712).
    for (const definition of [supersessions, interchanges, supplierItems]) {
      for (const select of [definition.listSelect, definition.editSelect]) {
        expect(select).not.toMatch(/\.\.\.items!/)
      }
    }
  })
})
