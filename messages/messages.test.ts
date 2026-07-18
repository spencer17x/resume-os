import { describe, expect, it } from 'vitest'
import en from './en.json'
import zh from './zh.json'

function messageKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => messageKeys(entry, `${prefix}[${index}]`))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) =>
      messageKeys(entry, prefix ? `${prefix}.${key}` : key)
    )
  }

  return [prefix]
}

describe('localized messages', () => {
  it('keeps the English and Chinese message trees in exact recursive parity', () => {
    expect(messageKeys(zh).sort()).toEqual(messageKeys(en).sort())
  })

  it('contains every desktop experience namespace', () => {
    const namespaces = [
      'desktop',
      'mobile',
      'studio',
      'agentChanges',
      'book',
      'resume3d',
      'settings',
      'errors'
    ]

    for (const namespace of namespaces) {
      expect(en).toHaveProperty(namespace)
      expect(zh).toHaveProperty(namespace)
    }
  })
})
