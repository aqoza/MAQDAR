import { describe, expect, it } from 'vitest'
import { deleteImportInOrder, type DeleteSteps } from './delete'

type Err = { code: string; hint?: string }

/** Steps that record their calls; `drains` lists the `done` answers of import_cancel_step. */
function steps(options: {
  drains?: boolean[]
  removeError?: Err
  deleteError?: Err
  drainError?: Err
}) {
  const calls: string[] = []
  const drains = [...(options.drains ?? [true])]
  const fake: DeleteSteps<Err> = {
    drain: async () => {
      calls.push('drain')
      if (options.drainError) return { error: options.drainError }
      return { done: drains.shift() ?? true }
    },
    listPaths: async () => {
      calls.push('list')
      return { paths: ['org/batch/1.csv', 'org/batch/2.xlsx'] }
    },
    removeOriginals: async (paths) => {
      calls.push(`remove:${paths.length}`)
      return { error: options.removeError ?? null }
    },
    deleteBatch: async () => {
      calls.push('delete')
      return { error: options.deleteError ?? null }
    },
  }
  return { calls, fake }
}

describe('deleteImportInOrder', () => {
  it('drains an expired import before touching Storage, then deletes it', async () => {
    const { calls, fake } = steps({ drains: [false, false, true] })
    expect(await deleteImportInOrder('expired', fake)).toEqual({ ok: true })
    expect(calls).toEqual(['drain', 'drain', 'drain', 'list', 'remove:2', 'delete'])
  })

  it('keeps the originals when staging cannot be drained (nothing is deleted)', async () => {
    const { calls, fake } = steps({ drains: [false, false, false] })
    expect(await deleteImportInOrder('canceled', fake, 3)).toEqual({
      ok: false,
      step: 'cleanup',
      error: null,
    })
    expect(calls).toEqual(['drain', 'drain', 'drain'])
  })

  it('stops at a failing drain call', async () => {
    const { calls, fake } = steps({ drainError: { code: 'MQ409', hint: 'status' } })
    expect(await deleteImportInOrder('canceled', fake)).toMatchObject({
      ok: false,
      step: 'cleanup',
    })
    expect(calls).toEqual(['drain'])
  })

  it('does not drain a succeeded import (its commit already did)', async () => {
    const { calls, fake } = steps({})
    expect(await deleteImportInOrder('succeeded', fake)).toEqual({ ok: true })
    expect(calls).toEqual(['list', 'remove:2', 'delete'])
  })

  it('deletes nothing when the originals cannot be removed', async () => {
    const { calls, fake } = steps({ removeError: { code: 'storage' } })
    expect(await deleteImportInOrder('succeeded', fake)).toMatchObject({
      ok: false,
      step: 'storage',
    })
    expect(calls).not.toContain('delete')
  })

  it('passes an open import straight to import_delete for its refusal', async () => {
    const { calls, fake } = steps({ deleteError: { code: 'MQ409', hint: 'status' } })
    expect(await deleteImportInOrder('validated', fake)).toEqual({
      ok: false,
      step: 'delete',
      error: { code: 'MQ409', hint: 'status' },
    })
    expect(calls).toEqual(['delete'])
  })
})
