import http from 'http'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

const entryDir = path.dirname(path.resolve(process.argv[1] || '.'))
const publicDir = path.join(entryDir, 'web', 'public')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

export interface WebServerOptions {
  port?: number
  host?: string
}

async function tryLoadWs(): Promise<typeof import('ws')> {
  try {
    return await import('ws')
  } catch {
    console.error(
      'Error: "ws" package is required for --web mode.\n' +
        'Install it with: bun add ws',
    )
    process.exit(1)
  }
}

export async function startWebServer(
  options: WebServerOptions = {},
): Promise<void> {
  const port = options.port ?? (Number(process.env.CLAUDE_WEB_PORT) || 3000)
  const host = options.host ?? (process.env.CLAUDE_WEB_HOST || '127.0.0.1')
  const children = new Set<import('child_process').ChildProcess>()

  const { WebSocketServer } = await tryLoadWs()

  const server = http.createServer((req, res) => {
    const safePath = req.url?.split('?')[0] ?? '/index.html'
    const filePath = path.join(
      publicDir,
      safePath === '/' ? 'index.html' : safePath,
    )

    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const ext = path.extname(filePath)
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      })
      res.end(data)
    })
  })

  const wss = new WebSocketServer({ server })
  wss.on('error', () => {})

  wss.on('connection', ws => {
    const scriptPath = path.resolve(process.argv[1]!)
    const filteredArgs = process.argv.slice(2).filter((a, i, arr) => {
      if (a === '--web') return false
      if (a === '--port') return false
      if (arr[i - 1] === '--port') return false
      return true
    })

    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_CODE_FORCE_INTERACTIVE: '1',
      FORCE_COLOR: '3',
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'xterm.js',
      COLORTERM: 'truecolor',
      COLUMNS: '120',
      LINES: '40',
    }

    const child = spawn(process.execPath, [scriptPath, ...filteredArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv as NodeJS.ProcessEnv,
      cwd: process.cwd(),
    })
    children.add(child)

    child.stdout!.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data.toString('utf-8'))
      }
    })

    child.stderr!.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data.toString('utf-8'))
      }
    })

    ws.on('message', raw => {
      const msg =
        typeof raw === 'string'
          ? raw
          : Buffer.isBuffer(raw)
            ? raw.toString('utf-8')
            : ''
      if (msg.startsWith('!resize:')) return
      if (child.stdin?.writable) {
        try {
          child.stdin.write(msg)
        } catch {}
      }
    })

    ws.on('close', () => {
      child.kill()
      children.delete(child)
    })

    child.on('exit', () => {
      children.delete(child)
      try {
        ws.close()
      } catch {}
    })

    child.on('error', () => {
      children.delete(child)
    })
  })

  process.on('SIGINT', () => {
    for (const c of children) {
      try {
        c.kill()
      } catch {}
    }
    wss.close()
    server.close()
    process.exit(0)
  })

  return new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = `http://${host}:${port}`
      console.log(`\n  ✨ Claude Code Web mode started`)
      console.log(`  ────────────────────────────────────`)
      console.log(`  🌐  Open browser at: ${addr}`)
      console.log(`  💡  Press Ctrl+C to stop\n`)
      resolve()
    })
    server.on('error', (err: Error & { code?: string }) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `Error: Port ${port} is already in use. Use --port to specify a different port.`,
        )
      } else {
        console.error('Server error:', err)
      }
      reject(err)
    })
  })
}
