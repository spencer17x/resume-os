// @vitest-environment node

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DOCUMENT_WORKER_RESOURCE_LIMITS,
  DOCUMENT_WORKER_TRACE_ANCHORS,
  resolveDocumentWorkerUrl,
  runDocumentParser
} from './document-parser'

class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  terminate = vi.fn(async () => 0)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('runDocumentParser', () => {
  it('resolves the native worker from a static module-relative URL', () => {
    const workerUrl = resolveDocumentWorkerUrl()
    expect(workerUrl).toBeInstanceOf(URL)
    expect(workerUrl.protocol).toBe('file:')
    expect(workerUrl.pathname).toMatch(/\/document-parser-worker\.mjs$/)
  })

  it('terminates a worker on timeout and rejects with a stable error', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const result = runDocumentParser({ type: 'pdf', data: new Uint8Array([1]), maxPdfPages: 25, maxTextChars: 40_000 }, {
      timeoutMs: 500,
      workerFactory: () => worker
    })
    const rejection = expect(result).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' })

    await vi.advanceTimersByTimeAsync(501)
    await rejection
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('terminates a worker when the request is aborted', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const result = runDocumentParser({ type: 'docx', data: new Uint8Array([1]), maxTextChars: 40_000 }, {
      signal: controller.signal,
      timeoutMs: 5_000,
      workerFactory: () => worker
    })
    const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })

    controller.abort()
    await rejection
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('returns a successful worker result and terminates the worker', async () => {
    const worker = new FakeWorker()
    const workerFactory = vi.fn(() => worker)
    const result = runDocumentParser({ type: 'pdf', data: new Uint8Array([1]), maxPdfPages: 25, maxTextChars: 40_000 }, {
      timeoutMs: 5_000,
      workerFactory
    })
    worker.emit('message', { ok: true, result: { text: 'resume', pageCount: 1 } })

    await expect(result).resolves.toEqual({ text: 'resume', pageCount: 1 })
    expect(workerFactory).toHaveBeenCalledWith(expect.any(URL), {
      resourceLimits: DOCUMENT_WORKER_RESOURCE_LIMITS,
      workerData: { traceAnchors: DOCUMENT_WORKER_TRACE_ANCHORS }
    })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

})
