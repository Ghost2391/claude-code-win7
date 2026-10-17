import { randomUUID } from 'node:crypto'
import { clearGrokClientCache } from '../../services/api/grok/client.js'
import { clearOpenAIClientCache } from '../../services/api/openai/client.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../settings/settings.js'

/** Profile protocol families that map to a settings modelType value. */
export type ProfileModelType = 'anthropic' | 'openai' | 'gemini' | 'grok'

export type CustomModelDefinition =
  | string
  | {
      value: string
      label?: string
      description?: string
      contextWindow?: number
    }

/**
 * A named provider profile: a complete endpoint + model set that can be saved
 * and switched between, like opencode's provider config. When active, its
 * fields are materialized into the standard env vars / modelType that the rest
 * of the runtime reads.
 */
export type ProviderProfile = {
  id: string
  name: string
  modelType: ProfileModelType
  baseURL?: string
  apiKey?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  customModels?: CustomModelDefinition[]
}

/** All profiles actually stored in user settings (excluding the active id). */
export function getProviderProfiles(): ProviderProfile[] {
  const settings = getInitialSettings()
  return settings.providerProfiles ?? []
}

/** Id of the currently-activated profile, if any. */
export function getActiveProviderProfileId(): string | undefined {
  return getInitialSettings().activeProviderProfile
}

/** The active profile object, if one is set and still present. */
export function getActiveProviderProfile(): ProviderProfile | undefined {
  const activeId = getActiveProviderProfileId()
  if (!activeId) return undefined
  return getProviderProfiles().find(p => p.id === activeId)
}

/** ModelType of the active profile, falling back to the raw settings value. */
export function getProfileModelType(
  settings: {
    modelType?: ProfileModelType
    activeProviderProfile?: string
    providerProfiles?: ProviderProfile[]
  } = getInitialSettings(),
): ProfileModelType {
  const activeId = settings.activeProviderProfile
  const profile = settings.providerProfiles?.find(p => p.id === activeId)
  if (profile) return profile.modelType
  return settings.modelType ?? 'anthropic'
}

/** Materialize the active profile's fields into process.env + clear caches. */
export function materializeActiveProvider(): void {
  const profile = getActiveProviderProfile()
  if (!profile) return

  const envMap: Record<string, string> = {}

  if (profile.baseURL) {
    envMap[baseUrlEnvKey(profile.modelType)] = profile.baseURL
  }
  if (profile.apiKey) {
    envMap[apiKeyEnvKey(profile.modelType)] = profile.apiKey
  }
  if (profile.haikuModel) {
    envMap[haikuModelEnvKey(profile.modelType)] = profile.haikuModel
  }
  if (profile.sonnetModel) {
    envMap[sonnetModelEnvKey(profile.modelType)] = profile.sonnetModel
  }
  if (profile.opusModel) {
    envMap[opusModelEnvKey(profile.modelType)] = profile.opusModel
  }

  for (const [key, value] of Object.entries(envMap)) {
    process.env[key] = value
  }

  // Clients cache the built endpoint against the env at construction time —
  // invalidate so the next build picks up the materialized vars.
  clearOpenAIClientCache()
  clearGrokClientCache()
}

/**
 * Create or update a named profile and persist it to user settings.
 * Returns the created profile's id.
 */
export function saveProviderProfile(
  profile: Omit<ProviderProfile, 'id'>,
  existingId?: string,
): string {
  const id = existingId ?? randomUUID()
  const profiles = [...getProviderProfiles()]
  const normalized: ProviderProfile = { ...profile, id }
  const idx = profiles.findIndex(p => p.id === id)
  if (idx >= 0) {
    profiles[idx] = normalized
  } else {
    profiles.push(normalized)
  }
  updateSettingsForSource('userSettings', {
    providerProfiles: profiles,
  } as unknown as Parameters<typeof updateSettingsForSource>[1])
  return id
}

/** Remove a profile. If it was active, deactivates it. */
export function deleteProviderProfile(id: string): void {
  const profiles = getProviderProfiles().filter(p => p.id !== id)
  const wasActive = getActiveProviderProfileId() === id
  updateSettingsForSource('userSettings', {
    providerProfiles: profiles,
    ...(wasActive ? { activeProviderProfile: undefined } : {}),
  } as unknown as Parameters<typeof updateSettingsForSource>[1])
}

/** Set the active profile and materialize its values into the env. */
export function activateProviderProfile(id: string): void {
  updateSettingsForSource('userSettings', {
    activeProviderProfile: id,
  } as unknown as Parameters<typeof updateSettingsForSource>[1])
  materializeActiveProvider()
}

/** Deactivate the active profile (fall back to raw modelType/env). */
export function deactivateProviderProfile(): void {
  updateSettingsForSource('userSettings', {
    activeProviderProfile: undefined,
  } as unknown as Parameters<typeof updateSettingsForSource>[1])
}

/** Map a profile modelType to the env key holding its base URL. */
function baseUrlEnvKey(modelType: ProviderProfile['modelType']): string {
  switch (modelType) {
    case 'anthropic':
      return 'ANTHROPIC_BASE_URL'
    case 'openai':
      return 'OPENAI_BASE_URL'
    case 'gemini':
      return 'GEMINI_BASE_URL'
    case 'grok':
      return 'GROK_BASE_URL'
  }
}

/** Map a profile modelType to the env key holding its API key. */
function apiKeyEnvKey(modelType: ProviderProfile['modelType']): string {
  switch (modelType) {
    case 'anthropic':
      return 'ANTHROPIC_AUTH_TOKEN'
    default:
      return `${modelType.toUpperCase()}_API_KEY`
  }
}

/** Map a profile modelType + tier to the model-default env key. */
function tierModelEnvKey(
  modelType: ProviderProfile['modelType'],
  tier: 'haiku' | 'sonnet' | 'opus',
): string {
  const prefix =
    modelType === 'anthropic' ? 'ANTHROPIC' : modelType.toUpperCase()
  return `${prefix}_DEFAULT_${tier.toUpperCase()}_MODEL`
}

function haikuModelEnvKey(modelType: ProviderProfile['modelType']): string {
  return tierModelEnvKey(modelType, 'haiku')
}
function sonnetModelEnvKey(modelType: ProviderProfile['modelType']): string {
  return tierModelEnvKey(modelType, 'sonnet')
}
function opusModelEnvKey(modelType: ProviderProfile['modelType']): string {
  return tierModelEnvKey(modelType, 'opus')
}
