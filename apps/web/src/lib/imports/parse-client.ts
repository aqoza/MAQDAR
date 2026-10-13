import type {
  ChunkEvent,
  FileLike,
  InspectOptions,
  InspectResult,
  ParseErrorPayload,
  ParseRequest,
  ParseSummary,
  WorkerRequest,
  WorkerResponse,
} from './parse'

/**
 * The page's handle on the parse pipeline. It starts `parse.worker.ts` as a module worker and,
 * when module workers are unavailable or the worker fails to start, runs the same pipeline on the
 * main thread in slices that yield to the event loop: one interface either way. Chunks are pulled:
 * the worker reads one chunk ahead of the page, so memory stays at about two chunks whatever the
 * file size. Browser-only at call time (import it from client components).
 */

/** A failed inspect or parse, with the machine code the UI translates. */
export class ParseFailure extends Error {
  constructor(
    readonly code: ParseErrorPayload['code'],
    message: string,
    readonly detail?: Record<string, string | number>,
  ) {
    super(message)
    this.name = 'ParseFailure'
  }
}

/** Chunks of one file. `next()` resolves with the summary (done) after the last chunk. */
export interface ChunkStream extends AsyncIterableIterator<ChunkEvent, ParseSummary | undefined> {
  next(): Promise<IteratorResult<ChunkEvent, ParseSummary>>
  /** Resolves with the summary once the file is read to the end. */
  readonly summary: Promise<ParseSummary>
  /** Stops reading (also what `break` in a `for await` does). */
  cancel(): Promise<void>
}

export interface ImportParser {
  /** Where parsing runs; settles once the worker started or the fallback took over. */
  readonly mode: Promise<'worker' | 'main-thread'>
  inspect(file: FileLike, options?: InspectOptions): Promise<InspectResult>
  parse(file: FileLike, request: ParseRequest): ChunkStream
  /** Drops the cached workbook (after a file is staged or removed). */
  release(): void
  /** Stops the worker; pending calls fail. */
  dispose(): void
}

type Transport = { send(message: WorkerRequest): void; close(): void }

type Item =
  | { type: 'chunk'; event: ChunkEvent }
  | { type: 'done'; summary: ParseSummary }
  | { type: 'failed'; error: ParseErrorPayload }

const failure = (error: ParseErrorPayload) =>
  new ParseFailure(error.code, error.message, error.detail)

class PulledStream implements ChunkStream {
  private readonly items: Item[] = []
  private waiter: ((item: Item) => void) | null = null
  private requested = 1
  private received = 0
  private finished = false
  readonly summary: Promise<ParseSummary>
  private settle!: { resolve: (summary: ParseSummary) => void; reject: (error: unknown) => void }

  constructor(
    private readonly pull: () => void,
    private readonly stop: () => void,
  ) {
    this.summary = new Promise<ParseSummary>((resolve, reject) => {
      this.settle = { resolve, reject }
    })
    // Nobody may await the summary; do not report its rejection as unhandled.
    this.summary.catch(() => undefined)
  }

  /** The 'parse' request asked for the first chunk again (after a fallback). */
  restart(): void {
    this.requested = this.received + 1
  }

  receive(item: Item): void {
    if (this.finished) return
    if (item.type === 'chunk') this.received += 1
    else {
      this.finished = true
      if (item.type === 'done') this.settle.resolve(item.summary)
      else this.settle.reject(failure(item.error))
    }
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter(item)
    } else {
      this.items.push(item)
    }
  }

  async next(): Promise<IteratorResult<ChunkEvent, ParseSummary>> {
    const item =
      this.items.shift() ??
      (await new Promise<Item>((resolve) => {
        this.waiter = resolve
      }))
    if (item.type === 'chunk') {
      // Read one chunk ahead while the page uploads this one.
      if (!this.finished && this.requested === this.received) {
        this.requested += 1
        this.pull()
      }
      return { value: item.event, done: false }
    }
    if (item.type === 'done') {
      this.items.unshift(item)
      return { value: item.summary, done: true }
    }
    this.items.unshift(item)
    throw failure(item.error)
  }

  async cancel(): Promise<void> {
    if (this.finished) return
    this.finished = true
    this.stop()
    this.settle.reject(new ParseFailure('internal', 'Parsing was cancelled'))
    this.waiter?.({ type: 'failed', error: { code: 'internal', message: 'Parsing was cancelled' } })
    this.waiter = null
  }

  async return(): Promise<IteratorResult<ChunkEvent, undefined>> {
    await this.cancel()
    return { value: undefined, done: true }
  }

  [Symbol.asyncIterator](): this {
    return this
  }
}

