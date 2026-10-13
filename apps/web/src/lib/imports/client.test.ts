import { describe, expect, it, vi } from 'vitest'
import { ChunkBuilder, type Chunk } from './chunks'
import {
  ImportApiError,
  apiErrorKey,
  backoffMs,
  commitFraction,
  contentTypeFor,
  createImportClient,
  extensionOf,
  isBusyError,
  isSteppedCommit,
  isTimeoutError,
  type BatchState,
  type CommitResult,
  type FileManifest,
} from './client'

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

type Responder = (call: Call) => Response | Promise<Response>

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** A fetch that answers from a queue of responders and records every call. */
function mockFetch(...responders: Responder[]) {
  const calls: Call[] = []
  const queue = [...responders]
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    }
    calls.push(call)
    const next = queue.shift()
    if (!next) throw new Error(`Unexpected request ${call.method} ${call.url}`)
    return next(call)
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

function client(fetch: typeof globalThis.fetch, sleeps: number[] = []) {
  return createImportClient({
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    random: () => 0.5,
  })
}

const BATCH = '0b6f8c5e-1d1a-4c55-9a2a-8f0f4d1a2b3c'

function batchState(patch: Partial<BatchState> = {}): BatchState {
  return {
    batch_id: BATCH,
    status: 'staging',
    commit_mode: null,
    rows_total: 10,
    rows_staged: 0,
    error_count: 0,
    warning_count: 0,
    failure_code: null,
    failure_detail: null,
    validated_at: null,
    commit_started_at: null,
    last_step_at: null,
    finished_at: null,
    expires_at: null,
    ...patch,
  }
}

function chunkOf(firstRow: number, count: number, cell = 'P'): Chunk {
  const builder = new ChunkBuilder(
    2,
    { maxRows: 100_000, maxBytes: 1_000_000 },
    { startRow: firstRow },
  )
  for (let row = firstRow; row < firstRow + count; row += 1)
    builder.add(row, [`${cell}-${row}`, ''])
  return builder.flush() as Chunk
}

/** A stage answer echoing the rows of the request. */
function staged(call: Call): Response {
  const rows = JSON.parse((call.body as { rows: string }).rows) as unknown[][]
  const first = rows[0]?.[0] as number
  const last = rows.at(-1)?.[0] as number
  return json(200, {
    file_no: 1,
    first_row: first,
    last_row: last,
    rows: rows.length,
    staged: rows.length,
    duplicates: 0,
    errors_added: 0,
    warnings_added: 0,
    replayed: false,
    file: { file_no: 1, rows_staged: last },
    batch: batchState({ rows_staged: last }),
  })
}

const MANIFEST: FileManifest = {
  file_no: 1,
  entity: 'items',
  original_name: 'items.csv',
  extension: 'csv',
  content_type: 'text/csv',
  size_bytes: 120,
  sha256: 'a'.repeat(64),
  rows_total: 2,
  columns: ['item_code', 'name_en'],
}

describe('createImport', () => {
  it('posts the manifest as JSON and returns the create result', async () => {
    const { fetch, calls } = mockFetch(() =>
      json(200, { ...batchState(), files: [{ file_no: 1, entity: 'items', storage_path: 'x' }] }),
    )
    const result = await client(fetch).createImport({
      batchId: BATCH,
      organizationId: 'org',
      files: [MANIFEST],
    })
    expect(result.files[0]?.storage_path).toBe('x')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: '/api/imports',
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: { batch_id: BATCH, organization_id: 'org', files: [MANIFEST] },
    })
  })

  it('retries a network failure with the same batch id (creation is idempotent)', async () => {
    const sleeps: number[] = []
    const { fetch, calls } = mockFetch(
      () => {
        throw new TypeError('Failed to fetch')
      },
      () => json(200, { ...batchState(), files: [] }),
    )
    await client(fetch, sleeps).createImport({ batchId: BATCH, organizationId: 'o', files: [] })
    expect(calls).toHaveLength(2)
    expect((calls[1]?.body as { batch_id: string }).batch_id).toBe(BATCH)
    expect(sleeps).toHaveLength(1)
  })

  it('treats a followed redirect (the sign-in page) as an expired session', async () => {
    const { fetch, calls } = mockFetch(() => {
      const page = new Response('<html>login</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
      Object.defineProperty(page, 'redirected', { value: true })
      return page
    })
    const error = await client(fetch)
      .createImport({ batchId: BATCH, organizationId: 'o', files: [] })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 401, code: 'MQ401' })
    expect(apiErrorKey(error)).toBe('session')
    expect(calls).toHaveLength(1)
  })

  it('throws the machine code, hint and message of a refusal', async () => {
    const { fetch } = mockFetch(() =>
      json(409, { code: 'MQ409', hint: 'open_batches', message: 'finish an open import first' }),
    )
    const error = await client(fetch)
      .createImport({ batchId: BATCH, organizationId: 'o', files: [] })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ImportApiError)
    expect(error).toMatchObject({
      status: 409,
      code: 'MQ409',
      hint: 'open_batches',
      message: 'finish an open import first',
    })
    expect(apiErrorKey(error)).toBe('open_batches')
  })
})

