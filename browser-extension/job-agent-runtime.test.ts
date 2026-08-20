import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

type RuntimeApi = {
  configure(value: unknown, config: unknown, now: string, id: string): Record<string, unknown>
  schedule(value: unknown, now: string, id: string, reason?: string): Record<string, unknown>
  nextDispatchable(value: unknown, now: string): { id: string } | null
  markDispatched(value: unknown, id: string, now: string): Record<string, unknown>
  acknowledge(value: unknown, id: string, status: string, now: string): Record<string, unknown>
  publicStatus(value: unknown, now: string): Record<string, unknown>
}

function runtimeApi() {
  const context: { globalThis: unknown; Date: DateConstructor; Number: NumberConstructor; ResumeOsJobRuntime?: RuntimeApi } = { globalThis: null, Date, Number }
  context.globalThis = context
  runInNewContext(readFileSync('browser-extension/job-agent-runtime.js', 'utf8'), context)
  return context.ResumeOsJobRuntime!
}

describe('extension job agent runtime', () => {
  it('keeps a pending cycle while the page is closed and completes it after acknowledgement', () => {
    const api = runtimeApi()
    const started = api.configure(null, { enabled: true, intervalMinutes: 15 }, '2026-08-20T08:00:00.000Z', 'cycle-1')
    expect(api.publicStatus(started, '2026-08-20T08:00:00.000Z')).toMatchObject({ enabled: true, pendingCount: 1 })
    expect(api.nextDispatchable(started, '2026-08-20T08:00:00.000Z')).toMatchObject({ id: 'cycle-1' })
    const dispatched = api.markDispatched(started, 'cycle-1', '2026-08-20T08:01:00.000Z')
    const completed = api.acknowledge(dispatched, 'cycle-1', 'completed', '2026-08-20T08:02:00.000Z')
    expect(api.publicStatus(completed, '2026-08-20T08:02:00.000Z')).toMatchObject({ pendingCount: 0, lastCompletedAt: '2026-08-20T08:02:00.000Z' })
  })

  it('coalesces missed intervals into one bounded catch-up cycle', () => {
    const api = runtimeApi()
    const started = api.configure(null, { enabled: true, intervalMinutes: 15 }, '2026-08-20T08:00:00.000Z', 'cycle-start')
    const first = api.schedule({ ...started, pendingCycles: [], lastScheduledAt: '2026-08-20T08:00:00.000Z' }, '2026-08-20T09:00:00.000Z', 'cycle-catch-up', 'browser-restarted')
    expect(first).toMatchObject({ missedRunCount: 3, offlineReason: 'browser-restarted' })
    expect(api.publicStatus(first, '2026-08-20T09:00:00.000Z')).toMatchObject({ pendingCount: 1, missedRunCount: 3 })
  })

  it('does not build a burst while repeated alarms find the page closed', () => {
    const api = runtimeApi()
    let runtime = api.configure(null, { enabled: true, intervalMinutes: 15 }, '2026-08-20T08:00:00.000Z', 'cycle-start')
    runtime = api.schedule(runtime, '2026-08-20T08:15:00.000Z', 'cycle-2')
    runtime = api.schedule(runtime, '2026-08-20T08:30:00.000Z', 'cycle-3')
    expect(api.publicStatus(runtime, '2026-08-20T08:30:00.000Z')).toMatchObject({ pendingCount: 1, missedRunCount: 2 })
  })

  it('clears pending work when the Agent is disabled', () => {
    const api = runtimeApi()
    const started = api.configure(null, { enabled: true, intervalMinutes: 15 }, '2026-08-20T08:00:00.000Z', 'cycle-1')
    expect(api.configure(started, { enabled: false, intervalMinutes: 15 }, '2026-08-20T08:01:00.000Z', 'unused'))
      .toMatchObject({ enabled: false, pendingCycles: [] })
  })
})
