import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { isLegacyWindowsConsole } from '../clearTerminal.js'
import type { Diff, Frame } from '../frame.js'
import { LogUpdate, legacyWindowsViewportRepaint } from '../log-update.js'
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

  test('main-screen full reset repaints the viewport instead of clearing scrollback', () => {
    // Regression: a full reset used to emit ESC[2J/ESC[3J + home, wiping the
    // terminal scrollback and yanking the viewport to the top of the
    // repainted frame ("chat jumped back to the beginning").
    const { prev, next, stylePool } = makeScrollbackChangeFrames()
    const log = new LogUpdate({ isTTY: true, stylePool })

    // A change on row 0 — long since scrolled off the 5-row viewport.
    const diff = log.render(prev, next, false)

    expect(diff.some(patch => patch.type === 'clearTerminal')).toBe(false)
    const text = diff
      .filter(
        (patch): patch is { type: 'stdout'; content: string } =>
          patch.type === 'stdout',
      )
      .map(patch => patch.content)
      .join('')
    expect(text.includes(ERASE_SCREEN)).toBe(false)
    // Absolute repaint of the visible viewport (frame rows 15..19 → 1..5).
    expect(text).toContain(cup(1, 1))
    expect(text).toContain(cup(5, 1))
  })

  test('alt-screen full reset still clears (no scrollback to preserve)', () => {
    const { prev, next, stylePool } = makeScrollbackChangeFrames()
    const log = new LogUpdate({ isTTY: true, stylePool })

    const diff = log.render(prev, next, true)

    expect(diff.some(patch => patch.type === 'clearTerminal')).toBe(true)
  })

  /** 20-row frame, 5-row viewport, one cell changed in scrollback (row 0). */
  function makeScrollbackChangeFrames(): {
    prev: Frame
    next: Frame
    stylePool: StylePool
  } {
    const stylePool = new StylePool()
    // Shared pools: the cell diff compares packed (charIndex, style) words, so
    // the two frames must resolve characters through the same CharPool.
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const make = (char: string): Frame => {
      const screen = createScreen(10, 20, stylePool, charPool, hyperlinkPool)
      setCellAt(screen, 0, 0, {
        char,
        styleId: stylePool.none,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
      return {
        screen,
        viewport: { width: 10, height: 5 },
        cursor: { x: 0, y: 20, visible: true },
      }
    }
    return { prev: make('A'), next: make('B'), stylePool }
  }

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

describe('main-screen height change self-heal', () => {
  /**
   * Two frames sharing pools so the cell diff compares equal packed words.
   * The previous frame fills the viewport (height >= viewport height), which
   * is the state where relative cursor moves depend on exact scroll math.
   */
  function makeHeightChangeFrames(
    prevH: number,
    nextH: number,
    cursorY?: number,
  ): {
    prev: Frame
    next: Frame
    stylePool: StylePool
  } {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const make = (height: number, char: string): Frame => {
      const screen = createScreen(
        10,
        height,
        stylePool,
        charPool,
        hyperlinkPool,
      )
      // Mark the bottom row so the repaint has content to place.
      setCellAt(screen, 0, height - 1, {
        char,
        styleId: stylePool.none,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
      return {
        screen,
        viewport: { width: 10, height: 5 },
        cursor: { x: 0, y: cursorY ?? height, visible: true },
      }
    }
    return { prev: make(prevH, 'A'), next: make(nextH, 'B'), stylePool }
  }

  function stdoutOf(diff: Diff): string {
    return diff
      .filter(
        (patch): patch is { type: 'stdout'; content: string } =>
          patch.type === 'stdout',
      )
      .map(patch => patch.content)
      .join('')
  }

  test('the frame that first exceeds the viewport repaints by absolute row', () => {
    // prev exactly fits (5 rows, viewport 5) → next overflows (6 > 5).
    const { prev, next, stylePool } = makeHeightChangeFrames(5, 6)
    const text = stdoutOf(
      new LogUpdate({ isTTY: true, stylePool }).render(prev, next, false),
    )

    expect(text).toContain(cup(1, 1)) // first visible row
    expect(text).toContain(cup(5, 1)) // last visible row (viewport height)
    expect(text).toContain('B') // new bottom row content painted
    expect(text.includes(ERASE_SCREEN)).toBe(false)
  })

  test('steady growth above the viewport stays on the cheap append path', () => {
    // Both frames overflow the viewport: pure append, no viewport repaint.
    const { prev, next, stylePool } = makeHeightChangeFrames(8, 9)
    const text = stdoutOf(
      new LogUpdate({ isTTY: true, stylePool }).render(prev, next, false),
    )

    expect(text).not.toContain(cup(1, 1))
    expect(text).toContain('B')
  })

  test('crossing back into the viewport repaints by absolute row', () => {
    // cursor above the last row so the shrink->below full reset (which needs
    // cursorAtBottom) does not fire; this exercises the crossing repaint.
    const { prev, next, stylePool } = makeHeightChangeFrames(6, 4, 2)
    const text = stdoutOf(
      new LogUpdate({ isTTY: true, stylePool }).render(prev, next, false),
    )

    expect(text).toContain(cup(1, 1))
    expect(text.includes(ERASE_SCREEN)).toBe(false)
  })

  test('a frame that fits the viewport keeps the cheap incremental path', () => {
    const { prev, next, stylePool } = makeHeightChangeFrames(3, 4)
    const text = stdoutOf(
      new LogUpdate({ isTTY: true, stylePool }).render(prev, next, false),
    )

    expect(text).not.toContain(cup(1, 1))
    expect(text).toContain('B')
  })
})
