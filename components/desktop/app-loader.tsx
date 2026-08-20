'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'
import type { AppId } from '@/lib/desktop/types'

type AppComponent = ComponentType<{ appId: AppId }>

const LazyResume3DApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/resume-3d-app').then((module) => module.Resume3DApp),
  {
    ssr: false,
    loading: Resume3DLoading
  }
)

const LazyResumeStudioApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/resume-studio-app').then((module) => module.ResumeStudioApp),
  { loading: AppLoading }
)
const LazyJobRadarApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/job-radar-app').then((module) => module.JobRadarApp),
  { loading: AppLoading }
)
const LazyResumeAgentApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/resume-agent-app').then((module) => module.ResumeAgentApp),
  { loading: AppLoading }
)
const LazyJDMatchApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/jd-match-app').then((module) => module.JDMatchApp),
  { loading: AppLoading }
)
const LazyClassicResumeApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/classic-resume-app').then((module) => module.ClassicResumeApp),
  { loading: AppLoading }
)
const LazyProjectsApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/projects-app').then((module) => module.ProjectsApp),
  { loading: AppLoading }
)
const LazyTerminalApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/terminal-app').then((module) => module.TerminalApp),
  { loading: AppLoading }
)
const LazyTimelineApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/timeline-app').then((module) => module.TimelineApp),
  { loading: AppLoading }
)
const LazyResumeBookApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/resume-book-app').then((module) => module.ResumeBookApp),
  { loading: AppLoading }
)
const LazySettingsApp = dynamic<{ appId: AppId }>(
  () => import('@/components/apps/settings-app').then((module) => module.SettingsApp),
  { loading: AppLoading }
)

function Resume3DLoading() {
  const t = useTranslations('resume3d')
  return <div className="resume-3d-loading-shell" role="status" aria-label={t('loadingShell')} aria-busy="true" />
}

function AppLoading() {
  const t = useTranslations('desktop')
  return <div className="app-loader-pending" role="status" aria-label={t('loading')} aria-busy="true" />
}

const appComponents: Record<AppId, AppComponent> = {
  studio: LazyResumeStudioApp,
  jobs: LazyJobRadarApp,
  agent: LazyResumeAgentApp,
  'jd-match': LazyJDMatchApp,
  'resume-3d': LazyResume3DApp,
  book: LazyResumeBookApp,
  classic: LazyClassicResumeApp,
  projects: LazyProjectsApp,
  timeline: LazyTimelineApp,
  terminal: LazyTerminalApp,
  settings: LazySettingsApp
}

export function AppLoader({ appId }: { appId: AppId }) {
  const App = appComponents[appId]
  return <App appId={appId} />
}
