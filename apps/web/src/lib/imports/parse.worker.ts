/**
 * The import wizard's parse worker (a module worker): decodes, parses and normalizes files off
 * the main thread and hands the page one staged chunk per request. Started by `parse-client.ts`
 * with `new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })`. All logic
 * is in `parse.ts`; this file only wires messages.
 */
import { createWorkerHandler, type WorkerRequest, type WorkerResponse } from './parse'

type WorkerScope = {
  postMessage(message: WorkerResponse): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = globalThis as unknown as WorkerScope
const handle = createWorkerHandler((message) => scope.postMessage(message))

scope.addEventListener('message', (event) => {
  void handle(event.data)
})

scope.postMessage({ type: 'ready' })
