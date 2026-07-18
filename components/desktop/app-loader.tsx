'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { ResumeStudioApp } from '@/components/apps/resume-studio-app'
import { ResumeAgentApp } from '@/components/apps/resume-agent-app'
import { JDMatchApp } from '@/components/apps/jd-match-app'
import { ClassicResumeApp } from '@/components/apps/classic-resume-app'
import { ProjectsApp } from '@/components/apps/projects-app'
import { TerminalApp } from '@/components/apps/terminal-app'
import { TimelineApp } from '@/components/apps/timeline-app'
import { ResumeBookApp } from '@/components/apps/resume-book-app'
import { SettingsApp } from '@/components/apps/settings-app'
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

function Resume3DLoading() {
  const t = useTranslations('resume3d')
  return <div className="resume-3d-loading-shell" role="status" aria-label={t('loadingShell')} aria-busy="true" />
}

const appComponents: Record<AppId, AppComponent> = {
  studio: ResumeStudioApp,
  agent: ResumeAgentApp,
  'jd-match': JDMatchApp,
  'resume-3d': LazyResume3DApp,
  book: ResumeBookApp,
  classic: ClassicResumeApp,
  projects: ProjectsApp,
  timeline: TimelineApp,
  terminal: TerminalApp,
  settings: SettingsApp
}

export function AppLoader({ appId }: { appId: AppId }) {
  const App = appComponents[appId]
  return <App appId={appId} />
}
