import { describe, expect, it } from 'vitest'
import { simulateJobAgentFromHistory } from './job-history-learning'

describe('job history learning simulation', () => {
  it('turns de-identified history counts into a bounded preview without applying it', () => {
    const result = simulateJobAgentFromHistory({
      boss: {
        conversationCount: 24, outgoingMessageCount: 20, incomingMessageCount: 6,
        recruiterReplyCount: 6, resumeRequestCount: 2, interviewInviteCount: 3,
        offerCount: 1, rejectionCount: 1, observedAt: '2026-08-20T08:00:00.000Z'
      },
      applications: [], messages: [], now: '2026-08-20T09:00:00.000Z'
    })
    expect(result).toMatchObject({
      sampleSize: 24,
      recommendedMinimumMatchScore: 65,
      recommendedDailyContactLimit: 5,
      recommendedAutonomy: 'autopilot',
      recommendedAutoSendResume: true
    })
  })

  it('keeps an empty history in approval mode', () => {
    expect(simulateJobAgentFromHistory({ applications: [], messages: [], now: '2026-08-20T09:00:00.000Z' }))
      .toMatchObject({ sampleSize: 0, recommendedAutonomy: 'approval', reasonCodes: ['history-empty'] })
  })
})
