import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/log.ts', logMock)
mock.module('bun:bundle', () => ({ feature: () => false }))
mock.module('src/services/api/openai/client.js', () => ({
  clearOpenAIClientCache: () => {},
}))
mock.module('src/services/api/grok/client.js', () => ({
  clearGrokClientCache: () => {},
}))

let stored: Record<string, unknown> = {}
mock.module('src/utils/settings/settings.js', () => ({
  getInitialSettings: () => stored,
  updateSettingsForSource: (
    _source: string,
    patch: Record<string, unknown>,
  ) => {
    stored = { ...stored, ...patch }
    return { error: null }
  },
}))

const envKeys = [
  'ANTHROPIC_BASE_URL',
  'OPENAI_BASE_URL',
  'GEMINI_BASE_URL',
  'GROK_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROK_API_KEY',
  'OPENAI_DEFAULT_HAIKU_MODEL',
  'OPENAI_DEFAULT_SONNET_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'GEMINI_DEFAULT_HAIKU_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL',
] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  stored = {}
  for (const key of envKeys) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key]
    else delete process.env[key]
  }
  delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  delete process.env.GROK_DEFAULT_SONNET_MODEL
})

describe('providerProfiles', () => {
  test('getProfileModelType falls back to settings.modelType ?? anthropic', async () => {
    const { getProfileModelType } = await import('../providerProfiles.js')
    expect(getProfileModelType({})).toBe('anthropic')
    expect(getProfileModelType({ modelType: 'gemini' })).toBe('gemini')
  })

  test('getProfileModelType prefers the active profile modelType', async () => {
    const { getProfileModelType } = await import('../providerProfiles.js')
    expect(
      getProfileModelType({
        modelType: 'openai',
        activeProviderProfile: 'p1',
        providerProfiles: [{ id: 'p1', name: 'DeepSeek', modelType: 'openai' }],
      }),
    ).toBe('openai')
    expect(
      getProfileModelType({
        modelType: 'openai',
        activeProviderProfile: 'p2',
        providerProfiles: [{ id: 'p2', name: 'Gemini', modelType: 'gemini' }],
      }),
    ).toBe('gemini')
  })

  test('saveProviderProfile persists and returns an id', async () => {
    const { saveProviderProfile, getProviderProfiles } = await import(
      '../providerProfiles.js'
    )
    const id = saveProviderProfile({
      name: 'DeepSeek',
      modelType: 'openai',
      baseURL: 'https://api.deepseek.com',
      sonnetModel: 'deepseek-v4-pro',
    })
    expect(id).toBeTypeOf('string')
    const profiles = getProviderProfiles()
    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.sonnetModel).toBe('deepseek-v4-pro')
    expect(profiles[0]!.id).toBe(id)
  })

  test('activateProviderProfile materializes base url + api key + models into env', async () => {
    const { saveProviderProfile, activateProviderProfile } = await import(
      '../providerProfiles.js'
    )
    const id = saveProviderProfile({
      name: 'DeepSeek',
      modelType: 'openai',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-secret',
      haikuModel: 'deepseek-v4-flash',
      sonnetModel: 'deepseek-v4-pro',
      opusModel: 'deepseek-v4-pro',
    })
    activateProviderProfile(id)
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.deepseek.com')
    expect(process.env.OPENAI_API_KEY).toBe('sk-secret')
    expect(process.env.OPENAI_DEFAULT_HAIKU_MODEL).toBe('deepseek-v4-flash')
    expect(process.env.OPENAI_DEFAULT_SONNET_MODEL).toBe('deepseek-v4-pro')
    expect(process.env.OPENAI_DEFAULT_OPUS_MODEL).toBe('deepseek-v4-pro')
  })

  test('materializeActiveProvider maps anthropic profile to ANTHROPIC_* env', async () => {
    const {
      saveProviderProfile,
      activateProviderProfile,
      getActiveProviderProfile,
    } = await import('../providerProfiles.js')
    const id = saveProviderProfile({
      name: 'Proxy',
      modelType: 'anthropic',
      baseURL: 'https://proxy.example.com',
      apiKey: 'tok-123',
      sonnetModel: 'claude-sonnet-4-6',
    })
    activateProviderProfile(id)
    expect(getActiveProviderProfile()?.id).toBe(id)
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com')
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('tok-123')
    expect(process.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-6')
  })

  test('deleteProviderProfile removes it and deactivates when active', async () => {
    const {
      saveProviderProfile,
      activateProviderProfile,
      deleteProviderProfile,
      getProviderProfiles,
      getActiveProviderProfile,
    } = await import('../providerProfiles.js')
    const id = saveProviderProfile({
      name: 'Temp',
      modelType: 'grok',
    })
    activateProviderProfile(id)
    expect(getActiveProviderProfile()).toBeDefined()
    deleteProviderProfile(id)
    expect(getProviderProfiles()).toHaveLength(0)
    expect(getActiveProviderProfile()).toBeUndefined()
  })

  test('deactivateProviderProfile clears the active id', async () => {
    const {
      saveProviderProfile,
      activateProviderProfile,
      deactivateProviderProfile,
      getActiveProviderProfileId,
    } = await import('../providerProfiles.js')
    const id = saveProviderProfile({ name: 'X', modelType: 'openai' })
    activateProviderProfile(id)
    expect(getActiveProviderProfileId()).toBe(id)
    deactivateProviderProfile()
    expect(getActiveProviderProfileId()).toBeUndefined()
  })
})
