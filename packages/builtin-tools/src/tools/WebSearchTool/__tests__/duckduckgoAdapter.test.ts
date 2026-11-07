import { describe, expect, test } from 'bun:test'
import {
  extractDuckDuckGoResults,
  resolveDuckDuckGoUrl,
} from '../adapters/duckduckgoAdapter'

describe('resolveDuckDuckGoUrl', () => {
  test('unwraps the /l/?uddg= redirect wrapper', () => {
    expect(
      resolveDuckDuckGoUrl(
        '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fa%3D1&rut=xyz',
      ),
    ).toBe('https://example.com/page?a=1')
  })

  test('accepts an absolute https URL unchanged', () => {
    expect(resolveDuckDuckGoUrl('https://example.org/x')).toBe(
      'https://example.org/x',
    )
  })

  test('drops duckduckgo-internal and empty links', () => {
    expect(resolveDuckDuckGoUrl('https://duckduckgo.com/settings')).toBe(
      undefined,
    )
    expect(resolveDuckDuckGoUrl('')).toBe(undefined)
  })

  test('drops non-http uddg targets', () => {
    expect(
      resolveDuckDuckGoUrl('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)'),
    ).toBe(undefined)
  })
})

describe('extractDuckDuckGoResults', () => {
  test('parses title, url and snippet from result anchors', () => {
    const html = `
      <div class="result results_links">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Example &amp; Title</a>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">This is the <b>snippet</b> text.</a>
      </div>
      <div class="result results_links">
        <a rel="nofollow" class="result__a" href="https://direct.example.org/x">Direct Result</a>
        <div class="result__snippet">Another snippet</div>
      </div>
    `
    expect(extractDuckDuckGoResults(html)).toEqual([
      {
        title: 'Example & Title',
        url: 'https://example.com/page',
        snippet: 'This is the snippet text.',
      },
      {
        title: 'Direct Result',
        url: 'https://direct.example.org/x',
        snippet: 'Another snippet',
      },
    ])
  })

  test('ignores non-result anchors', () => {
    const html = `<a href="https://duckduckgo.com/y.js">sponsored</a>`
    expect(extractDuckDuckGoResults(html)).toEqual([])
  })

  test('skips results with no snippet', () => {
    const html = `<a class="result__a" href="https://example.com">Title</a>`
    expect(extractDuckDuckGoResults(html)).toEqual([
      { title: 'Title', url: 'https://example.com/', snippet: undefined },
    ])
  })
})
