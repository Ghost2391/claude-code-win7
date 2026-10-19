import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import type { ProviderProfile } from '../model/providerProfiles.js'
import {
  parseContextWindowSize,
  extractContextWindowFromModelName,
  getContextWindowForModel,
  resolveProfileContextWindow,
} from '../context.js'

describe('context window resolution', () => {
  const savedEnv = process.env.CONTEXT_WINDOW
  const savedMax = process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS

  beforeEach(() => {
    delete process.env.CONTEXT_WINDOW
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  })

  afterEach(() => {
    if (savedEnv) process.env.CONTEXT_WINDOW = savedEnv
    else delete process.env.CONTEXT_WINDOW
    if (savedMax) process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = savedMax
    else delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  })

  test('parseContextWindowSize parses k, m, and raw numbers', () => {
    expect(parseContextWindowSize('128k')).toBe(128_000)
    expect(parseContextWindowSize('64k')).toBe(64_000)
    expect(parseContextWindowSize('1m')).toBe(1_000_000)
    expect(parseContextWindowSize('1.5m')).toBe(1_500_000)
    expect(parseContextWindowSize(200_000)).toBe(200_000)
    expect(parseContextWindowSize('128000')).toBe(128_000)
    expect(parseContextWindowSize('invalid')).toBeUndefined()
  })

  test('extractContextWindowFromModelName extracts bracket suffix', () => {
    expect(
      extractContextWindowFromModelName('cn:deepseek-v4.1-flash[128k]'),
    ).toBe(128_000)
    expect(extractContextWindowFromModelName('deepseek-chat[64k]')).toBe(64_000)
    expect(extractContextWindowFromModelName('gemini-pro[1m]')).toBe(1_000_000)
    expect(
      extractContextWindowFromModelName('claude-sonnet-4-6'),
    ).toBeUndefined()
  })

  test('getContextWindowForModel respects CONTEXT_WINDOW env var', () => {
    process.env.CONTEXT_WINDOW = '128k'
    expect(getContextWindowForModel('custom-model')).toBe(128_000)
  })

  test('getContextWindowForModel respects model bracket suffix', () => {
    expect(getContextWindowForModel('deepseek-chat[64k]')).toBe(64_000)
  })
})

describe('resolveProfileContextWindow', () => {
  function profile(
    id: string,
    extra: Partial<ProviderProfile> = {},
  ): ProviderProfile {
    return { id, name: id, modelType: 'openai', ...extra }
  }

  test('customModels entry overrides the profile-level default', () => {
    const profiles = [
      profile('deepseek', {
        contextWindow: '600k',
        customModels: [
          { value: 'cn:deepseek-v4.1-flash', contextWindow: '600k' },
          { value: 'deepseek-small', contextWindow: '128k' },
        ],
      }),
    ]
    expect(
      resolveProfileContextWindow(
        profiles,
        'deepseek',
        'cn:deepseek-v4.1-flash',
      ),
    ).toBe(600_000)
    expect(
      resolveProfileContextWindow(profiles, 'deepseek', 'deepseek-small'),
    ).toBe(128_000)
  })

  test('falls back to the profile-level contextWindow', () => {
    const profiles = [profile('p', { contextWindow: '800k', opusModel: 'm' })]
    expect(resolveProfileContextWindow(profiles, 'p', 'm')).toBe(800_000)
  })

  test('active profile wins when several profiles declare the same model', () => {
    const shared = 'm-shared'
    const profiles = [
      profile('inactive', {
        customModels: [{ value: shared, contextWindow: '290k' }],
      }),
      profile('active', {
        customModels: [{ value: shared, contextWindow: '690k' }],
      }),
    ]
    expect(resolveProfileContextWindow(profiles, 'active', shared)).toBe(
      690_000,
    )
  })

  test('inactive profile still resolves models it owns exclusively', () => {
    const profiles = [
      profile('a', {
        customModels: [{ value: 'm-a', contextWindow: '250k' }],
      }),
      profile('b', { contextWindow: '700k', opusModel: 'm-b' }),
    ]
    expect(resolveProfileContextWindow(profiles, 'b', 'm-a')).toBe(250_000)
    expect(resolveProfileContextWindow(profiles, 'b', 'm-b')).toBe(700_000)
  })

  test('returns undefined for unknown models or empty profile lists', () => {
    expect(
      resolveProfileContextWindow(undefined, undefined, 'm'),
    ).toBeUndefined()
    expect(resolveProfileContextWindow([], undefined, 'm')).toBeUndefined()
    expect(
      resolveProfileContextWindow([profile('p')], 'p', 'unknown'),
    ).toBeUndefined()
  })
})
