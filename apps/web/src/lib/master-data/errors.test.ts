import { describe, expect, it } from 'vitest'
import { brands } from './entities/brands'
import { items } from './entities/items'
import { fieldForConstraint, placeDeleteError, placeWriteError } from './errors'
import { formValuesFromRow, inputFromFormData, submittedValues } from './form-values'

describe('fieldForConstraint', () => {
  it('maps generated constraint names to fields', () => {
    expect(fieldForConstraint(items, 'items_organization_id_code_key')).toBe('code')
    expect(fieldForConstraint(items, 'items_brand_fkey')).toBe('brand_id')
    expect(fieldForConstraint(items, 'items_currency_fkey')).toBe('currency')
    expect(fieldForConstraint(items, 'items_name_ar_check')).toBe('name_ar')
    expect(fieldForConstraint(brands, 'brands_country_of_origin_check')).toBe('country_of_origin')
  })

  it('prefers the explicit map', () => {
    expect(fieldForConstraint(items, 'items_check')).toBe('discontinued_on')
    expect(fieldForConstraint(items, 'items_pkey')).toBeNull()
  })
})

describe('placeWriteError', () => {
  const unique = (constraint: string) => ({
    code: '23505',
    message: `duplicate key value violates unique constraint "${constraint}"`,
  })

  it('puts a duplicate code on the code field', () => {
    expect(placeWriteError(items, unique('items_organization_id_code_key'))).toEqual({
      scope: 'field',
      field: 'code',
      key: 'codeTaken',
    })
    expect(placeWriteError(items, unique('something_else_key'))).toEqual({
      scope: 'form',
      key: 'duplicate',
    })
  })

  it('places reference, check and overlap violations', () => {
    expect(
      placeWriteError(items, {
        code: '23503',
        message:
          'insert or update on table "items" violates foreign key constraint "items_currency_fkey"',
      }),
    ).toEqual({ scope: 'field', field: 'currency', key: 'missingReference' })
    expect(
      placeWriteError(items, {
        code: '23514',
        message: 'new row for relation "items" violates check constraint "items_check"',
      }),
    ).toEqual({ scope: 'field', field: 'discontinued_on', key: 'invalid' })
    expect(placeWriteError(items, { code: '23514', message: 'check constraint "x"' })).toEqual({
      scope: 'rpc',
    })
    expect(placeWriteError(items, { code: '23P01', message: 'exclusion constraint "x"' })).toEqual({
      scope: 'form',
      key: 'overlap',
    })
  })

  it('maps MQ422 hints that name a field of the entity', () => {
    const withHint = { ...items, hintMessages: { status: 'cycle' as const } }
    expect(placeWriteError(withHint, { code: 'MQ422', hint: 'status' })).toEqual({
      scope: 'field',
      field: 'status',
      key: 'cycle',
    })
    expect(placeWriteError(items, { code: 'MQ422', hint: 'code' })).toEqual({
      scope: 'field',
      field: 'code',
      key: 'invalid',
    })
    expect(placeWriteError(items, { code: 'MQ422', hint: 'parent_location_id' })).toEqual({
      scope: 'rpc',
    })
  })

  it('leaves everything else to the RpcErrors texts', () => {
    expect(placeWriteError(items, { code: '42501' })).toEqual({ scope: 'rpc' })
    expect(placeWriteError(items, null)).toEqual({ scope: 'rpc' })
  })
})

describe('placeDeleteError', () => {
  it('explains demand history and references', () => {
    expect(placeDeleteError({ code: 'MQ409' })).toEqual({ scope: 'form', key: 'hasDemand' })
    expect(placeDeleteError({ code: '23503' })).toEqual({ scope: 'form', key: 'inUse' })
    expect(placeDeleteError({ code: '42501' })).toEqual({ scope: 'rpc' })
  })
})

describe('form values', () => {
  it('reads a stored row into input strings', () => {
    expect(
      formValuesFromRow(items.fields, {
        code: 'A/1',
        name_en: 'Filter',
        name_ar: null,
        brand_id: null,
        product_group: 'Filters',
        unit_of_measure: 'EA',
        unit_cost: 12.5,
        currency: 'SAR',
        status: 'active',
        introduced_on: '2026-01-01',
        discontinued_on: null,
      }),
    ).toEqual({
      code: 'A/1',
      status: 'active',
      name_en: 'Filter',
      name_ar: '',
      brand_id: '',
      product_group: 'Filters',
      unit_of_measure: 'EA',
      unit_cost: '12.5',
      currency: 'SAR',
      introduced_on: '2026-01-01',
      discontinued_on: '',
    })
    expect(formValuesFromRow(brands.fields, { is_active: true }).is_active).toBe(true)
  })

  it('reads submitted form data and flattens it for re-filling', () => {
    const formData = new FormData()
    formData.set('code', ' TOY ')
    formData.set('is_active', 'on')
    const input = inputFromFormData(brands.fields, formData)
    expect(input).toEqual({
      code: 'TOY',
      brand_type: '',
      name_en: '',
      name_ar: '',
      country_of_origin: '',
      is_active: true,
    })
    expect(submittedValues({ ...input, days: ['5', '6'] })).toEqual({
      code: 'TOY',
      brand_type: '',
      name_en: '',
      name_ar: '',
      country_of_origin: '',
      is_active: 'on',
      days: '5,6',
    })
  })
})
