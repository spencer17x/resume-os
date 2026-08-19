'use client'

import { Bot, BrainCircuit, ClipboardPaste, ExternalLink, MessageSquareText, Radar, Save, ShieldCheck, X } from 'lucide-react'
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
import { refreshSelectedJobMarket } from '@/lib/jobs/job-market-search'
import { importMarketplaceJob } from '@/lib/jobs/manual-job-import'
import { parseJobClipboardText } from '@/lib/jobs/job-clipboard-import'
import {
  detectBrowserAgentSessions,
  type BrowserPlatformSession
} from '@/lib/jobs/browser-agent-protocol'
import {
  DEFAULT_JOB_AGENT_PREFERENCES,
  JOB_AGENT_PLATFORM_IDS,
  JOB_AGENT_PREFERENCES_KEY,
  parseJobAgentPreferences,
  serializeJobAgentPreferences,
  type JobAgentPreferences
} from '@/lib/jobs/job-agent-policy'
import {
  DEFAULT_JOB_MARKETPLACES,
  PRIMARY_JOB_MARKETPLACE_IDS,
  buildOfficialMarketplaceSearchUrl,
  deriveJobSearchSeed,
  type JobMarketplaceId
} from '@/lib/jobs/job-marketplace'
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
  const [selectedPlatforms, setSelectedPlatforms] = useState<JobMarketplaceId[]>([...DEFAULT_JOB_MARKETPLACES])
  const [agentPreferences, setAgentPreferences] = useState<JobAgentPreferences>(DEFAULT_JOB_AGENT_PREFERENCES)
  const [browserSessions, setBrowserSessions] = useState<BrowserPlatformSession[]>([])
  const [browserAgentAvailable, setBrowserAgentAvailable] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [titles, setTitles] = useState('')
  const [locations, setLocations] = useState('')
  const [preferredCompanies, setPreferredCompanies] = useState('')
  const [requiredTerms, setRequiredTerms] = useState('')
  const [preferredTerms, setPreferredTerms] = useState('')
  const [excludedTerms, setExcludedTerms] = useState('')
  const [importPlatform, setImportPlatform] = useState<JobMarketplaceId>('boss')
  const [clipboardJobText, setClipboardJobText] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [importTitle, setImportTitle] = useState('')
  const [importCompany, setImportCompany] = useState('')
  const [importLocation, setImportLocation] = useState('')
  const [importDescription, setImportDescription] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busySourceId, setBusySourceId] = useState('')
  const [marketProgress, setMarketProgress] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const refreshGenerationRef = useRef(0)
  const hydratedProfileIdRef = useRef('')
  const seededDraftIdRef = useRef('')
  const agentPreferencesHydratedRef = useRef(false)
  const browserAutoRunRef = useRef(false)

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
    setLoaded(true)
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
    setAgentPreferences(parseJobAgentPreferences(window.localStorage.getItem(JOB_AGENT_PREFERENCES_KEY)))
    agentPreferencesHydratedRef.current = true
  }, [])
  useEffect(() => {
    if (!agentPreferencesHydratedRef.current) return
    window.localStorage.setItem(JOB_AGENT_PREFERENCES_KEY, serializeJobAgentPreferences(agentPreferences))
  }, [agentPreferences])
  useEffect(() => {
    let active = true
    void detectBrowserAgentSessions({ window }).then((response) => {
      if (!active) return
      setBrowserAgentAvailable(response.ok)
      setBrowserSessions(response.sessions ?? [])
    })
    return () => { active = false }
  }, [])
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
    const primaryPlatforms = profile.platforms?.filter((platform) => (
      PRIMARY_JOB_MARKETPLACE_IDS.includes(platform as typeof PRIMARY_JOB_MARKETPLACE_IDS[number])
    )) ?? []
    setSelectedPlatforms(primaryPlatforms.length ? primaryPlatforms : [...DEFAULT_JOB_MARKETPLACES])
    setTitles(profile.titles.join(', '))
    setLocations(profile.locations.join(', '))
    setPreferredCompanies(profile.preferredCompanies?.join(', ') ?? '')
    setRequiredTerms(profile.requiredTerms.join(', '))
    setPreferredTerms(profile.preferredTerms.join(', '))
    setExcludedTerms(profile.excludedTerms.join(', '))
  }, [profiles])

  useEffect(() => {
    if (!loaded || profiles.length > 0 || !activeDraft || !trustedDraft) return
    if (seededDraftIdRef.current === activeDraft.id) return
    seededDraftIdRef.current = activeDraft.id
    const seed = deriveJobSearchSeed(activeDraft.data)
    setProfileName(seed.name)
    setTitles(seed.titles.join(', '))
    setLocations(seed.locations.join(', '))
    setPreferredTerms(seed.preferredTerms.join(', '))
  }, [activeDraft, loaded, profiles.length, trustedDraft])
  useEffect(() => {
    if (
      !browserAgentAvailable
      || browserAutoRunRef.current
      || !loaded
      || !trustedDraft
      || !titles.trim()
      || busySourceId
    ) return
    browserAutoRunRef.current = true
    void searchMarket()
  }, [browserAgentAvailable, busySourceId, loaded, titles, trustedDraft])

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

  async function saveProfile(announce = true): Promise<JobSearchProfile | null> {
    setError('')
    try {
      const now = new Date().toISOString()
      const existing = profiles[0]
      const profile = jobSearchProfileSchema.parse({
        id: existing?.id ?? createStableJobDomainId('search-profile', [profileName, titles]),
        name: profileName.trim(),
        platforms: selectedPlatforms,
        titles: splitTerms(titles),
        adjacentTitles: [],
        locations: splitTerms(locations),
        excludedLocations: [],
        workplaceTypes: [],
        employmentTypes: [],
        requiredTerms: splitTerms(requiredTerms),
        preferredTerms: splitTerms(preferredTerms),
        excludedTerms: splitTerms(excludedTerms),
        preferredCompanies: splitTerms(preferredCompanies),
        maximumAgeDays: 30,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })
      await store.put('jobSearchProfiles', profile)
      if (activeDraft) await scoreCurrentPostings(profile, activeDraft.id)
      if (announce) setNotice(t('profileSaved'))
      await load()
      return profile
    } catch {
      setError(t('errors.invalidProfile'))
      return null
    }
  }

  async function searchMarket() {
    if (!activeDraft || !trustedDraft) {
      setError(t('errors.resumeRequired'))
      return
    }
    if (selectedPlatforms.length === 0) {
      setError(t('errors.platformRequired'))
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    const generation = refreshGenerationRef.current + 1
    refreshGenerationRef.current = generation
    controllerRef.current = controller
    setBusySourceId('market')
    setMarketProgress(t('marketStarting'))
    setError('')
    setNotice('')
    try {
      const profile = await saveProfile(false)
      if (!profile || controller.signal.aborted || refreshGenerationRef.current !== generation) return
      const result = await refreshSelectedJobMarket({
        platforms: selectedPlatforms,
        existingSources: sources,
        store,
        createAdapter,
        signal: controller.signal,
        onProgress(completed, total, source) {
          if (refreshGenerationRef.current !== generation) return
          setMarketProgress(t('marketProgress', { completed, total, source: source.label }))
        }
      })
      if (refreshGenerationRef.current !== generation) return
      await scoreCurrentPostings(profile, activeDraft.id)
      const totals = result.summaries.reduce((summary, source) => ({
        added: summary.added + source.newCount,
        updated: summary.updated + source.updatedCount,
        closed: summary.closed + source.closedCount,
        warnings: summary.warnings + source.warningCount
      }), { added: 0, updated: 0, closed: 0, warnings: 0 })
      setNotice(result.sourceCount === 0
        ? t('marketManualOnly')
        : t('marketComplete', {
          sources: result.sourceCount,
          added: totals.added,
          updated: totals.updated,
          failures: result.failures.length,
          skipped: result.skippedCount
        }))
      await load()
    } catch (caught) {
      if (refreshGenerationRef.current !== generation) return
      if (controller.signal.aborted || (caught instanceof DOMException && caught.name === 'AbortError')) {
        setNotice(t('refreshCancelled'))
      } else {
        setError(t('errors.refresh'))
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setBusySourceId('')
        setMarketProgress('')
      }
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

  async function importAndAnalyze() {
    if (!activeDraft || !trustedDraft) {
      setError(t('errors.resumeRequired'))
      return
    }
    setError('')
    setNotice('')
    try {
      const profile = await saveProfile(false)
      if (!profile) return
      const facts = (await store.list('careerFacts')).filter((fact) => (
        fact.evidenceRefs.includes(careerEvidenceSourceId(activeDraft.id))
      ))
      const imported = await importMarketplaceJob({
        store,
        platform: importPlatform,
        url: importUrl,
        title: importTitle,
        company: importCompany,
        description: importDescription,
        location: importLocation,
        locale: locale === 'zh' ? 'zh' : 'en',
        profile,
        sourceDraftId: activeDraft.id,
        facts
      })
      saveJobPromotionIntent(createJobPromotionIntent({
        posting: imported.posting,
        recommendation: imported.recommendation,
        sourceDraftId: activeDraft.id
      }))
      setImportUrl('')
      setImportTitle('')
      setImportCompany('')
      setImportLocation('')
      setImportDescription('')
      if (desktop) desktop.openApp('jd-match')
      else window.location.assign(`/${locale}/jd-match`)
    } catch {
      setError(t('errors.importJob'))
    }
  }

  function prefillFromClipboard() {
    setError('')
    setNotice('')
    try {
      const parsed = parseJobClipboardText(clipboardJobText)
      if (parsed.platform && PRIMARY_JOB_MARKETPLACE_IDS.includes(parsed.platform as typeof PRIMARY_JOB_MARKETPLACE_IDS[number])) {
        setImportPlatform(parsed.platform)
      }
      if (parsed.url) setImportUrl(parsed.url)
      if (parsed.title) setImportTitle(parsed.title)
      if (parsed.company) setImportCompany(parsed.company)
      if (parsed.location) setImportLocation(parsed.location)
      if (parsed.description) setImportDescription(parsed.description)
      setNotice(t('clipboardParsed'))
    } catch {
      setError(t('errors.clipboardJob'))
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
  }).sort((left, right) => {
    const leftScore = recommendationByPosting.get(left.id)?.preliminaryScore ?? -1
    const rightScore = recommendationByPosting.get(right.id)?.preliminaryScore ?? -1
    return rightScore - leftScore || right.lastCheckedAt.localeCompare(left.lastCheckedAt)
  })
  const officialSearchPlatforms = selectedPlatforms.filter((platform): platform is Extract<JobMarketplaceId, 'boss' | '51job' | 'lagou' | 'liepin' | '58'> => (
    platform === 'boss' || platform === '51job' || platform === 'lagou' || platform === 'liepin' || platform === '58'
  ))
  const primaryTitle = splitTerms(titles)[0]
  const primaryLocation = splitTerms(locations)[0]

  return <main className="job-radar-app" aria-label={t('title')}>
    <header className="job-radar-app__header">
      <div><span><Radar size={14} aria-hidden="true" />{t('eyebrow')}</span><h1>{t('title')}</h1><p>{t('description')}</p></div>
      {busySourceId ? <button type="button" onClick={() => controllerRef.current?.abort()}><X size={14} />{t('cancel')}</button> : null}
    </header>
    {error ? <p className="job-radar-app__error" role="alert">{error}</p> : null}
    {notice ? <p className="job-radar-app__notice" role="status">{notice}</p> : null}
    <div className="job-radar-app__layout">
      <aside>
        <section className="job-radar-app__agent-control">
          <div className="job-radar-app__agent-heading"><Bot size={16} aria-hidden="true" /><div><h2>{t('jobAgent.title')}</h2><p>{t('jobAgent.description')}</p></div></div>
          <div className="job-radar-app__agent-enabled"><ShieldCheck size={14} aria-hidden="true" /><span><strong>{t('jobAgent.zeroConfig')}</strong><small>{t('jobAgent.zeroConfigHelp')}</small></span></div>
          <p className="job-radar-app__section-help" aria-live="polite">{browserAgentAvailable ? t('jobAgent.browserReady') : t('jobAgent.browserMissing')}</p>
          <div className="job-radar-app__agent-platforms" role="list" aria-label={t('jobAgent.platformLegend')}>{JOB_AGENT_PLATFORM_IDS.map((platform) => {
            const session = browserSessions.find((item) => item.platform === platform)
            const state = session?.state ?? 'unknown'
            return <div key={platform} role="listitem" data-session={state}>
              <span><strong>{t(`jobAgent.platform.${platform}`)}</strong><small>{t(`jobAgent.session.${state}`)}</small></span>
            </div>
          })}</div>
          <div className="job-radar-app__learning"><BrainCircuit size={14} aria-hidden="true" /><div><strong>{t('jobAgent.learning')}</strong><p>{t('jobAgent.learningHelp')}</p></div></div>
          <p className="job-radar-app__section-help">{t('jobAgent.learnReplies')} · {t('jobAgent.learnOutcomes')}</p>
          <button className="job-radar-app__market-search" type="button" onClick={() => void searchMarket()} disabled={Boolean(busySourceId) || !trustedDraft || selectedPlatforms.length === 0 || !titles.trim()}><Bot size={14} />{t('jobAgent.runNow')}</button>
          {marketProgress ? <p className="job-radar-app__progress" role="status">{marketProgress}</p> : null}
          {officialSearchPlatforms.length > 0 ? <div className="job-radar-app__official-searches"><h3>{t('officialSearches')}</h3><p>{t('officialSearchHelp')}</p><ul>{officialSearchPlatforms.map((platform) => <li key={platform}><a href={buildOfficialMarketplaceSearchUrl({ platform, title: primaryTitle, location: primaryLocation })} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />{t('openMarketplace', { platform: t(`marketplace.${platform}.name`) })}</a><small>{t(`marketplace.${platform}.note`)}</small></li>)}</ul></div> : null}
          <p className="job-radar-app__section-help">{t('jobAgent.runtimeBoundary')}</p>
        </section>
        <section><h2>{t('profile')}</h2>
          <label>{t('profileName')}<input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
          <label>{t('titles')}<input value={titles} onChange={(event) => setTitles(event.target.value)} /></label>
          <label>{t('locations')}<input value={locations} onChange={(event) => setLocations(event.target.value)} /></label>
          <label>{t('preferredCompanies')}<input value={preferredCompanies} onChange={(event) => setPreferredCompanies(event.target.value)} placeholder={t('preferredCompaniesPlaceholder')} /></label>
          <label>{t('requiredTerms')}<input value={requiredTerms} onChange={(event) => setRequiredTerms(event.target.value)} /></label>
          <label>{t('preferredTerms')}<input value={preferredTerms} onChange={(event) => setPreferredTerms(event.target.value)} /></label>
          <label>{t('excludedTerms')}<input value={excludedTerms} onChange={(event) => setExcludedTerms(event.target.value)} /></label>
          <button type="button" onClick={() => void saveProfile()} disabled={!profileName.trim() || !titles.trim() || selectedPlatforms.length === 0}><Save size={14} />{t('saveProfile')}</button>
        </section>
        <section><h2>{t('importJob')}</h2>
          <p className="job-radar-app__section-help">{t('importJobHelp')}</p>
          <label>{t('clipboardJob')}<textarea value={clipboardJobText} onChange={(event) => setClipboardJobText(event.target.value)} rows={6} placeholder={t('clipboardJobPlaceholder')} /></label>
          <button type="button" onClick={prefillFromClipboard} disabled={!clipboardJobText.trim()}><ClipboardPaste size={14} />{t('parseClipboardJob')}</button>
          <label>{t('importPlatform')}<select value={importPlatform} onChange={(event) => setImportPlatform(event.target.value as JobMarketplaceId)}>{PRIMARY_JOB_MARKETPLACE_IDS.map((platform) => <option key={platform} value={platform}>{t(`marketplace.${platform}.name`)}</option>)}</select></label>
          <label>{t('importUrl')}<input type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://…" /></label>
          <label>{t('importTitle')}<input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} /></label>
          <label>{t('importCompany')}<input value={importCompany} onChange={(event) => setImportCompany(event.target.value)} /></label>
          <label>{t('importLocation')}<input value={importLocation} onChange={(event) => setImportLocation(event.target.value)} /></label>
          <label>{t('importDescription')}<textarea value={importDescription} onChange={(event) => setImportDescription(event.target.value)} rows={7} /></label>
          <button type="button" onClick={() => void importAndAnalyze()} disabled={!trustedDraft || !importUrl.trim() || !importTitle.trim() || !importCompany.trim() || !importDescription.trim() || !profileName.trim() || !titles.trim()}><ClipboardPaste size={14} />{t('importAndAnalyze')}</button>
        </section>
      </aside>
      <section className="job-radar-app__inbox">
        <section className="job-radar-app__communication" aria-label={t('jobAgent.communicationTitle')}>
          <div><MessageSquareText size={17} aria-hidden="true" /><span><strong>{t('jobAgent.communicationTitle')}</strong><small>{t('jobAgent.communicationHelp')}</small></span></div>
          <ol><li data-ready="true">{t('jobAgent.stage.discover')}</li><li>{t('jobAgent.stage.qualify')}</li><li>{t('jobAgent.stage.tailor')}</li><li>{t('jobAgent.stage.chat')}</li><li>{t('jobAgent.stage.learn')}</li></ol>
          <p>{t('jobAgent.connectorBoundary')}</p>
        </section>
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
