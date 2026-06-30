import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { isLegacyWindowsConsole } from '../clearTerminal.js'
import type { Diff, Frame } from '../frame.js'
import { legacyWindowsViewportRepaint } from '../log-update.js'
import {
  CellWidth,
  CharPool,
  createScreen,
  HyperlinkPool,
  setCellAt,
  StylePool,
} from '../screen.js'

const ESC = '\x1b'
const ERASE_SCREEN = `${ESC}[2J`
const EL = `${ESC}[K`
const cup = (row: number, col: number) => `${ESC}[${row};${col}H`

describe('isLegacyWindowsConsole', () => {
  const ENV_KEYS = [
    'WT_SESSION',
    'TERM_PROGRAM',
    'TERM_PROGRAM_VERSION',
    'MSYSTEM',
  ]
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform)
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  function setPlatform(platform: string): void {
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
    })
  }

  test('true on win32 with no modern-terminal env (legacy conhost)', () => {
    setPlatform('win32')
    expect(isLegacyWindowsConsole()).toBe(true)
  })

  test('false on Windows Terminal (WT_SESSION set)', () => {
    setPlatform('win32')
    process.env.WT_SESSION = 'abc'
    expect(isLegacyWindowsConsole()).toBe(false)
  })

  test('false on mintty / Git Bash (MSYSTEM set)', () => {
    setPlatform('win32')
    process.env.MSYSTEM = 'MINGW64'
    expect(isLegacyWindowsConsole()).toBe(false)
  })

  test('false on non-Windows platforms', () => {
    setPlatform('darwin')
    expect(isLegacyWindowsConsole()).toBe(false)
    setPlatform('linux')
    expect(isLegacyWindowsConsole()).toBe(false)
  })
})

describe('legacyWindowsViewportRepaint', () => {
  function makeFrame(
    screenW: number,
    screenH: number,
    viewportW: number,
    viewportH: number,
    writes: Array<[x: number, y: number, char: string]> = [],
  ): { frame: Frame; stylePool: StylePool } {
    const stylePool = new StylePool()
    const screen = createScreen(
      screenW,
      screenH,
      stylePool,
      new CharPool(),
      new HyperlinkPool(),
    )
    for (const [x, y, char] of writes) {
      setCellAt(screen, x, y, {
        char,
        styleId: stylePool.none,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
    }
    const frame: Frame = {
      screen,
      viewport: { width: viewportW, height: viewportH },
      cursor: { x: 0, y: screenH, visible: true },
    }
    return { frame, stylePool }
  }

  function contentOf(diff: Diff): string {
    expect(diff).toHaveLength(1)
    const patch = diff[0]!
    expect(patch.type).toBe('stdout')
    return patch.type === 'stdout' ? patch.content : ''
  }

  test('frame taller than viewport: absolute repaint of bottom rows, no clear-screen', () => {
    // screen 10x8, viewport 10x5 → bottom 5 rows visible; 'A' on last row.
    const { frame, stylePool } = makeFrame(10, 8, 10, 5, [[0, 7, 'A']])
    const content = contentOf(legacyWindowsViewportRepaint(frame, stylePool))

    // The whole point: no ESC[2J (which can't clear scrollback on conhost and
    // stacks the old frame). Use absolute CSI positioning + per-line erase.
    expect(content.includes(ERASE_SCREEN)).toBe(false)
    expect(content).toContain(cup(1, 1)) // first visible physical row
    expect(content).toContain(cup(5, 1)) // last visible physical row (vh = 5)
    expect(content).toContain(EL)
    expect(content).toContain('A') // screen row 7 maps to physical row 5

    // Cursor end-state: content fills the viewport → park at bottom + one LF
    // (mirrors the normal full-reset's trailing scroll).
    expect(content.endsWith(`${cup(5, 1)}\n`)).toBe(true)
  })

  test('never emits a clearTerminal patch', () => {
    const { frame, stylePool } = makeFrame(10, 8, 10, 5)
    const diff = legacyWindowsViewportRepaint(frame, stylePool)
    expect(diff.every(patch => patch.type !== 'clearTerminal')).toBe(true)
  })

  test('frame shorter than viewport: blanks the rows below content, no scroll', () => {
    // screen 10x3, viewport 10x5 → rows 4 and 5 are below content and cleared.
    const { frame, stylePool } = makeFrame(10, 3, 10, 5)
    const content = contentOf(legacyWindowsViewportRepaint(frame, stylePool))

    expect(content.includes(ERASE_SCREEN)).toBe(false)
    expect(content).toContain(cup(4, 1)) // blank row below content, cleared
    expect(content).toContain(cup(5, 1)) // blank row below content, cleared
    expect(content).toContain(EL)

    // physBottomRow = 4 ≤ viewport height → park there, no trailing LF scroll.
    expect(content.endsWith(cup(4, 1))).toBe(true)
  })
})
