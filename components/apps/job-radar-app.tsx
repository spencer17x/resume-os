'use client'

import { ExternalLink, LoaderCircle, Radar, RefreshCw, Save, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { useOptionalDesktop } from '@/components/desktop/desktop-provider'
import { ApplicationPipeline } from '@/components/apps/application-pipeline'
import { careerEvidenceSourceId } from '@/lib/agent/career-evidence'
import { ACTIVE_WORKFLOW_CHANGED_EVENT } from '@/lib/agent/workflow-persistence'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import {
  createStableJobDomainId,
  jobSearchProfileSchema,
  jobSourceSchema,
  type ApplicationRecord,
  type JobPosting,
  type JobRecommendation,
  type JobSearchProfile,
  type JobSource
} from '@/lib/jobs/job-domain'
import { scoreJobRecommendation } from '@/lib/jobs/job-recommendation'
import { createJobPromotionIntent, saveJobPromotionIntent } from '@/lib/jobs/job-promotion'
import { refreshJobSource } from '@/lib/jobs/job-refresh'
import {
  ApplicationRecordError,
  loadApplicationPacket,
  markApplicationApplied,
  prepareApplicationPacket,
  type ApplicationPacket
} from '@/lib/jobs/application-record'
import { createSameOriginJobSourceAdapter, JobSourceError } from '@/lib/jobs/sources'
import type { JobSourceAdapter } from '@/lib/jobs/sources'
import type { AppId } from '@/lib/desktop/types'

type SourceKind = Extract<JobSource['kind'], 'greenhouse' | 'lever'>
type Filter = 'all' | 'new' | 'saved' | 'needs-analysis' | 'ready' | 'applied' | 'ignored' | 'closed'

export type JobRadarAppProps = {
  appId?: AppId
  store?: IndexedDbDomainStore
  createAdapter?: (kind: SourceKind) => JobSourceAdapter
}

export function JobRadarApp({ store: storeOverride, createAdapter = createSameOriginJobSourceAdapter }: JobRadarAppProps = {}) {
  const t = useTranslations('jobRadar')
  const locale = useLocale()
  const desktop = useOptionalDesktop()
  const { activeDraft } = useResumeDraft()
  const trustedDraft = Boolean(activeDraft && ['paste', 'upload'].includes(activeDraft.source))
  const [store] = useState(() => storeOverride ?? createDomainStore())
  const [sources, setSources] = useState<JobSource[]>([])
  const [profiles, setProfiles] = useState<JobSearchProfile[]>([])
  const [postings, setPostings] = useState<JobPosting[]>([])
  const [recommendations, setRecommendations] = useState<JobRecommendation[]>([])
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [packets, setPackets] = useState<ApplicationPacket[]>([])
  const [busyApplicationId, setBusyApplicationId] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceKind>('greenhouse')
  const [sourceKey, setSourceKey] = useState('')
  const [profileName, setProfileName] = useState('')
  const [titles, setTitles] = useState('')
  const [locations, setLocations] = useState('')
  const [requiredTerms, setRequiredTerms] = useState('')
  const [preferredTerms, setPreferredTerms] = useState('')
  const [excludedTerms, setExcludedTerms] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busySourceId, setBusySourceId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const refreshGenerationRef = useRef(0)
  const hydratedProfileIdRef = useRef('')

  const load = useCallback(async () => {
    const [nextSources, nextProfiles, nextPostings, nextRecommendations, nextApplications] = await Promise.all([
      store.list('jobSources'),
      store.list('jobSearchProfiles'),
      store.list('jobPostings'),
      store.list('jobRecommendations'),
      store.list('applicationRecords')
    ])
    setSources(nextSources.sort(byUpdatedAt))
    setProfiles(nextProfiles.sort(byUpdatedAt))
    setPostings(nextPostings.sort((left, right) => right.lastCheckedAt.localeCompare(left.lastCheckedAt)))
    setRecommendations(nextRecommendations)
    setApplications(nextApplications)
    if (activeDraft && ['paste', 'upload'].includes(activeDraft.source)) {
      const results = await Promise.allSettled(nextApplications
        .filter((application) => application.sourceDraftId === activeDraft.id)
        .map((application) => loadApplicationPacket({
          store,
          recordId: application.id,
          resume: activeDraft.data
        })))
      setPackets(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
    } else {
      setPackets([])
    }
  }, [activeDraft, store])

  useEffect(() => {
    let active = true
    void load().catch(() => { if (active) setError(t('errors.storage')) })
    return () => {
      active = false
      controllerRef.current?.abort()
    }
  }, [load, store, t])
  useEffect(() => {
    const refresh = () => { void load() }
    window.addEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, refresh)
  }, [load])

  useEffect(() => {
    const profile = profiles[0]
    if (!profile || hydratedProfileIdRef.current === profile.id) return
    hydratedProfileIdRef.current = profile.id
    setProfileName(profile.name)
    setTitles(profile.titles.join(', '))
    setLocations(profile.locations.join(', '))
    setRequiredTerms(profile.requiredTerms.join(', '))
    setPreferredTerms(profile.preferredTerms.join(', '))
    setExcludedTerms(profile.excludedTerms.join(', '))
  }, [profiles])

  async function addSource() {
    setError('')
    try {
      const key = sourceKey.trim()
      const now = new Date().toISOString()
      const source = jobSourceSchema.parse({
        id: createStableJobDomainId('job-source', [sourceKind, key]),
        kind: sourceKind,
        label: key,
        sourceKey: key,
        enabled: true,
        createdAt: now,
        updatedAt: now
      })
      await store.put('jobSources', source)
      setSourceKey('')
      setNotice(t('sourceAdded'))
      await load()
    } catch {
      setError(t('errors.invalidSource'))
    }
  }

  async function saveProfile() {
    setError('')
    try {
      const now = new Date().toISOString()
      const existing = profiles[0]
      const profile = jobSearchProfileSchema.parse({
        id: existing?.id ?? createStableJobDomainId('search-profile', [profileName, titles]),
        name: profileName.trim(),
        titles: splitTerms(titles),
        adjacentTitles: [],
        locations: splitTerms(locations),
        excludedLocations: [],
        workplaceTypes: [],
        employmentTypes: [],
        requiredTerms: splitTerms(requiredTerms),
        preferredTerms: splitTerms(preferredTerms),
        excludedTerms: splitTerms(excludedTerms),
        maximumAgeDays: 30,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })
      await store.put('jobSearchProfiles', profile)
      if (activeDraft) await scoreCurrentPostings(profile, activeDraft.id)
      setNotice(t('profileSaved'))
      await load()
    } catch {
      setError(t('errors.invalidProfile'))
    }
  }

  async function refresh(source: JobSource) {
    if (source.kind === 'manual' || !activeDraft || !trustedDraft) {
      setError(!trustedDraft ? t('errors.resumeRequired') : t('errors.invalidSource'))
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    const generation = refreshGenerationRef.current + 1
    refreshGenerationRef.current = generation
    controllerRef.current = controller
    setBusySourceId(source.id)
    setError('')
    try {
      const summary = await refreshJobSource({
        source,
        adapter: createAdapter(source.kind),
        store,
        signal: controller.signal
      })
      if (refreshGenerationRef.current !== generation) return
      const profile = profiles[0]
      if (profile) await scoreCurrentPostings(profile, activeDraft.id)
      setNotice(t(summary.completeness === 'partial' || summary.warningCount > 0
        ? 'refreshPartial'
        : 'refreshComplete', {
        added: summary.newCount,
        updated: summary.updatedCount,
        closed: summary.closedCount,
        warnings: summary.warningCount
      }))
      await load()
    } catch (refreshError) {
      if (refreshGenerationRef.current !== generation) return
      if (controller.signal.aborted) setNotice(t('refreshCancelled'))
      else setError(refreshError instanceof JobSourceError
        ? t(`errors.${refreshError.code}`)
        : t('errors.refresh'))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setBusySourceId('')
      }
    }
  }

  async function scoreCurrentPostings(profile: JobSearchProfile, draftId: string) {
    const [currentPostings, facts] = await Promise.all([
      store.list('jobPostings'),
      store.list('careerFacts')
    ])
    const evidenceSourceId = careerEvidenceSourceId(draftId)
    const relevantFacts = facts.filter((fact) => fact.evidenceRefs.includes(evidenceSourceId))
    const now = new Date().toISOString()
    await store.transaction(['jobRecommendations'], 'readwrite', async (transaction) => {
      for (const posting of currentPostings) {
        const recommendation = scoreJobRecommendation({
          posting,
          profile,
          sourceDraftId: draftId,
          facts: relevantFacts,
          now
        })
        const existing = await transaction.get('jobRecommendations', recommendation.id)
        await transaction.put('jobRecommendations', {
          ...recommendation,
          decision: existing?.decision ?? recommendation.decision,
          analyzedTargetJobId: existing?.analyzedTargetJobId,
          createdAt: existing?.createdAt ?? recommendation.createdAt
        })
      }
    })
  }

  async function decide(recommendation: JobRecommendation, decision: 'saved' | 'ignored') {
    const now = new Date().toISOString()
    await store.put('jobRecommendations', { ...recommendation, decision, updatedAt: now })
    if (decision === 'saved' && activeDraft) {
      const id = createStableJobDomainId('application', [recommendation.postingId, activeDraft.id])
      const existing = applications.find((application) => application.id === id)
      await store.put('applicationRecords', existing ?? {
        id,
        postingId: recommendation.postingId,
        sourceDraftId: activeDraft.id,
        status: 'saved',
        notes: '',
        createdAt: now,
        updatedAt: now
      })
    }
    await load()
  }

  async function analyzePosting(posting: JobPosting, recommendation: JobRecommendation) {
    if (!activeDraft || !trustedDraft) {
      setError(t('errors.resumeRequired'))
      return
    }
    try {
      saveJobPromotionIntent(createJobPromotionIntent({
        posting,
        recommendation,
        sourceDraftId: activeDraft.id
      }))
      await decide(recommendation, 'saved')
      if (desktop) desktop.openApp('jd-match')
      else window.location.assign(`/${locale}/jd-match`)
    } catch {
      setError(t('errors.promotion'))
    }
  }

  async function prepareApplication(recordId: string) {
    if (!activeDraft || !trustedDraft) return
    setBusyApplicationId(recordId)
    setError('')
    try {
      await prepareApplicationPacket({ store, recordId, resume: activeDraft.data, now: new Date().toISOString() })
    } catch (caught) {
      setError(caught instanceof ApplicationRecordError && caught.code === 'PACKET_NOT_READY'
        ? t('errors.packet')
        : t('errors.applicationSave'))
    } finally {
      setBusyApplicationId('')
      await load()
    }
  }

  async function confirmApplied(recordId: string) {
    if (!activeDraft || !trustedDraft) return
    setBusyApplicationId(recordId)
    setError('')
    try {
      await markApplicationApplied({ store, recordId, resume: activeDraft.data, now: new Date().toISOString() })
      setNotice(t('applicationConfirmed'))
    } catch {
      setError(t('errors.packet'))
    } finally {
      setBusyApplicationId('')
      await load()
    }
  }

  async function saveApplicationNotes(recordId: string, notes: string) {
    const record = applications.find((item) => item.id === recordId)
    if (!record || record.notes === notes.trim()) return
    try {
      await store.put('applicationRecords', { ...record, notes: notes.trim(), updatedAt: new Date().toISOString() })
      await load()
    } catch {
      setError(t('errors.applicationSave'))
    }
  }

  const recommendationByPosting = new Map(recommendations.map((item) => [item.postingId, item]))
  const applicationByPosting = new Map(applications.map((item) => [item.postingId, item]))
  const visible = postings.filter((posting) => {
    const decision = recommendationByPosting.get(posting.id)?.decision ?? 'new'
    const application = applicationByPosting.get(posting.id)
    if (filter === 'closed') return posting.status === 'closed'
    if (posting.status === 'closed') return filter === 'all'
    if (filter === 'needs-analysis') return Boolean(application && ['saved', 'analyzing', 'preparing'].includes(application.status))
    if (filter === 'ready') return application?.status === 'ready-to-apply'
    if (filter === 'applied') return Boolean(application && ['applied', 'interviewing', 'offered', 'rejected', 'withdrawn', 'archived'].includes(application.status))
    return filter === 'all' || decision === filter
  })

  return <main className="job-radar-app" aria-label={t('title')}>
    <header className="job-radar-app__header">
      <div><span><Radar size={14} aria-hidden="true" />{t('eyebrow')}</span><h1>{t('title')}</h1><p>{t('description')}</p></div>
      {busySourceId ? <button type="button" onClick={() => controllerRef.current?.abort()}><X size={14} />{t('cancel')}</button> : null}
    </header>
    {error ? <p className="job-radar-app__error" role="alert">{error}</p> : null}
    {notice ? <p className="job-radar-app__notice" role="status">{notice}</p> : null}
    <div className="job-radar-app__layout">
      <aside>
        <section><h2>{t('sources')}</h2>
          <label>{t('sourceKind')}<select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as SourceKind)}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></label>
          <label>{t('sourceKey')}<input value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} placeholder="company-slug" /></label>
          <button type="button" onClick={() => void addSource()} disabled={!sourceKey.trim()}>{t('addSource')}</button>
          <ul>{sources.map((source) => <li key={source.id}><span>{source.label}<small>{source.kind}</small></span><button type="button" disabled={Boolean(busySourceId)} onClick={() => void refresh(source)} aria-label={t('refreshSource', { source: source.label })}>{busySourceId === source.id ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button></li>)}</ul>
        </section>
        <section><h2>{t('profile')}</h2>
          <label>{t('profileName')}<input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
          <label>{t('titles')}<input value={titles} onChange={(event) => setTitles(event.target.value)} /></label>
          <label>{t('locations')}<input value={locations} onChange={(event) => setLocations(event.target.value)} /></label>
          <label>{t('requiredTerms')}<input value={requiredTerms} onChange={(event) => setRequiredTerms(event.target.value)} /></label>
          <label>{t('preferredTerms')}<input value={preferredTerms} onChange={(event) => setPreferredTerms(event.target.value)} /></label>
          <label>{t('excludedTerms')}<input value={excludedTerms} onChange={(event) => setExcludedTerms(event.target.value)} /></label>
          <button type="button" onClick={() => void saveProfile()} disabled={!profileName.trim() || !titles.trim()}><Save size={14} />{t('saveProfile')}</button>
        </section>
      </aside>
      <section className="job-radar-app__inbox">
        <div className="job-radar-app__toolbar"><h2>{t('inbox')}</h2><div role="group" aria-label={t('filters')}>{(['all', 'new', 'saved', 'needs-analysis', 'ready', 'applied', 'ignored', 'closed'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`filter.${value}`)}</button>)}</div></div>
        {!trustedDraft ? <p className="job-radar-app__empty">{t('resumeRequired')}</p> : visible.length === 0 ? <p className="job-radar-app__empty">{t('empty')}</p> : <ul className="job-radar-app__jobs">{visible.map((posting) => {
          const recommendation = recommendationByPosting.get(posting.id)
          return <li key={posting.id} data-status={posting.status}>
            <article><header><div><span>{posting.company}</span><h3>{posting.title}</h3><p>{[posting.location, posting.workplaceType, posting.employmentType].filter(Boolean).join(' · ') || t('unknown')}</p></div>{recommendation?.preliminaryScore !== undefined ? <strong aria-label={t('scoreLabel', { score: recommendation.preliminaryScore })}>{Math.round(recommendation.preliminaryScore)}</strong> : null}</header>
              <p>{posting.description.slice(0, 240)}</p><small>{t('sourceStatus', { source: sources.find((item) => item.id === posting.sourceId)?.kind ?? 'manual', status: posting.status })}</small>
              {recommendation ? <details><summary>{t('whyRecommended')}</summary><ul>{recommendation.reasons.map((reason) => <li key={reason.code}>{t('reason', { code: reason.code, contribution: reason.contribution })}</li>)}</ul></details> : <p>{t('unknownRecommendation')}</p>}
              <footer>{recommendation ? <><button type="button" onClick={() => void decide(recommendation, 'saved')}><Save size={13} />{t('save')}</button><button type="button" onClick={() => void decide(recommendation, 'ignored')}>{t('ignore')}</button><button type="button" onClick={() => void analyzePosting(posting, recommendation)}>{t('analyze')}</button></> : null}<a href={posting.canonicalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />{t('openOriginal')}</a></footer>
            </article>
          </li>
        })}</ul>}
        <ApplicationPipeline
          packets={packets}
          pendingId={busyApplicationId}
          onPrepare={(id) => void prepareApplication(id)}
          onMarkApplied={(id) => void confirmApplied(id)}
          onNotesChange={(id, notes) => void saveApplicationNotes(id, notes)}
        />
      </section>
    </div>
  </main>
}

function splitTerms(value: string) {
  return [...new Set(value.split(/[,，\n]/u).map((term) => term.trim()).filter(Boolean))]
}

function byUpdatedAt(left: { updatedAt: string }, right: { updatedAt: string }) {
  return right.updatedAt.localeCompare(left.updatedAt)
}
