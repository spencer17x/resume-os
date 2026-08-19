import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JOB_AGENT_PREFERENCES,
  canExecuteJobAgentAction,
  parseJobAgentPreferences,
  serializeJobAgentPreferences
} from './job-agent-policy'

describe('job agent policy', () => {
  it('falls back safely when persisted preferences are missing or invalid', () => {
    expect(parseJobAgentPreferences(null)).toEqual(DEFAULT_JOB_AGENT_PREFERENCES)
    expect(parseJobAgentPreferences('{"enabled":"yes"}')).toEqual(DEFAULT_JOB_AGENT_PREFERENCES)
  })

  it('round-trips bounded preferences and removes duplicate platforms', () => {
    const value = serializeJobAgentPreferences({
      ...DEFAULT_JOB_AGENT_PREFERENCES,
      enabled: true,
      platforms: ['boss', 'boss', 'lever']
    })
    expect(parseJobAgentPreferences(value)).toMatchObject({
      enabled: true,
      platforms: ['boss', 'lever']
    })
  })

  it('starts with every platform enabled and no platform-specific setup', () => {
    expect(DEFAULT_JOB_AGENT_PREFERENCES).toMatchObject({ enabled: true, autonomy: 'autopilot' })
    expect(DEFAULT_JOB_AGENT_PREFERENCES.platforms).toHaveLength(9)
  })

  it('never sends or submits without both autopilot mode and an authorized connector', () => {
    const preferences = { ...DEFAULT_JOB_AGENT_PREFERENCES, enabled: true, autonomy: 'autopilot' as const }
    expect(canExecuteJobAgentAction({ action: 'discover', preferences })).toBe(true)
    expect(canExecuteJobAgentAction({ action: 'draft-message', preferences })).toBe(true)
    expect(canExecuteJobAgentAction({ action: 'send-message', preferences })).toBe(false)
    expect(canExecuteJobAgentAction({ action: 'send-message', preferences, connectorAuthorized: true })).toBe(true)
    expect(canExecuteJobAgentAction({ action: 'submit-application', preferences })).toBe(false)
  })
})
