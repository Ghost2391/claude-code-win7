import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

const startupPreferences = new Map<string, boolean>()

export function getStartupTuiPreference(): boolean {
  const path = join(getClaudeConfigHomeDir(), '.tui-mode')
  let enabled = startupPreferences.get(path)
  if (enabled === undefined) {
    enabled = existsSync(path)
    startupPreferences.set(path, enabled)
  }
  return enabled
}
