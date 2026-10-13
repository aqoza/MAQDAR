import { describe, expect, it } from 'vitest'
import { chunkBody } from './chunks'
import { autoMap, sourceIndexes } from './mapping'
import {
  createWorkerHandler,
  type ParseRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './parse'
import { ParseFailure, createImportParser } from './parse-client'

const HEADER = ['item_code', 'location_code', 'demand_date', 'quantity']

function demandFile(rows: number): File {
  const lines = [HEADER.join(',')]
  for (let row = 1; row <= rows; row += 1) lines.push(`P-${row},RUH-01,2024-01-05,${row}`)
  return new File([lines.join('\n')], 'demand_history.csv')
}

function demandRequest(maxRows: number): ParseRequest {
  return {
    entity: 'demand_history',
    sources: sourceIndexes('demand_history', autoMap('demand_history', HEADER)),
    normalize: { decimalSeparator: '.', dateOrder: 'YYYY-MM-DD', date1904: false },
    limits: { maxRows },
  }
}

type Listener = (event: { data: WorkerResponse; preventDefault?: () => void }) => void

/**
 * A worker double: messages cross a structured clone and arrive asynchronously, like a real
 * worker's, and the pipeline runs through the same handler parse.worker.ts uses.
 */
class FakeWorker {
  readonly sent: WorkerRequest[] = []
  terminated = false
  private readonly listeners = new Map<string, Listener[]>()
  private readonly handle = createWorkerHandler((message) => {
    const copy = structuredClone(message)
    setTimeout(() => this.emit('message', copy), 0)
  })

  constructor(private readonly behaviour: 'ok' | 'fails-to-load' = 'ok') {
    setTimeout(() => {
      if (behaviour === 'ok') this.emit('message', { type: 'ready' })
      else this.emit('error', undefined)
    }, 0)
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  postMessage(message: WorkerRequest) {
    if (this.terminated) return
    this.sent.push(message)
    if (this.behaviour === 'ok') void this.handle(message)
  }

  terminate() {
    this.terminated = true
  }

  private emit(type: string, data: WorkerResponse | undefined) {
    if (this.terminated) return
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: data as WorkerResponse, preventDefault: () => undefined })
    }
  }
}

describe('createImportParser on the main thread', () => {
  it('falls back when there is no Worker and still streams every chunk', async () => {
    const parser = createImportParser({ createWorker: null })
    expect(await parser.mode).toBe('main-thread')
    const file = demandFile(7)
    const inspected = await parser.inspect(file)
    expect(inspected.header).toEqual(HEADER)
    const stream = parser.parse(file, demandRequest(3))
    const ranges: number[][] = []
    for await (const event of stream) ranges.push([event.chunk.firstRow, event.chunk.lastRow])
    expect(ranges).toEqual([
      [1, 3],
      [4, 6],
      [7, 7],
    ])
    expect(await stream.summary).toMatchObject({ rowsTotal: 7 })
    parser.dispose()
  })

  it('turns pipeline failures into ParseFailure with the machine code', async () => {
    const parser = createImportParser({ createWorker: null })
    await expect(parser.inspect(new File([], 'empty.csv'))).rejects.toMatchObject({
      name: 'ParseFailure',
      code: 'empty_file',
    })
    const stream = parser.parse(new File(['x'], 'notes.pdf'), demandRequest(10))
    await expect(stream.next()).rejects.toBeInstanceOf(ParseFailure)
    await expect(stream.summary).rejects.toMatchObject({ code: 'unsupported_type' })
  })
})

describe('createImportParser with a worker', () => {
  it('reads one chunk ahead of the page and returns the summary', async () => {
    const worker = new FakeWorker()
    const parser = createImportParser({ createWorker: () => worker as unknown as Worker })
    expect(await parser.mode).toBe('worker')
    const stream = parser.parse(demandFile(10), demandRequest(2))
    const first = await stream.next()
    if (first.done) throw new Error('expected a chunk')
    expect(JSON.parse(chunkBody(first.value.chunk))[0]).toEqual([
      1,
      'P-1',
      'RUH-01',
      '2024-01-05',
      '1',
      null,
    ])
    // Taking chunk 1 asked for chunk 2 only.
    expect(worker.sent.map((message) => message.type)).toEqual(['parse', 'pull'])
    let next = await stream.next()
    const firstRows = [1]
    while (!next.done) {
      firstRows.push(next.value.chunk.firstRow)
      next = await stream.next()
    }
    expect(firstRows).toEqual([1, 3, 5, 7, 9])
    expect(next.value).toMatchObject({ rowsTotal: 10, trailingBlankRows: 0 })
    expect(worker.sent.filter((message) => message.type === 'pull')).toHaveLength(5)
    // A finished stream stays finished.
    expect((await stream.next()).done).toBe(true)
    parser.release()
    expect(worker.sent.at(-1)).toEqual({ type: 'release' })
  })

  it('cancels a parse when the page stops early', async () => {
    const worker = new FakeWorker()
    const parser = createImportParser({ createWorker: () => worker as unknown as Worker })
    const stream = parser.parse(demandFile(10), demandRequest(2))
    for await (const event of stream) {
      expect(event.chunk.firstRow).toBe(1)
      break
    }
    expect(worker.sent.at(-1)).toMatchObject({ type: 'cancel' })
    await expect(stream.summary).rejects.toBeInstanceOf(ParseFailure)
  })

  it('moves pending work to the main thread when the worker fails to load', async () => {
    const worker = new FakeWorker('fails-to-load')
    const parser = createImportParser({ createWorker: () => worker as unknown as Worker })
    const inspected = parser.inspect(demandFile(3))
    expect(await parser.mode).toBe('main-thread')
    expect(worker.terminated).toBe(true)
    expect((await inspected).header).toEqual(HEADER)
    const stream = parser.parse(demandFile(3), demandRequest(10))
    const first = await stream.next()
    expect(first.done ? null : first.value.chunk.lastRow).toBe(3)
  })

  it('falls back when creating the worker throws', async () => {
    const parser = createImportParser({
      createWorker: () => {
        throw new Error('module workers are not supported')
      },
    })
    expect(await parser.mode).toBe('main-thread')
  })

  it('fails pending calls when the parser is disposed', async () => {
    const worker = new FakeWorker()
    const parser = createImportParser({ createWorker: () => worker as unknown as Worker })
    await parser.mode
    const pending = parser.inspect(demandFile(1))
    parser.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'internal' })
    expect(worker.terminated).toBe(true)
  })
})
