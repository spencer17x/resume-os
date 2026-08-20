(function installJobAgentRuntime(globalObject) {
  const MAX_PENDING_CYCLES = 12
  const MAX_MISSED_INTERVALS = 96

  function normalizeRuntime(value, now) {
    const candidate = value && typeof value === 'object' ? value : {}
    const pendingCycles = Array.isArray(candidate.pendingCycles)
      ? candidate.pendingCycles.filter(validCycle).slice(-MAX_PENDING_CYCLES)
      : []
    return {
      version: 1,
      enabled: candidate.enabled === true,
      intervalMinutes: boundedInterval(candidate.intervalMinutes),
      pendingCycles,
      missedRunCount: boundedInteger(candidate.missedRunCount, 0, 10_000),
      ...(validTimestamp(candidate.lastScheduledAt) ? { lastScheduledAt: candidate.lastScheduledAt } : {}),
      ...(validTimestamp(candidate.lastDispatchedAt) ? { lastDispatchedAt: candidate.lastDispatchedAt } : {}),
      ...(validTimestamp(candidate.lastCompletedAt) ? { lastCompletedAt: candidate.lastCompletedAt } : {}),
      ...(validTimestamp(candidate.nextRunAt) ? { nextRunAt: candidate.nextRunAt } : {}),
      offlineReason: ['none', 'page-closed', 'browser-restarted', 'dispatch-failed'].includes(candidate.offlineReason)
        ? candidate.offlineReason
        : 'none',
      updatedAt: validTimestamp(candidate.updatedAt) ? candidate.updatedAt : now
    }
  }

  function configure(runtimeValue, config, now, cycleId) {
    const runtime = normalizeRuntime(runtimeValue, now)
    const enabled = config?.enabled === true
    const intervalMinutes = boundedInterval(config?.intervalMinutes)
    if (!enabled) {
      const { nextRunAt: _nextRunAt, ...withoutNextRun } = runtime
      return { ...withoutNextRun, enabled: false, intervalMinutes, pendingCycles: [], offlineReason: 'none', updatedAt: now }
    }
    const nextRunAt = new Date(Date.parse(now) + intervalMinutes * 60_000).toISOString()
    const pendingCycles = runtime.enabled
      ? runtime.pendingCycles
      : appendCycle(runtime.pendingCycles, createCycle(cycleId, now, 'resume', 0))
    return { ...runtime, enabled: true, intervalMinutes, pendingCycles, nextRunAt, offlineReason: 'none', updatedAt: now }
  }

  function schedule(runtimeValue, now, cycleId, reason = 'scheduled') {
    const runtime = normalizeRuntime(runtimeValue, now)
    if (!runtime.enabled) return runtime
    const intervalMs = runtime.intervalMinutes * 60_000
    const previous = runtime.lastScheduledAt ? Date.parse(runtime.lastScheduledAt) : Date.parse(now) - intervalMs
    const elapsed = Math.max(intervalMs, Date.parse(now) - previous)
    const missedIntervals = Math.min(MAX_MISSED_INTERVALS, Math.max(0, Math.floor(elapsed / intervalMs) - 1))
    const cycleReason = missedIntervals > 0 || reason === 'browser-restarted' ? 'catch-up' : reason
    const lastCycle = runtime.pendingCycles[runtime.pendingCycles.length - 1]
    const canCoalesce = lastCycle?.state === 'pending'
    const coalescedMissed = Math.min(MAX_MISSED_INTERVALS, missedIntervals + (canCoalesce ? 1 : 0))
    const pendingCycles = canCoalesce
      ? runtime.pendingCycles.map((cycle, index) => index === runtime.pendingCycles.length - 1
        ? { ...cycle, reason: 'catch-up', missedIntervals: Math.min(MAX_MISSED_INTERVALS, cycle.missedIntervals + coalescedMissed) }
        : cycle)
      : appendCycle(runtime.pendingCycles, createCycle(cycleId, now, cycleReason, missedIntervals))
    return {
      ...runtime,
      pendingCycles,
      missedRunCount: Math.min(10_000, runtime.missedRunCount + coalescedMissed),
      lastScheduledAt: now,
      nextRunAt: new Date(Date.parse(now) + intervalMs).toISOString(),
      offlineReason: reason === 'browser-restarted' ? 'browser-restarted' : runtime.offlineReason,
      updatedAt: now
    }
  }

  function nextDispatchable(runtimeValue, now, retryAfterMs = 120_000) {
    const runtime = normalizeRuntime(runtimeValue, now)
    const cycle = runtime.pendingCycles[0]
    if (!cycle) return null
    if (cycle.state !== 'dispatched') return cycle
    return Date.parse(now) - Date.parse(cycle.lastAttemptAt ?? cycle.scheduledAt) >= retryAfterMs ? cycle : null
  }

  function markDispatched(runtimeValue, cycleId, now) {
    const runtime = normalizeRuntime(runtimeValue, now)
    return {
      ...runtime,
      pendingCycles: runtime.pendingCycles.map((cycle) => cycle.id === cycleId
        ? { ...cycle, state: 'dispatched', attempts: Math.min(10, cycle.attempts + 1), lastAttemptAt: now }
        : cycle),
      lastDispatchedAt: now,
      offlineReason: 'none',
      updatedAt: now
    }
  }

  function markUnavailable(runtimeValue, reason, now) {
    const runtime = normalizeRuntime(runtimeValue, now)
    return { ...runtime, offlineReason: reason, updatedAt: now }
  }

  function acknowledge(runtimeValue, cycleId, status, now) {
    const runtime = normalizeRuntime(runtimeValue, now)
    const cycle = runtime.pendingCycles.find((item) => item.id === cycleId)
    if (!cycle) return runtime
    if (status === 'failed' && cycle.attempts < 3) {
      return {
        ...runtime,
        pendingCycles: runtime.pendingCycles.map((item) => item.id === cycleId ? { ...item, state: 'pending' } : item),
        offlineReason: 'dispatch-failed',
        updatedAt: now
      }
    }
    return {
      ...runtime,
      pendingCycles: runtime.pendingCycles.filter((item) => item.id !== cycleId),
      lastCompletedAt: status === 'completed' ? now : runtime.lastCompletedAt,
      missedRunCount: Math.max(0, runtime.missedRunCount - cycle.missedIntervals),
      offlineReason: status === 'failed' ? 'dispatch-failed' : 'none',
      updatedAt: now
    }
  }

  function publicStatus(runtimeValue, now) {
    const runtime = normalizeRuntime(runtimeValue, now)
    return {
      enabled: runtime.enabled,
      intervalMinutes: runtime.intervalMinutes,
      pendingCount: runtime.pendingCycles.length,
      missedRunCount: runtime.missedRunCount,
      offlineReason: runtime.offlineReason,
      ...(runtime.lastScheduledAt ? { lastScheduledAt: runtime.lastScheduledAt } : {}),
      ...(runtime.lastDispatchedAt ? { lastDispatchedAt: runtime.lastDispatchedAt } : {}),
      ...(runtime.lastCompletedAt ? { lastCompletedAt: runtime.lastCompletedAt } : {}),
      ...(runtime.nextRunAt ? { nextRunAt: runtime.nextRunAt } : {})
    }
  }

  function createCycle(id, scheduledAt, reason, missedIntervals) {
    return { id, scheduledAt, reason, missedIntervals, state: 'pending', attempts: 0 }
  }

  function appendCycle(cycles, cycle) {
    if (cycles.some((item) => item.id === cycle.id)) return cycles
    if (cycles.length < MAX_PENDING_CYCLES) return [...cycles, cycle]
    const last = cycles[cycles.length - 1]
    return [
      ...cycles.slice(0, -1),
      {
        ...last,
        reason: 'catch-up',
        missedIntervals: Math.min(MAX_MISSED_INTERVALS, last.missedIntervals + cycle.missedIntervals + 1)
      }
    ]
  }

  function validCycle(value) {
    return value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 160
      && validTimestamp(value.scheduledAt)
      && ['scheduled', 'catch-up', 'resume'].includes(value.reason)
      && ['pending', 'dispatched'].includes(value.state)
      && Number.isInteger(value.attempts) && value.attempts >= 0 && value.attempts <= 10
      && Number.isInteger(value.missedIntervals) && value.missedIntervals >= 0 && value.missedIntervals <= MAX_MISSED_INTERVALS
      && (value.lastAttemptAt === undefined || validTimestamp(value.lastAttemptAt))
  }

  function boundedInterval(value) {
    const interval = Number(value)
    return Number.isFinite(interval) && interval >= 5 && interval <= 1_440 ? interval : 15
  }

  function boundedInteger(value, minimum, maximum) {
    return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum
  }

  function validTimestamp(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
  }

  globalObject.ResumeOsJobRuntime = {
    acknowledge,
    configure,
    markDispatched,
    markUnavailable,
    nextDispatchable,
    normalizeRuntime,
    publicStatus,
    schedule
  }
})(globalThis)
