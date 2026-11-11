function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  const lower = model.trim().toLowerCase()
  if (lower === 'haiku') return 'haiku'
  if (lower === 'opus') return 'opus'
  if (lower === 'sonnet') return 'sonnet'
  return null
}

/**
 * Resolve the OpenAI model name for a given model string.
 *
 * Concrete model names (including custom Claude/Gemini/DeepSeek IDs on an
 * OpenAI-compatible gateway such as `claude-sonnet-5-5-medium` or
 * `claude-opus-4-6`) are passed through as-is after stripping client-only
 * context-window tags (`[1m]`, `[200k]`, etc.). Family env vars only resolve
 * bare aliases (`sonnet` / `opus` / `haiku`).
 *
 * Priority:
 * 1. OPENAI_MODEL env var (global override)
 * 2. Bare family alias -> OPENAI_DEFAULT_{FAMILY}_MODEL / ANTHROPIC_DEFAULT_{FAMILY}_MODEL
 * 3. Pass through original model name
 */
export function resolveOpenAIModel(anthropicModel: string): string {
  if (process.env.OPENAI_MODEL) {
    return process.env.OPENAI_MODEL
  }

  const cleanModel = anthropicModel.replace(/\[(\d+(?:\.\d+)?[kmKM])\]$/, '')

  const family = getModelFamily(cleanModel)
  if (family) {
    const openaiEnvVar = `OPENAI_DEFAULT_${family.toUpperCase()}_MODEL`
    const openaiOverride = process.env[openaiEnvVar]
    if (openaiOverride) return openaiOverride

    const anthropicEnvVar = `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`
    const anthropicOverride = process.env[anthropicEnvVar]
    if (anthropicOverride) return anthropicOverride
  }

  return cleanModel
}
