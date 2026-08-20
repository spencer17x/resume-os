'use client'

import { useTranslations } from 'next-intl'
import type { ApplicationRecord, JobPosting } from '@/lib/jobs/job-domain'
import type { BossConversationMessage, BossConversationThread } from '@/lib/jobs/boss-conversation'

export function JobProcessBoard({ applications, postings, threads, messages }: {
  applications: ApplicationRecord[]
  postings: JobPosting[]
  threads: BossConversationThread[]
  messages: BossConversationMessage[]
}) {
  const t = useTranslations('jobRadar.processBoard')
  const postingById = new Map(postings.map((posting) => [posting.id, posting]))
  const threadByApplication = new Map(threads.map((thread) => [thread.applicationId, thread]))
  const latestMessageByThread = new Map<string, BossConversationMessage>()
  for (const message of [...messages].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
    latestMessageByThread.set(message.threadId, message)
  }
  if (applications.length === 0) return null
  return <section className="job-process-board" aria-labelledby="job-process-board-title">
    <header><div><h2 id="job-process-board-title">{t('title')}</h2><p>{t('description')}</p></div><span>{applications.length}</span></header>
    <div role="table" aria-label={t('title')}>
      <div role="row" className="job-process-board__heading">
        <span role="columnheader">{t('job')}</span><span role="columnheader">{t('resume')}</span><span role="columnheader">{t('conversation')}</span><span role="columnheader">{t('message')}</span><span role="columnheader">{t('application')}</span><span role="columnheader">{t('interview')}</span>
      </div>
      {applications.map((application) => {
        const posting = postingById.get(application.postingId)
        const thread = threadByApplication.get(application.id)
        const message = thread ? latestMessageByThread.get(thread.id) : undefined
        return <div role="row" key={application.id}>
          <span role="cell"><strong>{posting?.title ?? t('unknown')}</strong><small>{posting?.company ?? t('unknown')}</small></span>
          <span role="cell" data-state={application.resumeVariantId ? 'ready' : 'waiting'}>{application.resumeVariantId ? t('resumeReady') : t('resumePreparing')}</span>
          <span role="cell" data-state={thread?.status ?? 'waiting'}>{thread ? t(`conversationStage.${thread.recruitmentStage}`) : t('notStarted')}</span>
          <span role="cell" data-state={message?.status ?? 'waiting'}>{message ? t(`messageStatus.${message.status}`) : t('noMessage')}</span>
          <span role="cell" data-state={application.status}>{t(`applicationStatus.${application.status}`)}</span>
          <span role="cell" data-state={['interviewing', 'offered', 'rejected'].includes(application.status) ? application.status : 'waiting'}>{['interviewing', 'offered', 'rejected'].includes(application.status) ? t(`interviewStatus.${application.status}`) : t('noInterview')}</span>
        </div>
      })}
    </div>
  </section>
}
