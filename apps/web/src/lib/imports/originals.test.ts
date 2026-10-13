import { describe, expect, it } from 'vitest'
import { queueOriginals, type OriginalState, type OriginalTarget } from './originals'

const target = (fileNo: number, patch: Partial<OriginalTarget> = {}): OriginalTarget => ({
  id: `f${fileNo}`,
  fileNo,
  uploadUrl: `https://storage.test/upload/${fileNo}`,
  exists: false,
  uploadable: true,
  ...patch,
})

/** An upload whose completion the test controls. */
function controlledUploads() {
  const started: number[] = []
  const finish = new Map<number, (stored: boolean) => void>()
  const upload = (entry: OriginalTarget) =>
    new Promise<boolean>((resolve) => {
      started.push(entry.fileNo)
      finish.set(entry.fileNo, resolve)
    })
  return { started, finish, upload }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('queueOriginals', () => {
  it('uploads at most `limit` originals at a time, in file order', async () => {
    const { started, finish, upload } = controlledUploads()
    const states: [string, OriginalState][] = []
    const results = queueOriginals({
      targets: [target(1), target(2), target(3)],
      upload,
      onState: (id, state) => states.push([id, state]),
      signal: new AbortController().signal,
      limit: 2,
    })
    await tick()
    expect(started).toEqual([1, 2])
    finish.get(1)?.(true)
    await tick()
    expect(started).toEqual([1, 2, 3])
    finish.get(2)?.(false)
    finish.get(3)?.(true)
    expect(await results.get(1)).toBe(true)
    expect(await results.get(2)).toBe(false)
    expect(await results.get(3)).toBe(true)
    expect(states).toContainEqual(['f2', 'failed'])
    expect(states.at(-1)).toEqual(['f3', 'stored'])
  })

  it('reports files without a URL as stored (already there) or not uploaded', async () => {
    const states: [string, OriginalState][] = []
    const results = queueOriginals({
      targets: [target(1, { uploadUrl: null, exists: true }), target(2, { uploadable: false })],
      upload: async () => true,
      onState: (id, state) => states.push([id, state]),
      signal: new AbortController().signal,
      limit: 2,
    })
    expect(await results.get(1)).toBe(true)
    expect(await results.get(2)).toBe(false)
    expect(states).toEqual([
      ['f1', 'stored'],
      ['f2', 'none'],
    ])
  })

  it('never starts queued uploads and reports nothing more once aborted', async () => {
    const { started, finish, upload } = controlledUploads()
    const controller = new AbortController()
    const states: [string, OriginalState][] = []
    const results = queueOriginals({
      targets: [target(1), target(2), target(3)],
      upload,
      onState: (id, state) => states.push([id, state]),
      signal: controller.signal,
      limit: 1,
    })
    await tick()
    expect(started).toEqual([1])
    // The user cancels the import while file 1 uploads and files 2 and 3 wait.
    controller.abort()
    const reported = states.length
    finish.get(1)?.(true)
    expect(await results.get(1)).toBe(true)
    expect(await results.get(2)).toBe(false)
    expect(await results.get(3)).toBe(false)
    expect(started).toEqual([1])
    expect(states).toHaveLength(reported)
  })
})
