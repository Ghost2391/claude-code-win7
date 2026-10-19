// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { CONTEXT_1M_BETA_HEADER } from '../constants/betas.js'
import { getGlobalConfig } from './config.js'
import { getInitialSettings } from './settings/settings.js'
import { isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import { resolveAntModel } from './model/antModels.js'
import { getModelCapability } from './model/modelCapabilities.js'
import {
  type ProviderProfile,
  profileMatchesModel,
} from './model/providerProfiles.js'

// Model context window size (200k tokens for all models right now)
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000

// Capped default for slot-reservation optimization. BQ p99 output = 4,911
// tokens, so 32k/64k defaults over-reserve 8-16× slot capacity. With the cap
// enabled, <1% of requests hit the limit; those get one clean retry at 64k
// (see query.ts max_output_tokens_escalate). Cap is applied in
// claude.ts:getMaxOutputTokensForModel to avoid the growthbook→betas→context
// import cycle.
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

/**
 * Check if 1M context is disabled via environment variable.
 * Used by C4E admins to disable 1M context for HIPAA compliance.
 */
export function is1mContextDisabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT)
}

export function has1mContext(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  return /\[1m\]/i.test(model)
}

// @[MODEL LAUNCH]: Update this pattern if the new model supports 1M context
export function modelSupports1M(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  const canonical = getCanonicalName(model)
  return (
    canonical.includes('claude-sonnet-4') ||
    canonical.includes('opus-4-6') ||
    canonical.includes('opus-4-7')
  )
}

/**
 * Parse a human-friendly context window string like "128k", "200k", "1m", "64k"
 * or a raw number into a positive integer.
 */
export function parseContextWindowSize(val: unknown): number | undefined {
  if (typeof val === 'number' && !isNaN(val) && val > 0) {
    return Math.round(val)
  }
  if (typeof val !== 'string') return undefined
  const trimmed = val.trim().toLowerCase()
  if (!trimmed) return undefined

  // "1m" -> 1,000,000; "1.5m" -> 1,500,000
  const mMatch = /^([0-9]+(?:\.[0-9]+)?)\s*m$/i.exec(trimmed)
  if (mMatch && mMatch[1]) {
    return Math.round(parseFloat(mMatch[1]) * 1_000_000)
  }
  // "128k" -> 128,000; "64k" -> 64,000
  const kMatch = /^([0-9]+(?:\.[0-9]+)?)\s*k$/i.exec(trimmed)
  if (kMatch && kMatch[1]) {
    return Math.round(parseFloat(kMatch[1]) * 1_000)
  }
  // Raw integer as string "128000"
  const parsed = parseInt(trimmed, 10)
  if (!isNaN(parsed) && parsed > 0) {
    return parsed
  }
  return undefined
}

/**
 * Extract context window size from bracketed suffix in model name, e.g. "model[128k]" or "model[64k]".
 */
export function extractContextWindowFromModelName(
  model: string,
): number | undefined {
  const match = /\[(\d+(?:\.\d+)?[kmKM])\]/.exec(model)
  if (match && match[1]) {
    return parseContextWindowSize(match[1])
  }
  return undefined
}

/**
 * Context window declared for `model` by a single provider profile:
 * the customModels entry wins over the profile-level default.
 */
function getProfileContextWindow(
  profile: ProviderProfile,
  model: string,
): number | undefined {
  if (profile.customModels) {
    const match = profile.customModels.find(
      m => (typeof m === 'string' ? m : m.value) === model,
    )
    if (match && typeof match !== 'string' && match.contextWindow) {
      const parsed = parseContextWindowSize(match.contextWindow)
      if (parsed) return parsed
    }
  }
  if (profile.contextWindow) {
    return parseContextWindowSize(profile.contextWindow)
  }
  return undefined
}

/**
 * Resolve a model's context window from saved provider profiles.
 *
 * The active profile takes precedence when it declares the model, so that a
 * model name shared by several saved profiles always uses the window of the
 * provider the session is actually running on. Otherwise the first profile
 * that declares the model wins.
 */
export function resolveProfileContextWindow(
  profiles: readonly ProviderProfile[] | undefined,
  activeProfileId: string | undefined,
  model: string,
): number | undefined {
  if (!profiles?.length) return undefined
  const activeProfile = activeProfileId
    ? profiles.find(p => p.id === activeProfileId)
    : undefined
  if (activeProfile && profileMatchesModel(activeProfile, model)) {
    const window = getProfileContextWindow(activeProfile, model)
    if (window) return window
  }
  for (const p of profiles) {
    if (p === activeProfile) continue
    if (profileMatchesModel(p, model)) {
      const window = getProfileContextWindow(p, model)
      if (window) return window
    }
  }
  return undefined
}

