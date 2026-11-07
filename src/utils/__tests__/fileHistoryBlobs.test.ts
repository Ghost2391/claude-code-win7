import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  blobNameForContentHash,
  ensureBlobDir,
  hasContentHash,
  hashFileContent,
  isContentAddressedBlobName,
  storeBlob,
} from '../fileHistoryBlobs.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'file-history-blobs-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('blobNameForContentHash', () => {
  test('produces a b-prefixed 64-hex name', () => {
    const hash = 'a'.repeat(64)
    expect(blobNameForContentHash(hash)).toBe(`b${hash}`)
  })
})

describe('isContentAddressedBlobName', () => {
  test('accepts blob names', () => {
    expect(
      isContentAddressedBlobName(blobNameForContentHash('f'.repeat(64))),
    ).toBe(true)
  })

  test('rejects legacy versioned names', () => {
    expect(isContentAddressedBlobName('0123456789abcdef@v1')).toBe(false)
  })

  test('rejects truncated hashes and junk', () => {
    expect(isContentAddressedBlobName('bdeadbeef')).toBe(false)
    expect(isContentAddressedBlobName('')).toBe(false)
  })
})

describe('hashFileContent', () => {
  test('hashes content deterministically', async () => {
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.txt')
    await writeFile(a, 'hello world\n')
    await writeFile(b, 'hello world\n')

    const [ha, hb] = await Promise.all([hashFileContent(a), hashFileContent(b)])
    expect(ha).toBe(hb)
    expect(ha).toMatch(/^[0-9a-f]{64}$/)
  })

  test('different content produces a different hash', async () => {
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.txt')
    await writeFile(a, 'one')
    await writeFile(b, 'two')
    expect(await hashFileContent(a)).not.toBe(await hashFileContent(b))
  })

  test('rejects on missing file', async () => {
    await expect(hashFileContent(join(dir, 'missing'))).rejects.toThrow()
  })
})

describe('storeBlob', () => {
  test('creates the blob on first store', async () => {
    const src = join(dir, 'src.txt')
    await writeFile(src, 'content')
    const blobPath = join(dir, 'blobs', 'b-abc')
    await ensureBlobDir(blobPath)

    expect(await storeBlob(src, blobPath, 0o644)).toBe(true)
    expect(await readFile(blobPath, 'utf-8')).toBe('content')
  })

  test('deduplicates identical content (second store is a no-op)', async () => {
    const src = join(dir, 'src.txt')
    await writeFile(src, 'content')
    const blobPath = join(dir, 'b-abc')
    await ensureBlobDir(blobPath)

    expect(await storeBlob(src, blobPath, 0o644)).toBe(true)
    const firstStat = await stat(blobPath)

    // Overwrite the source with different bytes; the stored blob must stay.
    await writeFile(src, 'different')
    expect(await storeBlob(src, blobPath, 0o644)).toBe(false)
    expect(await readFile(blobPath, 'utf-8')).toBe('content')

    const secondStat = await stat(blobPath)
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs)
  })

  test('propagates errors for missing source without leaving temp files', async () => {
    const blobPath = join(dir, 'blobs', 'b-abc')
    await ensureBlobDir(blobPath)
    await expect(
      storeBlob(join(dir, 'missing'), blobPath, 0o644),
    ).rejects.toThrow()
    expect(await hasContentHash(blobPath, 'anything')).toBe(false)
  })
})

describe('hasContentHash', () => {
  test('returns true for matching content', async () => {
    const file = join(dir, 'f.txt')
    await writeFile(file, 'same')
    expect(await hasContentHash(file, await hashFileContent(file))).toBe(true)
  })

  test('returns false for different content', async () => {
    const file = join(dir, 'f.txt')
    await writeFile(file, 'same')
    expect(await hasContentHash(file, '0'.repeat(64))).toBe(false)
  })

  test('returns false for unreadable file', async () => {
    expect(await hasContentHash(join(dir, 'missing'), '0'.repeat(64))).toBe(
      false,
    )
  })
})