type Pending =
  | {
      kind: 'inspect'
      message: WorkerRequest
      resolve: (result: InspectResult) => void
      reject: (error: unknown) => void
    }
  | { kind: 'parse'; message: WorkerRequest; stream: PulledStream }

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Runs the pipeline in this thread, delivering messages asynchronously like a worker would. */
export function createInProcessTransport(onMessage: (message: WorkerResponse) => void): Transport {
  const handler = import('./parse').then(({ createWorkerHandler }) =>
    createWorkerHandler(onMessage, { pause: yieldToEventLoop }),
  )
  return {
    send(message) {
      void handler.then((handle) => handle(message))
    },
    close() {},
  }
}

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>

const WORKER_START_TIMEOUT_MS = 20_000

/**
 * Creates the parser. `createWorker` is for tests; by default the bundled module worker is used
 * when the browser has `Worker`.
 */
export function createImportParser(
  options: { createWorker?: (() => WorkerLike) | null } = {},
): ImportParser {
  let nextId = 1
  const pending = new Map<number, Pending>()
  let transport: Transport
  let ready = false
  let resolveMode!: (mode: 'worker' | 'main-thread') => void
  const mode = new Promise<'worker' | 'main-thread'>((resolve) => {
    resolveMode = resolve
  })

  const dispatch = (message: WorkerResponse) => {
    if (message.type === 'ready') return
    const entry = pending.get(message.id)
    if (!entry) return
    if (entry.kind === 'inspect') {
      pending.delete(message.id)
      if (message.type === 'inspected') entry.resolve(message.result)
      else if (message.type === 'failed') entry.reject(failure(message.error))
      return
    }
    if (message.type === 'chunk') entry.stream.receive({ type: 'chunk', event: message.event })
    else if (message.type === 'done' || message.type === 'failed') {
      pending.delete(message.id)
      entry.stream.receive(
        message.type === 'done'
          ? { type: 'done', summary: message.summary }
          : { type: 'failed', error: message.error },
      )
    }
  }

  const failAll = (reason: string) => {
    for (const [id, entry] of pending) {
      pending.delete(id)
      const error = { code: 'internal' as const, message: reason }
      if (entry.kind === 'inspect') entry.reject(failure(error))
      else entry.stream.receive({ type: 'failed', error })
    }
  }

  const fallBack = () => {
    transport = createInProcessTransport(dispatch)
    ready = true
    resolveMode('main-thread')
    // Requests the worker never answered go to the in-process pipeline.
    for (const entry of pending.values()) {
      if (entry.kind === 'parse') entry.stream.restart()
      transport.send(entry.message)
    }
  }

  const factory =
    options.createWorker === undefined
      ? typeof Worker === 'undefined'
        ? null
        : () => new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
      : options.createWorker

  let worker: WorkerLike | null = null
  try {
    worker = factory ? factory() : null
  } catch {
    worker = null
  }

  if (worker) {
    const started = worker
    const timer = setTimeout(() => {
      if (!ready) {
        started.terminate()
        fallBack()
      }
    }, WORKER_START_TIMEOUT_MS)
    started.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === 'ready' && !ready) {
        ready = true
        clearTimeout(timer)
        resolveMode('worker')
      }
      dispatch(event.data)
    })
    started.addEventListener('error', (event: Event) => {
      event.preventDefault?.()
      if (!ready) {
        clearTimeout(timer)
        started.terminate()
        fallBack()
      } else {
        failAll('The parse worker stopped')
      }
    })
    started.addEventListener('messageerror', () => failAll('A message to the parse worker failed'))
    transport = {
      send: (message) => started.postMessage(message),
      close: () => started.terminate(),
    }
  } else {
    transport = createInProcessTransport(dispatch)
    ready = true
    resolveMode('main-thread')
  }

  return {
    mode,
    inspect(file, inspectOptions = {}) {
      const id = nextId++
      const message: WorkerRequest = { type: 'inspect', id, file, options: inspectOptions }
      return new Promise<InspectResult>((resolve, reject) => {
        pending.set(id, { kind: 'inspect', message, resolve, reject })
        transport.send(message)
      })
    },
    parse(file, request) {
      const id = nextId++
      const message: WorkerRequest = { type: 'parse', id, file, request }
      const stream = new PulledStream(
        () => transport.send({ type: 'pull', id }),
        () => {
          pending.delete(id)
          transport.send({ type: 'cancel', id })
        },
      )
      pending.set(id, { kind: 'parse', message, stream })
      transport.send(message)
      return stream
    },
    release() {
      transport.send({ type: 'release' })
    },
    dispose() {
      failAll('The parser was closed')
      transport.close()
    },
  }
}
