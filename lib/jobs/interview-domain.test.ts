import { describe, expect, it } from 'vitest'
import {
  createInterviewSession,
  interviewReviewInputFingerprint,
  interviewQuestionSchema,
  recordInterviewOutcome
} from './interview-domain'

const now = '2026-08-19T10:00:00.000Z'

describe('interview domain', () => {
  it('creates stable interview rounds and requires explicit outcome reporting', () => {
    const session = createInterviewSession({
      applicationId: 'application-1', targetJobId: 'target-1', round: 1,
      format: 'video', scheduledAt: '2026-08-20T02:00:00.000Z', now
    })
    expect(session).toMatchObject({ id: expect.stringContaining('interview-'), stage: 'scheduled' })
    expect(() => recordInterviewOutcome({
      session, outcome: 'passed', now, explicitUserReport: false
    })).toThrow()
    expect(recordInterviewOutcome({
      session, outcome: 'passed', notes: 'User confirmed the next round.', now, explicitUserReport: true
    })).toMatchObject({ stage: 'passed', userReportedResult: true, resultReportedAt: now })
  })

  it('fingerprints user-provided questions and answers deterministically', () => {
    const session = createInterviewSession({
      applicationId: 'application-1', targetJobId: 'target-1', round: 1, format: 'video', now
    })
    const question = interviewQuestionSchema.parse({
      id: 'question-1', sessionId: session.id, question: '如何设计任务队列？',
      userAnswer: '使用持久队列和幂等消费者。', suggestedAnswer: '', feedback: '', tags: ['system-design'],
      createdAt: now, updatedAt: now
    })
    expect(interviewReviewInputFingerprint({ session, questions: [question] }))
      .toBe(interviewReviewInputFingerprint({ session, questions: [question] }))
  })
})