describe('stageChunk', () => {
  it('PUTs the chunk body as a JSON string to …/chunks/{firstRow}', async () => {
    const { fetch, calls } = mockFetch(staged)
    const chunk = chunkOf(1, 3)
    const { results } = await client(fetch).stageChunk(BATCH, 2, chunk)
    expect(results).toHaveLength(1)
    expect(calls[0]?.url).toBe(`/api/imports/${BATCH}/files/2/chunks/1`)
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.headers['content-type']).toBe('application/json')
    expect(JSON.parse((calls[0]?.body as { rows: string }).rows)).toEqual([
      [1, 'P-1', ''],
      [2, 'P-2', ''],
      [3, 'P-3', ''],
    ])
  })

  it('halves a chunk that timed out and sends both halves in order', async () => {
    const sleeps: number[] = []
    const { fetch, calls } = mockFetch(
      () => json(503, { code: 'timeout' }, { 'retry-after': '5' }),
      staged,
      staged,
    )
    const seen: number[] = []
    const { results, maxRows } = await client(fetch, sleeps).stageChunk(
      BATCH,
      1,
      chunkOf(1, 10),
      (result) => seen.push(result.first_row),
    )
    expect(calls.map((call) => call.url.split('/').at(-1))).toEqual(['1', '1', '6'])
    expect(results.map((result) => [result.first_row, result.last_row])).toEqual([
      [1, 5],
      [6, 10],
    ])
    expect(seen).toEqual([1, 6])
    expect(maxRows).toBe(5)
    expect(sleeps).toEqual([])
  })

  it('gives up on a single row that still times out', async () => {
    const { fetch } = mockFetch(() => json(503, { code: 'timeout' }))
    const error = await client(fetch)
      .stageChunk(BATCH, 1, chunkOf(7, 1))
      .catch((caught: unknown) => caught)
    expect(isTimeoutError(error)).toBe(true)
  })

  it('splits a chunk over the text or envelope cap before sending', async () => {
    // Built with a looser byte cap: 1.9 MB of escaped quotes, ~3.9 MB once enveloped.
    const builder = new ChunkBuilder(2, { maxRows: 1_000, maxBytes: 3_000_000 })
    for (let row = 1; row <= 240; row += 1) builder.add(row, ['"'.repeat(3_900), ''])
    const chunk = builder.flush() as Chunk
    expect(chunk.bytes).toBeGreaterThan(1_000_000)
    const { fetch, calls } = mockFetch(...Array<Responder>(8).fill(staged))
    const { results } = await client(fetch).stageChunk(BATCH, 1, chunk)
    expect(calls.length).toBeGreaterThan(1)
    expect(results.map((result) => result.first_row)).toEqual(
      results.map((_, index) => (index === 0 ? 1 : (results[index - 1]?.last_row ?? 0) + 1)),
    )
    expect(results.at(-1)?.last_row).toBe(240)
    for (const call of calls) {
      const text = (call.body as { rows: string }).rows
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(1_000_000)
      expect(new TextEncoder().encode(JSON.stringify(call.body)).length).toBeLessThanOrEqual(
        2_048_000,
      )
    }
  })

  it('backs off with jitter between 1 and 10 s while the organization is busy', async () => {
    const sleeps: number[] = []
    const { fetch, calls } = mockFetch(
      () => json(409, { code: 'busy' }),
      () => json(409, { code: 'MQ409', hint: 'import_in_progress' }),
      staged,
    )
    await client(fetch, sleeps).stageChunk(BATCH, 1, chunkOf(1, 2))
    expect(calls).toHaveLength(3)
    expect(sleeps).toHaveLength(2)
    for (const wait of sleeps) {
      expect(wait).toBeGreaterThanOrEqual(1_000)
      expect(wait).toBeLessThanOrEqual(10_000)
    }
  })

  it('does not retry other conflicts', async () => {
    const { fetch, calls } = mockFetch(() => json(409, { code: 'MQ409', hint: 'parent' }))
    const error = await client(fetch)
      .stageChunk(BATCH, 1, chunkOf(1, 2))
      .catch((caught: unknown) => caught)
    expect(calls).toHaveLength(1)
    expect(apiErrorKey(error)).toBe('parent')
  })
})

