import { describe, expect, it } from 'vitest'
import { crc32 } from './crc32'

const encode = (value: string) => new TextEncoder().encode(value)

describe('crc32', () => {
  it.each([
    ['', 0x00000000],
    ['123456789', 0xcbf43926],
    ['The quick brown fox jumps over the lazy dog', 0x414fa339]
  ])('matches the standard vector %j', (value, expected) => {
    expect(crc32(encode(value))).toBe(expected)
  })

  it('produces the same checksum across incremental buffers', () => {
    const chunks = ['123', '456', '789'].map(encode)
    const incremental = chunks.reduce((checksum, chunk) => crc32(chunk, checksum), 0)

    expect(incremental).toBe(0xcbf43926)
    expect(incremental).toBe(crc32(encode('123456789')))
  })
})
