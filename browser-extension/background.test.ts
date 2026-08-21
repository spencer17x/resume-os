import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('JobSeeker Agent BOSS extension background', () => {
  it('constructs a fixed-host search tab, collects bounded jobs, and closes the tab', async () => {
    let listener: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean) | undefined
    const create = vi.fn(async ({ url }: { url: string }) => ({ id: 42, url }))
    const remove = vi.fn(async () => undefined)
    const sendMessage = vi.fn(async () => ({ jobs: [{ externalId: 'one' }] }))
    const chrome = {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        onMessage: { addListener: (value: typeof listener) => { listener = value } }
      },
      tabs: {
        create,
        remove,
        sendMessage,
        get: async () => ({ id: 42, status: 'complete' }),
        query: async () => [],
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
      },
      alarms: { onAlarm: { addListener: vi.fn() }, clear: vi.fn(), create: vi.fn() },
      storage: { local: { set: vi.fn(), get: vi.fn(async () => ({})) } },
      notifications: { create: vi.fn(async () => 'notification-1') }
    }
    runInNewContext(readFileSync('browser-extension/background.js', 'utf8'), {
      chrome, URL, Map, Set, Promise,
      setTimeout: (callback: () => void, milliseconds: number) => {
        if (milliseconds < 2_000) queueMicrotask(callback)
        return 1
      },
      clearTimeout: vi.fn(),
      queueMicrotask
    })
    expect(listener).toBeTypeOf('function')
    const response = new Promise<Record<string, unknown>>((resolve) => {
      expect(listener?.({
        action: 'search-boss-jobs', requestId: 'request-1', payload: { query: '平台工程师' }
      }, {}, (value) => resolve(value as Record<string, unknown>))).toBe(true)
    })
    await expect(response).resolves.toMatchObject({ ok: true, jobs: [{ externalId: 'one' }] })
    const opened = new URL(create.mock.calls[0][0].url)
    expect(opened.origin).toBe('https://www.zhipin.com')
    expect(opened.pathname).toBe('/web/geek/job')
    expect(opened.searchParams.get('query')).toBe('平台工程师')
    expect(remove).toHaveBeenCalledWith(42)
  })
})
