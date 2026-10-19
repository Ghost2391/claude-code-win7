import { setMainLoopModelOverride } from '../bootstrap/state.js'
import type { Command } from '../commands.js'
import type {
  LocalCommandCall,
  LocalJSXCommandContext,
} from '../types/command.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  activateProviderProfile,
  deactivateProviderProfile,
  deleteProviderProfile,
  getActiveProviderProfile,
  getProfileDefaultModel,
  getProviderProfiles,
  type ProviderProfile,
} from '../utils/model/providerProfiles.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js'

function getEnvVarForProvider(provider: string): string {
  switch (provider) {
    case 'bedrock':
      return 'CLAUDE_CODE_USE_BEDROCK'
    case 'vertex':
      return 'CLAUDE_CODE_USE_VERTEX'
    case 'foundry':
      return 'CLAUDE_CODE_USE_FOUNDRY'
    case 'gemini':
      return 'CLAUDE_CODE_USE_GEMINI'
    case 'grok':
      return 'CLAUDE_CODE_USE_GROK'
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

// Get merged env: process.env + settings.env (from userSettings)
function getMergedEnv(): Record<string, string> {
  const settings = getSettings_DEPRECATED()
  const merged: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  )
  if (settings?.env) {
    Object.assign(merged, settings.env)
  }
  return merged
}

const call: LocalCommandCall = async (args, context) => {
  const arg = args.trim().toLowerCase()

  // profile <id>        — activate a saved provider profile
  // profile list        — list all saved provider profiles
  // profile rm <id>     — delete a saved provider profile
  // profile off         — deactivate the active profile
  if (arg.startsWith('profile')) {
    return handleProfileCommand(arg.slice('profile'.length).trim(), context)
  }

  // No argument: show current provider
  if (!arg) {
    const current = getAPIProvider()
    const active = getActiveProviderProfile()
    return {
      type: 'text',
      value: active
        ? `Current API provider: ${current} (profile: ${active.name})`
        : `Current API provider: ${current}`,
    }
  }

  // unset - clear settings, fallback to env vars
  if (arg === 'unset') {
    updateSettingsForSource('userSettings', { modelType: undefined })
    // Also clear all provider-specific env vars to prevent conflicts
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    return {
      type: 'text',
      value: 'API provider cleared (will use environment variables).',
    }
  }

  // Validate provider
  const validProviders = [
    'anthropic',
    'openai',
    'gemini',
    'grok',
    'bedrock',
    'vertex',
    'foundry',
  ]
  if (!validProviders.includes(arg)) {
    return {
      type: 'text',
      value: `Invalid provider: ${arg}\nValid: ${validProviders.join(', ')}`,
    }
  }

  // Check env vars when switching to openai (including settings.env)
  if (arg === 'openai') {
    const mergedEnv = getMergedEnv()
    const hasChatGPTAuth = mergedEnv.OPENAI_AUTH_MODE === 'chatgpt'
    const hasKey = !!mergedEnv.OPENAI_API_KEY
    const hasUrl = !!mergedEnv.OPENAI_BASE_URL
    if (!hasChatGPTAuth && (!hasKey || !hasUrl)) {
      updateSettingsForSource('userSettings', { modelType: 'openai' })
      const missing = []
      if (!hasKey) missing.push('OPENAI_API_KEY')
      if (!hasUrl) missing.push('OPENAI_BASE_URL')
      return {
        type: 'text',
        value: `Switched to OpenAI provider.\nWarning: Missing env vars: ${missing.join(', ')}\nConfigure them via /login or set manually.`,
      }
    }
  }

  // Check env vars when switching to grok (including settings.env)
  if (arg === 'grok') {
    const mergedEnv = getMergedEnv()
    const hasKey = !!(mergedEnv.GROK_API_KEY || mergedEnv.XAI_API_KEY)
    if (!hasKey) {
      updateSettingsForSource('userSettings', { modelType: 'grok' })
      return {
        type: 'text',
        value: `Switched to Grok provider.\nWarning: Missing env var: GROK_API_KEY (or XAI_API_KEY)\nConfigure it via settings.json env or set manually.`,
      }
    }
  }

  // Check env vars when switching to gemini (including settings.env)
  if (arg === 'gemini') {
    const mergedEnv = getMergedEnv()
    const hasKey = !!mergedEnv.GEMINI_API_KEY
    // GEMINI_BASE_URL is optional (has default)
    if (!hasKey) {
      updateSettingsForSource('userSettings', { modelType: 'gemini' })
      return {
        type: 'text',
        value: `Switched to Gemini provider.\nWarning: Missing env var: GEMINI_API_KEY\nConfigure it via /login or set manually.`,
      }
    }
  }

  // Handle different provider types
  // - 'anthropic', 'openai', 'gemini' are stored in settings.json (persistent)
  // - 'bedrock', 'vertex', 'foundry' are env-only (do NOT touch settings.json)
  if (
    arg === 'anthropic' ||
    arg === 'openai' ||
    arg === 'gemini' ||
    arg === 'grok'
  ) {
    // Clear any cloud provider env vars to avoid conflicts
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    // Update settings.json
    updateSettingsForSource('userSettings', { modelType: arg })
    // Ensure settings.env gets applied to process.env
    applyConfigEnvironmentVariables()
    return { type: 'text', value: `API provider set to ${arg}.` }
  } else {
    // Cloud providers: set env vars only, do NOT touch settings.json
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    process.env[getEnvVarForProvider(arg)] = '1'
    // Do not modify settings.json - cloud providers controlled solely by env vars
    applyConfigEnvironmentVariables()
    return {
      type: 'text',
      value: `API provider set to ${arg} (via environment variable).`,
    }
  }
}

const provider = {
  type: 'local',
  name: 'provider',
  description:
    'Switch API provider (anthropic/openai/gemini/grok/bedrock/vertex/foundry)',
  aliases: ['api'],
  argumentHint:
    '[anthropic|openai|gemini|grok|bedrock|vertex|foundry|unset|profile list|profile <id>|profile rm <id>|profile off]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

/**
 * Point the session at the profile's main-loop model so a provider switch
 * takes effect immediately, without a follow-up /model selection.
 */
function applyProfileModel(
  profile: ProviderProfile,
  context: LocalJSXCommandContext,
): string | undefined {
  const model = getProfileDefaultModel(profile)
  if (!model) return undefined
  setMainLoopModelOverride(model)
  context.setAppState(prev => ({
    ...prev,
    mainLoopModel: model,
    mainLoopModelForSession: null,
  }))
  return model
}

/** Reset the session model so the env / settings default applies again. */
function resetProfileModel(context: LocalJSXCommandContext): void {
  setMainLoopModelOverride(undefined)
  context.setAppState(prev => ({
    ...prev,
    mainLoopModel: null,
    mainLoopModelForSession: null,
  }))
}

function handleProfileCommand(
  rest: string,
  context: LocalJSXCommandContext,
): { type: 'text'; value: string } {
  const [sub, id] = rest.split(/\s+/)

  if (sub === 'list' || sub === '') {
    const profiles = getProviderProfiles()
    const activeId = getActiveProviderProfile()?.id
    if (profiles.length === 0) {
      return {
        type: 'text',
        value:
          'No provider profiles configured. Use /login and pick "Save as profile" to create one.',
      }
    }
    const lines = profiles.map(p => {
      const marker = p.id === activeId ? '* ' : '  '
      const meta = [
        p.modelType,
        p.baseURL ?? '',
        p.sonnetModel ?? p.opusModel ?? '',
      ]
        .filter(Boolean)
        .join(' · ')
      return `${marker}${p.name} (${p.id}): ${meta}`
    })
    return { type: 'text', value: ['Provider profiles:', ...lines].join('\n') }
  }

  if (sub === 'off') {
    deactivateProviderProfile()
    applyConfigEnvironmentVariables()
    resetProfileModel(context)
    return {
      type: 'text',
      value:
        'Provider profile deactivated — using settings modelType / env vars.',
    }
  }

  if (sub === 'rm') {
    if (!id) {
      return { type: 'text', value: 'Usage: /provider profile rm <id>' }
    }
    const profile = getProviderProfiles().find(p => p.id === id)
    if (!profile) {
      return { type: 'text', value: `No provider profile with id: ${id}` }
    }
    const wasActive = getActiveProviderProfile()?.id === id
    deleteProviderProfile(id)
    applyConfigEnvironmentVariables()
    if (wasActive) resetProfileModel(context)
    return {
      type: 'text',
      value: `Removed provider profile "${profile.name}".`,
    }
  }

  // Activate by id or by name (case-insensitive)
  const profile = matchProfile(sub)
  if (!profile) {
    return {
      type: 'text',
      value: `Unknown provider profile: ${sub}\nUsage: /provider profile list | <id> | rm <id> | off`,
    }
  }
  activateProviderProfile(profile.id)
  applyConfigEnvironmentVariables()
  const model = applyProfileModel(profile, context)
  return {
    type: 'text',
    value: model
      ? `Activated provider profile "${profile.name}" (${profile.modelType}) — model set to ${model}.`
      : `Activated provider profile "${profile.name}" (${profile.modelType}).`,
  }
}

function matchProfile(needle: string): ProviderProfile | undefined {
  const profiles = getProviderProfiles()
  return (
    profiles.find(p => p.id === needle) ??
    profiles.find(p => p.name.toLowerCase() === needle.toLowerCase())
  )
}

export default provider
