import { z } from 'zod'
import type { BrowserBossHistorySummary } from './browser-agent-protocol'
import type { ApplicationRecord } from './job-domain'
import type { BossConversationMessage } from './boss-conversation'
import type { JobAgentAutonomy } from './job-agent-policy'

export const jobHistorySimulationSchema = z.object({
  version: z.literal(1),
  sampleSize: z.number().int().min(0).max(10_000),
  recommendedMinimumMatchScore: z.number().int().min(0).max(100),
  recommendedDailyContactLimit: z.number().int().min(1).max(100),
  recommendedAutonomy: z.enum(['approval', 'autopilot']),
  recommendedAutoSendResume: z.boolean(),
  signals: z.object({
    conversations: z.number().int().min(0).max(10_000),
    recruiterReplies: z.number().int().min(0).max(10_000),
    resumeRequests: z.number().int().min(0).max(10_000),
    interviewInvites: z.number().int().min(0).max(10_000),
    offers: z.number().int().min(0).max(10_000),
    rejections: z.number().int().min(0).max(10_000),
    localApplications: z.number().int().min(0).max(10_000)
  }).strict(),
  reasonCodes: z.array(z.enum([
    'history-empty', 'reply-observed', 'resume-request-observed',
    'interview-observed', 'low-conversion', 'outcome-observed'
  ])).max(10),
  simulatedAt: z.iso.datetime({ offset: true })
}).strict()

export type JobHistorySimulation = z.infer<typeof jobHistorySimulationSchema>

export function simulateJobAgentFromHistory(input: {
  boss?: BrowserBossHistorySummary
  applications: readonly ApplicationRecord[]
  messages: readonly BossConversationMessage[]
  now: string
}): JobHistorySimulation {
  const boss = input.boss
  const localReplies = input.messages.filter((message) => message.direction === 'inbound').length
  const conversations = boss?.conversationCount ?? 0
  const recruiterReplies = Math.max(boss?.recruiterReplyCount ?? 0, localReplies)
  const resumeRequests = boss?.resumeRequestCount ?? 0
  const interviewInvites = Math.max(
    boss?.interviewInviteCount ?? 0,
    input.applications.filter((application) => ['interviewing', 'offered', 'rejected'].includes(application.status)).length
  )
  const offers = Math.max(boss?.offerCount ?? 0, input.applications.filter((application) => application.status === 'offered').length)
  const rejections = Math.max(boss?.rejectionCount ?? 0, input.applications.filter((application) => application.status === 'rejected').length)
  const sampleSize = Math.max(conversations, input.applications.length, input.messages.length)
  const replyRate = conversations > 0 ? recruiterReplies / conversations : 0
  const interviewRate = conversations > 0 ? interviewInvites / conversations : 0
  const reasonCodes: JobHistorySimulation['reasonCodes'] = []
  if (sampleSize === 0) reasonCodes.push('history-empty')
  if (recruiterReplies > 0) reasonCodes.push('reply-observed')
  if (resumeRequests > 0) reasonCodes.push('resume-request-observed')
  if (interviewInvites > 0) reasonCodes.push('interview-observed')
  if (conversations >= 5 && replyRate < 0.15) reasonCodes.push('low-conversion')
  if (offers + rejections > 0) reasonCodes.push('outcome-observed')
  const recommendedMinimumMatchScore = interviewRate >= 0.1 ? 65 : replyRate >= 0.2 ? 70 : 75
  const recommendedDailyContactLimit = Math.min(50, Math.max(5, Math.round(conversations / 6) || 10))
  const recommendedAutonomy: Extract<JobAgentAutonomy, 'approval' | 'autopilot'> = recruiterReplies > 0 ? 'autopilot' : 'approval'
  return jobHistorySimulationSchema.parse({
    version: 1,
    sampleSize,
    recommendedMinimumMatchScore,
    recommendedDailyContactLimit,
    recommendedAutonomy,
    recommendedAutoSendResume: resumeRequests > 0,
    signals: {
      conversations,
      recruiterReplies,
      resumeRequests,
      interviewInvites,
      offers,
      rejections,
      localApplications: input.applications.length
    },
    reasonCodes,
    simulatedAt: input.now
  })
}
