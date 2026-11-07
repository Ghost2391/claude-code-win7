import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logForDebugging } from 'src/utils/debug.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  classifyNetworkError,
  createAdapter,
  createAdapterByKey,
  type SearchAdapterKey,
  type SearchProgress,
  type SearchResult as AdapterSearchResult,
  type WebSearchAdapter,
} from './adapters/index.js'
import { getWebSearchPrompt, WEB_SEARCH_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

/** Small delay between retry attempts (ms). */
const RETRY_BACKOFF_MS = 500

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function describeAdapterFailure(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : undefined
    return cause && cause !== error.message
      ? `${error.message}: ${cause}`
      : error.message
  }
  return String(error)
}

/**
 * Fallback order when the configured backend is unreachable. Both scrape a
 * public HTML page — no API key, no third-party proxy — so they fail only
 * when the network itself is down.
 */
const FALLBACK_ADAPTERS: readonly SearchAdapterKey[] = ['bing', 'duckduckgo']

/**
 * Search with resilience against flaky networks and dead search backends:
 *
 *   1. First attempt on the configured adapter.
 *   2. On a retryable transport error (socket closed / ECONNRESET / timeout),
 *      wait briefly and retry the SAME adapter — stale keep-alive pools and
 *      one-off resets usually recover.
 *   3. If it still fails — or the backend is plainly unreachable (DNS /
 *      connection refused / TLS) — swap in a different backend (Bing HTML,
 *      then DuckDuckGo HTML) so WebSearch keeps working instead of surfacing
 *      a raw "socket closed" error to the model.
 *
 * Non-network errors (bad API key, 4xx JSON, abort) propagate immediately.
 */
