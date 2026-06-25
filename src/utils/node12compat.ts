/**
 * Node 12.22.12 compatibility polyfills for Windows 7 support.
 *
 * Provides shims for APIs missing in Node 12:
 * - fs.rmSync / fs.rm (Node 14.14+)
 * - crypto.randomUUID (Node 14.17+)
 * - structuredClone (Node 17+)
 * - Bun-specific APIs (Bun.spawn, Bun.serve, Bun.hash, Bun.gc)
 * - execa compatibility layer
 */

import { rmdirSync, existsSync, lstatSync, readdirSync, unlinkSync, statSync } from 'fs'
import { spawn, spawnSync } from 'child_process'
import * as path from 'path'

// Use require() for crypto to allow mutation of the module object
const crypto = require('crypto') as typeof import('crypto')

// =============================================================================
// fs.rmSync / fs.rm polyfill (Node 14.14+)
// =============================================================================

function rmSyncRecursive(targetPath: string): void {
  if (!existsSync(targetPath)) return
  const stat = lstatSync(targetPath)
  if (stat.isDirectory()) {
    const entries = readdirSync(targetPath)
    for (const entry of entries) {
      rmSyncRecursive(path.join(targetPath, entry))
    }
    rmdirSync(targetPath)
  } else {
    unlinkSync(targetPath)
  }
}

const fsModule = require('fs') as any
if (typeof fsModule.rmSync !== 'function') {
  fsModule.rmSync = rmSyncRecursive
}
if (typeof fsModule.rm !== 'function') {
  fsModule.rm = function rmPolyfill(
    p: string,
    options?: { recursive?: boolean; force?: boolean },
    callback?: (error: Error | null) => void,
  ) {
    try {
      if (options?.recursive) {
        rmSyncRecursive(p)
      } else {
        unlinkSync(p)
      }
      if (callback) callback(null)
    } catch (err) {
      if (callback) callback(err as Error)
    }
  }
}

// =============================================================================
// crypto.randomUUID polyfill (Node 14.17+)
// =============================================================================

if (typeof (crypto as any).randomUUID !== 'function') {
  ;(crypto as any).randomUUID = function (): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (crypto.randomBytes(1)[0] & 0x0f) | (c === 'x' ? 0 : 0x40)
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}

// =============================================================================
// structuredClone polyfill (Node 17+)
// =============================================================================

if (typeof (globalThis as any).structuredClone !== 'function') {
  ;(globalThis as any).structuredClone = function structuredClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
  }
}

// =============================================================================
// Bun API stubs
// =============================================================================

if (typeof (globalThis as any).Bun === 'undefined') {
  ;(globalThis as any).Bun = {
    spawn(command: string[], options?: any): any {
      const proc = spawn(command[0]!, command.slice(1), {
        stdio: options?.stdout === 'pipe' || options?.stderr === 'pipe' ? 'pipe' : 'inherit',
        windowsHide: true,
        ...options,
      })
      return {
        stdout: proc.stdout,
        stderr: proc.stderr,
        exited: new Promise<number>((resolve) => {
          proc.on('close', (code: number | null) => resolve(code ?? 1))
          proc.on('error', () => resolve(1))
        }),
        kill(signal?: string) {
          proc.kill(signal as any)
        },
      }
    },
    spawnSync(command: string[], options?: any): any {
      const result = spawnSync(command[0]!, command.slice(1), {
        encoding: 'utf-8',
        windowsHide: true,
        ...options,
      })
      return {
        stdout: result.stdout?.toString() ?? '',
        stderr: result.stderr?.toString() ?? '',
        exitCode: result.status ?? 1,
        success: result.status === 0,
      }
    },
    serve(options: any): any {
      const http = require('http')
      const handler = options.fetch || options.port
      const server = http.createServer(typeof handler === 'function' ? handler : undefined)
      server.listen(options.port ?? 0, options.hostname ?? '0.0.0.0')
      return { stop() { server.close() }, reload() {}, port: options.port ?? 0 }
    },
    hash(data: any): number {
      const h = crypto.createHash('sha256').update(String(data)).digest()
      return h.readInt32BE(0)
    },
    gc(_force?: boolean): void {
      if (typeof (globalThis as any).gc === 'function') {
        ;(globalThis as any).gc()
      }
    },
    file(filePath: string): any {
      return {
        arrayBuffer() { return require('fs').readFileSync(filePath).buffer },
        text() { return require('fs').readFileSync(filePath, 'utf-8') },
        size: (() => { try { return statSync(filePath).size } catch { return 0 } })(),
      }
    },
    embeddedFiles: [] as any[],
  }
}

export {}
