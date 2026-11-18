import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Terminal } from '@xterm/headless'
import { Writable } from 'node:stream'
import type { Diff, Frame } from '../frame.js'
import { LogUpdate, viewportRepaint } from '../log-update.js'
import { optimize } from '../optimizer.js'
import { writeDiffToTerminal } from '../terminal.js'
import {
  CellWidth,
  CharPool,
  HyperlinkPool,
  StylePool,
  createScreen,
  setCellAt,
} from '../screen.js'

let previousTerminalEmulator: string | undefined
beforeEach(() => {
  previousTerminalEmulator = process.env.TERMINAL_EMULATOR
  process.env.TERMINAL_EMULATOR = 'JetBrains-JediTerm'
})
afterEach(() => {
  if (previousTerminalEmulator === undefined)
    delete process.env.TERMINAL_EMULATOR
  else process.env.TERMINAL_EMULATOR = previousTerminalEmulator
})

function serialize(diff: Diff): string {
  let output = ''
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString()
      callback()
    },
  })
  writeDiffToTerminal({ stdout, stderr: stdout }, optimize(diff), true)
  return output
}

function write(terminal: Terminal, diff: Diff): Promise<void> {
  return new Promise(resolve => terminal.write(serialize(diff), resolve))
}

function fixture() {
  const stylePool = new StylePool()
  const charPool = new CharPool()
  const hyperlinkPool = new HyperlinkPool()
  const makeFrame = (height: number): Frame => {
    const screen = createScreen(10, height, stylePool, charPool, hyperlinkPool)
    for (let row = 0; row < height; row++) {
      const text = String(row).padEnd(10, '-')
      for (let column = 0; column < text.length; column++) {
        setCellAt(screen, column, row, {
          char: text[column]!,
          styleId: stylePool.none,
          width: CellWidth.Narrow,
          hyperlink: undefined,
        })
      }
    }
    return {
      screen,
      viewport: { width: 10, height: 5 },
      cursor: { x: 0, y: height, visible: true },
    }
  }
  return { stylePool, makeFrame }
}

