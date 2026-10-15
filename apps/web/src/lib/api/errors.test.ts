import { describe, expect, it } from 'vitest'
import { CONTRACT } from '../imports/contract'
import {
  CONTRACT_ERROR_TEXT,
  POINTER_PATTERN,
  REQUEST_ERROR_CODES,
  REQUEST_ERROR_TEXT,
  contractErrorCodes,
  errorText,
  pointerForRow,
  pointerToken,
  recordPointer,
} from './errors'

describe('error texts', () => {
  it('has English text for every contract error and warning code, and nothing else', () => {
    const codes = CONTRACT.error_codes.map((entry) => entry.code).sort()
    expect(Object.keys(CONTRACT_ERROR_TEXT).sort()).toEqual(codes)
    for (const code of codes) expect(errorText(code)).toBe(CONTRACT_ERROR_TEXT[code])
  })

  it('has text for every request-shape code, none shared with the contract', () => {
    expect(Object.keys(REQUEST_ERROR_TEXT).sort()).toEqual([...REQUEST_ERROR_CODES].sort())
    for (const code of REQUEST_ERROR_CODES) {
      expect(Object.hasOwn(CONTRACT_ERROR_TEXT, code)).toBe(false)
      expect(errorText(code)).toBe(REQUEST_ERROR_TEXT[code])
    }
  })

  it('names the first record of a duplicate key and falls back for unknown codes', () => {
    expect(errorText('duplicate_key', 4)).toBe(
      'This key appears more than once in the request. First at record 4.',
    )
    expect(errorText('duplicate_key', null)).toBe(CONTRACT_ERROR_TEXT.duplicate_key)
    expect(errorText('nonexistent_code')).toBe('The value was refused.')
  })

  it('splits contract codes by level', () => {
    expect(contractErrorCodes('warning').sort()).toEqual(['source_missing', 'zero_row_new_key'])
    expect(contractErrorCodes('error')).toContain('unknown_reference')
    expect(contractErrorCodes('error')).not.toContain('zero_row_new_key')
  })

  it('never uses placeholders (the API answers plain English)', () => {
    for (const text of [
      ...Object.values(CONTRACT_ERROR_TEXT),
      ...Object.values(REQUEST_ERROR_TEXT),
    ]) {
      expect(text).not.toMatch(/\{[a-z_]+\}/)
    }
  })
})

describe('pointers', () => {
  it('builds record and field pointers', () => {
    expect(recordPointer(null)).toBe('#/records')
    expect(recordPointer(0)).toBe('#/records/0')
    expect(recordPointer(17, 'unit_cost')).toBe('#/records/17/unit_cost')
    expect(recordPointer(null, 'unit_cost')).toBe('#/records/unit_cost')
    expect(recordPointer(-1, null)).toBe('#/records')
  })

  it('mirrors app.api_error_result for row_no 0 and column ""', () => {
    expect(pointerForRow(0, '')).toBe('#/records')
    expect(pointerForRow(1, '')).toBe('#/records/0')
    expect(pointerForRow(18, 'unit_cost')).toBe('#/records/17/unit_cost')
    expect(pointerForRow(0, 'currency')).toBe('#/records/currency')
  })

  it('escapes reference tokens per RFC 6901 and percent-encodes for the fragment form', () => {
    expect(pointerToken('a/b~c')).toBe('a~1b~0c')
    expect(pointerToken('unit cost')).toBe('unit%20cost')
    expect(pointerToken('سعر')).toBe(encodeURIComponent('سعر'))
    expect(pointerToken('a"b#c')).toBe('a%22b%23c')
  })

  it('accepts only the pointer shapes the database produces', () => {
    for (const pointer of ['#', '#/records', '#/records/0', '#/records/12/unit_cost']) {
      expect(POINTER_PATTERN.test(pointer), pointer).toBe(true)
    }
    for (const pointer of ['#/records/01', '#/records/x y', '/records/1', '#/records/1/Bad']) {
      expect(POINTER_PATTERN.test(pointer), pointer).toBe(false)
    }
  })
})
