import type { JobEmploymentType, JobWorkplaceType } from './job-domain'

const knownCities = [
  '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '苏州',
  '西安', '重庆', '长沙', '天津', '厦门', '宁波', '郑州', '青岛', '合肥'
] as const

const knownTitles = [
  'AI Agent工程师', 'AI应用工程师', 'AI全栈工程师', '全栈工程师',
  '高级前端工程师', '前端开发工程师', '前端工程师', '后端开发工程师',
  '后端工程师', '大模型应用工程师', '算法工程师', '产品经理'
] as const

export type AnalyzedJobGoal = {
  titles: string[]
  locations: string[]
  minimumSalary?: number
  maximumSalary?: number
  workplaceTypes: JobWorkplaceType[]
  employmentTypes: JobEmploymentType[]
  preferredTerms: string[]
}

export function analyzeJobGoalDescription(description: string): AnalyzedJobGoal {
  const text = description.normalize('NFKC').trim().slice(0, 5_000)
  const compact = text.replace(/\s+/gu, '')
  const titles = knownTitles.filter((title) => compact.toLocaleLowerCase().includes(
    title.replace(/\s+/gu, '').toLocaleLowerCase()
  ))
  const locations = knownCities.filter((city) => compact.includes(city))
  const workplaceTypes: JobWorkplaceType[] = []
  if (/(远程|remote|居家办公)/iu.test(text)) workplaceTypes.push('remote')
  if (/(混合办公|hybrid)/iu.test(text)) workplaceTypes.push('hybrid')
  if (/(现场办公|坐班|onsite)/iu.test(text)) workplaceTypes.push('onsite')
  const employmentTypes: JobEmploymentType[] = []
  if (/(全职|full[- ]?time)/iu.test(text)) employmentTypes.push('full-time')
  if (/(兼职|part[- ]?time)/iu.test(text)) employmentTypes.push('part-time')
  if (/(合同制|外包|contract)/iu.test(text)) employmentTypes.push('contract')
  if (/(实习|intern)/iu.test(text)) employmentTypes.push('internship')
  const salary = parseSalaryRange(text)
  const preferredTerms = [
    'AI Agent', 'RAG', 'LangGraph', 'TypeScript', 'React', 'Next.js',
    'React Native', 'Node.js', '远程', '交易系统', '支付', '钱包'
  ].filter((term) => compact.toLocaleLowerCase().includes(term.replace(/\s+/gu, '').toLocaleLowerCase()))
  return {
    titles: [...new Set(titles)],
    locations: [...new Set(locations)],
    ...salary,
    workplaceTypes,
    employmentTypes,
    preferredTerms
  }
}

function parseSalaryRange(text: string): Pick<AnalyzedJobGoal, 'minimumSalary' | 'maximumSalary'> {
  const match = /(?:月薪|薪资|工资)?\s*(\d{1,3}(?:\.\d+)?)\s*(k|千|万)?\s*(?:-|到|至|~|～)\s*(\d{1,3}(?:\.\d+)?)\s*(k|千|万)?/iu.exec(text)
  if (!match) return {}
  const minimumSalary = salaryValue(match[1], match[2] || match[4])
  const maximumSalary = salaryValue(match[3], match[4] || match[2])
  if (!minimumSalary || !maximumSalary || maximumSalary < minimumSalary) return {}
  return { minimumSalary, maximumSalary }
}

function salaryValue(raw: string, unit: string | undefined) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  if (/万/u.test(unit ?? '')) return Math.round(value * 10_000)
  if (/(k|千)/iu.test(unit ?? '')) return Math.round(value * 1_000)
  return Math.round(value)
}