describe('stageFile', () => {
  it('sends later chunks in pieces of the size that worked after a timeout', async () => {
    const { fetch, calls } = mockFetch(
      () => json(503, { code: 'timeout' }),
      staged,
      staged,
      staged,
      staged,
    )
    async function* chunks() {
      yield { chunk: chunkOf(1, 4) }
      yield { chunk: chunkOf(5, 4) }
    }
    const through: number[] = []
    const last = await client(fetch).stageFile({
      batchId: BATCH,
      fileNo: 1,
      chunks: chunks(),
      onProgress: (progress) => through.push(progress.through),
    })
    expect(calls.map((call) => call.url.split('/').at(-1))).toEqual(['1', '1', '3', '5', '7'])
    expect(through).toEqual([2, 4, 6, 8])
    expect(last?.last_row).toBe(8)
  })
})

describe('sealFile', () => {
  it('posts rows_total', async () => {
    const { fetch, calls } = mockFetch(() => json(200, { file_no: 1, batch: batchState() }))
    await client(fetch).sealFile(BATCH, 1, 42)
    expect(calls[0]).toMatchObject({
      url: `/api/imports/${BATCH}/files/1/seal`,
      method: 'POST',
      body: { rows_total: 42 },
    })
  })
})

describe('uploadOriginal', () => {
  it('PUTs the file to the signed URL with its content type and the publishable key', async () => {
    const { fetch, calls } = mockFetch(() => new Response('{}', { status: 200 }))
    const file = new Blob(['a,b\n1,2\n'])
    const stored = await client(fetch).uploadOriginal(file, 'https://x.test/upload?token=t', {
      contentType: 'text/csv',
      apikey: 'pk',
    })
    expect(stored).toBe(true)
    expect(calls[0]).toMatchObject({
      url: 'https://x.test/upload?token=t',
      method: 'PUT',
      headers: { 'content-type': 'text/csv', apikey: 'pk' },
    })
    expect(calls[0]?.body).toBe(file)
  })

  it('reports a failed upload without throwing', async () => {
    const refused = mockFetch(() => new Response('denied', { status: 400 }))
    expect(
      await client(refused.fetch).uploadOriginal(new Blob(['x']), 'https://x.test/u', {
        contentType: 'text/csv',
      }),
    ).toBe(false)
    const offline = mockFetch(() => {
      throw new TypeError('CORS')
    })
    expect(
      await client(offline.fetch).uploadOriginal(new Blob(['x']), 'https://x.test/u', {
        contentType: 'text/csv',
      }),
    ).toBe(false)
  })
})

