/**
 * The upload queue of the originals (the audit copies in Storage): at most `limit` uploads at a
 * time, in file order, each to its signed URL. Once `signal` is aborted (the user canceled the
 * import or started another one), queued uploads never start and no state is reported any more,
 * so a canceled import gets no late objects and a newer run is never relabelled by an older one.
 * Pure (no React, no fetch of its own): the upload itself is injected.
 */

export type OriginalState = 'pending' | 'uploading' | 'stored' | 'failed' | 'none'

export type OriginalTarget = {
  /** The wizard's id of the file (for state reports). */
  id: string
  fileNo: number
  /** Signed upload URL, or null when the server could not sign one. */
  uploadUrl: string | null
  /** The server says the original is already stored (a retried create). */
  exists: boolean
  /** Whether the file has an extension Storage accepts (else nothing is uploaded). */
  uploadable: boolean
}

export type QueueOriginalsOptions = {
  targets: readonly OriginalTarget[]
  /** Uploads one original; resolves true when Storage accepted it. */
  upload: (target: OriginalTarget & { uploadUrl: string }) => Promise<boolean>
  /** Called with each state change, never after `signal` is aborted. */
  onState: (id: string, state: OriginalState) => void
  signal: AbortSignal
  /** Uploads at the same time. */
  limit: number
}

/** Starts the queue; returns, per file number, whether its original ended up stored. */
export function queueOriginals({
  targets,
  upload,
  onState,
  signal,
  limit,
}: QueueOriginalsOptions): Map<number, Promise<boolean>> {
  const results = new Map<number, Promise<boolean>>()
  const report = (id: string, state: OriginalState) => {
    if (!signal.aborted) onState(id, state)
  }
  let active = 0
  const waiting: (() => void)[] = []
  const slot = () =>
    new Promise<void>((resolve) => {
      if (active < limit) {
        active += 1
        resolve()
      } else {
        waiting.push(() => {
          active += 1
          resolve()
        })
      }
    })
  const release = () => {
    active -= 1
    waiting.shift()?.()
  }

  for (const target of targets) {
    if (!target.uploadUrl || !target.uploadable) {
      report(target.id, target.exists ? 'stored' : 'none')
      results.set(target.fileNo, Promise.resolve(target.exists))
      continue
    }
    const uploadUrl = target.uploadUrl
    results.set(
      target.fileNo,
      slot().then(async () => {
        try {
          // Canceled while waiting for a slot: never start this upload.
          if (signal.aborted) return false
          report(target.id, 'uploading')
          const stored = await upload({ ...target, uploadUrl })
          report(target.id, stored ? 'stored' : 'failed')
          return stored
        } catch {
          return false
        } finally {
          release()
        }
      }),
    )
  }
  return results
}
