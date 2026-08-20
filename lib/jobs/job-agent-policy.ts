import { z } from 'zod'

export const JOB_AGENT_PLATFORM_IDS = [
  'boss'
] as const

const legacyJobAgentPlatformIdSchema = z.enum([
  'greenhouse', 'lever', 'boss', '51job', 'lagou', 'liepin', 'linkedin', 'indeed', '58'
])

export const jobAgentPlatformIdSchema = z.enum(JOB_AGENT_PLATFORM_IDS)
export type JobAgentPlatformId = z.infer<typeof jobAgentPlatformIdSchema>

export const jobAgentAutonomySchema = z.enum(['copilot', 'approval', 'autopilot'])
export type JobAgentAutonomy = z.infer<typeof jobAgentAutonomySchema>

export type JobAgentPlatformDefinition = {
  id: JobAgentPlatformId
  discovery: 'built-in' | 'official-search' | 'connector-required'
  communication: 'connector-required' | 'partner-required'
}

export const jobAgentPlatformRegistry = {
  boss: { id: 'boss', discovery: 'official-search', communication: 'partner-required' }
} as const satisfies Record<JobAgentPlatformId, JobAgentPlatformDefinition>

export const jobAgentPreferencesSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  autonomy: jobAgentAutonomySchema,
  platforms: z.array(jobAgentPlatformIdSchema).max(JOB_AGENT_PLATFORM_IDS.length),
  learnFromReplies: z.boolean(),
  learnFromOutcomes: z.boolean()
})

const persistedJobAgentPreferencesSchema = jobAgentPreferencesSchema.extend({
  platforms: z.array(legacyJobAgentPlatformIdSchema).max(9)
})

export type JobAgentPreferences = z.infer<typeof jobAgentPreferencesSchema>

export const DEFAULT_JOB_AGENT_PREFERENCES: JobAgentPreferences = {
  version: 1,
  enabled: false,
  autonomy: 'autopilot',
  platforms: [...JOB_AGENT_PLATFORM_IDS],
  learnFromReplies: true,
  learnFromOutcomes: true
}

export const JOB_AGENT_PREFERENCES_KEY = 'resume-os:job-agent-preferences:v1'

export function parseJobAgentPreferences(value: string | null): JobAgentPreferences {
  if (!value) return DEFAULT_JOB_AGENT_PREFERENCES
  try {
    const parsed = persistedJobAgentPreferencesSchema.safeParse(JSON.parse(value))
    if (!parsed.success) return DEFAULT_JOB_AGENT_PREFERENCES
    const platforms = [...new Set(parsed.data.platforms)]
      .filter((platform): platform is JobAgentPlatformId => (
        JOB_AGENT_PLATFORM_IDS.includes(platform as JobAgentPlatformId)
      ))
    return {
      ...parsed.data,
      platforms: platforms.length ? platforms : [...JOB_AGENT_PLATFORM_IDS]
    }
  } catch {
    return DEFAULT_JOB_AGENT_PREFERENCES
  }
}

export function serializeJobAgentPreferences(preferences: JobAgentPreferences) {
  return JSON.stringify(jobAgentPreferencesSchema.parse(preferences))
}

export function canExecuteJobAgentAction(input: {
  action: 'discover' | 'draft-message' | 'send-message' | 'submit-application'
  preferences: JobAgentPreferences
  connectorAuthorized?: boolean
}) {
  if (!input.preferences.enabled || input.preferences.platforms.length === 0) return false
  if (input.action === 'discover') return true
  if (input.action === 'draft-message') return input.preferences.autonomy !== 'copilot'
  return input.preferences.autonomy === 'autopilot' && input.connectorAuthorized === true
}
