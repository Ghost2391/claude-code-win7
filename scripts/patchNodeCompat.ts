import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Post-build patches shared by the Bun (build.ts) and Vite (post-build.ts)
 * pipelines. Walks the output tree so `dist/chunks/` is covered too — the
 * Bun build used to patch only the flat output before chunks were moved.
 */

// Bun emits `import.meta.require` both as the `__require` helper declaration
// and as direct lazy-require calls (`import.meta.require("./chunk-x.js")`).
// Only patching the helper left the direct calls untouched in code-split
// output, which crashed under Node. Replace every occurrence and inject a
// shim once per file.
const IMPORT_META_REQUIRE = 'import.meta.require'
const REQUIRE_SHIM_ID = '__ccbRequire'
const REQUIRE_SHIM =
  'import { createRequire as __ccbCreateRequire } from "node:module";\n' +
  'var __ccbRequire = __ccbCreateRequire(import.meta.url);\n'

/** Insert the shim after a shebang when present (imports must stay top-level). */
function prependShim(content: string): string {
  if (content.startsWith('#!')) {
    const newline = content.indexOf('\n')
    if (newline !== -1) {
      return (
        content.slice(0, newline + 1) +
        REQUIRE_SHIM +
        content.slice(newline + 1)
      )
    }
  }
  return REQUIRE_SHIM + content
}

const BUN_DESTRUCTURE = /var \{([^}]+)\} = globalThis\.Bun;?/g
const BUN_DESTRUCTURE_TEST = /var \{[^}]+\} = globalThis\.Bun;?/
const BUN_DESTRUCTURE_SAFE =
  'var {$1} = typeof globalThis.Bun !== "undefined" ? globalThis.Bun : {};'

export type PatchStats = {
  files: number
  importMetaRequire: number
  bunDestructure: number
}

async function collectJsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      files.push(...(await collectJsFiles(entryPath)))
    } else if (entry.name.endsWith('.js')) {
      files.push(entryPath)
    }
  }
  return files
}

export async function patchNodeCompat(rootDir: string): Promise<PatchStats> {
  const files = await collectJsFiles(rootDir)
  const stats: PatchStats = {
    files: files.length,
    importMetaRequire: 0,
    bunDestructure: 0,
  }

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf-8')
    let patched = content

    if (patched.includes(IMPORT_META_REQUIRE)) {
      patched = prependShim(
        patched.replaceAll(IMPORT_META_REQUIRE, REQUIRE_SHIM_ID),
      )
      stats.importMetaRequire++
    }

    if (BUN_DESTRUCTURE_TEST.test(patched)) {
      patched = patched.replaceAll(BUN_DESTRUCTURE, BUN_DESTRUCTURE_SAFE)
      stats.bunDestructure++
    }

    if (patched !== content) {
      await writeFile(filePath, patched)
    }
  }

  return stats
}
