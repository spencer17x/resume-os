'use client'

import dynamic from 'next/dynamic'
import {
  Activity,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  ClipboardPaste,
  ExternalLink,
  FileText,
  CalendarClock,
  LayoutDashboard,
  MessageSquareText,
  Pause,
  Play,
  Radar,
  Save,
  Send,
  Settings2,
  SlidersHorizontal,
  X
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { usePathname } from '@/i18n/navigation'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { ApplicationPipeline } from '@/components/apps/application-pipeline'
import { ResumeVariantLibrary } from '@/components/apps/resume-variant-library'
import { JobProcessBoard } from '@/components/apps/job-process-board'
import { JobHistoryLearningPanel } from '@/components/apps/job-history-learning-panel'
import { JobAgentRuntimeStatus } from '@/components/apps/job-agent-runtime-status'
import type { JobSetupValues } from '@/components/apps/job-agent-setup'
import { careerEvidenceSourceId } from '@/lib/agent/career-evidence'
import { ACTIVE_WORKFLOW_CHANGED_EVENT } from '@/lib/agent/workflow-persistence'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import {
  createJobInputFingerprint,
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
import { analyzeBossCandidateQueue, queueBossCandidates, upsertBossBrowserJobs } from '@/lib/jobs/boss-agent'
import { requestBossCandidateAnalysis } from '@/lib/jobs/boss-analysis-client'
import {
  approveBossConversationMessage,
  syncBossConversationSignals,
  ensureBossOpeningDraft,
  ensureBossFollowUpDrafts,
  ensureBossResumeReceiptReplyDraft,
  ensureBossSignalReplyDrafts,
  executeBossResumeAttachment,
  executeApprovedBossMessage,
  reviseBossMessageDraft,
  verifyBossConversationRecipient,
  type BossConversationMessage,
  type BossConversationThread
} from '@/lib/jobs/boss-conversation'
import { createJobPromotionIntent, saveJobPromotionIntent } from '@/lib/jobs/job-promotion'
import { refreshJobSource } from '@/lib/jobs/job-refresh'
import { refreshSelectedJobMarket } from '@/lib/jobs/job-market-search'
import { importMarketplaceJob } from '@/lib/jobs/manual-job-import'
import { parseJobClipboardText } from '@/lib/jobs/job-clipboard-import'
import { analyzeJobGoalDescription } from '@/lib/jobs/job-goal-description'
import { formatMonthlyCompensation, recommendationReasonMessageKey, sanitizeJobDisplayText } from '@/lib/jobs/job-display'
import {
  collectBossBrowserJobs,
  collectBossJobDetail,
  collectBossConversationSignals,
  configureBrowserJobAgent,
  detectBrowserAgentSessions,
  diagnoseBossBrowserAdapter,
  getBrowserJobAgentRuntime,
  inspectBossBrowserConversation,
  readBrowserJobAgentCycle,
  reportBrowserJobAgentCycle,
  searchBossBrowserJobs,
  summarizeBossHistory,
  sendBossBrowserMessage,
  sendBossResumeAttachment,
  JOB_AGENT_WAKE_EVENT,
  type BrowserBossJob,
  type BrowserBossAdapterDiagnostic,
  type BrowserJobAgentRuntime,
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
import { simulateJobAgentFromHistory, type JobHistorySimulation } from '@/lib/jobs/job-history-learning'
import {
  DEFAULT_JOB_MARKETPLACES,
  PRIMARY_JOB_MARKETPLACE_IDS,
  buildOfficialMarketplaceSearchUrl,
  deriveJobSearchSeed,
  type JobMarketplaceId
} from '@/lib/jobs/job-marketplace'
import {
  ApplicationRecordError,
  markApplicationApplied,
  prepareApplicationPacket,
  prepareReadyBossApplicationPackets,
  type ApplicationPacket
} from '@/lib/jobs/application-record'
import { createSameOriginJobSourceAdapter, JobSourceError } from '@/lib/jobs/sources'
import type { JobSourceAdapter } from '@/lib/jobs/sources'
import type { AppId } from '@/lib/desktop/types'

type SourceKind = Extract<JobSource['kind'], 'greenhouse' | 'lever'>
type Filter = 'all' | 'new' | 'saved' | 'needs-analysis' | 'ready' | 'applied' | 'ignored' | 'closed'
type JobWorkspaceSection = 'overview' | 'opportunities' | 'resumes' | 'conversations' | 'applications' | 'interviews' | 'activity' | 'preferences' | 'profile' | 'target-job' | 'settings' | 'setup'

const LazyInterviewWorkspace = dynamic(
  () => import('@/components/apps/interview-workspace').then((module) => module.InterviewWorkspace),
  { loading: JobEmbeddedLoading }
)
const LazyJDMatchApp = dynamic(
  () => import('@/components/apps/jd-match-app').then((module) => module.JDMatchApp),
  { loading: JobEmbeddedLoading }
)
const LazyResumeStudioApp = dynamic(
  () => import('@/components/apps/resume-studio-app').then((module) => module.ResumeStudioApp),
  { loading: JobEmbeddedLoading }
)
const LazyResumeAgentApp = dynamic(
  () => import('@/components/apps/resume-agent-app').then((module) => module.ResumeAgentApp),
  { loading: JobEmbeddedLoading }
)
const LazySettingsApp = dynamic(
  () => import('@/components/apps/settings-app').then((module) => module.SettingsApp),
  { loading: JobEmbeddedLoading }
)
const LazyJobAgentSetup = dynamic(
  () => import('@/components/apps/job-agent-setup').then((module) => module.JobAgentSetup),
  { loading: JobEmbeddedLoading }
)

function JobEmbeddedLoading() {
  const t = useTranslations('jobRadar.workspace')
  return <div className="job-embedded-loading" role="status" aria-label={t('loadingModule')} aria-busy="true"><span /></div>
}

function Link({ href, onClick, ...props }: Omit<ComponentPropsWithoutRef<'a'>, 'href'> & { href: string }) {
  const locale = useLocale()
  return <a {...props} href={`/${locale}${href}`} onClick={(event) => {
    onClick?.(event)
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || props.target === '_blank'
    ) return
    event.preventDefault()
    navigateJobWorkspace(locale, href)
  }} />
}

function navigateJobWorkspace(locale: string, href: string) {
  const localizedHref = href.startsWith(`/${locale}/`) ? href : `/${locale}${href}`
  window.history.pushState(null, '', localizedHref)
}

export type JobRadarAppProps = {
  appId?: AppId
  store?: IndexedDbDomainStore
  createAdapter?: (kind: SourceKind) => JobSourceAdapter
}

export function JobRadarApp({ store: storeOverride, createAdapter = createSameOriginJobSourceAdapter }: JobRadarAppProps = {}) {
  const t = useTranslations('jobRadar')
  const desktopT = useTranslations('desktop')
  const locale = useLocale()
  const pathname = usePathname()
  const workspaceSection = jobWorkspaceSection(pathname)
  const { activeDraft } = useResumeDraft()
  const trustedDraft = Boolean(activeDraft && ['paste', 'upload'].includes(activeDraft.source))
  const [store] = useState(() => storeOverride ?? createDomainStore())
  const [sources, setSources] = useState<JobSource[]>([])
  const [profiles, setProfiles] = useState<JobSearchProfile[]>([])
  const [postings, setPostings] = useState<JobPosting[]>([])
  const [recommendations, setRecommendations] = useState<JobRecommendation[]>([])
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [packets, setPackets] = useState<ApplicationPacket[]>([])
  const [conversationThreads, setConversationThreads] = useState<BossConversationThread[]>([])
  const [conversationMessages, setConversationMessages] = useState<BossConversationMessage[]>([])
  const [busyApplicationId, setBusyApplicationId] = useState('')
  const [busyConversationMessageId, setBusyConversationMessageId] = useState('')
  const [busyResumeThreadId, setBusyResumeThreadId] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceKind>('greenhouse')
  const [sourceKey, setSourceKey] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<JobMarketplaceId[]>([...DEFAULT_JOB_MARKETPLACES])
  const [agentPreferences, setAgentPreferences] = useState<JobAgentPreferences>(DEFAULT_JOB_AGENT_PREFERENCES)
  const [agentPreferencesHydrated, setAgentPreferencesHydrated] = useState(false)
  const [browserSessions, setBrowserSessions] = useState<BrowserPlatformSession[]>([])
  const [browserAgentAvailable, setBrowserAgentAvailable] = useState(false)
  const [adapterDiagnostics, setAdapterDiagnostics] = useState<BrowserBossAdapterDiagnostic[]>([])
  const [browserJobRuntime, setBrowserJobRuntime] = useState<BrowserJobAgentRuntime | null>(null)
  const [diagnosingAdapter, setDiagnosingAdapter] = useState(false)
  const [historyLearningBusy, setHistoryLearningBusy] = useState(false)
  const [historySimulation, setHistorySimulation] = useState<JobHistorySimulation | null>(null)
  const [profileName, setProfileName] = useState('')
  const [goalDescription, setGoalDescription] = useState('')
  const [titles, setTitles] = useState('')
  const [locations, setLocations] = useState('')
  const [preferredCompanies, setPreferredCompanies] = useState('')
  const [requiredTerms, setRequiredTerms] = useState('')
  const [preferredTerms, setPreferredTerms] = useState('')
  const [excludedTerms, setExcludedTerms] = useState('')
  const [advancedSetup, setAdvancedSetup] = useState({
    blockedCompanies: '',
    industries: '',
    experienceLevels: '',
    educationLevels: '',
    companySizes: '',
    financingStages: '',
    minimumSalary: '',
    maximumSalary: '',
    maximumAgeDays: 30,
    workplaceTypes: [] as JobSetupValues['workplaceTypes'],
    employmentTypes: [] as JobSetupValues['employmentTypes']
  })
  const [importPlatform, setImportPlatform] = useState<JobMarketplaceId>('boss')
  const [clipboardJobText, setClipboardJobText] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [importTitle, setImportTitle] = useState('')
  const [importCompany, setImportCompany] = useState('')
  const [importLocation, setImportLocation] = useState('')
  const [importDescription, setImportDescription] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedPostingId, setSelectedPostingId] = useState('')
  const [busySourceId, setBusySourceId] = useState('')
  const [marketProgress, setMarketProgress] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const refreshGenerationRef = useRef(0)
  const hydratedProfileIdRef = useRef('')
  const seededDraftIdRef = useRef('')
  const activeBrowserCyclesRef = useRef(new Set<string>())
  const savedSearchProfile = profiles[0]
  const agentSetupComplete = trustedDraft && Boolean(savedSearchProfile?.titles.length)
  const agentExecutionEnabled = agentPreferences.enabled && agentSetupComplete
  const agentRunning = agentExecutionEnabled && browserAgentAvailable
  const setupAnalysis = activeDraft && trustedDraft ? {
    name: activeDraft.data.profile.name,
    role: activeDraft.data.profile.title || activeDraft.data.targetRole || '',
    suggestedTitles: deriveJobSearchSeed(activeDraft.data).titles,
    skills: activeDraft.data.skills.flatMap((group) => group.items),
    experienceCount: activeDraft.data.experiences.length
  } : null
  const setupValues: JobSetupValues = {
    goalDescription,
    profileName,
    titles,
    locations,
    preferredCompanies,
    blockedCompanies: advancedSetup.blockedCompanies,
    requiredTerms,
    preferredTerms,
    excludedTerms,
    industries: advancedSetup.industries,
    experienceLevels: advancedSetup.experienceLevels,
    educationLevels: advancedSetup.educationLevels,
    companySizes: advancedSetup.companySizes,
    financingStages: advancedSetup.financingStages,
    minimumSalary: advancedSetup.minimumSalary,
    maximumSalary: advancedSetup.maximumSalary,
    maximumAgeDays: advancedSetup.maximumAgeDays,
    workplaceTypes: advancedSetup.workplaceTypes,
    employmentTypes: advancedSetup.employmentTypes,
    minimumMatchScore: agentPreferences.minimumMatchScore ?? 70,
    dailyContactLimit: agentPreferences.dailyContactLimit ?? 20,
    autonomy: agentPreferences.autonomy,
    autoSendResume: agentPreferences.autoSendResume ?? false
  }

  const load = useCallback(async () => {
    const [nextSources, nextProfiles, nextPostings, nextRecommendations, nextApplications, nextThreads, nextMessages] = await Promise.all([
      store.list('jobSources'),
      store.list('jobSearchProfiles'),
      store.list('jobPostings'),
      store.list('jobRecommendations'),
      store.list('applicationRecords'),
      store.list('bossConversationThreads'),
      store.list('bossConversationMessages')
    ])
    setSources(nextSources.sort(byUpdatedAt))
    setProfiles(nextProfiles.sort(byUpdatedAt))
    setPostings(nextPostings.sort((left, right) => right.lastCheckedAt.localeCompare(left.lastCheckedAt)))
    setRecommendations(nextRecommendations)
    setApplications(nextApplications)
    setConversationThreads(nextThreads.sort(byUpdatedAt))
    setConversationMessages(nextMessages.sort(byUpdatedAt))
    setLoaded(true)
    if (activeDraft && ['paste', 'upload'].includes(activeDraft.source)) {
      const automatic = await prepareReadyBossApplicationPackets({
        store,
        sourceDraftId: activeDraft.id,
        resume: activeDraft.data,
        now: () => new Date().toISOString()
      })
      if (automatic.preparedIds.length > 0) {
        const [latestApplications, latestThreads, latestMessages] = await Promise.all([
          store.list('applicationRecords'),
          store.list('bossConversationThreads'),
          store.list('bossConversationMessages')
        ])
        setApplications(latestApplications)
        setConversationThreads(latestThreads.sort(byUpdatedAt))
        setConversationMessages(latestMessages.sort(byUpdatedAt))
      }
      setPackets(automatic.packets)
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
    setAgentPreferencesHydrated(true)
  }, [])
  useEffect(() => {
    if (!agentPreferencesHydrated) return
    window.localStorage.setItem(JOB_AGENT_PREFERENCES_KEY, serializeJobAgentPreferences(agentPreferences))
  }, [agentPreferences, agentPreferencesHydrated])
  useEffect(() => {
    if (!loaded || !agentPreferencesHydrated || agentSetupComplete) return
    setAgentPreferences((current) => current.enabled ? { ...current, enabled: false } : current)
  }, [agentPreferencesHydrated, agentSetupComplete, loaded])
  useEffect(() => {
    let active = true
    void detectBrowserAgentSessions({ window }).then((response) => {
      if (!active) return
      setBrowserAgentAvailable(response.ok)
      setBrowserSessions(response.sessions ?? [])
      if (response.ok) {
        void syncConversationSignals()
        void runBossAdapterDiagnostics()
        void refreshBrowserJobRuntime()
      }
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
    setAdvancedSetup({
      blockedCompanies: profile.blockedCompanies?.join(', ') ?? '',
      industries: profile.industries?.join(', ') ?? '',
      experienceLevels: profile.experienceLevels?.join(', ') ?? '',
      educationLevels: profile.educationLevels?.join(', ') ?? '',
      companySizes: profile.companySizes?.join(', ') ?? '',
      financingStages: profile.financingStages?.join(', ') ?? '',
      minimumSalary: profile.minimumMonthlySalary?.toString() ?? '',
      maximumSalary: profile.maximumMonthlySalary?.toString() ?? '',
      maximumAgeDays: profile.maximumAgeDays,
      workplaceTypes: profile.workplaceTypes,
      employmentTypes: profile.employmentTypes
    })
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
    if (!browserAgentAvailable) return
    const timeout = window.setTimeout(() => {
      void configureBrowserJobAgent({ window, enabled: agentExecutionEnabled, intervalMinutes: 15 }).then((response) => {
        if (response.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
      })
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [agentExecutionEnabled, browserAgentAvailable])
  useEffect(() => {
    const wake = (event: Event) => {
      const parsed = readBrowserJobAgentCycle(event)
      if (!parsed.success || activeBrowserCyclesRef.current.has(parsed.data.id)) return
      activeBrowserCyclesRef.current.add(parsed.data.id)
      const run = async () => {
        try {
          if (!agentExecutionEnabled || !titles.trim() || busySourceId) {
            const response = await reportBrowserJobAgentCycle({ window, cycleId: parsed.data.id, status: 'skipped' })
            if (response.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
            return
          }
          await Promise.all([searchMarket(), syncConversationSignals()])
          const response = await reportBrowserJobAgentCycle({ window, cycleId: parsed.data.id, status: 'completed' })
          if (response.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
        } catch {
          const response = await reportBrowserJobAgentCycle({ window, cycleId: parsed.data.id, status: 'failed' }).catch(() => null)
          if (response?.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
        } finally {
          activeBrowserCyclesRef.current.delete(parsed.data.id)
        }
      }
      void run()
    }
    window.addEventListener(JOB_AGENT_WAKE_EVENT, wake)
    return () => window.removeEventListener(JOB_AGENT_WAKE_EVENT, wake)
  }, [agentExecutionEnabled, busySourceId, titles])

  function toggleJobAgent() {
    if (!agentSetupComplete) return
    setAgentPreferences((current) => {
      const enabled = !current.enabled
      if (!enabled) controllerRef.current?.abort()
      return { ...current, enabled }
    })
  }

  function updateSetupValue(key: keyof JobSetupValues, value: JobSetupValues[keyof JobSetupValues]) {
    if (key === 'goalDescription') return setGoalDescription(String(value))
    if (key === 'profileName') return setProfileName(String(value))
    if (key === 'titles') return setTitles(String(value))
    if (key === 'locations') return setLocations(String(value))
    if (key === 'preferredCompanies') return setPreferredCompanies(String(value))
    if (key === 'requiredTerms') return setRequiredTerms(String(value))
    if (key === 'preferredTerms') return setPreferredTerms(String(value))
    if (key === 'excludedTerms') return setExcludedTerms(String(value))
    if (key === 'minimumMatchScore' || key === 'dailyContactLimit' || key === 'autonomy' || key === 'autoSendResume') {
      setAgentPreferences((current) => ({ ...current, [key]: value }))
      return
    }
    setAdvancedSetup((current) => ({ ...current, [key]: value }))
  }

  function analyzeSetupGoal() {
    const analyzed = analyzeJobGoalDescription(goalDescription)
    if (analyzed.titles.length > 0) setTitles(analyzed.titles.join(', '))
    if (analyzed.locations.length > 0) setLocations(analyzed.locations.join(', '))
    if (analyzed.preferredTerms.length > 0) {
      setPreferredTerms((current) => [...new Set([...splitTerms(current), ...analyzed.preferredTerms])].join(', '))
    }
    setAdvancedSetup((current) => ({
      ...current,
      ...(analyzed.minimumSalary !== undefined ? { minimumSalary: String(analyzed.minimumSalary) } : {}),
      ...(analyzed.maximumSalary !== undefined ? { maximumSalary: String(analyzed.maximumSalary) } : {}),
      ...(analyzed.workplaceTypes.length > 0 ? { workplaceTypes: analyzed.workplaceTypes } : {}),
      ...(analyzed.employmentTypes.length > 0 ? { employmentTypes: analyzed.employmentTypes } : {})
    }))
  }

  async function startConfiguredAgent() {
    setAgentPreferences((current) => ({ ...current, enabled: true }))
    navigateJobWorkspace(locale, '/jobs')
  }

  async function syncConversationSignals() {
    const response = await collectBossConversationSignals({ window })
    const now = new Date().toISOString()
    const signals = response.ok ? response.conversationSignals ?? [] : []
    const updated = signals.length > 0
      ? await syncBossConversationSignals({ store, signals, now })
      : []
    const signalDrafts = signals.length > 0
      ? await ensureBossSignalReplyDrafts({ store, signals, now })
      : []
    const followUps = await ensureBossFollowUpDrafts({ store, now })
    if (updated.length > 0 || signalDrafts.length > 0 || followUps.length > 0) {
      await load()
      if (agentPreferences.autonomy === 'autopilot') {
        for (const thread of updated.filter((item) => item.recruitmentStage === 'resume-requested')) {
          if ((agentPreferences.autoSendResume ?? true) && await hasAutomaticContactCapacity()) {
            await sendRequestedResume(thread)
          }
        }
        for (const message of [...signalDrafts, ...followUps]) await tryAutopilotMessage(message)
      }
    }
  }

  async function runBossAdapterDiagnostics() {
    setDiagnosingAdapter(true)
    try {
      const response = await diagnoseBossBrowserAdapter({ window })
      setAdapterDiagnostics(response.ok ? response.diagnostics ?? [] : [])
    } finally {
      setDiagnosingAdapter(false)
    }
  }

  async function refreshBrowserJobRuntime() {
    const response = await getBrowserJobAgentRuntime({ window })
    if (response.jobAgentRuntime) setBrowserJobRuntime(response.jobAgentRuntime)
  }

  async function simulateHistoryLearning() {
    setHistoryLearningBusy(true)
    setError('')
    try {
      const response = await summarizeBossHistory({ window, timeoutMs: 8_000 })
      setHistorySimulation(simulateJobAgentFromHistory({
        boss: response.ok ? response.historySummary : undefined,
        applications,
        messages: conversationMessages,
        now: new Date().toISOString()
      }))
    } catch {
      setError(t('historyLearning.readFailed'))
    } finally {
      setHistoryLearningBusy(false)
    }
  }

  function applyHistoryLearning() {
    if (!historySimulation || historySimulation.sampleSize === 0) return
    setAgentPreferences((current) => ({
      ...current,
      minimumMatchScore: historySimulation.recommendedMinimumMatchScore,
      dailyContactLimit: historySimulation.recommendedDailyContactLimit,
      autonomy: historySimulation.recommendedAutonomy,
      autoSendResume: historySimulation.recommendedAutoSendResume,
      learnFromReplies: true,
      learnFromOutcomes: true
    }))
    setNotice(t('historyLearning.applied'))
    setHistorySimulation(null)
  }

  async function tryAutopilotMessage(message: BossConversationMessage) {
    try {
      if (!await hasAutomaticContactCapacity()) return
      const thread = await store.get('bossConversationThreads', message.threadId)
      if (!thread) return
      const response = await inspectBossBrowserConversation({ window, timeoutMs: 3_000 })
      if (!response.ok || !response.recipient) return
      const verified = verifyBossConversationRecipient({
        thread,
        ...response.recipient,
        now: new Date().toISOString()
      })
      await store.put('bossConversationThreads', verified)
      const approved = await approveBossConversationMessage({
        store,
        threadId: verified.id,
        messageId: message.id,
        now: new Date().toISOString()
      })
      await sendApprovedConversationMessage(message.id, approved, verified)
    } catch {
      // The draft remains reviewable when the exact BOSS conversation is not active.
    }
  }

  async function hasAutomaticContactCapacity() {
    const limit = agentPreferences.dailyContactLimit ?? 20
    const today = new Date().toISOString().slice(0, 10)
    const messages = await store.list('bossConversationMessages')
    return messages.filter((message) => message.sentAt?.slice(0, 10) === today).length < limit
  }

  async function sendRequestedResume(preparedThread: BossConversationThread) {
    if (
      !preparedThread.recipientFingerprint
      || !preparedThread.platformRecipientId
      || !preparedThread.conversationId
      || !preparedThread.recipientName
    ) return
    setBusyResumeThreadId(preparedThread.id)
    setError('')
    try {
      const application = await store.get('applicationRecords', preparedThread.applicationId)
      const variant = application?.resumeVariantId
        ? await store.get('resumeVariants', application.resumeVariantId)
        : undefined
      if (!variant) throw new TypeError('Job-specific resume variant unavailable')
      const diagnosticResponse = await diagnoseBossBrowserAdapter({ window })
      const conversationFingerprint = createJobInputFingerprint(preparedThread.conversationId)
      const chatDiagnostic = diagnosticResponse.diagnostics?.find((item) => (
        item.pageKind === 'chat'
        && item.ready.conversation
        && item.conversationFingerprint === conversationFingerprint
      ))
      if (chatDiagnostic?.counts.pdfInputs !== 1) throw new TypeError('No unique BOSS PDF resume input is available')
      const mimeType = 'application/pdf' as const
      const artifactModule = await import('@/lib/resume-pdf')
      const bytes = artifactModule.renderResumePdf(variant.data)
      const bytesBase64 = bytesToBase64(bytes)
      const fileName = artifactModule.resumePdfFileName(variant.data, variant.name)
      const contentFingerprint = createJobInputFingerprint(bytesBase64)
      const sentThread = await executeBossResumeAttachment({
        store,
        thread: preparedThread,
        fileName,
        bytesBase64,
        byteLength: bytes.byteLength,
        mimeType,
        contentFingerprint,
        now: () => new Date().toISOString(),
        send: async () => {
          const response = await sendBossResumeAttachment({
            window,
            fileName,
            bytesBase64,
            byteLength: bytes.byteLength,
            mimeType,
            contentFingerprint,
            recipient: {
              platformRecipientId: preparedThread.platformRecipientId!,
              conversationId: preparedThread.conversationId!,
              recipientName: preparedThread.recipientName!,
              ...(preparedThread.recipientTitle ? { recipientTitle: preparedThread.recipientTitle } : {})
            }
          })
          if (!response.ok || !response.resumeReceipt) throw new TypeError('BOSS resume receipt unavailable')
          return response.resumeReceipt
        }
      })
      const acknowledgement = await ensureBossResumeReceiptReplyDraft({
        store,
        threadId: sentThread.id,
        now: new Date().toISOString()
      })
      if (agentPreferences.autonomy === 'autopilot') await tryAutopilotMessage(acknowledgement.message)
      setNotice(t('jobAgent.resumeSent', { format: 'PDF' }))
      await load()
    } catch {
      setError(t('jobAgent.resumeSendFailed'))
    } finally {
      setBusyResumeThreadId('')
    }
  }

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
        requiredTerms: splitTerms(requiredTerms),
        preferredTerms: splitTerms(preferredTerms),
        excludedTerms: splitTerms(excludedTerms),
        preferredCompanies: splitTerms(preferredCompanies),
        blockedCompanies: splitTerms(advancedSetup.blockedCompanies),
        experienceLevels: splitTerms(advancedSetup.experienceLevels),
        educationLevels: splitTerms(advancedSetup.educationLevels),
        industries: splitTerms(advancedSetup.industries),
        companySizes: splitTerms(advancedSetup.companySizes),
        financingStages: splitTerms(advancedSetup.financingStages),
        ...(advancedSetup.minimumSalary ? { minimumMonthlySalary: Number(advancedSetup.minimumSalary) } : {}),
        ...(advancedSetup.maximumSalary ? { maximumMonthlySalary: Number(advancedSetup.maximumSalary) } : {}),
        workplaceTypes: advancedSetup.workplaceTypes,
        employmentTypes: advancedSetup.employmentTypes,
        maximumAgeDays: advancedSetup.maximumAgeDays,
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
      let discoveredBossJobs = 0
      if (browserAgentAvailable) {
        const jobsByExternalId = new Map<string, BrowserBossJob>()
        for (const title of profile.titles.slice(0, 3)) {
          const searchResult = await searchBossBrowserJobs({ window, query: title, timeoutMs: 15_000 })
          for (const job of searchResult.jobs ?? []) jobsByExternalId.set(job.externalId, job)
          if (controller.signal.aborted || refreshGenerationRef.current !== generation) return
        }
        if (jobsByExternalId.size === 0) {
          const existingResult = await collectBossBrowserJobs({ window, timeoutMs: 3_000 })
          for (const job of existingResult.jobs ?? []) jobsByExternalId.set(job.externalId, job)
        }
        if (jobsByExternalId.size > 0) {
          discoveredBossJobs = (await upsertBossBrowserJobs({
            store,
            jobs: [...jobsByExternalId.values()].slice(0, 100),
            now: new Date().toISOString()
          })).length
        }
      }
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
      const queueResult = await queueBossCandidates({
        store,
        sourceDraftId: activeDraft.id,
        minimumScore: agentPreferences.minimumMatchScore ?? 70,
        maximumCandidates: agentPreferences.dailyContactLimit ?? 20,
        now: new Date().toISOString()
      })
      const analysisResult = await analyzeBossCandidateQueue({
        store,
        sourceDraftId: activeDraft.id,
        maximumCandidates: 3,
        signal: controller.signal,
        now: () => new Date().toISOString(),
        runAnalysis: (posting, signal) => requestBossCandidateAnalysis({
          posting,
          resume: activeDraft.data,
          locale: locale === 'zh' ? 'zh' : 'en',
          signal
        })
      })
      const totals = result.summaries.reduce((summary, source) => ({
        added: summary.added + source.newCount,
        updated: summary.updated + source.updatedCount,
        closed: summary.closed + source.closedCount,
        warnings: summary.warnings + source.warningCount
      }), { added: 0, updated: 0, closed: 0, warnings: 0 })
      setNotice(analysisResult.prepared.length > 0
        ? t('jobAgent.preparedCandidates', { count: analysisResult.prepared.length })
        : queueResult.queued.length > 0
          ? t('jobAgent.queuedCandidates', { count: queueResult.queued.length })
        : discoveredBossJobs > 0
          ? t('jobAgent.discoveredCandidates', { count: discoveredBossJobs })
        : result.sourceCount === 0
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
      let promotionPosting = posting
      let promotionRecommendation = recommendation
      if (posting.sourceId === 'job-source-boss-browser') {
        const response = await collectBossJobDetail({ window, url: posting.canonicalUrl, timeoutMs: 15_000 })
        const detail = response.jobDetail
        if (!response.ok || !detail || detail.externalId !== posting.externalId) {
          setError(t('errors.jobDetail'))
          return
        }
        const now = new Date().toISOString()
        promotionPosting = {
          ...posting,
          description: detail.description,
          canonicalUrl: detail.url,
          applyUrl: detail.url,
          lastCheckedAt: now,
          contentHash: createJobInputFingerprint({
            title: posting.title,
            company: posting.company,
            description: detail.description,
            location: posting.location,
            compensation: posting.compensation
          })
        }
        const profile = profiles[0]
        if (!profile) {
          setError(t('errors.invalidProfile'))
          return
        }
        const facts = (await store.list('careerFacts')).filter((fact) => (
          fact.evidenceRefs.includes(careerEvidenceSourceId(activeDraft.id))
        ))
        promotionRecommendation = {
          ...scoreJobRecommendation({
            posting: promotionPosting,
            profile,
            sourceDraftId: activeDraft.id,
            facts,
            now
          }),
          decision: recommendation.decision,
          createdAt: recommendation.createdAt
        }
        await store.transaction(['jobPostings', 'jobRecommendations'], 'readwrite', async (transaction) => {
          await transaction.put('jobPostings', promotionPosting)
          await transaction.put('jobRecommendations', promotionRecommendation)
        })
      }
      saveJobPromotionIntent(createJobPromotionIntent({
        posting: promotionPosting,
        recommendation: promotionRecommendation,
        sourceDraftId: activeDraft.id
      }))
      await decide(promotionRecommendation, 'saved')
      navigateJobWorkspace(locale, '/jobs/target-job')
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
      navigateJobWorkspace(locale, '/jobs/target-job')
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
      const now = new Date().toISOString()
      await prepareApplicationPacket({ store, recordId, resume: activeDraft.data, now })
      await ensureBossOpeningDraft({ store, applicationId: recordId, now })
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

  async function reviseConversationMessage(messageId: string, body: string) {
    const message = conversationMessages.find((item) => item.id === messageId)
    if (!message || message.body === body.trim()) return
    try {
      await store.put('bossConversationMessages', reviseBossMessageDraft({
        message,
        body,
        now: new Date().toISOString()
      }))
      setNotice(t('jobAgent.messageRevised'))
      await load()
    } catch {
      setError(t('errors.applicationSave'))
    }
  }

  async function verifyAndApproveConversationMessage(messageId: string) {
    const message = conversationMessages.find((item) => item.id === messageId)
    const thread = message ? conversationThreads.find((item) => item.id === message.threadId) : undefined
    if (!message || !thread) return
    setBusyConversationMessageId(messageId)
    setError('')
    try {
      const response = await inspectBossBrowserConversation({ window, timeoutMs: 3_000 })
      if (!response.ok || !response.recipient) throw new TypeError('BOSS recipient unavailable')
      const verified = verifyBossConversationRecipient({
        thread,
        ...response.recipient,
        now: new Date().toISOString()
      })
      await store.put('bossConversationThreads', verified)
      const approved = await approveBossConversationMessage({
        store,
        threadId: verified.id,
        messageId,
        now: new Date().toISOString()
      })
      if (agentPreferences.autonomy === 'autopilot') {
        await sendApprovedConversationMessage(messageId, approved, verified)
      } else {
        setNotice(t('jobAgent.messageApproved', { name: response.recipient.recipientName }))
        await load()
      }
    } catch {
      setError(t('jobAgent.messageVerificationFailed'))
    } finally {
      setBusyConversationMessageId('')
    }
  }

  async function sendApprovedConversationMessage(
    messageId: string,
    preparedMessage?: BossConversationMessage,
    preparedThread?: BossConversationThread
  ) {
    const message = preparedMessage ?? conversationMessages.find((item) => item.id === messageId)
    const thread = preparedThread ?? (message ? conversationThreads.find((item) => item.id === message.threadId) : undefined)
    if (
      !message
      || !thread?.recipientFingerprint
      || !thread.platformRecipientId
      || !thread.conversationId
      || !thread.recipientName
    ) return
    setBusyConversationMessageId(messageId)
    setError('')
    try {
      const persisted = await executeApprovedBossMessage({
        store,
        thread,
        message,
        now: () => new Date().toISOString(),
        send: async ({ message: approved, thread: verified }) => {
          const response = await sendBossBrowserMessage({
            window,
            messageId: approved.id,
            body: approved.body,
            bodyFingerprint: approved.bodyFingerprint,
            recipient: {
              platformRecipientId: verified.platformRecipientId!,
              conversationId: verified.conversationId!,
              recipientName: verified.recipientName!,
              ...(verified.recipientTitle ? { recipientTitle: verified.recipientTitle } : {})
            },
            timeoutMs: 10_000
          })
          if (!response.ok || !response.sendReceipt) throw new TypeError('BOSS send receipt unavailable')
          return response.sendReceipt
        }
      })
      setNotice(t('jobAgent.messageSent', { status: t(`jobAgent.messageStatus.${persisted.status}`) }))
    } catch {
      setError(t('jobAgent.messageSendFailed'))
    } finally {
      setBusyConversationMessageId('')
      await load()
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

  const selectedPosting = visible.find((posting) => posting.id === selectedPostingId) ?? visible[0] ?? null
  const selectedRecommendation = selectedPosting ? recommendationByPosting.get(selectedPosting.id) : undefined
  const pendingRequirements = applications.filter((item) => ['saved', 'analyzing', 'preparing'].includes(item.status)).length
  const readyApplications = applications.filter((item) => item.status === 'ready-to-apply').length
  const pendingMessages = conversationMessages.filter((item) => ['awaiting-approval', 'approved', 'failed'].includes(item.status)).length
  const managedMode = agentPreferences.enabled && agentPreferences.autonomy === 'autopilot'
  const applicationCounts = {
    applied: applications.filter((item) => ['applied', 'interviewing', 'offered', 'rejected'].includes(item.status)).length,
    viewed: applications.filter((item) => item.status !== 'saved').length,
    conversations: conversationThreads.filter((item) => item.status === 'active').length,
    interviews: applications.filter((item) => item.status === 'interviewing').length,
    offers: applications.filter((item) => item.status === 'offered').length
  }
  const navItems: Array<{ id: JobWorkspaceSection; href: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', href: '/jobs', icon: LayoutDashboard },
    { id: 'opportunities', href: '/jobs/opportunities', icon: BriefcaseBusiness },
    { id: 'resumes', href: '/jobs/resumes', icon: FileText },
    { id: 'conversations', href: '/jobs/conversations', icon: MessageSquareText },
    { id: 'applications', href: '/jobs/applications', icon: Send },
    { id: 'interviews', href: '/jobs/interviews', icon: CalendarClock },
    { id: 'activity', href: '/jobs/activity', icon: Activity }
  ]

  return <main className="job-workspace" aria-label={t('title')}>
    <aside className="job-workspace__sidebar">
      <div className="job-workspace__brand"><span><Bot size={19} aria-hidden="true" /></span><strong>{t('workspace.brand')}</strong></div>
      <nav aria-label={t('workspace.navigation')}>{navItems.map(({ id, href, icon: Icon }) => <Link key={id} href={href} data-active={workspaceSection === id}><Icon size={17} aria-hidden="true" /><span>{t(`workspace.nav.${id}`)}</span></Link>)}</nav>
      <div className="job-workspace__sidebar-footer"><Link href="/jobs/setup" data-active={workspaceSection === 'setup' || workspaceSection === 'preferences'}><SlidersHorizontal size={17} aria-hidden="true" /><span>{t('workspace.nav.preferences')}</span></Link><Link href="/jobs/profile" data-active={workspaceSection === 'profile'} aria-label={activeDraft?.data.profile.name || t('workspace.candidate')}><span>{activeDraft?.data.profile.name?.slice(0, 1) || 'R'}</span><strong>{activeDraft?.data.profile.name || t('workspace.candidate')}</strong></Link></div>
    </aside>
    <section className="job-workspace__main">
      <header className="job-workspace__topbar"><h1>{t(`workspace.pageTitle.${workspaceSection}`)}</h1><div><span data-connected={browserAgentAvailable}><i />{browserAgentAvailable ? t('workspace.connected') : t('workspace.disconnected')}</span><Link href="/jobs/settings" aria-label={t('workspace.settings')}><Settings2 size={18} /></Link></div></header>
      {error ? <p className="job-workspace__alert" data-tone="error" role="alert">{error}</p> : null}
      {notice ? <p className="job-workspace__alert" data-tone="success" role="status">{notice}</p> : null}

      {workspaceSection === 'overview' ? <div className="job-overview">
        <section className="job-overview__agent">
          <div><span data-running={agentRunning} /><div><h2>{!agentSetupComplete ? t('workspace.setupRequired') : !agentPreferences.enabled ? t('workspace.agentPaused') : browserAgentAvailable ? t('workspace.agentRunning') : t('workspace.agentReady')}</h2><p>{agentSetupComplete ? t('workspace.targetSummary', { titles: savedSearchProfile?.titles.slice(0, 2).join('、') || t('unknown'), location: savedSearchProfile?.locations[0] || t('unknown') }) : t('workspace.setupHelp')}</p></div></div>
          <div>{!agentSetupComplete ? <Link className="job-button job-button--primary" href="/jobs/setup">{t('workspace.setupAction')}<ChevronRight size={16} /></Link> : <><button type="button" className="job-button job-button--secondary" onClick={toggleJobAgent}>{agentPreferences.enabled ? <Pause size={15} /> : <Play size={15} />}{agentPreferences.enabled ? t('workspace.pauseAgent') : t('workspace.startAgent')}</button><Link className="job-button job-button--primary" href={pendingRequirements > 0 ? '/jobs/resumes' : pendingMessages > 0 ? '/jobs/conversations' : '/jobs/opportunities'}>{t(managedMode ? 'workspace.viewProgress' : 'workspace.reviewTasks')}<ChevronRight size={16} /></Link></>}</div>
        </section>
        <JobAgentRuntimeStatus runtime={browserJobRuntime} />
        <div className="job-overview__columns">
          <section><h2>{t('workspace.todayActivity')}</h2><div className="job-overview__timeline">
            <Link href="/jobs/opportunities"><time>{formatActivityTime(postings[0]?.lastCheckedAt, locale)}</time><span><BriefcaseBusiness size={17} /></span><div><strong>{t('workspace.activityFound', { count: postings.length })}</strong><p>{t('workspace.activityFoundHelp')}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/resumes"><time>{formatActivityTime(applications[0]?.updatedAt, locale)}</time><span><FileText size={17} /></span><div><strong>{t('workspace.activityResume', { count: packets.length })}</strong><p>{t('workspace.activityResumeHelp')}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/conversations"><time>{formatActivityTime(conversationMessages[0]?.updatedAt, locale)}</time><span><MessageSquareText size={17} /></span><div><strong>{t('workspace.activityMessages', { count: conversationMessages.length })}</strong><p>{t('workspace.activityMessagesHelp')}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/applications"><time>{formatActivityTime(applications.at(-1)?.updatedAt, locale)}</time><span><Send size={17} /></span><div><strong>{t('workspace.activityApplications', { count: applications.length })}</strong><p>{t('workspace.activityApplicationsHelp')}</p></div><ChevronRight size={17} /></Link>
          </div></section>
          <section><h2>{t(managedMode ? 'workspace.agentProcessing' : 'workspace.needsAttention')}</h2><div className="job-overview__tasks">
            <Link href="/jobs/opportunities"><span data-tone="blue"><BriefcaseBusiness size={16} /></span><div><strong>{t(managedMode ? 'workspace.processingJobs' : 'workspace.taskReviewJobs')}</strong><p>{t(managedMode ? 'workspace.processingCount' : 'workspace.taskCount', { count: recommendations.filter((item) => (item.decision ?? 'new') === 'new').length })}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/resumes"><span data-tone="amber"><FileText size={16} /></span><div><strong>{t(managedMode ? 'workspace.processingResumes' : 'workspace.taskResume')}</strong><p>{t(managedMode ? 'workspace.processingCount' : 'workspace.taskCount', { count: pendingRequirements })}</p></div><ChevronRight size={17} /></Link>
            <Link href="/jobs/conversations"><span data-tone="red"><MessageSquareText size={16} /></span><div><strong>{t(managedMode ? 'workspace.monitoringConversations' : 'workspace.taskMessages')}</strong><p>{t(managedMode ? 'workspace.processingCount' : 'workspace.taskCount', { count: pendingMessages })}</p></div><ChevronRight size={17} /></Link>
          </div></section>
        </div>
        <section className="job-overview__progress"><h2>{t('workspace.applicationProgress')}</h2><div>{(['applied', 'viewed', 'conversations', 'interviews', 'offers'] as const).map((key) => <article key={key}><strong>{applicationCounts[key]}</strong><span>{t(`workspace.progress.${key}`)}</span></article>)}</div></section>
        <JobProcessBoard applications={applications} postings={postings} threads={conversationThreads} messages={conversationMessages} />
        <JobHistoryLearningPanel simulation={historySimulation} busy={historyLearningBusy} onSimulate={() => void simulateHistoryLearning()} onApply={applyHistoryLearning} onDismiss={() => setHistorySimulation(null)} />
      </div> : null}

      {workspaceSection === 'opportunities' ? <div className="job-opportunities">
        <section className="job-opportunities__list"><header><div><h2>{t('inbox')}</h2><p>{t('workspace.opportunityHelp')}</p></div><button type="button" className="job-button job-button--primary" onClick={() => void searchMarket()} disabled={Boolean(busySourceId) || !trustedDraft || !titles.trim()}><Radar size={15} />{busySourceId ? t('marketStarting') : t('jobAgent.runNow')}</button></header><div className="job-opportunities__filters" role="group" aria-label={t('filters')}>{(['all', 'new', 'saved', 'needs-analysis', 'ready', 'applied'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`filter.${value}`)}</button>)}</div>{!trustedDraft ? <p className="job-workspace__empty">{t('resumeRequired')}</p> : visible.length === 0 ? <p className="job-workspace__empty">{t('empty')}</p> : <ul>{visible.map((posting) => { const recommendation = recommendationByPosting.get(posting.id); const application = applicationByPosting.get(posting.id); return <li key={posting.id}><button type="button" data-selected={selectedPosting?.id === posting.id} onClick={() => setSelectedPostingId(posting.id)}><div><strong>{sanitizeJobDisplayText(posting.title)}</strong><span>{sanitizeJobDisplayText(posting.company)}</span></div><span>{formatMonthlyCompensation(posting) || posting.location || t('unknown')}</span><b>{recommendation?.preliminaryScore !== undefined ? `${Math.round(recommendation.preliminaryScore)}%` : '—'}</b><small>{application ? t(`application.status.${application.status}`) : t(`filter.${recommendation?.decision ?? 'new'}`)}</small></button></li>})}</ul>}</section>
        <section className="job-opportunities__detail">{selectedPosting ? <><header><span>{sanitizeJobDisplayText(selectedPosting.company)}</span><h2>{sanitizeJobDisplayText(selectedPosting.title)}</h2><p>{[selectedPosting.location, selectedPosting.workplaceType, selectedPosting.employmentType].filter(Boolean).join(' · ') || t('unknown')}</p></header><div className="job-opportunities__score"><span>{t('workspace.matchScore')}</span><strong>{selectedRecommendation?.preliminaryScore !== undefined ? `${Math.round(selectedRecommendation.preliminaryScore)}%` : '—'}</strong></div><section><h3>{t('whyRecommended')}</h3>{selectedRecommendation?.reasons.length ? <ol>{selectedRecommendation.reasons.slice(0, 3).map((reason) => <li key={reason.code} data-tone={reason.contribution > 0 ? 'positive' : 'neutral'}><CheckCircle2 size={15} />{t(`reasonCode.${recommendationReasonMessageKey(reason.code, reason.contribution)}`, { score: Math.round(Math.abs(reason.contribution)) })}</li>)}</ol> : <p>{t('unknownRecommendation')}</p>}</section><p className="job-opportunities__description">{sanitizeJobDisplayText(selectedPosting.description).slice(0, 520)}</p><footer>{selectedRecommendation ? <><button type="button" className="job-button job-button--primary" onClick={() => void analyzePosting(selectedPosting, selectedRecommendation)}>{t(managedMode ? 'workspace.processNow' : 'workspace.confirmInterest')}</button><button type="button" className="job-button job-button--secondary" onClick={() => void decide(selectedRecommendation, 'saved')}><Save size={14} />{t('save')}</button><button type="button" className="job-button job-button--secondary" onClick={() => void decide(selectedRecommendation, 'ignored')}>{t('ignore')}</button></> : null}<a href={selectedPosting.canonicalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{t('openOriginal')}</a></footer></> : <p className="job-workspace__empty">{t('workspace.selectOpportunity')}</p>}</section>
      </div> : null}

      {workspaceSection === 'resumes' ? <div className="job-workspace__content"><section className="job-section-heading"><div><h2>{t('workspace.resumeTasksTitle')}</h2><p>{t('workspace.resumeTasksHelp')}</p></div><span>{pendingRequirements + readyApplications}</span></section><ResumeVariantLibrary store={store} sourceDraftId={trustedDraft ? activeDraft?.id : undefined} baseResume={trustedDraft ? activeDraft?.data : undefined} plannedTitles={savedSearchProfile?.titles ?? []} /><div className="job-resume-agent"><LazyResumeAgentApp appId="agent" /></div><ApplicationPipeline packets={packets} pendingId={busyApplicationId} onPrepare={(id) => void prepareApplication(id)} onMarkApplied={(id) => void confirmApplied(id)} onNotesChange={(id, notes) => void saveApplicationNotes(id, notes)} /></div> : null}

      {workspaceSection === 'conversations' ? <div className="job-workspace__content"><section className="job-section-heading"><div><h2>{t('jobAgent.messageQueueTitle')}</h2><p>{t('jobAgent.messageQueueHelp')}</p></div><span>{conversationMessages.length}</span></section>{conversationMessages.length === 0 ? <section className="job-conversation-empty"><span><MessageSquareText size={24} /></span><h3>{t('jobAgent.emptyTitle')}</h3><p>{t('jobAgent.emptyDescription', { count: pendingRequirements })}</p><small>{agentPreferences.enabled ? t('jobAgent.emptyNextScan') : t('jobAgent.emptyPaused')}</small><footer><Link className="job-button job-button--primary" href="/jobs/resumes">{t('jobAgent.emptyViewResumes')}</Link><a className="job-button job-button--secondary" href="https://www.zhipin.com/web/geek/chat" target="_blank" rel="noopener noreferrer">{t('jobAgent.openBossChat')}</a></footer></section> : <BossConversationQueue threads={conversationThreads} messages={conversationMessages} applications={applications} postings={postings} pendingMessageId={busyConversationMessageId} pendingResumeThreadId={busyResumeThreadId} onRevise={(messageId, body) => void reviseConversationMessage(messageId, body)} onVerify={(messageId) => void verifyAndApproveConversationMessage(messageId)} onSend={(messageId) => void sendApprovedConversationMessage(messageId)} onSendResume={(thread) => void sendRequestedResume(thread)} />}</div> : null}

      {workspaceSection === 'applications' ? <div className="job-workspace__content"><section className="job-section-heading"><div><h2>{t('application.title')}</h2><p>{t('application.description')}</p></div><span>{applications.length}</span></section><ApplicationPipeline packets={packets} pendingId={busyApplicationId} onPrepare={(id) => void prepareApplication(id)} onMarkApplied={(id) => void confirmApplied(id)} onNotesChange={(id, notes) => void saveApplicationNotes(id, notes)} /></div> : null}

      {workspaceSection === 'interviews' ? <LazyInterviewWorkspace store={store} applications={applications} postings={postings} locale={locale} onChanged={load} /> : null}

      {workspaceSection === 'setup' ? <LazyJobAgentSetup trustedResume={trustedDraft} resumeEditor={<LazyResumeStudioApp appId="studio" />} analysis={setupAnalysis} values={setupValues} onChange={updateSetupValue} onAnalyzeGoal={analyzeSetupGoal} onSave={async () => Boolean(await saveProfile())} onStart={startConfiguredAgent} /> : null}

      {workspaceSection === 'profile' ? <div className="job-workspace__embedded" role="application" aria-label={desktopT('apps.studio')}><LazyResumeStudioApp appId="studio" /></div> : null}

      {workspaceSection === 'target-job' ? <div className="job-workspace__embedded" role="application" aria-label={desktopT('apps.jd-match')}><LazyJDMatchApp appId="jd-match" /></div> : null}

      {workspaceSection === 'settings' ? <div className="job-workspace__embedded" role="application" aria-label={desktopT('apps.settings')}><LazySettingsApp appId="settings" /></div> : null}

      {workspaceSection === 'activity' ? <div className="job-workspace__content"><section className="job-section-heading"><div><h2>{t('workspace.activityTitle')}</h2><p>{t('workspace.activityHelp')}</p></div></section><div className="job-activity-list">{postings.slice(0, 12).map((posting) => <article key={posting.id}><span><BriefcaseBusiness size={16} /></span><div><strong>{t('workspace.activityPosting', { title: posting.title })}</strong><p>{posting.company} · {posting.lastCheckedAt.slice(0, 10)}</p></div></article>)}{postings.length === 0 ? <p className="job-workspace__empty">{t('workspace.noActivity')}</p> : null}</div></div> : null}

      {workspaceSection === 'preferences' ? <div className="job-preferences"><section><header><h2>{t('workspace.preferencesTitle')}</h2><p>{t('workspace.preferencesHelp')}</p></header><div className="job-preferences__grid"><label>{t('profileName')}<input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label>{t('titles')}<input value={titles} onChange={(event) => setTitles(event.target.value)} /></label><label>{t('locations')}<input value={locations} onChange={(event) => setLocations(event.target.value)} /></label><label>{t('preferredCompanies')}<input value={preferredCompanies} onChange={(event) => setPreferredCompanies(event.target.value)} placeholder={t('preferredCompaniesPlaceholder')} /></label><label>{t('requiredTerms')}<input value={requiredTerms} onChange={(event) => setRequiredTerms(event.target.value)} /></label><label>{t('preferredTerms')}<input value={preferredTerms} onChange={(event) => setPreferredTerms(event.target.value)} /></label><label>{t('excludedTerms')}<input value={excludedTerms} onChange={(event) => setExcludedTerms(event.target.value)} /></label></div><button type="button" className="job-button job-button--primary" onClick={() => void saveProfile()} disabled={!profileName.trim() || !titles.trim()}><Save size={15} />{t('saveProfile')}</button></section><section className="job-adapter-diagnostics"><header><div><h2>{t('jobAgent.diagnosticsTitle')}</h2><p>{t('jobAgent.diagnosticsHelp')}</p></div><button type="button" className="job-button job-button--secondary" onClick={() => void runBossAdapterDiagnostics()} disabled={diagnosingAdapter}>{t('jobAgent.runDiagnostics')}</button></header>{adapterDiagnostics.length === 0 ? <div className="job-adapter-diagnostics__empty"><p>{t('jobAgent.diagnosticsEmpty')}</p><a href="https://www.zhipin.com/web/geek/chat" target="_blank" rel="noopener noreferrer">{t('jobAgent.openBossChat')}</a></div> : <div className="job-adapter-diagnostics__list">{adapterDiagnostics.map((diagnostic, index) => <article key={`${diagnostic.pageKind}-${diagnostic.frameId}-${index}`}><header><strong>{t(`jobAgent.diagnosticPage.${diagnostic.pageKind}`)}</strong><span>{t(`jobAgent.session.${diagnostic.sessionState}`)}</span></header><div>{(['discovery', 'conversation', 'messageSend', 'resumeUpload'] as const).map((key) => <p key={key} data-ready={diagnostic.ready[key]}><CheckCircle2 size={14} />{t(`jobAgent.diagnosticReady.${key}`)}</p>)}</div><small>{t('jobAgent.diagnosticCounts', { jobs: diagnostic.counts.jobLinks, editors: diagnostic.counts.editors, send: diagnostic.counts.sendControls, identities: diagnostic.counts.recipientIdentities, conversations: diagnostic.counts.conversationIdentities, names: diagnostic.counts.recipientNames, pdf: diagnostic.counts.pdfInputs })}</small></article>)}</div>}</section><details><summary>{t('importJob')}</summary><p>{t('importJobHelp')}</p><label>{t('clipboardJob')}<textarea value={clipboardJobText} onChange={(event) => setClipboardJobText(event.target.value)} rows={5} placeholder={t('clipboardJobPlaceholder')} /></label><button type="button" className="job-button job-button--secondary" onClick={prefillFromClipboard} disabled={!clipboardJobText.trim()}><ClipboardPaste size={14} />{t('parseClipboardJob')}</button><div className="job-preferences__grid"><label>{t('importUrl')}<input type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} /></label><label>{t('importTitle')}<input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} /></label><label>{t('importCompany')}<input value={importCompany} onChange={(event) => setImportCompany(event.target.value)} /></label><label>{t('importLocation')}<input value={importLocation} onChange={(event) => setImportLocation(event.target.value)} /></label></div><label>{t('importDescription')}<textarea value={importDescription} onChange={(event) => setImportDescription(event.target.value)} rows={6} /></label><button type="button" className="job-button job-button--primary" onClick={() => void importAndAnalyze()} disabled={!trustedDraft || !importUrl.trim() || !importTitle.trim() || !importCompany.trim() || !importDescription.trim()}>{t('importAndAnalyze')}</button></details></div> : null}
    </section>
  </main>
}

export function BossConversationQueue({
  threads,
  messages,
  applications,
  postings,
  pendingMessageId,
  pendingResumeThreadId,
  onRevise,
  onVerify,
  onSend,
  onSendResume
}: {
  threads: BossConversationThread[]
  messages: BossConversationMessage[]
  applications: ApplicationRecord[]
  postings: JobPosting[]
  pendingMessageId?: string
  pendingResumeThreadId?: string
  onRevise: (messageId: string, body: string) => void
  onVerify: (messageId: string) => void
  onSend: (messageId: string) => void
  onSendResume?: (thread: BossConversationThread) => void
}) {
  const t = useTranslations('jobRadar.jobAgent')
  const applicationById = new Map(applications.map((application) => [application.id, application]))
  const postingById = new Map(postings.map((posting) => [posting.id, posting]))
  const visible = messages.flatMap((message) => {
    const thread = threads.find((item) => item.id === message.threadId)
    const application = thread ? applicationById.get(thread.applicationId) : undefined
    const posting = application ? postingById.get(application.postingId) : undefined
    return thread && application && posting ? [{ message, thread, posting }] : []
  })
  if (visible.length === 0) return null
  return <section className="boss-conversation-queue" aria-labelledby="boss-conversation-title">
    <header><div><MessageSquareText size={15} aria-hidden="true" /><span><strong id="boss-conversation-title">{t('messageQueueTitle')}</strong><small>{t('messageQueueHelp')}</small></span></div></header>
    <ul>{visible.map(({ message, thread, posting }) => <li key={message.id}>
      <article>
        <header><div><strong>{posting.title}</strong><span>{posting.company}</span></div><b>{t(`messageStatus.${message.status}`)}</b></header>
        <p>{thread.recipientName
          ? t('messageRecipient', { name: thread.recipientName })
          : t('messageRecipientPending')}</p>
        <p>{t('recruitmentStage', { stage: t(`stage.${thread.recruitmentStage}`) })}</p>
        <label>{t('messageDraft')}<textarea defaultValue={message.body} maxLength={5_000} onBlur={(event) => onRevise(message.id, event.target.value)} /></label>
        <small>{t('messageEvidence', { count: message.evidenceFactIds.length })}</small>
        {message.status === 'awaiting-approval' ? <button type="button" disabled={pendingMessageId === message.id} onClick={() => onVerify(message.id)}>{t('messageVerifyAndApprove')}</button> : null}
        {message.status === 'approved' ? <button type="button" disabled={pendingMessageId === message.id} onClick={() => onSend(message.id)}>{t('messageSendApproved')}</button> : null}
        {thread.recruitmentStage === 'resume-requested' && onSendResume ? <button type="button" disabled={pendingResumeThreadId === thread.id} onClick={() => onSendResume(thread)}>{t('sendRequestedResume')}</button> : null}
      </article>
    </li>)}</ul>
  </section>
}

function splitTerms(value: string) {
  return [...new Set(value.split(/[,，\n]/u).map((term) => term.trim()).filter(Boolean))]
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return window.btoa(binary)
}

function jobWorkspaceSection(pathname: string): JobWorkspaceSection {
  const normalized = pathname.replace(/^\/(?:zh|en)(?=\/)/u, '').replace(/\/+$/u, '')
  const section = normalized.split('/')[2]
  return section === 'opportunities'
    || section === 'resumes'
    || section === 'conversations'
    || section === 'applications'
    || section === 'interviews'
    || section === 'activity'
    || section === 'preferences'
    || section === 'profile'
    || section === 'target-job'
    || section === 'settings'
    || section === 'setup'
    ? section
    : 'overview'
}

function byUpdatedAt(left: { updatedAt: string }, right: { updatedAt: string }) {
  return right.updatedAt.localeCompare(left.updatedAt)
}

function formatActivityTime(value: string | undefined, locale: string) {
  if (!value || Number.isNaN(Date.parse(value))) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}