describe('commit', () => {
  const step = (status: number, patch: Partial<CommitResult>) => () =>
    json(status, {
      ...batchState({ status: 'committing', commit_mode: 'stepped' }),
      done: false,
      units: 1,
      ...patch,
    })

  it('repeats while the route answers 202 and returns the final state', async () => {
    const { fetch, calls } = mockFetch(
      step(202, { unit: 'prepare' }),
      step(202, { unit: 'merge:items:1:1-5000' }),
      step(200, { status: 'succeeded', done: true }),
    )
    const progress: string[] = []
    const result = await client(fetch).commit(BATCH, (state) =>
      progress.push(state.unit ?? state.status),
    )
    expect(result.status).toBe('succeeded')
    expect(progress).toEqual(['prepare', 'merge:items:1:1-5000', 'succeeded'])
    expect(calls.every((call) => call.url === `/api/imports/${BATCH}/commit`)).toBe(true)
    expect(calls[0]?.body).toEqual({})
  })

  it('halves max_rows after each timeout of a stepped commit', async () => {
    const sleeps: number[] = []
    const { fetch, calls } = mockFetch(
      () => json(503, { code: 'timeout' }, { 'retry-after': '5' }),
      () => json(503, { code: 'timeout' }),
      step(200, { status: 'succeeded', done: true }),
    )
    await client(fetch, sleeps).commit(BATCH, undefined, { rows_staged: 6_000, commit_mode: null })
    expect(calls.map((call) => call.body)).toEqual([{}, { max_rows: 5_000 }, { max_rows: 2_500 }])
    expect(sleeps).toEqual([5_000, 1_000])
  })

  it('keeps halving once the server reported a stepped commit', async () => {
    const { fetch, calls } = mockFetch(
      step(202, { unit: 'prepare' }),
      () => json(503, { code: 'timeout' }),
      step(200, { status: 'succeeded', done: true }),
    )
    await client(fetch).commit(BATCH, undefined, { rows_staged: 10, commit_mode: null })
    expect(calls.map((call) => call.body)).toEqual([{}, {}, { max_rows: 5_000 }])
  })

  it('retries an all-at-once commit that timed out once, without max_rows, then reports it', async () => {
    const sleeps: number[] = []
    const { fetch, calls } = mockFetch(
      () => json(503, { code: 'timeout' }, { 'retry-after': '5' }),
      () => json(503, { code: 'timeout' }, { 'retry-after': '5' }),
    )
    await expect(
      client(fetch, sleeps).commit(BATCH, undefined, { rows_staged: 4_000, commit_mode: null }),
    ).rejects.toMatchObject({ status: 503 })
    expect(calls.map((call) => call.body)).toEqual([{}, {}])
    expect(sleeps).toEqual([5_000])
  })

  it('recovers when the retry of an all-at-once commit succeeds', async () => {
    const { fetch, calls } = mockFetch(
      () => json(503, { code: 'timeout' }),
      step(200, { status: 'succeeded', commit_mode: 'atomic', done: true }),
    )
    const result = await client(fetch).commit(BATCH, undefined, { rows_staged: 5_000 })
    expect(result.status).toBe('succeeded')
    expect(calls.map((call) => call.body)).toEqual([{}, {}])
  })

  it('stops on a failed commit (done with status failed)', async () => {
    const { fetch } = mockFetch(
      step(200, { status: 'failed', done: true, failure_code: 'changed_during_commit' }),
    )
    const result = await client(fetch).commit(BATCH)
    expect(result).toMatchObject({ status: 'failed', failure_code: 'changed_during_commit' })
  })

  it('backs off while another writer holds the lock', async () => {
    const sleeps: number[] = []
    const { fetch } = mockFetch(
      () => json(409, { code: 'MQ409', hint: 'import_in_progress' }),
      step(200, { status: 'succeeded', done: true }),
    )
    await client(fetch, sleeps).commit(BATCH)
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBeGreaterThanOrEqual(1_000)
  })

  it('throws refusals such as unresolved errors', async () => {
    const { fetch } = mockFetch(() => json(409, { code: 'MQ409', hint: 'errors' }))
    await expect(client(fetch).commit(BATCH)).rejects.toMatchObject({ hint: 'errors' })
  })
})

describe('resume, cancel and delete', () => {
  it('resumes with a POST', async () => {
    const { fetch, calls } = mockFetch(() => json(200, batchState({ status: 'committing' })))
    expect((await client(fetch).resume(BATCH)).status).toBe('committing')
    expect(calls[0]).toMatchObject({ url: `/api/imports/${BATCH}/resume`, method: 'POST' })
  })

  it('repeats cancel until staging is cleared', async () => {
    const canceled = (done: boolean) => () =>
      json(200, { ...batchState({ status: 'canceled' }), done })
    const { fetch, calls } = mockFetch(canceled(false), canceled(false), canceled(true))
    const rounds: boolean[] = []
    const result = await client(fetch).cancel(BATCH, (state) => rounds.push(state.done))
    expect(result.done).toBe(true)
    expect(rounds).toEqual([false, false, true])
    expect(calls).toHaveLength(3)
  })

  it('reads the current state of the batch and its files with a GET', async () => {
    const file = {
      file_no: 1,
      entity: 'items',
      error_count: 2,
      warning_count: 0,
      errors_stored: 2,
      error_counts: { unknown_reference: { brand_code: 2 } },
    }
    const { fetch, calls } = mockFetch(() =>
      json(200, { batch: batchState({ status: 'invalid' }), files: [file] }),
    )
    const result = await client(fetch).getImport(BATCH)
    expect(result.files[0]).toMatchObject(file)
    expect(calls[0]).toMatchObject({ url: `/api/imports/${BATCH}`, method: 'GET' })
  })

  it('deletes with a JSON DELETE', async () => {
    const { fetch, calls } = mockFetch(() => new Response(null, { status: 204 }))
    await client(fetch).deleteImport(BATCH)
    expect(calls[0]).toMatchObject({
      url: `/api/imports/${BATCH}`,
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    })
  })
})

