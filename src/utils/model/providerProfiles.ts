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
  lastSelectedModel?: string
}

/**
 * Session-scoped pin of the active profile id.
 *
 * `activeProviderProfile` lives in the user settings file, which every running
 * CLI process shares. Persisting a switch there is correct for the *next*
 * session, but a concurrent session must not follow it: its model override is
 * in-memory and session-local (AppState.mainLoopModel), so adopting another
 * session's profile would send provider A's model to provider B's endpoint
 * (the "model does not exist" failure). So each process pins the id it started
 * with and only changes it when the user switches profile in *this* process.
 *
 * - `undefined` → not pinned yet; follow the settings file (startup).
 * - `null`      → explicitly deactivated in this session.
 * - string      → active profile id for this session.
 */
let sessionActiveProfileId: string | null | undefined
const profileEnvOverlay = new Map<
  string,
  { original: string | undefined; injected: string }
>()

/** Raw id persisted in the shared settings file. */
function getSettingsActiveProviderProfileId(): string | undefined {
  return getInitialSettings().activeProviderProfile
}

/** Clear the session pin so the next materialize re-reads the settings file. */
export function resetSessionProviderProfileForTesting(): void {
  sessionActiveProfileId = undefined
  profileEnvOverlay.clear()
}

/**
 * Pin the settings value for this process on first use. Called from
 * `materializeActiveProvider()`, which runs once during startup before any
 * settings watcher can observe another session's write.
 */
function pinSessionProfile(): void {
  if (sessionActiveProfileId === undefined) {
    sessionActiveProfileId = getSettingsActiveProviderProfileId() ?? null
  }
}

/** All profiles actually stored in user settings (excluding the active id). */
export function getProviderProfiles(): ProviderProfile[] {
  const settings = getInitialSettings()
  return settings.providerProfiles ?? []
}

/** Id of the currently-activated profile for this session, if any. */
export function getActiveProviderProfileId(): string | undefined {
  if (sessionActiveProfileId !== undefined) {
    return sessionActiveProfileId ?? undefined
  }
  return getSettingsActiveProviderProfileId()
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
  // Once this session has pinned a profile, it wins over the shared file so a
  // concurrent session's switch cannot reroute our requests.
  const activeId =
    sessionActiveProfileId !== undefined
      ? (sessionActiveProfileId ?? undefined)
      : settings.activeProviderProfile
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

export function rememberSelectedModel(model: string | null): void {
  const activeId = getActiveProviderProfileId()
  if (activeId) {
    const profiles = getProviderProfiles().map(profile =>
      profile.id === activeId
        ? { ...profile, lastSelectedModel: model ?? undefined }
        : profile,
    )
    updateSettingsForSource('userSettings', { providerProfiles: profiles })
  } else {
    updateSettingsForSource('userSettings', { model: model ?? undefined })
  }
}

/** Materialize the active profile's fields into process.env + clear caches. */
export function materializeActiveProvider(): void {
  pinSessionProfile()
  const profile = getActiveProviderProfile()

  for (const [key, { original, injected }] of profileEnvOverlay) {
    if (process.env[key] !== injected) continue
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  profileEnvOverlay.clear()

  // Clear the client caches even with no profile: the env above may have just
  // changed, and both clients cache the endpoint captured at construction.
  clearOpenAIClientCache()
  clearGrokClientCache()

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
    profileEnvOverlay.set(key, {
      original: process.env[key],
      injected: value,
    })
    process.env[key] = value
  }
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
  if (wasActive) sessionActiveProfileId = null
  updateSettingsForSource('userSettings', {
    providerProfiles: profiles,
    ...(wasActive ? { activeProviderProfile: undefined } : {}),
  } as unknown as Parameters<typeof updateSettingsForSource>[1])
  // Drop the deleted profile's base URL / API key from this process's env.
  if (wasActive) materializeActiveProvider()
}

/** Set the active profile and materialize its values into the env. */
export function activateProviderProfile(id: string): void {
  // Pin before persisting: the settings watcher in this same process also
  // fires for our own write, and it must already see the new id.
  sessionActiveProfileId = id
  updateSettingsForSource('userSettings', {
    activeProviderProfile: id,
  } as unknown as Parameters<typeof updateSettingsForSource>[1])
  materializeActiveProvider()
}

/** Deactivate the active profile (fall back to raw modelType/env). */
export function deactivateProviderProfile(): void {
  sessionActiveProfileId = null
  updateSettingsForSource('userSettings', {
    activeProviderProfile: undefined,
  } as unknown as Parameters<typeof updateSettingsForSource>[1])
  materializeActiveProvider()
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
