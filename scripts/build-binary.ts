#!/usr/bin/env bun
/**
 * Cross-compile a standalone native executable (single-file, like the
 * official Claude Code binary — a Bun --compile artifact embedding all JS).
 *
 * Uses the Bun bundler directly on src/entrypoints/cli.tsx (NOT the Vite
 * pipeline — Vite emits 650+ runtime chunks that a compiled binary can't
 * follow), so every dynamic import is inlined into one executable.
 *
 * Default target is Linux x64 (run on any machine — no Node/Bun needed).
 * Pass --target=<bun-linux-x64|bun-windows-x64|bun-darwin-x64|bun|node>
 * to cross-compile for another platform.
 *
 * Output: dist/claude             (Linux/macOS ELF/Mach-O)
 *         dist/claude.exe         (Windows PE)
 *
 * Usage:  bun run build:binary            # Linux x64
 *         bun run build:binary -- --target=bun-windows-x64
 */

import { cp, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getMacroDefines, DEFAULT_BUILD_FEATURES } from './defines.ts'
import { generateEmbeddedWebAssets } from './embedWebAssets.ts'

const root = resolve(import.meta.dir, '..')
const outdir = join(root, 'dist')

const arg =
  process.argv.find(a => a.startsWith('--target=')) ?? '--target=bun-linux-x64'
const target = arg.split('=')[1]

const binName = /^bun-(windows|win)/i.test(target) ? 'claude.exe' : 'claude'
const binPath = join(outdir, binName)

// Embed the static web assets into the binary so --web mode works even when
// web/public is not deployed next to the executable.
await generateEmbeddedWebAssets(root)

// NOTE: Bun's public `Target` type only lists "bun" | "node" | "browser",
// but the runtime also accepts cross-compile targets (e.g. "bun-linux-x64",
// "bun-windows-x64", "bun-darwin-x64", "bun-linux-x64-musl"). Cast through
// the accepted union so tsc stays green while the runtime gets the raw value.
const buildTarget = target as Parameters<typeof Bun.build>[0]['target']

// Collect FEATURE_* env vars → build features (same as build.ts)
const envFeatures = Object.keys(process.env)
  .filter(k => k.startsWith('FEATURE_'))
  .map(k => k.replace('FEATURE_', ''))
const features = [...new Set([...DEFAULT_BUILD_FEATURES, ...envFeatures])]

console.log(
  `[build:binary] Compiling ${binName} (target=${target}, features: ${features.length}) …`,
)

const result = await Bun.build({
  entrypoints: [join(root, 'src/entrypoints/cli.tsx')],
  outdir,
  target: buildTarget,
  // Standalone executable — everything inlined, no splitting.
  splitting: false,
  sourcemap: 'none',
  minify: true,
  define: {
    ...getMacroDefines(),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  features,
  compile: true,
})

if (!result.success) {
  console.error('[build:binary] Failed:')
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// Bun.compile emits one standalone executable. In compile mode the `naming`
// option is ignored — the output basename follows the entrypoint ("cli").
// Rename it to the intended binary name.
const produced =
  result.outputs.find(o => o.path.includes('cli')) ?? result.outputs[0]
if (!produced) {
  console.error('[build:binary] No output binary produced.')
  process.exit(1)
}
if (produced.path !== binPath) {
  await rm(binPath, { force: true })
  await cp(produced.path, binPath)
  await rm(produced.path, { force: true })
}
await rm(join(outdir, 'binary-build'), { recursive: true, force: true })

console.log(`[build:binary] Done → ${binPath}`)

// Copy the static web assets and vendor dirs beside the binary so
// --web mode, audio-capture and embedded ripgrep can find them at runtime.
await mkdir(join(outdir, 'vendor'), { recursive: true })
await cp(
  join(root, 'vendor', 'audio-capture'),
  join(outdir, 'vendor', 'audio-capture'),
  { recursive: true },
).catch(() => {})
await cp(
  join(root, 'src', 'utils', 'vendor', 'ripgrep'),
  join(outdir, 'vendor', 'ripgrep'),
  { recursive: true },
).catch(() => {})
await cp(
  join(root, 'src', 'entrypoints', 'web', 'public'),
  join(outdir, 'web', 'public'),
  { recursive: true },
).catch(() => {})

console.log('[build:binary] Copied vendor/ + web/ assets next to binary.')
