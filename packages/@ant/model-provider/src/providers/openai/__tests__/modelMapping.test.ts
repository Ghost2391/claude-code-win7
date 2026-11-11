import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { resolveOpenAIModel } from '../modelMapping.js'

describe('resolveOpenAIModel', () => {
  const originalEnv = {
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_DEFAULT_HAIKU_MODEL: process.env.OPENAI_DEFAULT_HAIKU_MODEL,
    OPENAI_DEFAULT_SONNET_MODEL: process.env.OPENAI_DEFAULT_SONNET_MODEL,
    OPENAI_DEFAULT_OPUS_MODEL: process.env.OPENAI_DEFAULT_OPUS_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
  }

  beforeEach(() => {
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_DEFAULT_HAIKU_MODEL
    delete process.env.OPENAI_DEFAULT_SONNET_MODEL
    delete process.env.OPENAI_DEFAULT_OPUS_MODEL
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  })

  afterEach(() => {
    Object.assign(process.env, originalEnv)
  })

  test('OPENAI_MODEL env var overrides all', () => {
    process.env.OPENAI_MODEL = 'my-custom-model'
    expect(resolveOpenAIModel('claude-sonnet-4-6')).toBe('my-custom-model')
  })

  test('resolves bare family aliases via OPENAI_DEFAULT_*_MODEL or ANTHROPIC_DEFAULT_*_MODEL', () => {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'my-sonnet'
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'my-haiku'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'my-opus'
    expect(resolveOpenAIModel('sonnet')).toBe('my-sonnet')
    expect(resolveOpenAIModel('haiku')).toBe('my-haiku')
    expect(resolveOpenAIModel('opus')).toBe('my-opus')
  })

  test('passes concrete model names through without hijacking by family substring', () => {
    process.env.OPENAI_DEFAULT_SONNET_MODEL = 'gemini-3.8-flash-medium'
    process.env.OPENAI_DEFAULT_OPUS_MODEL = 'gemini-3.8-flash-medium'
    expect(resolveOpenAIModel('claude-sonnet-5-5-medium')).toBe(
      'claude-sonnet-5-5-medium',
    )
    expect(resolveOpenAIModel('claude-opus-4-6')).toBe('claude-opus-4-6')
    expect(resolveOpenAIModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  test('passes through unknown model name', () => {
    expect(resolveOpenAIModel('some-random-model')).toBe('some-random-model')
  })

  test('strips context-window bracket suffix', () => {
    expect(resolveOpenAIModel('claude-sonnet-4-6[1m]')).toBe(
      'claude-sonnet-4-6',
    )
    expect(resolveOpenAIModel('gemini-4-argon-medium[600k]')).toBe(
      'gemini-4-argon-medium',
    )
  })
})
