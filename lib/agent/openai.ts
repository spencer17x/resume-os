import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output, streamText } from 'ai'
import type { ZodType } from 'zod'
import {
  AI_API_KEY_HEADER,
  AI_BASE_URL_HEADER,
  AI_MODEL_HEADER
} from '@/lib/agent/provider-headers'
import { apiErrorResponse, type ApiErrorCode } from '@/lib/server/request-guard'

export const DEFAULT_MAX_OUTPUT_TOKENS = 5_000
export const AI_REQUEST_TIMEOUT_MS = 60_000

const DEFAULT_ALLOWED_AI_HOSTS = ['api.openai.com']
const MAX_API_KEY_LENGTH = 4_096
const MAX_BASE_URL_LENGTH = 2_048
const MAX_MODEL_LENGTH = 256
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export class AgentConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentConfigurationError'
  }
}

type AgentRequestOptions = {
  system?: string
  request?: Request
  abortSignal?: AbortSignal
  maxOutputTokens?: number
}

function getRequiredOpenAIConfig(request?: Request) {
  const requestConfig = getCompleteRequestConfig(request)
  if (requestConfig) return validateOpenAIConfig(requestConfig, true)

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  const model = process.env.OPENAI_MODEL?.trim()

  if (!apiKey) {
    throw new AgentConfigurationError('OPENAI_API_KEY is not configured')
  }

  if (!model) {
    throw new AgentConfigurationError('OPENAI_MODEL is not configured')
  }

  return validateOpenAIConfig({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    model
  }, false)
}

function getCompleteRequestConfig(request?: Request) {
  if (!request) return null

  const apiKey = request.headers.get(AI_API_KEY_HEADER)?.trim()
  const baseURL = request.headers.get(AI_BASE_URL_HEADER)?.trim()
  const model = request.headers.get(AI_MODEL_HEADER)?.trim()
  if (!apiKey || !baseURL || !model) return null

  return { apiKey, baseURL, model }
}

function validateOpenAIConfig(
  config: { apiKey: string; baseURL?: string; model: string },
  requireAllowedHost: boolean
) {
  assertBoundedValue(config.apiKey, MAX_API_KEY_LENGTH, 'API key')
  assertBoundedValue(config.model, MAX_MODEL_LENGTH, 'model')

  if (!config.baseURL) return config
  assertBoundedValue(config.baseURL, MAX_BASE_URL_LENGTH, 'base URL')

  let url: URL
  try {
    url = new URL(config.baseURL)
  } catch {
    throw new AgentConfigurationError('AI base URL is invalid')
  }

  const hasUserInfo = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/i.test(config.baseURL)
  if (
    hasUserInfo
    || url.username
    || url.password
    || config.baseURL.includes('?')
    || config.baseURL.includes('#')
  ) {
    throw new AgentConfigurationError('AI base URL is invalid')
  }

  const localLoopback = process.env.RESUME_OS_LOCAL_ONLY === '1' && isLoopbackHost(url.hostname)
  if (url.protocol !== 'https:' && !(localLoopback && url.protocol === 'http:')) {
    throw new AgentConfigurationError('AI base URL is invalid')
  }

  if (requireAllowedHost && !localLoopback && !allowedAiHosts().has(url.host.toLowerCase())) {
    throw new AgentConfigurationError('AI provider host is not allowed')
  }

  return { ...config, baseURL: url.toString() }
}

function assertBoundedValue(value: string, maxLength: number, field: string) {
  if (!value || value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    throw new AgentConfigurationError(`AI ${field} is invalid`)
  }
}

function allowedAiHosts() {
  return new Set([
    ...DEFAULT_ALLOWED_AI_HOSTS,
    ...(process.env.RESUME_OS_ALLOWED_AI_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  ])
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

async function fetchWithoutRedirects(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('AI provider redirects are not allowed')
  }
  return response
}

export async function generateAgentText(prompt: string, options: AgentRequestOptions = {}) {
  const config = getRequiredOpenAIConfig(options.request)
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    fetch: fetchWithoutRedirects
  })
  const request = createRequestSignal(options.abortSignal)

  try {
    const { text } = await generateText({
      model: openai.chat(config.model),
      system: options.system,
      prompt,
      temperature: 0.2,
      maxRetries: 1,
      abortSignal: request.signal,
      maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
    })

    return {
      model: config.model,
      text
    }
  } finally {
    request.dispose()
  }
}

export function streamAgentObject<OBJECT>(
  prompt: string,
  schema: ZodType<OBJECT>,
  options: AgentRequestOptions = {}
) {
  const config = getRequiredOpenAIConfig(options.request)
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    fetch: fetchWithoutRedirects
  })
  const request = createRequestSignal(options.abortSignal)
  const result = streamText({
    model: openai.chat(config.model),
    system: options.system,
    prompt,
    output: Output.object({ schema }),
    temperature: 0.2,
    maxRetries: 1,
    abortSignal: request.signal,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  })

  return {
    model: config.model,
    partialOutputStream: result.partialOutputStream,
    output: result.output,
    text: result.text,
    abort: request.abort,
    dispose: request.dispose
  }
}

function createRequestSignal(requestSignal?: AbortSignal) {
  const controller = new AbortController()
  const abortFromRequest = () => controller.abort(requestSignal?.reason)
  if (requestSignal?.aborted) {
    abortFromRequest()
  } else {
    requestSignal?.addEventListener('abort', abortFromRequest, { once: true })
  }

  const timeout = setTimeout(() => {
    controller.abort(new DOMException('AI request timed out', 'TimeoutError'))
  }, AI_REQUEST_TIMEOUT_MS)

  return {
    signal: controller.signal,
    abort(reason?: unknown) {
      controller.abort(reason)
    },
    dispose() {
      clearTimeout(timeout)
      requestSignal?.removeEventListener('abort', abortFromRequest)
    }
  }
}

export function createAgentErrorResponse(error: unknown) {
  const { code, status } = classifyAgentError(error)

  console.error('[resume-agent] AI request failed', { code })
  return apiErrorResponse(code, status)
}

function classifyAgentError(error: unknown): { code: ApiErrorCode; status: number } {
  if (error instanceof AgentConfigurationError) {
    return { code: 'AI_NOT_CONFIGURED', status: 503 }
  }

  if (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
  ) {
    return { code: 'REQUEST_ABORTED', status: 499 }
  }

  return { code: 'AI_UNAVAILABLE', status: 502 }
}