export function getContextWindowForModel(
  model: string,
  betas?: string[],
): number {
  // 1. Environment variable override (available to ALL users, not just 'ant')
  const envOverride =
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS ||
    process.env.CONTEXT_WINDOW ||
    process.env.CLAUDE_CONTEXT_WINDOW
  if (envOverride) {
    const parsed = parseContextWindowSize(envOverride)
    if (parsed) return parsed
  }

  // 2. Global settings.json override (e.g. settings.contextWindow: "128k")
  const profileSettings = getInitialSettings()
  if (profileSettings.contextWindow) {
    const parsed = parseContextWindowSize(profileSettings.contextWindow)
    if (parsed) return parsed
  }

  // 3. Model name explicit bracket suffix like [128k], [64k], [1m], etc.
  const fromModelName = extractContextWindowFromModelName(model)
  if (fromModelName) {
    return fromModelName
  }

  // 4. [1m] suffix — explicit client-side opt-in, respected over standard defaults
  if (has1mContext(model)) {
    return 1_000_000
  }

  // 5. Saved provider profiles. The active profile wins when it owns the
  // model (two profiles may declare the same model name; the session is
  // running on the active provider's endpoint), then any other profile that
  // declares it — e.g. a model picked from another provider in /model.
  const profileWindow = resolveProfileContextWindow(
    profileSettings.providerProfiles,
    profileSettings.activeProviderProfile,
    model,
  )
  if (profileWindow) return profileWindow

  // 6. Active provider profile fallback: apply profile-level contextWindow
  // for models this profile doesn't declare.
  const activeProfile = profileSettings.providerProfiles?.find(
    p => p.id === profileSettings.activeProviderProfile,
  )
  if (activeProfile?.contextWindow) {
    const parsed = parseContextWindowSize(activeProfile.contextWindow)
    if (parsed) return parsed
  }

  const cap = getModelCapability(model)
  if (cap?.max_input_tokens && cap.max_input_tokens >= 100_000) {
    if (
      cap.max_input_tokens > MODEL_CONTEXT_WINDOW_DEFAULT &&
      is1mContextDisabled()
    ) {
      return MODEL_CONTEXT_WINDOW_DEFAULT
    }
    return cap.max_input_tokens
  }

  if (betas?.includes(CONTEXT_1M_BETA_HEADER) && modelSupports1M(model)) {
    return 1_000_000
  }
  if (getSonnet1mExpTreatmentEnabled(model)) {
    return 1_000_000
  }
  if (process.env.USER_TYPE === 'ant') {
    const antModel = resolveAntModel(model)
    if (antModel?.contextWindow) {
      return antModel.contextWindow
    }
  }
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

export function getSonnet1mExpTreatmentEnabled(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  // Only applies to sonnet 4.6 without an explicit [1m] suffix
  if (has1mContext(model)) {
    return false
  }
  if (!getCanonicalName(model).includes('sonnet-4-6')) {
    return false
  }
  return getGlobalConfig().clientDataCache?.['coral_reef_sonnet'] === 'true'
}

/**
 * Calculate context window usage percentage from token usage data.
 * Returns used and remaining percentages, or null values if no usage data.
 */
export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) {
    return { used: null, remaining: null }
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens

  // Treat zero input tokens the same as no usage data — avoids flashing
  // "ctx:0%" when a third-party API omits usage from message_start.
  if (totalInputTokens === 0) {
    return { used: null, remaining: null }
  }

  const usedPercentage = Math.round(
    (totalInputTokens / contextWindowSize) * 100,
  )
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  }
}

/**
 * Returns the model's default and upper limit for max output tokens.
 */
export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  let defaultTokens: number
  let upperLimit: number

  if (process.env.USER_TYPE === 'ant') {
    const antModel = resolveAntModel(model.toLowerCase())
    if (antModel) {
      defaultTokens = antModel.defaultMaxTokens ?? MAX_OUTPUT_TOKENS_DEFAULT
      upperLimit = antModel.upperMaxTokensLimit ?? MAX_OUTPUT_TOKENS_UPPER_LIMIT
      return { default: defaultTokens, upperLimit }
    }
  }

  const m = getCanonicalName(model)

  if (m.includes('opus-4-7')) {
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (m.includes('opus-4-6')) {
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (m.includes('sonnet-4-6')) {
    defaultTokens = 32_000
    upperLimit = 128_000
  } else if (
    m.includes('opus-4-5') ||
    m.includes('sonnet-4') ||
    m.includes('haiku-4')
  ) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else if (m.includes('opus-4-1') || m.includes('opus-4')) {
    defaultTokens = 32_000
    upperLimit = 32_000
  } else if (m.includes('claude-3-opus')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('claude-3-sonnet')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('claude-3-haiku')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('3-5-sonnet') || m.includes('3-5-haiku')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('3-7-sonnet')) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else {
    defaultTokens = MAX_OUTPUT_TOKENS_DEFAULT
    upperLimit = MAX_OUTPUT_TOKENS_UPPER_LIMIT
  }

  const cap = getModelCapability(model)
  if (cap?.max_tokens && cap.max_tokens >= 4_096) {
    upperLimit = cap.max_tokens
    defaultTokens = Math.min(defaultTokens, upperLimit)
  }

  return { default: defaultTokens, upperLimit }
}

/**
 * Returns the max thinking budget tokens for a given model. The max
 * thinking tokens should be strictly less than the max output tokens.
 *
 * Deprecated since newer models use adaptive thinking rather than a
 * strict thinking token budget.
 */
export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
