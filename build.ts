import { mkdir, readdir, readFile, rename, writeFile, cp } from 'fs/promises'
import { join } from 'path'
import { getMacroDefines } from './scripts/defines.ts'
import { DEFAULT_BUILD_FEATURES } from './scripts/defines.ts'

const outdir = 'dist'

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

// Step 3: Post-process — replace Bun-only `import.meta.require` with Node.js compatible version
const files = await readdir(outdir)
const IMPORT_META_REQUIRE = 'var __require = import.meta.require;'
const COMPAT_REQUIRE =
  'var __require = typeof import.meta.require === "function" ? import.meta.require : (await import("module")).createRequire(import.meta.url);'

let patched = 0
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  if (content.includes(IMPORT_META_REQUIRE)) {
    await writeFile(
      filePath,
      content.replace(IMPORT_META_REQUIRE, COMPAT_REQUIRE),
    )
    patched++
  }
}

// Patch unguarded globalThis.Bun destructuring from third-party deps
let bunPatched = 0
const BUN_DESTRUCTURE = /var \{([^}]+)\} = globalThis\.Bun;?/g
const BUN_DESTRUCTURE_SAFE =
  'var {$1} = typeof globalThis.Bun !== "undefined" ? globalThis.Bun : {};'
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  if (BUN_DESTRUCTURE.test(content)) {
    await writeFile(
      filePath,
      content.replace(BUN_DESTRUCTURE, BUN_DESTRUCTURE_SAFE),
    )
    bunPatched++
  }
}
BUN_DESTRUCTURE.lastIndex = 0

// Transpile `using _ = ...` and `await using _ = ...` to `const`
// for Node.js 18 compat (ES2024 Explicit Resource Management).
let usingPatched = 0
const AWAIT_USING_DECL = /\bawait\s+using\s+(\w+)\s*=/g
const USING_DECL = /(?<!\bawait\s)\busing\s+(\w+)\s*=/g
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  USING_DECL.lastIndex = 0
  AWAIT_USING_DECL.lastIndex = 0
  const hasUsing = USING_DECL.test(content)
  USING_DECL.lastIndex = 0
  const hasAwaitUsing = AWAIT_USING_DECL.test(content)
  AWAIT_USING_DECL.lastIndex = 0
  if (hasUsing || hasAwaitUsing) {
    let patchedContent = content
    // Process await using FIRST so 'using' doesn't leave orphaned 'await'
    if (hasAwaitUsing) {
      AWAIT_USING_DECL.lastIndex = 0
      patchedContent = patchedContent.replace(AWAIT_USING_DECL, 'const $1 =')
    }
    if (hasUsing) {
      USING_DECL.lastIndex = 0
      patchedContent = patchedContent.replace(USING_DECL, 'const $1 =')
    }
    await writeFile(filePath, patchedContent)
    usingPatched++
  }
}
USING_DECL.lastIndex = 0
AWAIT_USING_DECL.lastIndex = 0

console.log(
  `Bundled ${result.outputs.length} files (patched ${patched} import.meta.require, ${bunPatched} Bun destructure, ${usingPatched} using→const)`,
)

// Step 4: Organize — move chunk files into dist/chunks/ subdirectory.
// Bun produces all chunks flat in outdir; moving them keeps the dist root
// clean: only cli.js, cli-bun.js, cli-node.js, and claude.cmd at top level.
const chunksDir = join(outdir, 'chunks')
await mkdir(chunksDir, { recursive: true })

const CHUNK_RE = /^chunk-[a-z0-9]+\.js$/
let chunksMoved = 0
const currentFiles = await readdir(outdir)
for (const file of currentFiles) {
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

// Step 9: Copy Win7 launcher script (convert LF→CRLF — cmd.exe can't parse
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
