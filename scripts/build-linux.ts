#!/usr/bin/env bun
/**
 * Linux build wrapper.
 *
 * Runs the standard `bun run build` (build.ts) which produces a
 * platform-independent JS bundle in dist/, then swaps the Windows
 * claude.cmd launcher for a POSIX `claude` shell script.
 *
 * The rest of dist/ (cli-node.js, cli-bun.js, chunks/, vendor/,
 * web/) is identical on every OS — Bun's build output has no
 * platform-specific code. ripgrep is downloaded by postinstall
 * into src/utils/vendor/ripgrep/<arch>-linux/ and copied verbatim.
 *
 * Usage:  bun run build:linux
 */

import { chmodSync, rmSync } from 'node:fs'
import { cp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dir, '..')
const outdir = join(root, 'dist')

// 1. Platform-independent bundle (same as `bun run build`).
const build = spawnSync('bun', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
if (build.status !== 0) {
  console.error(`[build:linux] 'bun run build' failed (exit ${build.status})`)
  process.exit(build.status ?? 1)
}

// 2. Replace the Windows claude.cmd with a POSIX launcher.
const winLauncher = join(outdir, 'claude.cmd')
const posixLauncher = join(outdir, 'claude')
rmSync(winLauncher, { force: true })
await cp(join(root, 'scripts', 'claude'), posixLauncher)
chmodSync(posixLauncher, 0o755)
console.log(`[build:linux] Replaced claude.cmd with ${posixLauncher}`)

// 3. Ensure dist/package.json carries bin entries so `npm link` /
//    a global install can expose the `claude` command.
await writeFile(
  join(outdir, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
)
console.log('[build:linux] dist/package.json written (type: "module")')

console.log('[build:linux] Done. Run with: ./dist/claude')
