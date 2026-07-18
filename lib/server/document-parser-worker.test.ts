// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The emitted worker stays JavaScript so Node can execute it directly.
import { parseDocumentTask } from './document-parser-worker.mjs'

describe('document parser worker runtime', () => {
  it('checks PDF metadata before text extraction and rejects excessive pages', async () => {
    const getInfo = vi.fn(async () => ({ total: 26 }))
    const getText = vi.fn()
    const destroy = vi.fn(async () => {})
    class PDFParseMock {
      getInfo = getInfo
      getText = getText
      destroy = destroy
    }

    await expect(parseDocumentTask({
      type: 'pdf',
      data: new Uint8Array([1]),
      maxPdfPages: 25,
      maxTextChars: 40_000
    }, { PDFParse: PDFParseMock })).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' })
    expect(getInfo).toHaveBeenCalledOnce()
    expect(getText).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('extracts only the preflighted PDF page range', async () => {
    const order: string[] = []
    const getInfo = vi.fn(async () => { order.push('info'); return { total: 3 } })
    const getText = vi.fn(async () => { order.push('text'); return { text: 'resume' } })
    class PDFParseMock {
      getInfo = getInfo
      getText = getText
      destroy = vi.fn(async () => {})
    }

    await expect(parseDocumentTask({
      type: 'pdf',
      data: new Uint8Array([1]),
      maxPdfPages: 25,
      maxTextChars: 40_000
    }, { PDFParse: PDFParseMock })).resolves.toEqual({ text: 'resume', pageCount: 3 })
    expect(order).toEqual(['info', 'text'])
    expect(getText).toHaveBeenCalledWith({ first: 3 })
  })

  it('runs mammoth DOCX extraction through the same worker task', async () => {
    const extractRawText = vi.fn(async () => ({ value: 'DOCX resume' }))
    await expect(parseDocumentTask({
      type: 'docx',
      data: new Uint8Array([0x50, 0x4b]),
      maxTextChars: 40_000
    }, { extractRawText })).resolves.toEqual({ text: 'DOCX resume' })
    expect(extractRawText).toHaveBeenCalledOnce()
  })

  it.each(['pdf', 'docx'] as const)('rejects oversized %s text inside the worker task', async (type) => {
    const oversizedText = 'x'.repeat(40_001)
    const dependencies = type === 'pdf'
      ? {
          PDFParse: class {
            getInfo = vi.fn(async () => ({ total: 1 }))
            getText = vi.fn(async () => ({ text: oversizedText }))
            destroy = vi.fn(async () => {})
          }
        }
      : { extractRawText: vi.fn(async () => ({ value: oversizedText })) }

    await expect(parseDocumentTask({
      type,
      data: new Uint8Array([1]),
      ...(type === 'pdf' ? { maxPdfPages: 25 } : {}),
      maxTextChars: 40_000
    }, dependencies)).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' })
  })
})
