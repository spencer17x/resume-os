import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32 } from './crc32'
import {
  DOCX_MAX_ENTRIES,
  DOCX_MAX_UNCOMPRESSED_BYTES,
  validateDocxArchive
} from './docx-preflight'

type ZipEntry = {
  name: string
  data?: Uint8Array
  declaredCompressedSize?: number
  declaredUncompressedSize?: number
  declaredCrc32?: number
  encrypted?: boolean
}

function zipArchive(entries: ZipEntry[]) {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = Buffer.from(entry.data ?? new Uint8Array())
    const compressed = deflateRawSync(data)
    const actualCrc = crc32(data)
    const flags = entry.encrypted ? 1 : 0
    const local = new Uint8Array(30 + name.length + compressed.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, flags, true)
    localView.setUint16(8, 8, true)
    localView.setUint32(14, actualCrc, true)
    localView.setUint32(18, compressed.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(compressed, 30 + name.length)
    localParts.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, flags, true)
    centralView.setUint16(10, 8, true)
    centralView.setUint32(16, entry.declaredCrc32 ?? actualCrc, true)
    centralView.setUint32(20, entry.declaredCompressedSize ?? compressed.length, true)
    centralView.setUint32(24, entry.declaredUncompressedSize ?? data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  const result = new Uint8Array(offset + centralSize + end.length)
  let cursor = 0
  for (const part of [...localParts, ...centralParts, end]) {
    result.set(part, cursor)
    cursor += part.length
  }
  return result
}

const requiredEntries = [
  { name: '[Content_Types].xml', data: new TextEncoder().encode('<Types/>') },
  { name: 'word/document.xml', data: new TextEncoder().encode('<document/>') }
]

describe('validateDocxArchive', () => {
  it('streams every entry and reports actual inflated bytes', async () => {
    await expect(validateDocxArchive(zipArchive(requiredEntries))).resolves.toEqual({
      entryCount: 2,
      totalUncompressedBytes: 19
    })
  })

  it('rejects a ZIP missing a required DOCX entry', async () => {
    await expect(validateDocxArchive(zipArchive([requiredEntries[0]]))).rejects.toMatchObject({
      code: 'INVALID_FILE_SIGNATURE'
    })
  })

  it('rejects actual inflated bytes over the cap even when the central directory declares one byte', async () => {
    const inflatedBomb = new Uint8Array(DOCX_MAX_UNCOMPRESSED_BYTES + 1024)
    inflatedBomb.fill(0x61)
    const archive = zipArchive([
      ...requiredEntries,
      {
        name: 'word/media/bomb.bin',
        data: inflatedBomb,
        declaredUncompressedSize: 1
      }
    ])

    expect(archive.byteLength).toBeLessThan(1_000_000)
    await expect(validateDocxArchive(archive)).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' })
  }, 15_000)

  it('rejects declared archive limits, encryption, suspicious ratios, and bad CRC', async () => {
    await expect(validateDocxArchive(zipArchive([
      ...requiredEntries,
      { name: 'word/media/large.bin', declaredUncompressedSize: DOCX_MAX_UNCOMPRESSED_BYTES + 1 }
    ]))).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' })

    await expect(validateDocxArchive(zipArchive([
      ...requiredEntries,
      { name: 'word/secret.bin', encrypted: true }
    ]))).rejects.toMatchObject({ code: 'INVALID_FILE_SIGNATURE' })

    await expect(validateDocxArchive(zipArchive([
      ...requiredEntries,
      {
        name: 'word/media/ratio.bin',
        data: new Uint8Array(2 * 1024 * 1024),
        declaredUncompressedSize: 2 * 1024 * 1024
      }
    ]))).rejects.toMatchObject({ code: 'EXTRACTION_LIMIT' })

    await expect(validateDocxArchive(zipArchive([
      ...requiredEntries,
      { name: 'word/bad-crc.xml', data: new Uint8Array([1, 2, 3]), declaredCrc32: 42 }
    ]))).rejects.toMatchObject({ code: 'INVALID_FILE_SIGNATURE' })
  })

  it('rejects an excessive central-directory entry count', async () => {
    const extras = Array.from({ length: DOCX_MAX_ENTRIES }, (_, index) => ({ name: `word/media/${index}.bin` }))
    await expect(validateDocxArchive(zipArchive([...requiredEntries, ...extras]))).rejects.toMatchObject({
      code: 'EXTRACTION_LIMIT'
    })
  })

  it('observes aborts before opening and across the asynchronous open boundary', async () => {
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(validateDocxArchive(zipArchive(requiredEntries), {
      signal: alreadyAborted.signal
    })).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })

    const openingAbort = new AbortController()
    const openingResult = validateDocxArchive(zipArchive(requiredEntries), {
      signal: openingAbort.signal
    })
    openingAbort.abort()
    await expect(openingResult).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  })

  it('terminates an active inflated stream when aborted', async () => {
    const largeEntry = new Uint8Array(24 * 1024 * 1024)
    largeEntry.fill(0x41)
    const controller = new AbortController()
    const result = validateDocxArchive(zipArchive([
      ...requiredEntries,
      { name: 'word/media/large.bin', data: largeEntry, declaredUncompressedSize: 1 }
    ]), { signal: controller.signal })

    setImmediate(() => controller.abort())
    await expect(result).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  }, 15_000)
})
