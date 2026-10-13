import { describe, expect, it } from 'vitest'
import ar from '../../../messages/ar.json'
import en from '../../../messages/en.json'
import { EXPLAINED_HINTS, IMPORT_STATUSES } from '../../lib/imports/client'
import { CONTRACT, ENTITY_NAMES, columnLabels } from '../../lib/imports/contract'
import { FAILURE_CODES } from './types'

// The import UI translates machine codes from the database and the contract; every code needs
// an English message (Arabic falls back to English key by key).
describe('import messages', () => {
  it('have one argument-free ImportErrors message per stable error code', () => {
    const codes = CONTRACT.error_codes.map((entry) => entry.code).sort()
    expect(Object.keys(en.ImportErrors).sort()).toEqual(codes)
    for (const [code, message] of Object.entries(en.ImportErrors)) {
      expect(message, code).not.toMatch(/\{/)
    }
    for (const code of Object.keys(ar.ImportErrors)) expect(codes).toContain(code)
  })

  it('name every entity, status and commit failure', () => {
    expect(Object.keys(en.ImportsClient.entities).sort()).toEqual([...ENTITY_NAMES].sort())
    expect(Object.keys(en.ImportsClient.status).sort()).toEqual([...IMPORT_STATUSES].sort())
    expect(Object.keys(en.ImportsClient.failure).sort()).toEqual([...FAILURE_CODES].sort())
  })

  it('explain every hint the client recognizes', () => {
    for (const hint of EXPLAINED_HINTS) {
      expect(Object.keys(en.ImportsClient.apiErrors), hint).toContain(hint)
    }
  })

  it('label every contract column in English and Arabic', () => {
    for (const entity of ENTITY_NAMES) {
      for (const [column, labels] of Object.entries(columnLabels(entity, en))) {
        expect(labels.length, `${entity}.${column} (en)`).toBeGreaterThan(0)
      }
      for (const [column, labels] of Object.entries(columnLabels(entity, ar))) {
        expect(labels.length, `${entity}.${column} (ar)`).toBeGreaterThan(0)
      }
    }
  })

  it('add the navigation entry and the import RpcErrors in both languages', () => {
    expect(en.Nav.imports).toBe('Imports')
    expect(ar.Nav.imports).not.toBe('')
    for (const key of ['busy', 'timeout', 'importInProgress'] as const) {
      expect(en.RpcErrors[key]).not.toBe('')
      expect(ar.RpcErrors[key]).not.toBe('')
    }
  })
})
