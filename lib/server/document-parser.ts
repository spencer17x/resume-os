import { Worker, type WorkerOptions } from 'node:worker_threads'
import type { ApiErrorCode } from '@/lib/server/request-guard'

type DocumentParserTask =
  | { type: 'pdf'; data: Uint8Array; maxPdfPages: number; maxTextChars: number }
  | { type: 'docx'; data: Uint8Array; maxTextChars: number }

type DocumentParserResult = { text: string; pageCount?: number }
type WorkerMessage =
  | { ok: true; result: DocumentParserResult }
  | { ok: false; code: 'EXTRACTION_LIMIT' | 'EXTRACTION_FAILED' }

export type DocumentWorker = {
  postMessage(value: unknown): void
  terminate(): Promise<number>
  on(event: 'message', listener: (message: WorkerMessage) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  off(event: 'message', listener: (message: WorkerMessage) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'exit', listener: (code: number) => void): unknown
}

export const DOCUMENT_WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4
})

// These opaque references keep the raw worker's external packages in Next's serverless
// trace. Turbopack may compile them to module IDs, so the worker must never use them as paths.
export const DOCUMENT_WORKER_TRACE_ANCHORS = Object.freeze([
  require.resolve('@napi-rs/canvas'),
  require.resolve('pdf-parse'),
  require.resolve('mammoth')
])

export class DocumentParserError extends Error {
  constructor(readonly code: Extract<ApiErrorCode, 'EXTRACTION_LIMIT' | 'EXTRACTION_FAILED' | 'REQUEST_ABORTED'>) {
    super(code)
    this.name = 'DocumentParserError'
  }
}

export function resolveDocumentWorkerUrl() {
  return new URL('./document-parser-worker.mjs', import.meta.url)
}

export function runDocumentParser(task: DocumentParserTask, options: {
  signal?: AbortSignal
  timeoutMs: number
  workerFactory?: (filename: URL, options: WorkerOptions) => DocumentWorker
}) {
  return new Promise<DocumentParserResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DocumentParserError('REQUEST_ABORTED'))
      return
    }

    const workerUrl = resolveDocumentWorkerUrl()
    const workerOptions = {
      resourceLimits: DOCUMENT_WORKER_RESOURCE_LIMITS,
      // The worker ignores these values. Keeping the external references on the
      // route makes Next include their package graphs in the serverless trace.
      workerData: { traceAnchors: DOCUMENT_WORKER_TRACE_ANCHORS }
    }
    const worker: DocumentWorker = options.workerFactory
      ? options.workerFactory(workerUrl, workerOptions)
      // Next 16.2 Turbopack currently mis-resolves Node worker_threads URL assets.
      // Reflect.construct skips the broken Worker transform while retaining URL asset emission.
      : Reflect.construct(Worker, [workerUrl, workerOptions]) as DocumentWorker
    let settled = false
    const timeout = setTimeout(() => {
      void settle(() => reject(new DocumentParserError('EXTRACTION_FAILED')))
    }, options.timeoutMs)
    const abort = () => {
      void settle(() => reject(new DocumentParserError('REQUEST_ABORTED')))
    }
    const onMessage = (message: WorkerMessage) => {
      void settle(() => {
        if (message.ok) resolve(message.result)
        else reject(new DocumentParserError(message.code))
      })
    }
    const onError = () => {
      void settle(() => reject(new DocumentParserError('EXTRACTION_FAILED')))
    }
    const onExit = (code: number) => {
      if (code !== 0) void settle(() => reject(new DocumentParserError('EXTRACTION_FAILED')))
    }
    const settle = async (complete: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
      await worker.terminate().catch(() => undefined)
      complete()
    }

    options.signal?.addEventListener('abort', abort, { once: true })
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
    worker.postMessage(task)
  })
}
