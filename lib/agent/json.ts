import {
  normalizeResumeData,
  type ResumeData,
  type ResumeLocale,
  type ResumeSource
} from '@/lib/resume-model'

export const MAX_AGENT_JSON_CHARS = 80_000
export const MAX_NORMALIZED_RESUME_BYTES = 60_000

export class AgentOutputError extends Error {
  constructor(readonly code: 'AI_OUTPUT_INVALID' | 'AI_OUTPUT_TOO_LARGE') {
    super(code === 'AI_OUTPUT_INVALID' ? 'Invalid JSON response' : 'AI output exceeds size limits')
    this.name = 'AgentOutputError'
  }
}

const fencedJsonPattern = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n?```$/i

export function extractJsonText(value: string) {
  if (value.length > MAX_AGENT_JSON_CHARS) {
    throw new AgentOutputError('AI_OUTPUT_TOO_LARGE')
  }

  const trimmed = value.trim()
  const fence = fencedJsonPattern.exec(trimmed)
  const json = (fence?.[1] ?? trimmed).trim()

  try {
    JSON.parse(json)
    assertNoDuplicateJsonKeys(json)
  } catch {
    throw new AgentOutputError('AI_OUTPUT_INVALID')
  }

  return json
}

/** Rejects object-key collisions before `JSON.parse` can silently keep the last value. */
function assertNoDuplicateJsonKeys(json: string) {
  let cursor = 0

  const skipWhitespace = () => {
    while (/\s/.test(json[cursor] ?? '')) cursor += 1
  }

  const parseString = () => {
    const start = cursor
    cursor += 1
    while (cursor < json.length) {
      const character = json[cursor]
      if (character === '\\') {
        cursor += 2
        continue
      }
      cursor += 1
      if (character === '"') return JSON.parse(json.slice(start, cursor)) as string
    }
    throw new SyntaxError('Unterminated JSON string')
  }

  const parseValue = (): void => {
    skipWhitespace()
    const character = json[cursor]
    if (character === '{') {
      cursor += 1
      const keys = new Set<string>()
      skipWhitespace()
      if (json[cursor] === '}') {
        cursor += 1
        return
      }
      while (cursor < json.length) {
        skipWhitespace()
        if (json[cursor] !== '"') throw new SyntaxError('JSON object key expected')
        const key = parseString()
        if (keys.has(key)) throw new SyntaxError('Duplicate JSON object key')
        keys.add(key)
        skipWhitespace()
        if (json[cursor] !== ':') throw new SyntaxError('JSON object colon expected')
        cursor += 1
        parseValue()
        skipWhitespace()
        if (json[cursor] === '}') {
          cursor += 1
          return
        }
        if (json[cursor] !== ',') throw new SyntaxError('JSON object delimiter expected')
        cursor += 1
      }
      throw new SyntaxError('Unterminated JSON object')
    }
    if (character === '[') {
      cursor += 1
      skipWhitespace()
      if (json[cursor] === ']') {
        cursor += 1
        return
      }
      while (cursor < json.length) {
        parseValue()
        skipWhitespace()
        if (json[cursor] === ']') {
          cursor += 1
          return
        }
        if (json[cursor] !== ',') throw new SyntaxError('JSON array delimiter expected')
        cursor += 1
      }
      throw new SyntaxError('Unterminated JSON array')
    }
    if (character === '"') {
      parseString()
      return
    }

    const start = cursor
    while (cursor < json.length && !/[\s,}\]]/.test(json[cursor])) cursor += 1
    if (cursor === start) throw new SyntaxError('JSON value expected')
  }

  parseValue()
  skipWhitespace()
  if (cursor !== json.length) throw new SyntaxError('Unexpected JSON trailing content')
}

export function parseResumeJson(
  value: string,
  options: {
    locale: ResumeLocale
    source: ResumeSource
    now?: string
  }
): ResumeData {
  try {
    const input = JSON.parse(extractJsonText(value))
    const normalized = normalizeResumeData(input, options)
    const serializedBytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength
    if (serializedBytes > MAX_NORMALIZED_RESUME_BYTES) {
      throw new AgentOutputError('AI_OUTPUT_TOO_LARGE')
    }
    return normalized
  } catch (error) {
    if (error instanceof AgentOutputError) throw error
    throw new AgentOutputError('AI_OUTPUT_INVALID')
  }
}
