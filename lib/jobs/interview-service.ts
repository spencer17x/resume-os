import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import { transitionApplicationRecord } from './application-record'
import { createInterviewSession, type InterviewSession } from './interview-domain'

export async function registerInterviewInvitation(input: {
  store: IndexedDbDomainStore
  applicationId: string
  round: number
  format: InterviewSession['format']
  scheduledAt?: string
  now: string
}) {
  return input.store.transaction(
    ['applicationRecords', 'targetJobs', 'interviewSessions'],
    'readwrite',
    async (transaction) => {
      const application = await transaction.get('applicationRecords', input.applicationId)
      if (!application?.targetJobId || !['applied', 'interviewing'].includes(application.status)) {
        throw new TypeError('Only a submitted application can receive an interview invitation')
      }
      const session = createInterviewSession({
        applicationId: application.id,
        targetJobId: application.targetJobId,
        round: input.round,
        format: input.format,
        scheduledAt: input.scheduledAt,
        now: input.now
      })
      const existing = await transaction.get('interviewSessions', session.id)
      if (existing) return existing
      await transaction.put('interviewSessions', session)
      if (application.status === 'applied') {
        await transaction.put('applicationRecords', transitionApplicationRecord({
          record: application,
          status: 'interviewing',
          now: input.now
        }))
      }
      return session
    }
  )
}
