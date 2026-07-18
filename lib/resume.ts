import { getResumeData } from '@/data/resume'
import type { Locale } from '@/i18n/routing'

export function getResumeKnowledgeBase(locale: Locale = 'zh') {
  return getResumeData(locale)
}

export function searchResume(query: string, locale: Locale = 'zh') {
  const { experiences, openSource, profile, projects, skills } = getResumeData(locale)
  const normalized = query.toLowerCase()
  const entries = [
    { type: 'profile', title: profile.name, content: JSON.stringify(profile) },
    ...skills.map((item) => ({ type: 'skills', title: item.group, content: JSON.stringify(item) })),
    ...experiences.map((item) => ({ type: 'experience', title: item.company, content: JSON.stringify(item) })),
    ...projects.map((item) => ({ type: 'project', title: item.name, content: JSON.stringify(item) })),
    { type: 'open-source', title: 'Open Source', content: openSource.join('\n') }
  ]

  return entries.filter((entry) => entry.content.toLowerCase().includes(normalized)).slice(0, 8)
}

export function getProjectById(id: string, locale: Locale = 'zh') {
  const { projects } = getResumeData(locale)
  return projects.find((project) => project.id === id)
}

export function getProjectIds() {
  return getResumeData('zh').projects.map((project) => project.id)
}
