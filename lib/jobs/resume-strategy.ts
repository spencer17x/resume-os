import type { ResumeData } from '@/lib/resume-model'

export const RESUME_STRATEGY_KEYS = [
  'ai-agent', 'frontend', 'fullstack', 'mobile', 'backend', 'general'
] as const

export type ResumeStrategyKey = typeof RESUME_STRATEGY_KEYS[number]

const strategyTerms: Record<ResumeStrategyKey, readonly string[]> = {
  'ai-agent': ['AI', 'Agent', 'RAG', 'LangGraph', 'LLM', '大模型', '智能体', '向量'],
  frontend: ['前端', 'React', 'Vue', 'Next.js', 'TypeScript', 'Web', '性能'],
  fullstack: ['全栈', 'Node.js', 'TypeScript', 'API', '数据库', '前端', '后端'],
  mobile: ['React Native', '移动端', '客户端', 'iOS', 'Android', 'RTC'],
  backend: ['后端', 'Node.js', 'Java', 'Python', 'Go', '数据库', '分布式'],
  general: []
}

export function classifyResumeStrategy(title: string, resume: ResumeData): ResumeStrategyKey {
  const titleStrategy = classifyRoleTitle(title)
  if (titleStrategy !== 'general') return titleStrategy
  const text = `${resume.profile.title}\n${resume.targetRole ?? ''}\n${resume.skills.flatMap((group) => group.items).join(' ')}`.normalize('NFKC')
  return classifyRoleTitle(text)
}

export function classifyRoleTitle(value: string): ResumeStrategyKey {
  const text = value.normalize('NFKC')
  if (/(AI\s*Agent|智能体|大模型应用|RAG|LangGraph)/iu.test(text)) return 'ai-agent'
  if (/(React\s*Native|移动端|客户端|iOS|Android)/iu.test(text)) return 'mobile'
  if (/(全栈|full\s*stack)/iu.test(text)) return 'fullstack'
  if (/(前端|frontend|React|Vue|Next\.js)/iu.test(text)) return 'frontend'
  if (/(后端|backend|Node\.js|Java|Python|Go)/iu.test(text)) return 'backend'
  return 'general'
}

export function createStrategyResume(resume: ResumeData, strategy: ResumeStrategyKey, targetRole: string): ResumeData {
  const terms = strategyTerms[strategy]
  const score = (value: unknown) => {
    const text = JSON.stringify(value).toLocaleLowerCase()
    return terms.reduce((total, term) => total + (text.includes(term.toLocaleLowerCase()) ? 1 : 0), 0)
  }
  const stableSort = <Value,>(values: readonly Value[]) => values.map((value, index) => ({ value, index, score: score(value) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ value }) => value)
  return {
    ...resume,
    targetRole,
    profile: { ...resume.profile, summary: stableSort(resume.profile.summary) },
    skills: stableSort(resume.skills),
    experiences: resume.experiences.map((experience) => ({ ...experience, bullets: stableSort(experience.bullets) })),
    projects: stableSort(resume.projects).map((project) => ({ ...project, highlights: stableSort(project.highlights) })),
    metadata: { ...resume.metadata, updatedAt: resume.metadata.updatedAt }
  }
}