describe('terminal viewport repaint', () => {
  test('alternate-screen scroll windows leave shell history and cursor intact', async () => {
    const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    try {
      await new Promise<void>(resolve =>
        terminal.write('shell\r\nprompt> ', resolve),
      )
      const shellCursor = terminal.buffer.active.cursorX
      await new Promise<void>(resolve => terminal.write('\x1b[?1049h', resolve))
      const { stylePool, makeFrame } = fixture()
      const renderer = new LogUpdate({ isTTY: true, stylePool })
      let previous = makeFrame(0)
      for (const offset of [60, 59, 50, 30, 29, 29, 29, 40, 60]) {
        const next = makeFrame(5)
        next.viewport.height = 6
        next.cursor.y = 4
        for (let row = 0; row < 4; row++) {
          const label = String(offset + row).padEnd(10, '-')
          for (let column = 0; column < 10; column++) {
            setCellAt(next.screen, column, row, {
              char: label[column]!,
              styleId: stylePool.none,
              width: CellWidth.Narrow,
              hyperlink: undefined,
            })
          }
        }
        await write(terminal, [
          { type: 'stdout', content: '\x1b[H' },
          ...renderer.render(
            { ...previous, cursor: { x: 0, y: 0, visible: false } },
            next,
            true,
            false,
          ),
        ])
        expect(terminal.buffer.active.type).toBe('alternate')
        expect(terminal.buffer.active.baseY).toBe(0)
        expect(terminal.buffer.active.getLine(0)?.translateToString()).toBe(
          String(offset).padEnd(10, '-'),
        )
        previous = next
      }
      const beforeResize = { ...previous, viewport: { width: 11, height: 6 } }
      await write(
        terminal,
        renderer.render(beforeResize, previous, true, false),
      )
      expect(terminal.buffer.active.getLine(0)?.translateToString()).toBe(
        '60--------',
      )
      expect(terminal.buffer.active.baseY).toBe(0)
      await new Promise<void>(resolve => terminal.write('\x1b[?1049l', resolve))
      expect(terminal.buffer.active.type).toBe('normal')
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
        'shell',
      )
      expect(terminal.buffer.active.getLine(1)?.translateToString(true)).toBe(
        'prompt> ',
      )
      expect(terminal.buffer.active.cursorX).toBe(shellCursor)
    } finally {
      terminal.dispose()
    }
  })

  test('shrinking and growing does not duplicate rows in terminal history', async () => {
    const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    try {
      const { stylePool, makeFrame } = fixture()
      const renderer = new LogUpdate({ isTTY: true, stylePool })
      let previous = makeFrame(0)
      for (const height of [8, 6, 8, 6, 8]) {
        const next = makeFrame(height)
        await write(terminal, renderer.render(previous, next))
        previous = next
      }
      const lines = Array.from(
        { length: terminal.buffer.active.length },
        (_, row) =>
          terminal.buffer.active.getLine(row)?.translateToString(true),
      )
      expect(lines.filter(line => line === '3---------')).toHaveLength(1)
    } finally {
      terminal.dispose()
    }
  })

  test('repaint compensates for emoji absent from older terminal width tables', async () => {
    const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    try {
      const { stylePool, makeFrame } = fixture()
      const frame = makeFrame(3)
      setCellAt(frame.screen, 1, 0, {
        char: '\u{1FAE0}',
        styleId: stylePool.none,
        width: CellWidth.Wide,
        hyperlink: undefined,
      })
      setCellAt(frame.screen, 2, 0, {
        char: '',
        styleId: stylePool.none,
        width: CellWidth.SpacerTail,
        hyperlink: undefined,
      })
      setCellAt(frame.screen, 3, 0, {
        char: 'B',
        styleId: stylePool.none,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
      await write(terminal, viewportRepaint(frame, stylePool))
      expect(terminal.buffer.active.getLine(0)?.getCell(3)?.getChars()).toBe(
        'B',
      )
      expect(terminal.buffer.active.getLine(0)?.getCell(9)?.getChars()).toBe(
        '-',
      )
    } finally {
      terminal.dispose()
    }
  })

  test('alternating growth and shrink keeps every visible row aligned', async () => {
    const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    try {
      const { stylePool, makeFrame } = fixture()
      const renderer = new LogUpdate({ isTTY: true, stylePool })
      let previous = makeFrame(3)
      await write(terminal, viewportRepaint(previous, stylePool))
      for (const height of [5, 8, 7, 9, 6, 5, 4, 8, 3, 10, 8, 8]) {
        const next = makeFrame(height)
        await write(terminal, renderer.render(previous, next))
        const base = terminal.buffer.active.baseY
        const first = Math.max(0, height - 4)
        for (let row = 0; row < 5; row++) {
          expect(
            terminal.buffer.active.getLine(base + row)?.translateToString(),
          ).toBe(
            first + row < height
              ? String(first + row).padEnd(10, '-')
              : ' '.repeat(10),
          )
        }
        expect(terminal.buffer.active.cursorY).toBe(Math.min(4, height))
        previous = next
      }
    } finally {
      terminal.dispose()
    }
  })

  test('crossing the viewport boundary scrolls each row only once', async () => {
    const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    try {
      const { stylePool, makeFrame } = fixture()
      const renderer = new LogUpdate({ isTTY: true, stylePool })
      let previous = makeFrame(3)
      await write(terminal, viewportRepaint(previous, stylePool))
      for (let height = 4; height <= 7; height++) {
        const next = makeFrame(height)
        await write(terminal, renderer.render(previous, next))
        expect(terminal.buffer.active.baseY).toBe(Math.max(0, height - 4))
        previous = next
      }
      expect(terminal.buffer.active.getLine(1)?.translateToString()).toBe(
        '1---------',
      )
    } finally {
      terminal.dispose()
    }
  })

  test('offscreen updates do not append duplicate history rows', async () => {
    const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    try {
      const { stylePool, makeFrame } = fixture()
      const renderer = new LogUpdate({ isTTY: true, stylePool })
      let previous = makeFrame(8)
      await write(terminal, renderer.render(makeFrame(0), previous))
      const initialBase = terminal.buffer.active.baseY
      for (let index = 0; index < 5; index++) {
        const next = makeFrame(8)
        setCellAt(next.screen, 0, 0, {
          char: String(index + 1),
          styleId: stylePool.none,
          width: CellWidth.Narrow,
          hyperlink: undefined,
        })
        await write(terminal, renderer.render(previous, next))
        expect(terminal.buffer.active.baseY).toBe(initialBase)
        previous = next
      }
    } finally {
      terminal.dispose()
    }
  })

  test('shrinking an overflowing frame keeps the next diff aligned', async () => {
    const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    try {
      const { stylePool, makeFrame } = fixture()
      const renderer = new LogUpdate({ isTTY: true, stylePool })
      const previous = makeFrame(8)
      const next = makeFrame(7)
      await write(terminal, viewportRepaint(previous, stylePool))
      await write(terminal, renderer.render(previous, next))
      const base = terminal.buffer.active.baseY
      expect(terminal.buffer.active.getLine(base)?.translateToString()).toBe(
        '3---------',
      )
      expect(
        terminal.buffer.active.getLine(base + 3)?.translateToString(),
      ).toBe('6---------')
      const changed = makeFrame(7)
      setCellAt(changed.screen, 0, 6, {
        char: 'X',
        styleId: stylePool.none,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
      await write(terminal, renderer.render(next, changed))
      expect(
        terminal.buffer.active.getLine(base + 3)?.translateToString(),
      ).toBe('X---------')
      expect(terminal.buffer.active.cursorY).toBe(4)
    } finally {
      terminal.dispose()
    }
  })

  test('preserves full-width rows and does not grow scrollback on idle repaints', async () => {
    const terminal = new Terminal({
      cols: 10,
      rows: 5,
      scrollback: 1000,
      allowProposedApi: true,
    })
    try {
      const { stylePool, makeFrame } = fixture()
      const frame = makeFrame(8)
      const renderer = new LogUpdate({ isTTY: true, stylePool })
      await write(terminal, viewportRepaint(frame, stylePool))
      const initialBase = terminal.buffer.active.baseY
      for (let index = 0; index < 128; index++) {
        await write(terminal, renderer.render(frame, frame))
      }
      expect(terminal.buffer.active.baseY).toBe(initialBase)
      expect(
        terminal.buffer.active.getLine(initialBase)?.translateToString(),
      ).toBe('4---------')
      expect(
        terminal.buffer.active.getLine(initialBase + 3)?.translateToString(),
      ).toBe('7---------')
      expect(terminal.buffer.active.cursorY).toBe(4)
      expect(terminal.buffer.active.cursorX).toBe(0)
    } finally {
      terminal.dispose()
    }
  })

  test('self-heals continuous growth without adding extra scrollback', async () => {
    const terminal = new Terminal({
      cols: 10,
      rows: 5,
      scrollback: 1000,
      allowProposedApi: true,
    })
    try {
      const { stylePool, makeFrame } = fixture()
      const renderer = new LogUpdate({ isTTY: true, stylePool })
      let previous = makeFrame(8)
      await write(terminal, viewportRepaint(previous, stylePool))
      const initialBase = terminal.buffer.active.baseY
      let repaints = 0
      for (let height = 9; height <= 136; height++) {
        const next = makeFrame(height)
        const diff = renderer.render(previous, next)
        if (serialize(diff).includes('\x1b[1;1H')) repaints++
        await write(terminal, diff)
        const base = terminal.buffer.active.baseY
        expect(base - initialBase).toBe(height - 8)
        expect(
          terminal.buffer.active.getLine(base + 3)?.translateToString(),
        ).toBe(String(height - 1).padEnd(10, '-'))
        previous = next
      }
      expect(repaints).toBe(2)
    } finally {
      terminal.dispose()
    }
  })

  test('preserves a wide character at the right edge', async () => {
    const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    try {
      const { stylePool, makeFrame } = fixture()
      const frame = makeFrame(3)
      setCellAt(frame.screen, 8, 0, {
        char: '界',
        styleId: stylePool.none,
        width: CellWidth.Wide,
        hyperlink: undefined,
      })
      setCellAt(frame.screen, 9, 0, {
        char: '',
        styleId: stylePool.none,
        width: CellWidth.SpacerTail,
        hyperlink: undefined,
      })
      await write(terminal, viewportRepaint(frame, stylePool))
      expect(terminal.buffer.active.getLine(0)?.translateToString()).toBe(
        '0-------界',
      )
    } finally {
      terminal.dispose()
    }
  })
})