describe('error classification', () => {
  it('maps statuses, codes and hints to message keys', () => {
    expect(apiErrorKey(new ImportApiError(0, 'network', null, 'x'))).toBe('network')
    expect(apiErrorKey(new ImportApiError(503, 'timeout', null, 'x'))).toBe('timeout')
    expect(apiErrorKey(new ImportApiError(409, 'busy', null, 'x'))).toBe('busy')
    expect(apiErrorKey(new ImportApiError(409, 'MQ409', 'another_commit', 'x'))).toBe(
      'another_commit',
    )
    expect(apiErrorKey(new ImportApiError(401, 'MQ401', null, 'x'))).toBe('session')
    expect(apiErrorKey(new ImportApiError(403, 'MQ403', 'role', 'x'))).toBe('forbidden')
    expect(apiErrorKey(new ImportApiError(404, 'MQ404', 'organization_id', 'x'))).toBe(
      'stale_organization',
    )
    expect(apiErrorKey(new ImportApiError(404, 'MQ404', 'batch_id', 'x'))).toBe('not_found')
    expect(apiErrorKey(new ImportApiError(413, 'too_large', null, 'x'))).toBe('too_large')
    expect(apiErrorKey(new ImportApiError(422, 'MQ422', 'size_bytes', 'x'))).toBe('generic')
    expect(apiErrorKey(new Error('x'))).toBe('generic')
  })

  it('tells busy and timeout answers apart', () => {
    expect(isBusyError(new ImportApiError(409, 'busy', null, 'x'))).toBe(true)
    expect(isBusyError(new ImportApiError(409, 'MQ409', 'import_in_progress', 'x'))).toBe(true)
    expect(isBusyError(new ImportApiError(409, 'MQ409', 'status', 'x'))).toBe(false)
    expect(isTimeoutError(new ImportApiError(503, 'timeout', null, 'x'))).toBe(true)
    expect(isTimeoutError(new ImportApiError(500, 'generic', null, 'x'))).toBe(false)
  })

  it('keeps the back-off between 1 and 10 seconds', () => {
    expect(backoffMs(0, () => 1)).toBe(1_000)
    expect(backoffMs(3, () => 1)).toBe(8_000)
    expect(backoffMs(10, () => 1)).toBe(10_000)
    expect(backoffMs(10, () => 0)).toBe(1_000)
  })
})

describe('helpers', () => {
  it('tells stepped commits from all-at-once commits', () => {
    expect(isSteppedCommit({ commit_mode: 'stepped', rows_staged: 10 })).toBe(true)
    expect(isSteppedCommit({ commit_mode: 'atomic', rows_staged: 9_000 })).toBe(false)
    expect(isSteppedCommit({ commit_mode: null, rows_staged: 5_000 })).toBe(false)
    expect(isSteppedCommit({ commit_mode: null, rows_staged: 5_001 })).toBe(true)
    expect(isSteppedCommit({ status: 'failed' })).toBe(true)
    expect(isSteppedCommit(null)).toBe(true)
  })

  it('derives the extension and the Storage content type', () => {
    expect(extensionOf('Items.CSV')).toBe('csv')
    expect(extensionOf('demand.tsv')).toBe('tsv')
    expect(extensionOf('book.xlsx')).toBe('xlsx')
    expect(extensionOf('book.xls')).toBeNull()
    expect(contentTypeFor('xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(contentTypeFor('txt')).toBe('text/plain')
  })

  it('computes commit progress from the last unit, in load order', () => {
    const files = [
      { file_no: 2, entity: 'items' as const, rows_total: 6_000 },
      { file_no: 1, entity: 'brands' as const, rows_total: 1_000 },
      { file_no: 3, entity: 'supplier_items' as const, rows_total: 3_000 },
    ]
    const at = (unit: string | null, progress: BatchState['progress'] = { phase: 'merge' }) =>
      commitFraction(files, { status: 'committing', progress, unit })
    expect(at('prepare')).toBe(0)
    expect(at('merge:brands:1:1-1000')).toBeCloseTo(0.1)
    expect(at('stats:brands')).toBeCloseTo(0.1)
    expect(at('merge:items:2:1-5000')).toBeCloseTo(0.6)
    expect(at('merge:supplier_items:3:1-3000')).toBe(1)
    expect(at(null, { phase: 'merge', file_no: 2, pass: 1, through_row: 3_000 })).toBeCloseTo(0.4)
    expect(at('cleanup', { phase: 'cleanup' })).toBe(1)
    expect(commitFraction(files, { status: 'succeeded' })).toBe(1)
  })
})
