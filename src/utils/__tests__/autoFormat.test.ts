import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatFileAfterWrite, isAutoFormatEnabled } from '../autoFormat.js'

describe('autoFormat', () => {
  const originalEnv = { ...process.env }
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'autoformat-'))
    delete process.env.CLAUDE_CODE_AUTO_FORMAT
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  describe('isAutoFormatEnabled', () => {
    test('false by default', () => {
      expect(isAutoFormatEnabled()).toBe(false)
    })

    test('true when CLAUDE_CODE_AUTO_FORMAT is set', () => {
      process.env.CLAUDE_CODE_AUTO_FORMAT = '1'
      expect(isAutoFormatEnabled()).toBe(true)
    })
  })

  describe('formatFileAfterWrite', () => {
    test('reports not formatted when auto-format is disabled', async () => {
      const file = join(tmp, 'a.ts')
      writeFileSync(file, 'const x=1')
      const result = await formatFileAfterWrite(file)
      expect(result.formatted).toBe(false)
      expect(result.content).toBeUndefined()
    })

    test('reports not formatted for extensions with no known formatter', async () => {
      process.env.CLAUDE_CODE_AUTO_FORMAT = '1'
      const file = join(tmp, 'a.rb')
      writeFileSync(file, 'def foo; end')
      const result = await formatFileAfterWrite(file)
      expect(result.formatted).toBe(false)
    })

    test('reports not formatted when the project has no formatter config', async () => {
      process.env.CLAUDE_CODE_AUTO_FORMAT = '1'
      // No biome.json / .prettierrc anywhere above tmp
      const file = join(tmp, 'a.ts')
      writeFileSync(file, 'const x=1')
      const result = await formatFileAfterWrite(file)
      expect(result.formatted).toBe(false)
    })

    test('leaves the file untouched when formatting is disabled', async () => {
      const file = join(tmp, 'a.ts')
      const original = 'const x=1\n'
      writeFileSync(file, original)
      await formatFileAfterWrite(file)
      const after = await Bun.file(file).text()
      expect(after).toBe(original)
    })

    test('returns no content when the formatter removes the file', async () => {
      process.env.CLAUDE_CODE_AUTO_FORMAT = '1'
      writeFileSync(join(tmp, 'biome.json'), '{}')
      const file = join(tmp, 'gone.ts')
      writeFileSync(file, 'const x=1')

      // A stand-in formatter that deletes the file it was asked to format.
      // Reproduces atomic-write formatters that rewrite-then-rename.
      const bin = join(tmp, 'node_modules', '.bin')
      mkdirSync(bin, { recursive: true })
      if (process.platform === 'win32') {
        writeFileSync(
          join(bin, 'biome.cmd'),
          '@echo off\r\ndel /f /q "%~3"\r\nexit /b 0\r\n',
        )
      } else {
        const shim = join(bin, 'biome')
        writeFileSync(shim, '#!/bin/sh\nrm -f "$3"\n')
        chmodSync(shim, 0o755)
      }

      const result = await formatFileAfterWrite(file)
      expect(result.formatted).toBe(true)
      expect(result.content).toBeUndefined()
      expect(existsSync(file)).toBe(false)
    })

    test('reports not formatted when the target file does not exist', async () => {
      process.env.CLAUDE_CODE_AUTO_FORMAT = '1'
      const missing = join(tmp, 'never-existed.ts')
      const result = await formatFileAfterWrite(missing)
      expect(result.formatted).toBe(false)
      expect(result.content).toBeUndefined()
    })
  })
})
