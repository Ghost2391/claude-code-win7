/**
 * DuckDuckGo-based search adapter — fetches DuckDuckGo's server-rendered
 * HTML result page (`html.duckduckgo.com`) and extracts organic results.
 *
 * No API key and no third-party proxy: works wherever the user's network can
 * reach duckduckgo.com. Used as a last-resort fallback when the configured
 * backend (Tavily / Exa / Brave) is unreachable.
 */

import axios from 'axios'
import he from 'he'
import { AbortError } from 'src/utils/errors.js'
import type { SearchResult, SearchOptions, WebSearchAdapter } from './types.js'

const FETCH_TIMEOUT_MS = 30_000
const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/'

/**
 * Browser-like headers — DuckDuckGo serves a JS-challenge page to obvious
 * bots. A plain desktop UA keeps the server-rendered HTML path.
 */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
} as const

export class DuckDuckGoSearchAdapter implements WebSearchAdapter {
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const { signal, onProgress, allowedDomains, blockedDomains } = options

    if (signal?.aborted) {
      throw new AbortError()
    }

    onProgress?.({ type: 'query_update', query })

    const abortController = new AbortController()
    if (signal) {
      signal.addEventListener('abort', () => abortController.abort(), {
        once: true,
      })
    }

    let html: string
    try {
      const response = await axios.get(DUCKDUCKGO_HTML_URL, {
        params: { q: query },
        signal: abortController.signal,
        timeout: FETCH_TIMEOUT_MS,
        responseType: 'text',
        headers: BROWSER_HEADERS,
      })
      html = String(response.data)
    } catch (e) {
      if (axios.isCancel(e) || abortController.signal.aborted) {
        throw new AbortError()
      }
      throw e
    }

    if (abortController.signal.aborted) {
      throw new AbortError()
    }

    const results = extractDuckDuckGoResults(html).filter(r => {
      if (!r.url) return false
      try {
        const hostname = new URL(r.url).hostname
        if (
          allowedDomains?.length &&
          !allowedDomains.some(
            d => hostname === d || hostname.endsWith('.' + d),
          )
        ) {
          return false
        }
        if (
          blockedDomains?.length &&
          blockedDomains.some(d => hostname === d || hostname.endsWith('.' + d))
        ) {
          return false
        }
      } catch {
        return false
      }
      return true
    })

    onProgress?.({
      type: 'search_results_received',
      resultCount: results.length,
      query,
    })

    return results
  }
}

/**
 * Extract organic results from DuckDuckGo's HTML page.
 *
 * Each result is an `<a class="result__a" href="...">Title</a>` followed by
 * a snippet node (`class="result__snippet"`). We walk the anchors and take
 * the text between one anchor and the next as the snippet search space.
 */
export function extractDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  const anchors: Array<{ attrs: string; body: string; end: number }> = []

  let match: RegExpExecArray | null
  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = match[1] ?? ''
    if (!/class=["'][^"']*result__a[^"']*["']/i.test(attrs)) continue
    anchors.push({
      attrs,
      body: match[2] ?? '',
      end: anchorRegex.lastIndex,
    })
  }

  for (let i = 0; i < anchors.length; i++) {
    const { attrs, body, end } = anchors[i]!
    const hrefMatch = /href=["']([^"']+)["']/i.exec(attrs)
    if (!hrefMatch) continue

    const url = resolveDuckDuckGoUrl(decodeHtmlEntities(hrefMatch[1] ?? ''))
    if (!url) continue

    const title = decodeHtmlEntities(body.replace(/<[^>]+>/g, '').trim())
    if (!title) continue

    // The snippet node follows this anchor and precedes the next result's
    // anchor.
    const gap = html.slice(end, anchorStart(anchors[i + 1], html.length))
    results.push({ title, url, snippet: extractSnippet(gap) })
  }

  return results
}

/** Start offset of an anchor, derived from its recorded end + lengths. */
function anchorStart(
  anchor: { attrs: string; body: string; end: number } | undefined,
  fallback: number,
): number {
  if (!anchor) return fallback
  // `<a` + attrs + `>` + body + `</a>` = attrs.length + body.length + 7
  return Math.max(
    0,
    anchor.end - (anchor.attrs.length + anchor.body.length + 7),
  )
}

function extractSnippet(gap: string): string | undefined {
  const snippetRegex =
    /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i
  const m = snippetRegex.exec(gap)
  if (!m) return undefined
  const text = decodeHtmlEntities(m[1]!.replace(/<[^>]+>/g, '').trim())
  return text || undefined
}

/**
 * DuckDuckGo wraps outbound links:
 *   //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&rut=...
 *   https://duckduckgo.com/l/?uddg=...
 * Unwrap to the real destination. Relative/unknown links are dropped.
 */
export function resolveDuckDuckGoUrl(rawUrl: string): string | undefined {
  let url = rawUrl.trim()
  if (!url) return undefined
  if (url.startsWith('//')) url = `https:${url}`

  try {
    const parsed = new URL(url, 'https://duckduckgo.com')
    const uddg = parsed.searchParams.get('uddg')
    if (uddg) {
      const target = decodeURIComponent(uddg)
      return /^https?:\/\//i.test(target) ? target : undefined
    }
    if (parsed.hostname !== 'duckduckgo.com') return parsed.toString()
  } catch {
    return undefined
  }
  return undefined
}

export const decodeHtmlEntities = he.decode
