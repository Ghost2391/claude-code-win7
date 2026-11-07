/**
 * Content-addressed storage helpers for file-history checkpoints.
 *
 * Each backup is stored once per unique content (sha256), instead of once per
 * (file, version). Identical contents — a file reverted and re-applied, two
 * files with the same boilerplate, a re-track with no actual change — share a
 * single blob. Names are `b<64-hex>` so old `{pathHash16}@v{n}` backups from
 * earlier sessions remain distinguishable (and restorable).
 *
 * Kept free of project imports so it can be unit-tested against real temp
 * files without the bootstrap/session-storage mock chain.
 */

import { createHash, randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { chmod, copyFile, mkdir, rename, stat, unlink } from 'fs/promises'
import { dirname } from 'path'

/** Blob file names start with 'b' + 64 hex chars (sha256). */
const BLOB_NAME_RE = /^b[0-9a-f]{64}$/

export function blobNameForContentHash(contentHash: string): string {
  return `b${contentHash}`
}

/** True for names produced by blobNameForContentHash (vs. legacy `…@v1`). */
export function isContentAddressedBlobName(name: string): boolean {
  return BLOB_NAME_RE.test(name)
}

/**
 * Hash file contents with a streaming read so large tracked files never sit in
 * the JS heap. Throws if the file is unreadable (callers stat first).
 */
export async function hashFileContent(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Copy `filePath` to `destinationPath` unless that blob already exists.
 *
 * Writes through a unique temp name and renames into place, so a concurrent
 * writer never observes a partially written blob. Returns true when this call
 * created the blob, false when it was already present (deduplicated).
 */
export async function storeBlob(
  filePath: string,
  destinationPath: string,
  mode: number,
): Promise<boolean> {
  if (await exists(destinationPath)) return false

  const tmpPath = `${destinationPath}.tmp-${randomUUID()}`
  try {
    await copyFile(filePath, tmpPath)
    await chmod(tmpPath, mode)
    try {
      await rename(tmpPath, destinationPath)
    } catch (error) {
      // Lost a race with another writer: the destination appeared first.
      // Identical content by construction, so dropping the temp copy is safe.
      if (await exists(destinationPath)) {
        await unlink(tmpPath).catch(() => {})
        return false
      }
      throw error
    }
    return true
  } catch (error) {
    await unlink(tmpPath).catch(() => {})
    throw error
  }
}

/**
 * True when the file's content hash equals `expectedHash`.
 * Size is compared first by callers to skip hashing obvious mismatches.
 */
export async function hasContentHash(
  filePath: string,
  expectedHash: string,
): Promise<boolean> {
  try {
    const actual = await hashFileContent(filePath)
    return actual === expectedHash
  } catch {
    // Unreadable/deleted mid-check: treat as different so the caller restores.
    return false
  }
}

/** Ensure the blob directory exists (called lazily before the first write). */
export async function ensureBlobDir(blobPath: string): Promise<void> {
  await mkdir(dirname(blobPath), { recursive: true })
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
