import {
  detectMarketplaceFromJobUrl,
  type JobMarketplaceId
} from './job-marketplace'

export const MAX_JOB_CLIPBOARD_LENGTH = 100_000

export type ParsedJobClipboard = {
  platform?: JobMarketplaceId
  url?: string
  title?: string
  company?: string
  location?: string
  description?: string
}

const labeledFields = {
  title: /^(?:职位名称|岗位名称|职位|岗位|job\s*title|title)\s*[:：]\s*(.+)$/iu,
  company: /^(?:公司名称|招聘公司|公司|company)\s*[:：]\s*(.+)$/iu,
  location: /^(?:工作地点|职位地点|地点|城市|location)\s*[:：]\s*(.+)$/iu
} as const
const descriptionStart = /^(?:职位描述|岗位描述|岗位职责|工作职责|job\s*description|description|responsibilities)\s*[:：]?\s*(.*)$/iu
const urlPattern = /https:\/\/[^\s<>"']+/giu
const urlLinePattern = /https:\/\/[^\s<>"']+/iu

export function parseJobClipboardText(value: string): ParsedJobClipboard {
  const normalized = value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim()
  if (!normalized || normalized.length > MAX_JOB_CLIPBOARD_LENGTH) {
    throw new TypeError('Clipboard job text is empty or too large')
  }
  const lines = normalized.split('\n').map((line) => line.trim())
  const rawUrl = normalized.match(urlPattern)?.[0]
  const url = rawUrl ? stripTrailingPunctuation(rawUrl) : undefined
  const result: ParsedJobClipboard = {
    ...(url ? { url, platform: detectMarketplaceFromJobUrl(url) } : {})
  }
  let descriptionLine = -1
  let inlineDescription = ''

  lines.forEach((line, index) => {
    if (!line) return
    for (const [field, pattern] of Object.entries(labeledFields) as Array<[
      keyof typeof labeledFields,
      RegExp
    ]>) {
      const match = line.match(pattern)
      if (match?.[1] && !result[field]) result[field] = match[1].trim()
    }
    if (descriptionLine < 0) {
      const match = line.match(descriptionStart)
      if (match) {
        descriptionLine = index
        inlineDescription = match[1]?.trim() ?? ''
      }
    }
  })

  if (descriptionLine >= 0) {
    const remainder = lines.slice(descriptionLine + 1).filter(Boolean).join('\n')
    const description = [inlineDescription, remainder].filter(Boolean).join('\n').trim()
    if (description) result.description = description
  } else {
    const unlabeled = lines.filter((line) => (
      line
      && !urlLinePattern.test(line)
      && !Object.values(labeledFields).some((pattern) => pattern.test(line))
    )).join('\n').trim()
    if (unlabeled.length >= 20) result.description = unlabeled
  }
  return result
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[),.;，。；）\]}]+$/gu, '')
}