async function searchWithNetworkResilience(
  adapter: WebSearchAdapter,
  query: string,
  options: Parameters<WebSearchAdapter['search']>[1],
): Promise<AdapterSearchResult[]> {
  let lastError: unknown
  try {
    return await adapter.search(query, options)
  } catch (error) {
    const kind = classifyNetworkError(error)
    if (kind === null || options.signal?.aborted) throw error
    lastError = error
    if (kind === 'retryable') {
      await sleep(RETRY_BACKOFF_MS, options.signal)
      if (options.signal?.aborted) throw error
      try {
        return await adapter.search(query, options)
      } catch (retryError) {
        if (
          classifyNetworkError(retryError) === null ||
          options.signal?.aborted
        ) {
          throw retryError
        }
        lastError = retryError
      }
    }
  }

  for (const key of FALLBACK_ADAPTERS) {
    if (options.signal?.aborted) throw lastError
    const fallback = createAdapterByKey(key)
    if (fallback.constructor.name === adapter.constructor.name) continue
    try {
      const results = await fallback.search(query, options)
      logForDebugging(
        `[WebSearch] ${adapter.constructor.name} failed (${describeAdapterFailure(lastError)}); ` +
          `served by ${key} fallback.`,
      )
      return results
    } catch (fallbackError) {
      if (options.signal?.aborted) throw fallbackError
      lastError = fallbackError
    }
  }

  throw lastError
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(2).describe('The search query to use'),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe('Only include search results from these domains'),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe('Never include search results from these domains'),
    num_results: z
      .number()
      .optional()
      .describe('Number of search results to return (default: 8)'),
    livecrawl: z
      .enum(['fallback', 'preferred'])
      .optional()
      .describe(
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
      ),
    search_type: z
      .enum(['auto', 'fast', 'deep'])
      .optional()
      .describe(
        "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
      ),
    context_max_characters: z
      .number()
      .optional()
      .describe(
        'Maximum characters for context string optimized for LLMs (default: 10000)',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const searchResultSchema = lazySchema(() => {
  const searchHitSchema = z.object({
    title: z.string().describe('The title of the search result'),
    url: z.string().describe('The URL of the search result'),
    snippet: z
      .string()
      .optional()
      .describe('A short description of the search result'),
  })

  return z.object({
    tool_use_id: z.string().describe('ID of the tool use'),
    content: z.array(searchHitSchema).describe('Array of search hits'),
  })
})

export type SearchResult = z.infer<ReturnType<typeof searchResultSchema>>

const outputSchema = lazySchema(() =>
  z.object({
    query: z.string().describe('The search query that was executed'),
    results: z
      .array(z.union([searchResultSchema(), z.string()]))
      .describe('Search results and/or text commentary from the model'),
    durationSeconds: z
      .number()
      .describe('Time taken to complete the search operation'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Re-export WebSearchProgress from centralized types to break import cycles
export type { WebSearchProgress } from 'src/types/tools.js'

import type { WebSearchProgress } from 'src/types/tools.js'

export const WebSearchTool = buildTool({
  name: WEB_SEARCH_TOOL_NAME,
  searchHint: 'search the web for current information',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    return `Claude wants to search the web for: ${input.query}`
  },
  userFacingName() {
    return 'Web Search'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Searching for ${summary}` : 'Searching the web'
  },
  isEnabled() {
    // Always enabled — the adapter factory selects the appropriate backend
    // (API server-side search or Bing fallback) based on provider capabilities.
    return true
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.query
  },
  async checkPermissions(_input): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: 'WebSearchTool requires permission.',
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: WEB_SEARCH_TOOL_NAME }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
    }
  },
  async prompt() {
    return getWebSearchPrompt()
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  extractSearchText() {
    return ''
  },
  async validateInput(input) {
    const { query, allowed_domains, blocked_domains } = input
    if (!query.length) {
      return {
        result: false,
        message: 'Error: Missing query',
        errorCode: 1,
      }
    }
    if (allowed_domains?.length && blocked_domains?.length) {
      return {
        result: false,
        message:
          'Error: Cannot specify both allowed_domains and blocked_domains in the same request',
        errorCode: 2,
      }
    }
    return { result: true }
  },
  async call(input, context, _canUseTool, _parentMessage, onProgress) {
    const startTime = performance.now()
    const { query } = input

    const searchOptions = {
      allowedDomains: input.allowed_domains,
      blockedDomains: input.blocked_domains,
      numResults: input.num_results,
      livecrawl: input.livecrawl,
      searchType: input.search_type,
      contextMaxCharacters: input.context_max_characters,
      signal: context.abortController.signal,
      onProgress(progress: SearchProgress) {
        if (onProgress) {
          const progressCounter = Date.now()
          onProgress({
            toolUseID: `search-progress-${progressCounter}`,
            data: progress,
          })
        }
      },
    }

    const adapter = createAdapter()
    let adapterResults: AdapterSearchResult[]
    try {
      adapterResults = await searchWithNetworkResilience(
        adapter,
        query,
        searchOptions,
      )
    } catch (error) {
      if (context.abortController.signal.aborted) throw error
      throw new Error(
        `Web search failed (${describeAdapterFailure(error)}). ` +
          `Tried ${adapter.constructor.name}. ` +
          `Set a different backend via /web-tools or WEB_SEARCH_ADAPTER (bing|brave|exa|tavily).`,
        { cause: error },
      )
    }

    const endTime = performance.now()
    const durationSeconds = (endTime - startTime) / 1000

    // Convert adapter SearchResult[] to legacy Output format
    const results: (SearchResult | string)[] = []
    if (adapterResults.length > 0) {
      results.push({
        tool_use_id: 'adapter-search-1',
        content: adapterResults.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
      })
    } else {
      results.push('No search results found.')
    }

    const data: Output = {
      query,
      results,
      durationSeconds,
    }
    return { data }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { query, results } = output

    let formattedOutput = `Web search results for query: "${query}"\n\n`

    ;(results ?? []).forEach(result => {
      if (result == null) {
        return
      }
      if (typeof result === 'string') {
        formattedOutput += result + '\n\n'
      } else {
        if (result.content?.length > 0) {
          formattedOutput += 'Links:\n'
          for (const link of result.content) {
            formattedOutput += `  - [${link.title}](${link.url})`
            if (link.snippet) {
              formattedOutput += `: ${link.snippet}`
            }
            formattedOutput += '\n'
          }
          formattedOutput += '\n'
        } else {
          formattedOutput += 'No links found.\n\n'
        }
      }
    })

    formattedOutput +=
      '\nREMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.'

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: formattedOutput.trim(),
    }
  },
} satisfies ToolDef<InputSchema, Output, WebSearchProgress>)
