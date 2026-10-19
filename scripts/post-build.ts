#!/usr/bin/env bun
/**
 * Post-build processing for Vite build output.
 *
 * 1. Patch globalThis.Bun destructuring in third-party deps for Node.js compat
 * 2. Copy native addon files
 * 3. Generate dual entry points (cli-bun.js, cli-node.js)
 */
import { cp, writeFile } from 'node:fs/promises'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { patchNodeCompat } from './patchNodeCompat.ts'

const outdir = 'dist'

async function postBuild() {
  // Step 1: Shared Node.js compat patches (recursive — dist/ + dist/chunks/)
  const stats = await patchNodeCompat(outdir)
  console.log(
    `Patched ${stats.files} files (${stats.importMetaRequire} import.meta.require, ${stats.bunDestructure} Bun destructure)`,
  )

  // Step 2: Copy native addon files
  const audioCaptureDir = join(outdir, 'vendor', 'audio-capture')
  await cp('vendor/audio-capture', audioCaptureDir, {
    recursive: true,
  } as never)
  console.log(`Copied vendor/audio-capture/ → ${audioCaptureDir}/`)

  const ripgrepDir = join(outdir, 'vendor', 'ripgrep')
  await cp('src/utils/vendor/ripgrep', ripgrepDir, { recursive: true } as never)
  console.log(`Copied src/utils/vendor/ripgrep/ → ${ripgrepDir}/`)

  // Step 2.5: Copy Windows launcher script
  await cp('scripts/claude.cmd', join(outdir, 'claude.cmd'))
  console.log(`Copied scripts/claude.cmd → ${outdir}/claude.cmd`)

  // Step 3: Generate dual entry points
  const cliBun = join(outdir, 'cli-bun.js')
  const cliNode = join(outdir, 'cli-node.js')

  await writeFile(cliBun, '#!/usr/bin/env bun\nimport "./cli.js"\n')
  await writeFile(cliNode, '#!/usr/bin/env node\nimport "./cli.js"\n')

  chmodSync(cliBun, 0o755)
  chmodSync(cliNode, 0o755)

  console.log(
    `Post-build complete: patched ${stats.files} files, generated entry points`,
  )
}

postBuild().catch(err => {
  console.error('Post-build failed:', err)
  process.exit(1)
})
