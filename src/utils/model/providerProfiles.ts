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
      contextWindow?: number | string
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
  contextWindow?: number | string
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

/** The model a profile should use as the session's main-loop model. */
export function getProfileDefaultModel(
  profile: ProviderProfile,
): string | undefined {
  const tierModel =
    profile.sonnetModel ?? profile.opusModel ?? profile.haikuModel
  if (tierModel) return tierModel
  const first = profile.customModels?.[0]
  if (!first) return undefined
  return typeof first === 'string' ? first : first.value
}

/** Materialize the active profile's fields into process.env + clear caches. */
export function materializeActiveProvider(): void {
  const profile = getActiveProviderProfile()
  if (!profile) return

  // Reset any profile-injected env vars so switching between profiles
  // (e.g. from one with a custom baseURL to one with default) doesn't leak.
  const profileEnvKeys = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'OPENAI_BASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_DEFAULT_HAIKU_MODEL',
    'OPENAI_DEFAULT_SONNET_MODEL',
    'OPENAI_DEFAULT_OPUS_MODEL',
    'GEMINI_BASE_URL',
    'GEMINI_API_KEY',
    'GEMINI_DEFAULT_HAIKU_MODEL',
    'GEMINI_DEFAULT_SONNET_MODEL',
    'GEMINI_DEFAULT_OPUS_MODEL',
    'GROK_BASE_URL',
    'GROK_API_KEY',
    'GROK_DEFAULT_HAIKU_MODEL',
    'GROK_DEFAULT_SONNET_MODEL',
    'GROK_DEFAULT_OPUS_MODEL',
  ]
  for (const k of profileEnvKeys) {
    delete process.env[k]
  }

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

/** Check whether a profile defines or provides the given model. */
export function profileMatchesModel(
  profile: ProviderProfile,
  modelName: string,
): boolean {
  if (!modelName) return false
  const clean = modelName
    .replace(/\[1m\]/i, '')
    .trim()
    .toLowerCase()
  const matches = (candidate?: string) => {
    if (!candidate) return false
    return (
      candidate
        .replace(/\[1m\]/i, '')
        .trim()
        .toLowerCase() === clean
    )
  }
  if (matches(profile.sonnetModel)) return true
  if (matches(profile.opusModel)) return true
  if (matches(profile.haikuModel)) return true
  for (const item of profile.customModels ?? []) {
    const val = typeof item === 'string' ? item : item.value
    if (matches(val)) return true
  }
  return false
}

/**
 * Resolve a model selection string (which may carry an explicit `profile:<id>:<model>`
 * prefix, or a bare model name, or a profile name) to its target profile and clean model name.
 */
export function resolveProfileAndModel(value: string | null | undefined): {
  profileId?: string
  modelName: string | null
  profile?: ProviderProfile
} {
  if (value === null || value === undefined) {
    return { modelName: null }
  }

  const profiles = getProviderProfiles()
  const activeId = getActiveProviderProfileId()
  const activeProfile = profiles.find(p => p.id === activeId)

  // 1. Explicit profile prefix: "profile:<profileId>:<modelName>"
  if (value.startsWith('profile:')) {
    const withoutPrefix = value.slice('profile:'.length)
    const colonIdx = withoutPrefix.indexOf(':')
    if (colonIdx !== -1) {
      const profileId = withoutPrefix.slice(0, colonIdx)
      const rawModel = withoutPrefix.slice(colonIdx + 1)
      const profile = profiles.find(p => p.id === profileId)
      return {
        profileId,
        modelName: rawModel || null,
        profile,
      }
    }
  }

  // 2. Direct match against a profile's id or name (e.g. "/model deepseek")
  const lowerVal = value.trim().toLowerCase()
  const matchedByIdOrName = profiles.find(
    p => p.id.toLowerCase() === lowerVal || p.name.toLowerCase() === lowerVal,
  )
  if (matchedByIdOrName) {
    return {
      profileId: matchedByIdOrName.id,
      modelName: getProfileDefaultModel(matchedByIdOrName) ?? null,
      profile: matchedByIdOrName,
    }
  }

  // 3. Model name belongs to active profile? Stay on active profile
  if (activeProfile && profileMatchesModel(activeProfile, value)) {
    return {
      profileId: activeId,
      modelName: value,
      profile: activeProfile,
    }
  }

  // 4. Model name belongs to another saved profile? Switch to it
  for (const p of profiles) {
    if (p.id !== activeId && profileMatchesModel(p, value)) {
      return {
        profileId: p.id,
        modelName: value,
        profile: p,
      }
    }
  }

  // 5. Normal model name without profile binding
  return { modelName: value }
}

/**
 * Switch the active provider profile by ID.
 * Materializes its environment variables and refreshes client caches.
 * Returns the activated profile if found.
 */
export function switchProfile(profileId: string): ProviderProfile | undefined {
  const profile = getProviderProfiles().find(p => p.id === profileId)
  if (!profile) return undefined
  activateProviderProfile(profileId)
  return profile
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
