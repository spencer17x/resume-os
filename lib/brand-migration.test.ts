import { describe, expect, it, vi } from 'vitest'
import { readMigratedStorageValue } from './brand-migration'

describe('brand storage migration', () => {
  it('copies a legacy Resume OS value into the JobSeeker Agent key', () => {
    const values = new Map([['resume-os-example', 'saved-value']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => values.set(key, value))
    }
    expect(readMigratedStorageValue(storage, 'job-seeker-agent-example', 'resume-os-example')).toBe('saved-value')
    expect(storage.setItem).toHaveBeenCalledWith('job-seeker-agent-example', 'saved-value')
  })

  it('prefers the current branded key', () => {
    const storage = { getItem: (key: string) => key === 'current' ? 'new' : 'old', setItem: vi.fn() }
    expect(readMigratedStorageValue(storage, 'current', 'legacy')).toBe('new')
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
