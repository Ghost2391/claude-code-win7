import { mkdir, readdir, readFile, rename, writeFile, cp } from 'fs/promises'
import { join, resolve } from 'path'
import { getMacroDefines } from './scripts/defines.ts'
import { DEFAULT_BUILD_FEATURES } from './scripts/defines.ts'
import { generateEmbeddedWebAssets } from './scripts/embedWebAssets.ts'
import { patchNodeCompat } from './scripts/patchNodeCompat.ts'

const outdir = 'dist'

// Step 0: Embed the static web assets so the bundled build carries them too.
await generateEmbeddedWebAssets(resolve(import.meta.dir))

// Step 1: Clean output directory
const { rmSync } = await import('fs')
rmSync(outdir, { recursive: true, force: true })

// Collect FEATURE_* env vars → Bun.build features
const envFeatures = Object.keys(process.env)
  .filter(k => k.startsWith('FEATURE_'))
  .map(k => k.replace('FEATURE_', ''))
const features = [...new Set([...DEFAULT_BUILD_FEATURES, ...envFeatures])]

// Step 2: Bundle with splitting (sourcemap disabled to keep dist clean)
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'bun',
  splitting: true,
  sourcemap: 'none',
  define: {
    ...getMacroDefines(),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  features,
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Step 3: Organize — move chunk files into dist/chunks/ subdirectory.
// Bun produces all chunks flat in outdir; moving them keeps the dist root
// clean: only cli.js, cli-bun.js, cli-node.js, and claude.cmd at top level.
const chunksDir = join(outdir, 'chunks')
await mkdir(chunksDir, { recursive: true })

const CHUNK_RE = /^chunk-[a-z0-9]+\.js$/
let chunksMoved = 0
const files = await readdir(outdir)
for (const file of files) {
  if (!CHUNK_RE.test(file)) continue
  await rename(join(outdir, file), join(chunksDir, file))
  chunksMoved++
}

// Update import paths in cli.js: ./chunk-xxx.js → ./chunks/chunk-xxx.js
const cliPath = join(outdir, 'cli.js')
let cliContent = await readFile(cliPath, 'utf-8')
const IMPORT_CHUNK_RE = /(['"])\.\/(chunk-[a-z0-9]+\.js)\1/g
cliContent = cliContent.replace(IMPORT_CHUNK_RE, '$1./chunks/$2$1')
await writeFile(cliPath, cliContent)

console.log(`Organized ${chunksMoved} chunks → ${chunksDir}/`)

// Step 4: Node.js compatibility patches (import.meta.require, globalThis.Bun).
// Runs recursively so both the entry chunks and dist/chunks are covered.
const patchStats = await patchNodeCompat(outdir)
console.log(
  `Bundled ${result.outputs.length} files (patched ${patchStats.importMetaRequire} import.meta.require, ${patchStats.bunDestructure} Bun destructure across ${patchStats.files} files)`,
)

// Step 5: Copy vendored npm dependencies (externalized by Bun build)
const npmModulesDir = join(outdir, 'node_modules')
await mkdir(npmModulesDir, { recursive: true })
const vendoredModules = ['ws', 'undici']
for (const mod of vendoredModules) {
  const src = join('node_modules', mod)
  const dest = join(npmModulesDir, mod)
  await cp(src, dest, { recursive: true })
  console.log(`Copied ${src}/ → ${dest}/`)
}

// Step 6: Copy vendor binaries
const audioCaptureDir = join(outdir, 'vendor', 'audio-capture')
await cp('vendor/audio-capture', audioCaptureDir, { recursive: true })
console.log(`Copied vendor/audio-capture/ → ${audioCaptureDir}/`)

const ripgrepDir = join(outdir, 'vendor', 'ripgrep')
await cp('src/utils/vendor/ripgrep', ripgrepDir, { recursive: true })
console.log(`Copied src/utils/vendor/ripgrep/ → ${ripgrepDir}/`)

// Step 7: Copy web static assets for --web mode
const webPublicDir = join(outdir, 'web', 'public')
await mkdir(webPublicDir, { recursive: true })
await cp('src/entrypoints/web/public', webPublicDir, { recursive: true })
console.log(`Copied src/entrypoints/web/public/ → ${webPublicDir}/`)

// Step 8: Generate dist/package.json (required for Node.js ESM resolution)
await writeFile(
  join(outdir, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
)
console.log(`Generated ${outdir}/package.json`)

// Step 9: Copy Windows launcher script (convert LF→CRLF — cmd.exe can't parse
// LF-only batch files, producing "'tlocal' is not recognized" etc.)
{
  const cmdContent = await readFile('scripts/claude.cmd', 'utf-8')
  await writeFile(
    join(outdir, 'claude.cmd'),
    cmdContent.replace(/\r?\n/g, '\r\n'),
  )
  console.log(`Copied scripts/claude.cmd → ${outdir}/claude.cmd`)
}

// Step 10: Generate entry points
const cliBun = join(outdir, 'cli-bun.js')
const cliNode = join(outdir, 'cli-node.js')

await writeFile(cliBun, '#!/usr/bin/env bun\nimport "./cli.js"\n')
await writeFile(cliNode, '#!/usr/bin/env node\nimport "./cli.js"\n')

const { chmodSync } = await import('fs')
chmodSync(cliBun, 0o755)
chmodSync(cliNode, 0o755)

console.log(`Generated ${cliBun} (shebang: bun) and ${cliNode} (shebang: node)`)
