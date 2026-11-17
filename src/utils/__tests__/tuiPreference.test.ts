import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getStartupTuiPreference } from '../tuiPreference.js'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const directories: string[] = []
afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('getStartupTuiPreference', () => {
  test('loads saved preference without changing the active mode mid-session', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tui-preference-'))
    directories.push(directory)
    process.env.CLAUDE_CONFIG_DIR = directory
    writeFileSync(join(directory, '.tui-mode'), 'enabled')
    expect(getStartupTuiPreference()).toBe(true)
    rmSync(join(directory, '.tui-mode'))
    expect(getStartupTuiPreference()).toBe(true)
  })
  test('does not enter alternate screen in response to a mid-session marker write', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tui-preference-'))
    directories.push(directory)
    process.env.CLAUDE_CONFIG_DIR = directory
    expect(getStartupTuiPreference()).toBe(false)
    writeFileSync(join(directory, '.tui-mode'), 'enabled')
    expect(getStartupTuiPreference()).toBe(false)
  })
})
