import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  parseContextWindowSize,
  extractContextWindowFromModelName,
  getContextWindowForModel,
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
