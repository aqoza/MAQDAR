import { describe, expect, it } from 'vitest'
import { IDLE_COMMIT_MS, detailOutcome, isIdleCommit } from './detail'

describe('detailOutcome', () => {
  const batch = { id: 'b' }
  const files = [{ file_no: 1 }]

  it('renders the import when both queries answered', () => {
    expect(detailOutcome({ data: batch, error: null }, { data: files, error: null })).toEqual({
      kind: 'ok',
      batch,
      files,
    })
  })

  it('is not found when the batch is not there', () => {
    expect(detailOutcome({ data: null, error: null }, { data: [], error: null })).toEqual({
      kind: 'not_found',
    })
  })

  it('reports a failed files query instead of an import without files or errors', () => {
    expect(
      detailOutcome({ data: batch, error: null }, { data: null, error: { message: 'timeout' } }),
    ).toEqual({ kind: 'failed' })
  })

  it('reports a failed batch query instead of answering not found', () => {
    expect(
      detailOutcome({ data: null, error: { message: 'timeout' } }, { data: files, error: null }),
    ).toEqual({ kind: 'failed' })
  })
})

describe('isIdleCommit', () => {
  const now = Date.parse('2026-10-13T12:00:00Z')

  it('is true for a committing import without a step for more than 30 minutes', () => {
    const last = new Date(now - IDLE_COMMIT_MS - 1_000).toISOString()
    expect(isIdleCommit('committing', last, now)).toBe(true)
  })

  it('is false for a recent step, another status or no step at all', () => {
    expect(isIdleCommit('committing', new Date(now - 60_000).toISOString(), now)).toBe(false)
    expect(isIdleCommit('failed', new Date(now - IDLE_COMMIT_MS * 2).toISOString(), now)).toBe(
      false,
    )
    expect(isIdleCommit('committing', null, now)).toBe(false)
    expect(isIdleCommit('committing', 'not a date', now)).toBe(false)
  })
})
