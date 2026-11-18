import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  resetModelStringsForTestingOnly,
  setMainLoopModelOverride,
} from 'src/bootstrap/state.js'
import * as settingsModule from 'src/utils/settings/settings.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { ALL_MODEL_CONFIGS } from '../configs.js'
import { getDefaultOpusModel, getUserSpecifiedModelSetting } from '../model.js'
import { getModelOptions, getOpus46Option } from '../modelOptions.js'
import { getModelStrings } from '../modelStrings.js'
import { resetSessionProviderProfileForTesting } from '../providerProfiles.js'

/**
 * Verifies getDefaultOpusModel() returns Opus 4.7 across all providers
 * (firstParty + Bedrock/Vertex/Foundry). This is the Gap #2 assertion:
 * as of 2026-04-17 all 3P vendors have published Opus 4.7, so the fork
 * must not fall back to Opus 4.6 on 3P.
 *
 * Authoritative sources for 3P availability:
 *   - AWS Bedrock: docs.aws.amazon.com/bedrock/.../model-card-anthropic-claude-opus-4-7.html
 *   - Google Vertex AI: docs.cloud.google.com/vertex-ai/.../claude/opus-4-7
 *   - Microsoft Foundry: ai.azure.com/catalog/models/claude-opus-4-7
 */

const envKeys = [
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GROK',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL',
  'OPENAI_MODEL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_MODEL',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetProviderState(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
  resetSessionProviderProfileForTesting()
  // Session-global override set by other test files leaks across the process.
  setMainLoopModelOverride(undefined)
}

describe('getDefaultOpusModel', () => {
  test('restores the remembered profile model while respecting explicit overrides', () => {
    const settings = {
      activeProviderProfile: 'remembered',
      providerProfiles: [
        {
          id: 'remembered',
          name: 'Remembered',
          modelType: 'openai',
          customModels: ['first', 'last'],
          lastSelectedModel: 'last',
        },
      ],
    }
    const initial = spyOn(settingsModule, 'getInitialSettings').mockReturnValue(
      settings as never,
    )
    const merged = spyOn(
      settingsModule,
      'getSettings_DEPRECATED',
    ).mockReturnValue(settings as never)
    try {
      expect(getUserSpecifiedModelSetting()).toBe('last')
      process.env.ANTHROPIC_MODEL = 'environment'
      expect(getUserSpecifiedModelSetting()).toBe('environment')
      setMainLoopModelOverride('explicit')
      expect(getUserSpecifiedModelSetting()).toBe('explicit')
    } finally {
      initial.mockRestore()
      merged.mockRestore()
    }
  })
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    resetProviderState()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    resetProviderState()
  })

  test('returns Opus 4.7 for firstParty', () => {
    expect(getDefaultOpusModel()).toBe(ALL_MODEL_CONFIGS.opus47.firstParty)
  })

  test('returns Opus 4.7 for bedrock (3P no longer lags)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getDefaultOpusModel()).toBe(ALL_MODEL_CONFIGS.opus47.bedrock)
  })

  test('returns Opus 4.7 for vertex (3P no longer lags)', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(getDefaultOpusModel()).toBe(ALL_MODEL_CONFIGS.opus47.vertex)
  })

  test('returns Opus 4.7 for foundry (3P no longer lags)', () => {
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(getDefaultOpusModel()).toBe(ALL_MODEL_CONFIGS.opus47.foundry)
  })

  test('honors ANTHROPIC_DEFAULT_OPUS_MODEL env override (any provider)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-4-1-custom'
    expect(getDefaultOpusModel()).toBe('claude-opus-4-1-custom')
  })

  test('honors OPENAI_DEFAULT_OPUS_MODEL for openai provider', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_DEFAULT_OPUS_MODEL = 'gpt-5-turbo'
    expect(getDefaultOpusModel()).toBe('gpt-5-turbo')
  })
})

/**
 * Gap #3 addition — "Opus 4.6" must appear as an explicit opt-in option in
 * the /model picker across all non-ANT user tiers. The option's value MUST
 * be the canonical 4.6 model string, NOT the 'opus' alias (which would
 * resolve via getDefaultOpusModel back to 4.7 on firstParty, silently
 * defeating the user's explicit choice).
 */
describe('getOpus46Option', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    resetProviderState()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    resetProviderState()
  })

  test('firstParty: value is canonical opus46 string, NOT opus alias', () => {
    const opt = getOpus46Option(false)
    expect(opt.value).toBe(getModelStrings().opus46)
    expect(opt.value).not.toBe('opus')
    expect(opt.label).toBe('Opus 4.6')
  })

  test('firstParty: description says "Previous generation", not "Legacy"', () => {
    const opt = getOpus46Option(false)
    expect(opt.description).toContain('Previous generation')
    expect(opt.description).not.toContain('Legacy')
  })

  test('bedrock: value is canonical opus46 string (unchanged behavior)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    const opt = getOpus46Option(false)
    expect(opt.value).toBe(getModelStrings().opus46)
    expect(opt.value).toBe(ALL_MODEL_CONFIGS.opus46.bedrock)
  })

  test('option has descriptionForModel that mentions Opus 4.6', () => {
    const opt = getOpus46Option(false)
    expect(opt.descriptionForModel).toBeDefined()
    expect(opt.descriptionForModel).toContain('Opus 4.6')
  })

  test('customModels-only profile omits default Claude tier slots in getModelOptions and falls back to customModels[0]', () => {
    const customSettings = {
      modelType: 'openai',
      activeProviderProfile: 'p1',
      providerProfiles: [
        {
          id: 'p1',
          name: 'Antigravity',
          modelType: 'openai',
          baseURL: 'http://127.0.0.1:8045/v1',
          customModels: [
            {
              value: 'gemini-3.8-flash-medium',
              label: 'gemini-3.8-flash-medium',
            },
            {
              value: 'claude-sonnet-5-5-medium',
              label: 'claude-sonnet-5-5-medium',
            },
          ],
        },
        {
          id: 'p2',
          name: 'DeepSeek',
          modelType: 'openai',
          baseURL: 'http://127.0.0.1:7863/v1',
          customModels: [{ value: 'cn:glm-5.3', label: 'glm-5.3(CN)' }],
        },
      ],
    }
    // Other test files replace the settings module process-wide, so stub the
    // readers directly instead of relying on the real settings cache.
    const spies = [
      spyOn(settingsModule, 'getInitialSettings').mockReturnValue(
        customSettings as never,
      ),
      spyOn(settingsModule, 'getSettings_DEPRECATED').mockReturnValue(
        customSettings as never,
      ),
    ]
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    try {
      const opts = getModelOptions(false)
      const values = opts.map(o => o.value)
      expect(values).toEqual([
        'gemini-3.8-flash-medium',
        'claude-sonnet-5-5-medium',
        'profile:p2:cn:glm-5.3',
      ])
      expect(values).not.toContain(null)
      expect(values).not.toContain('sonnet')
      expect(values).not.toContain('opus')
      expect(values).not.toContain('haiku')
      // The getDefault*Model() getters are stubbed process-wide by the
      // MagicDocs/SessionMemory prompt suites (mock.module is global), so their
      // customModels fallback is asserted on getProfileDefaultModel directly in
      // providerProfiles.test.ts instead of through these getters here.
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
