import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import * as path from 'path'

/**
 * Resolve the dist root directory from the current module's location.
 *
 * Works across all build layouts:
 * - Single-file: dist/cli.js → dist/
 * - Code-split:  dist/chunks/chunk-xxx.js → dist/
 * - Dev mode:    src/utils/distRoot.ts → <project_root>/
 * - Compiled standalone binary (Bun --compile): import.meta.url points at a
 *   virtual in-memory path that doesn't exist on disk, so we fall back to the
 *   real executable directory where build scripts stage vendor/ + web/ assets.
 */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const distRoot = (() => {
  // Bun --compile embeds the JS; import.meta.url resolves to a virtual path
  // (e.g. B:\~BUN\root\... on Windows, /$bunfs/root/... elsewhere) that is
  // neither a real directory nor the deploy location. Fall back to the exe dir.
  const isVirtualPath =
    /[\\/]~BUN[\\/]|[\\/]\$bunfs[\\/]/i.test(__dirname) ||
    !existsSync(__dirname)

  if (isVirtualPath) {
    return path.dirname(process.execPath)
  }

  const parts = __dirname.split(path.sep)
  const distIdx = parts.lastIndexOf('dist')
  if (distIdx !== -1) {
    return parts.slice(0, distIdx + 1).join(path.sep)
  }
  // Dev mode: from src/utils/ → project root
  const srcIdx = parts.lastIndexOf('src')
  if (srcIdx !== -1) {
    return parts.slice(0, srcIdx).join(path.sep)
  }
  return __dirname
})()

export { distRoot }
