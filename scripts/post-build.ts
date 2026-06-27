#!/usr/bin/env bun
/**
 * Post-build processing for Vite build output.
 *
 * 1. Patch globalThis.Bun destructuring in third-party deps for Node.js compat
 * 2. Copy native addon files
 * 3. Generate dual entry points (cli-bun.js, cli-node.js)
 */
import { readdir, readFile, writeFile, cp } from 'node:fs/promises'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'

const outdir = 'dist'

async function postBuild() {
  // Step 1: Patch globalThis.Bun destructuring in ALL output files
  const BUN_DESTRUCTURE = /var \{([^}]+)\} = globalThis\.Bun;?/g
  const BUN_DESTRUCTURE_SAFE =
    'var {$1} = typeof globalThis.Bun !== "undefined" ? globalThis.Bun : {};'

  let bunPatched = 0
  const files = await readdir(outdir)
  const jsFiles = files.filter(f => f.endsWith('.js'))

  for (const file of jsFiles) {
    const filePath = join(outdir, file)
    const content = await readFile(filePath, 'utf-8')
    BUN_DESTRUCTURE.lastIndex = 0
    if (BUN_DESTRUCTURE.test(content)) {
      await writeFile(
        filePath,
        content.replace(BUN_DESTRUCTURE, BUN_DESTRUCTURE_SAFE),
      )
      bunPatched++
    }
  }

  // Also patch chunk files in dist/chunks/
  const chunksDir = join(outdir, 'chunks')
  let chunkFiles: string[] = []
  try {
    chunkFiles = (await readdir(chunksDir)).filter(f => f.endsWith('.js'))
  } catch {
    // No chunks directory — single-file build fallback
  }

  for (const file of chunkFiles) {
    const filePath = join(chunksDir, file)
    const content = await readFile(filePath, 'utf-8')
    BUN_DESTRUCTURE.lastIndex = 0
    if (BUN_DESTRUCTURE.test(content)) {
      await writeFile(
        filePath,
        content.replace(BUN_DESTRUCTURE, BUN_DESTRUCTURE_SAFE),
      )
      bunPatched++
    }
  }

  // Step 1.5: Patch missing nodeImports in Rolldown output (Vite 8 / Rolldown
  // doesn't define nodeImports for Node.js streams shim — define it globally).
  const NODE_IMPORTS_RE = /Object\.assign\(nodeImports,{/
  let nodeImportsPatched = 0
  for (const file of jsFiles) {
    const filePath = join(outdir, file)
    const content = await readFile(filePath, 'utf-8')
    if (NODE_IMPORTS_RE.test(content)) {
      await writeFile(
        filePath,
        content.replace(
          NODE_IMPORTS_RE,
          '(globalThis.nodeImports??={}),Object.assign(globalThis.nodeImports,{',
        ),
      )
      nodeImportsPatched++
    }
  }
  for (const file of chunkFiles) {
    const filePath = join(chunksDir, file)
    const content = await readFile(filePath, 'utf-8')
    if (NODE_IMPORTS_RE.test(content)) {
      await writeFile(
        filePath,
        content.replace(
          NODE_IMPORTS_RE,
          '(globalThis.nodeImports??={}),Object.assign(globalThis.nodeImports,{',
        ),
      )
      nodeImportsPatched++
    }
  }

  // Step 1.6: Fix Object.assign(globalThis.nodeImports,{on:on$2,finished:finished$3})
  // On Node.js 18, 'on' is not exported from 'node:stream' (added in Node 20).
  // Use 'cn' from the existing node:events import (imported as `on as cn`).
  // Also add a named import for 'finished' since it's not otherwise imported.
  // Use regex patterns since the minifier renames variables across builds.
  let nodeImportsFixPatched = 0
  for (const file of chunkFiles) {
    const filePath = join(chunksDir, file)
    let content = await readFile(filePath, 'utf-8')
    let orig = content

    // 1. Import finished from node:stream with a unique alias
    // Negative lookahead prevents double-adding on re-run
    const fnAlias = 'zzzFn'
    content = content.replace(
      /import\{text as [\w$]+\}from"node:stream\/consumers";(?!\s*import\{finished as [\w$]+\}from"node:stream")/,
      match => match + `import{finished as ${fnAlias}}from"node:stream";`,
    )

    // 2. Fix Object.assign to use cn (events.on) + the alias
    content = content.replace(
      /Object\.assign\(globalThis\.nodeImports,\{on:[\w$]+,finished:[\w$]+\}\)/,
      `Object.assign(globalThis.nodeImports,{on:cn,finished:${fnAlias}})`,
    )

    if (content !== orig) {
      await writeFile(filePath, content)
      nodeImportsFixPatched++
    }
  }

  // Step 2: Generate dual entry points
  const cliBun = join(outdir, 'cli-bun.js')
  const cliNode = join(outdir, 'cli-node.js')

  await writeFile(cliBun, '#!/usr/bin/env bun\nimport "./cli.js"\n')
  await writeFile(cliNode, '#!/usr/bin/env node\nimport "./cli.js"\n')

  chmodSync(cliBun, 0o755)
  chmodSync(cliNode, 0o755)

  // Step 2.5: Generate package.json for ESM declaration (Node.js needs "type": "module")
  const pkgJson = join(outdir, 'package.json')
  await writeFile(pkgJson, '{\n  "type": "module",\n  "private": true\n}\n')

  // Step 3: Generate Windows batch entry
  const claudeBat = join(outdir, 'claude.bat')
  await writeFile(
    claudeBat,
    `@echo off\r\n` +
      `setlocal\r\n` +
      `\r\n` +
      `set "TERM=xterm-256color"\r\n` +
      `set "NODE_SKIP_PLATFORM_CHECK=1"\r\n` +
      `set "NODE_PATH=%~dp0..\\node-v18.20.8-win-x64"\r\n` +
      `\r\n` +
      `if exist "%NODE_PATH%\\node.exe" (\r\n` +
      `  "%NODE_PATH%\\node.exe" "%~dp0cli.js" %*\r\n` +
      `) else (\r\n` +
      `  echo Error: Node.js runtime not found at %NODE_PATH%\r\n` +
      `  echo Place Node.js 18.20.8 portable in %~dp0..\\node-v18.20.8-win-x64\\ \r\n` +
      `  pause\r\n` +
      `  exit /b 1\r\n` +
      `)\r\n`,
  )

  // Step 4: Copy native addon files (best-effort)
  try {
    const audioCaptureDir = join(outdir, 'vendor', 'audio-capture')
    await cp('vendor/audio-capture', audioCaptureDir, {
      recursive: true,
    } as never)
    console.log(`Copied vendor/audio-capture/ → ${audioCaptureDir}/`)
  } catch (e) {
    console.warn(`Warning: failed to copy vendor/audio-capture: ${e}`)
  }

  try {
    const ripgrepDir = join(outdir, 'vendor', 'ripgrep')
    await cp('src/utils/vendor/ripgrep', ripgrepDir, {
      recursive: true,
    } as never)
    console.log(`Copied src/utils/vendor/ripgrep/ → ${ripgrepDir}/`)
  } catch (e) {
    console.warn(`Warning: failed to copy vendor/ripgrep: ${e}`)
  }

  // Step 1.7: Verify stream.on fix — cn and zzzFn must exist if nodeImports was patched
  let verifyFail = 0
  const allFiles = [
    ...jsFiles.map(f => join(outdir, f)),
    ...chunkFiles.map(f => join(chunksDir, f)),
  ]
  for (const filePath of allFiles) {
    const content = await readFile(filePath, 'utf-8')
    if (content.includes('globalThis.nodeImports')) {
      if (!content.includes(',finished:zzzFn})')) {
        console.error(`FAIL: stream.on fix missing cn/zzzFn in ${filePath}`)
        verifyFail++
      }
    }
  }
  if (verifyFail > 0) {
    console.error(
      `VERIFY FAILED: ${verifyFail} files missing cn/zzzFn after patch`,
    )
    process.exit(1)
  }

  console.log(
    `Post-build complete: patched ${bunPatched} Bun destructure, ${nodeImportsPatched} nodeImports, ${nodeImportsFixPatched} nodeImports fix, generated entry points, wrote claude.bat`,
  )
}

postBuild().catch(err => {
  console.error('Post-build failed:', err)
  process.exit(1)
})
