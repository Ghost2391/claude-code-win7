/**
 * Search adapter factory — selects the appropriate backend.
 *
 * Priority (highest first):
 *   1. WEB_SEARCH_ADAPTER environment variable (explicit override)
 *   2. settings.webSearchAdapter (user-configurable via /web-tools)
 *   3. Default: tavily
 *
 * The `api` adapter delegates to Anthropic's server-side `web_search`
 * tool. Non-Anthropic providers (OpenAI-compatible / Gemini / Grok) cannot
 * execute that server tool — the schema is silently dropped from the request
 * and the model never emits a `tool_use`, so the adapter returns "no results".
 * Coerce those providers to Tavily instead.
 */

import { getAPIProvider } from 'src/utils/model/providers.js'
import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import { ApiSearchAdapter } from './apiAdapter.js'
import { BingSearchAdapter } from './bingAdapter.js'
import { BraveSearchAdapter } from './braveAdapter.js'
import { DuckDuckGoSearchAdapter } from './duckduckgoAdapter.js'
import { ExaSearchAdapter } from './exaAdapter.js'
import { TavilySearchAdapter } from './tavilyAdapter.js'
import type { WebSearchAdapter } from './types.js'

export type {
  SearchResult,
  SearchOptions,
  SearchProgress,
  WebSearchAdapter,
} from './types.js'

function isAdapterKey(value: unknown): value is SearchAdapterKey {
  return (
    value === 'api' ||
    value === 'bing' ||
    value === 'brave' ||
    value === 'duckduckgo' ||
    value === 'exa' ||
    value === 'tavily'
  )
}

export type SearchAdapterKey =
  | 'api'
  | 'bing'
  | 'brave'
  | 'duckduckgo'
  | 'exa'
  | 'tavily'

let cachedAdapter: WebSearchAdapter | null = null
let cachedAdapterKey: SearchAdapterKey | null = null

export function createAdapter(): WebSearchAdapter {
  // 1. Explicit env override
  const envAdapter = process.env.WEB_SEARCH_ADAPTER
  // 2. Settings preference (set via /web-tools panel)
  const settingsAdapter = getSettings_DEPRECATED().webSearchAdapter

  const requestedKey: SearchAdapterKey = isAdapterKey(envAdapter)
    ? envAdapter
    : isAdapterKey(settingsAdapter)
      ? settingsAdapter
      : 'tavily' // 3. Default

  // The server-side `web_search` tool only exists on Anthropic's API. On
  // other providers this degrades to a useless second LLM call, so fall back
  // to the Tavily adapter (which works everywhere).
  const adapterKey: SearchAdapterKey =
    requestedKey === 'api' && getAPIProvider() !== 'firstParty'
      ? 'tavily'
      : requestedKey

  if (cachedAdapter && cachedAdapterKey === adapterKey) return cachedAdapter

  switch (adapterKey) {
    case 'api':
      cachedAdapter = new ApiSearchAdapter()
      break
    case 'bing':
      cachedAdapter = new BingSearchAdapter()
      break
    case 'brave':
      cachedAdapter = new BraveSearchAdapter()
      break
    case 'duckduckgo':
      cachedAdapter = new DuckDuckGoSearchAdapter()
      break
    case 'exa':
      cachedAdapter = new ExaSearchAdapter()
      break
    case 'tavily':
    default:
      cachedAdapter = new TavilySearchAdapter()
      break
  }

  cachedAdapterKey = adapterKey
  return cachedAdapter
}

/** Build a fresh adapter for an explicit key (no cache). Used for fallbacks. */
export function createAdapterByKey(key: SearchAdapterKey): WebSearchAdapter {
  switch (key) {
    case 'api':
      return new ApiSearchAdapter()
    case 'bing':
      return new BingSearchAdapter()
    case 'brave':
      return new BraveSearchAdapter()
    case 'duckduckgo':
      return new DuckDuckGoSearchAdapter()
    case 'exa':
      return new ExaSearchAdapter()
    case 'tavily':
    default:
      return new TavilySearchAdapter()
  }
}

/** Worth retrying the same endpoint: the connection dropped mid-flight. */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
])

/** Host unreachable — retrying the SAME endpoint is pointless. Fail over. */
const HARD_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_FAIL',
  'ENETUNREACH',
  'EHOSTUNREACH',
])

export type NetworkErrorKind = 'retryable' | 'hard' | null

/**
 * Classify a transport error:
 *   - 'retryable': socket closed/reset/timeout — a second attempt often works.
 *   - 'hard': DNS failure / connection refused / host unreachable — the
 *     backend is simply not there; skip the retry and fail over immediately.
 *   - null: not a network error (4xx JSON, bad API key, abort) → propagate.
 */
export function classifyNetworkError(error: unknown): NetworkErrorKind {
  if (!error || typeof error !== 'object') return null
  const err = error as {
    code?: unknown
    message?: unknown
    cause?: { code?: unknown; message?: unknown }
  }
  const code =
    typeof err.code === 'string'
      ? err.code
      : typeof err.cause?.code === 'string'
        ? err.cause.code
        : undefined
  if (code && RETRYABLE_NETWORK_CODES.has(code)) return 'retryable'
  if (code && HARD_NETWORK_CODES.has(code)) return 'hard'
  if (code?.startsWith('CERT_') || code?.startsWith('ERR_TLS_')) return 'hard'

  const message = [
    typeof err.message === 'string' ? err.message : '',
    typeof err.cause?.message === 'string' ? err.cause.message : '',
  ]
    .join(' ')
    .toLowerCase()

  if (
    message.includes('certificate') ||
    message.includes('getaddrinfo') ||
    message.includes('connection refused')
  ) {
    return 'hard'
  }
  if (
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('hang up') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('connection was closed') ||
    message.includes('other side closed') ||
    message.includes('timed out')
  ) {
    return 'retryable'
  }
  return null
}
