import { describe, expect, test } from 'bun:test'
import { Terminal } from '@xterm/headless'
import type { Diff, Frame } from '../frame.js'
import { LogUpdate, viewportRepaint } from '../log-update.js'
import {
  CellWidth,
  CharPool,
  HyperlinkPool,
  StylePool,
  createScreen,
  setCellAt,
} from '../screen.js'

function serialize(diff: Diff): string {
  return diff
    .map(patch => {
      switch (patch.type) {
        case 'stdout':
          return patch.content
        case 'styleStr':
          return patch.str
        case 'carriageReturn':
          return '\r'
        case 'cursorMove':
          return (
            (patch.x > 0
              ? `\x1b[${patch.x}C`
              : patch.x < 0
                ? `\x1b[${-patch.x}D`
                : '') +
            (patch.y > 0
              ? `\x1b[${patch.y}B`
              : patch.y < 0
                ? `\x1b[${-patch.y}A`
                : '')
          )
        default:
          throw new Error(`Unexpected patch: ${patch.type}`)
      }
    })
    .join('')
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
