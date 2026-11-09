/**
 * Post-write auto-formatting.
 *
 * After a successful FileWrite/FileEdit, run the project's formatter on the
 * written file so the agent's output matches repo style without a follow-up
 * edit turn. Opt-in: nothing runs unless `settings.autoFormat` is true or
 * CLAUDE_CODE_AUTO_FORMAT=1 is set, because spawning an external binary on
 * every write is a visible side effect the user should choose.
 *
 * Design constraints:
 * - Never throws. A missing binary, non-zero exit, or timeout is silent —
 *   the file was already written correctly, formatting is cosmetic.
 * - Bounded: one formatter per file, 5s timeout, project root lookup capped.
 * - Only runs for extensions with a known formatter + a matching project
 *   config file, so an unrelated repo pays nothing.
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { dirname, extname, join } from 'path'
import { getCwd } from './cwd.js'
import { isEnvTruthy } from './envUtils.js'
import { pathExists } from './file.js'
import { readFileSyncWithMetadata } from './fileRead.js'
import { getInitialSettings } from './settings/settings.js'
import { whichSync } from './which.js'

/** Formatter binaries, in preference order per extension. */
const FORMATTERS: Record<string, string[]> = {
  '.ts': ['biome', 'prettier'],
  '.tsx': ['biome', 'prettier'],
  '.js': ['biome', 'prettier'],
  '.jsx': ['biome', 'prettier'],
  '.mjs': ['biome', 'prettier'],
  '.cjs': ['biome', 'prettier'],
  '.json': ['biome', 'prettier'],
  '.css': ['biome', 'prettier'],
  '.scss': ['prettier'],
  '.less': ['prettier'],
  '.html': ['prettier'],
  '.md': ['prettier'],
  '.yaml': ['prettier'],
  '.yml': ['prettier'],
  '.go': ['gofmt'],
  '.rs': ['rustfmt'],
  '.py': ['ruff'],
  '.java': ['google-java-format'],
}

/** Config file that proves the project actually uses that formatter. */
const CONFIG_FILES: Record<string, string[]> = {
  biome: ['biome.json', 'biome.jsonc'],
  prettier: [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    'prettier.config.js',
    'prettier.config.cjs',
    'prettier.config.mjs',
  ],
  gofmt: ['go.mod'],
  rustfmt: ['rustfmt.toml', '.rustfmt.toml', 'Cargo.toml'],
  ruff: ['pyproject.toml', 'ruff.toml', '.ruff.toml'],
  'google-java-format': ['pom.xml', 'build.gradle', 'build.gradle.kts'],
}

const FORMAT_TIMEOUT_MS = 5_000
const MAX_ROOT_SEARCH_DEPTH = 12

/**
 * True when the user opted into auto-formatting, via settings.json
 * (`autoFormat: true`) or the CLAUDE_CODE_AUTO_FORMAT env var.
 */
export function isAutoFormatEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_AUTO_FORMAT)) return true
  const settings = getInitialSettings()
  return settings.autoFormat === true
}

/**
 * Walk up from `filePath` looking for a formatter config file. Returns the
 * directory containing it, or null when the project has no formatter config.
 * Capped at MAX_ROOT_SEARCH_DEPTH so a stray file deep in a monorepo doesn't
 * scan the whole tree.
 */
async function findFormatterRoot(
  filePath: string,
  formatter: string,
): Promise<string | null> {
  const configs = CONFIG_FILES[formatter]
  if (!configs) return null

  let dir = dirname(filePath)
  for (let depth = 0; depth < MAX_ROOT_SEARCH_DEPTH; depth++) {
    for (const config of configs) {
      if (await pathExists(join(dir, config))) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Resolve the executable to spawn: the project's own node_modules/.bin wins
 * (that's where a repo-installed formatter lives), then PATH. On Windows the
 * lookup must try PATHEXT because npm-installed formatters are `.cmd` shims,
 * which CreateProcess cannot launch directly — the caller adapts for those.
 */
function resolveExecutable(command: string, projectRoot: string): string {
  const isWin = process.platform === 'win32'
  const suffixes = isWin
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)
        .map(e => (e.startsWith('.') ? e : `.${e}`))
    : ['']

  for (const suffix of suffixes) {
    const local = join(
      projectRoot,
      'node_modules',
      '.bin',
      `${command}${suffix}`,
    )
    if (existsSync(local)) return local
  }
  if (isWin) {
    for (const suffix of suffixes) {
      const resolved = whichSync(`${command}${suffix}`)
      if (resolved) return resolved
    }
    return command
  }
  return command
}

/** Wrap an argv element in quotes for a cmd.exe command line. */
function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`
}

function runFormatter(
  command: string,
  args: string[],
  cwd: string,
): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const exe = resolveExecutable(command, cwd)
      // .cmd/.bat shims need cmd.exe, but each argument is quoted so a
      // filename containing & | ^ cannot split into a second command.
      const child =
        process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)
          ? spawn(
              process.env.ComSpec ?? 'cmd.exe',
              [
                '/d',
                '/s',
                '/c',
                `"${[exe, ...args].map(quoteForCmd).join(' ')}"`,
              ],
              { cwd, stdio: 'ignore', windowsVerbatimArguments: true },
            )
          : spawn(exe, args, { cwd, stdio: 'ignore' })
      let settled = false
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      child.on('error', () => finish(false))
      child.on('close', code => finish(code === 0))
      setTimeout(() => {
        try {
          child.kill()
        } catch {
          // Already exited.
        }
        finish(false)
      }, FORMAT_TIMEOUT_MS).unref()
    } catch {
      resolve(false)
    }
  })
}

/**
 * Format `filePath` with the project's formatter, if configured.
 *
 * Returns `formatted: true` plus the on-disk `content` when a formatter ran
 * and rewrote the file; `content` is undefined when the file could not be
 * read back (deleted/moved by the formatter), so callers must treat it as
 * "unknown, keep the pre-format content". Never rejects and never throws.
 */
export async function formatFileAfterWrite(
  filePath: string,
): Promise<{ formatted: boolean; content?: string }> {
  if (!isAutoFormatEnabled()) return { formatted: false }

  const candidates = FORMATTERS[extname(filePath).toLowerCase()]
  if (!candidates) return { formatted: false, content: undefined }

  for (const formatter of candidates) {
    const root = await findFormatterRoot(filePath, formatter)
    if (!root) continue

    const args =
      formatter === 'gofmt'
        ? ['-w', filePath]
        : formatter === 'rustfmt'
          ? [filePath]
          : formatter === 'biome'
            ? ['format', '--write', filePath]
            : formatter === 'ruff'
              ? ['format', filePath]
              : [filePath, '--write']

    const ok = await runFormatter(formatter, args, root || getCwd())
    if (!ok) continue

    // The formatter rewrote the file. Hand back the on-disk content so the
    // caller can refresh readFileState; a formatter that deleted or moved
    // the file must not crash the write that already succeeded.
    return { formatted: true, content: readFormattedContent(filePath) }
  }

  return { formatted: false, content: undefined }
}

/**
 * Read back a file a formatter rewrote. Returns undefined when the file is
 * gone or unreadable — the caller falls back to the pre-format content.
 */
function readFormattedContent(filePath: string): string | undefined {
  try {
    return readFileSyncWithMetadata(filePath)?.content
  } catch {
    return undefined
  }
}
