import { z } from 'zod'

export const JOB_AGENT_PLATFORM_IDS = [
  'greenhouse',
  'lever',
  'boss',
  '51job',
  'lagou',
  'liepin',
  'linkedin',
  'indeed',
  '58'
] as const

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
  greenhouse: { id: 'greenhouse', discovery: 'built-in', communication: 'connector-required' },
  lever: { id: 'lever', discovery: 'built-in', communication: 'connector-required' },
  boss: { id: 'boss', discovery: 'official-search', communication: 'partner-required' },
  '51job': { id: '51job', discovery: 'official-search', communication: 'partner-required' },
  lagou: { id: 'lagou', discovery: 'connector-required', communication: 'partner-required' },
  liepin: { id: 'liepin', discovery: 'connector-required', communication: 'partner-required' },
  linkedin: { id: 'linkedin', discovery: 'connector-required', communication: 'partner-required' },
  indeed: { id: 'indeed', discovery: 'connector-required', communication: 'partner-required' },
  '58': { id: '58', discovery: 'connector-required', communication: 'partner-required' }
} as const satisfies Record<JobAgentPlatformId, JobAgentPlatformDefinition>

export const jobAgentPreferencesSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  autonomy: jobAgentAutonomySchema,
  platforms: z.array(jobAgentPlatformIdSchema).max(JOB_AGENT_PLATFORM_IDS.length),
  learnFromReplies: z.boolean(),
  learnFromOutcomes: z.boolean()
})

export type JobAgentPreferences = z.infer<typeof jobAgentPreferencesSchema>

export const DEFAULT_JOB_AGENT_PREFERENCES: JobAgentPreferences = {
  version: 1,
  enabled: false,
  autonomy: 'approval',
  platforms: ['greenhouse', 'lever', 'boss', '51job'],
  learnFromReplies: true,
  learnFromOutcomes: true
}

export const JOB_AGENT_PREFERENCES_KEY = 'resume-os:job-agent-preferences:v1'

export function parseJobAgentPreferences(value: string | null): JobAgentPreferences {
  if (!value) return DEFAULT_JOB_AGENT_PREFERENCES
  try {
    const parsed = jobAgentPreferencesSchema.safeParse(JSON.parse(value))
    if (!parsed.success) return DEFAULT_JOB_AGENT_PREFERENCES
    return {
      ...parsed.data,
      platforms: [...new Set(parsed.data.platforms)]
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
