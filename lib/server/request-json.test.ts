import { describe, expect, it, vi } from 'vitest'
import { readLimitedJson } from './request-json'

function streamedRequest(chunks: string[], headers: Record<string, string> = {}, onCancel = vi.fn()) {
  const encoder = new TextEncoder()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    },
    cancel: onCancel
  })

  return new Request('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half'
  } as RequestInit)
}

describe('readLimitedJson', () => {
  it('reads valid streamed JSON when Content-Length is omitted', async () => {
    const result = await readLimitedJson(streamedRequest(['{"message":', '"hello"}']), 64)
    expect(result).toEqual({ message: 'hello' })
  })

  it('stops and cancels a chunked body once the byte budget is exceeded', async () => {
    const onCancel = vi.fn()
    const request = streamedRequest(['{"text":"', 'x'.repeat(80), '"}'], {}, onCancel)

    await expect(readLimitedJson(request, 32)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE'
    })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not trust a false low Content-Length header', async () => {
    const onCancel = vi.fn()
    const request = streamedRequest(['{"text":"', 'x'.repeat(80), '"}'], {
      'content-length': '2'
    }, onCancel)

    await expect(readLimitedJson(request, 32)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('rejects a correctly declared oversized body before reading the stream', async () => {
    const onCancel = vi.fn()
    const request = streamedRequest(['x'.repeat(65)], { 'content-length': '65' }, onCancel)

    await expect(readLimitedJson(request, 64)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('rejects malformed, empty, or invalid UTF-8 JSON with a stable code', async () => {
    await expect(readLimitedJson(streamedRequest(['{"broken"']), 64)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(readLimitedJson(streamedRequest([]), 64)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]))
        controller.close()
      }
    })
    const request = new Request('http://localhost:3001/api/chat', {
      method: 'POST',
      body,
      duplex: 'half'
    } as RequestInit)
    await expect(readLimitedJson(request, 64)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })
})
