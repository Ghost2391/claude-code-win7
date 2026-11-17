import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { ModelSetting } from './model.js'
import { isModelAllowed } from './modelAllowlist.js'
import { getActiveProviderProfile } from './providerProfiles.js'

/**
 * Pure precedence rule for the user-specified model:
 * session/startup override > ANTHROPIC_MODEL > remembered per-profile choice >
 * saved settings.model. Exported so it can be tested without touching the
 * process-global settings/env state.
 */
export function pickUserSpecifiedModel(
  override: ModelSetting | undefined,
  envModel: string | undefined,
  rememberedModel: string | undefined,
  settingsModel: ModelSetting | undefined,
): ModelSetting | undefined {
  if (override !== undefined) return override
  return envModel || rememberedModel || settingsModel || undefined
}

/**
 * Model the user explicitly asked for (session override, --model, env, or
 * remembered/per-profile selection), or undefined for the default (null).
 */
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  const specifiedModel = pickUserSpecifiedModel(
    getMainLoopModelOverride(),
    process.env.ANTHROPIC_MODEL,
    getActiveProviderProfile()?.lastSelectedModel,
    (getSettings_DEPRECATED() || {}).model,
  )

  // Ignore the user-specified model if it's not in the availableModels allowlist.
  if (specifiedModel && !isModelAllowed(specifiedModel)) {
    return undefined
  }

  return specifiedModel
}
