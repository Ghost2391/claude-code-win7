/**
 * DEC (Digital Equipment Corporation) Private Mode Sequences
 *
 * DEC private modes use CSI ? N h (set) and CSI ? N l (reset) format.
 * These are terminal-specific extensions to the ANSI standard.
 */

import { csi } from './csi.js'

/**
 * Check if the terminal is known to support optional DEC private modes
 * (mouse tracking, focus events, bracketed paste, synchronized output).
 * On basic terminals these sequences leak as garbled text.
 *
 * Essential DEC modes (cursor visibility, alt screen) are always emitted —
 * they are required for basic TUI rendering and are supported by all
 * ANSI-compatible terminals (including IDEA/JediTerm, Cmder, etc.).
 */
function terminalSupportsOptionalDecModes(): boolean {
  if (!process.stdout.isTTY) return false
  if (process.env.TERM === 'dumb') return false
  if (!process.env.TERM) return false
  if (
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.TERM_PROGRAM === 'WezTerm' ||
    process.env.TERM_PROGRAM === 'ghostty' ||
    process.env.TERM_PROGRAM === 'alacritty' ||
    process.env.TERM_PROGRAM === 'kitty' ||
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.TERM_PROGRAM === 'ConEmu' ||
    process.env.TERM?.includes('kitty') ||
    process.env.TERM?.includes('alacritty') ||
    process.env.TERM === 'xterm-ghostty' ||
    process.env.WT_SESSION ||
    process.env.ZED_TERM ||
    process.env.TMUX
  ) return true
  const vteVersion = process.env.VTE_VERSION
  if (vteVersion && parseInt(vteVersion, 10) >= 6800) return true
  return false
}

const SUPPORTS_OPTIONAL_DEC = terminalSupportsOptionalDecModes()

/**
 * DEC private mode numbers
 */
export const DEC = {
  CURSOR_VISIBLE: 25,
  ALT_SCREEN: 47,
  ALT_SCREEN_CLEAR: 1049,
  MOUSE_NORMAL: 1000,
  MOUSE_BUTTON: 1002,
  MOUSE_ANY: 1003,
  MOUSE_SGR: 1006,
  FOCUS_EVENTS: 1004,
  BRACKETED_PASTE: 2004,
  SYNCHRONIZED_UPDATE: 2026,
} as const

/** Generate CSI ? N h sequence (set mode) */
export function decset(mode: number): string {
  return csi(`?${mode}h`)
}

/** Generate CSI ? N l sequence (reset mode) */
export function decreset(mode: number): string {
  return csi(`?${mode}l`)
}

// Essential sequences — always emitted (required for basic TUI rendering)
export const SHOW_CURSOR = decset(DEC.CURSOR_VISIBLE)
export const HIDE_CURSOR = decreset(DEC.CURSOR_VISIBLE)
export const ENTER_ALT_SCREEN = decset(DEC.ALT_SCREEN_CLEAR)
export const EXIT_ALT_SCREEN = decreset(DEC.ALT_SCREEN_CLEAR)

// Optional sequences — only on terminals known to support them
export const BSU = SUPPORTS_OPTIONAL_DEC ? decset(DEC.SYNCHRONIZED_UPDATE) : ''
export const ESU = SUPPORTS_OPTIONAL_DEC ? decreset(DEC.SYNCHRONIZED_UPDATE) : ''
export const EBP = SUPPORTS_OPTIONAL_DEC ? decset(DEC.BRACKETED_PASTE) : ''
export const DBP = SUPPORTS_OPTIONAL_DEC ? decreset(DEC.BRACKETED_PASTE) : ''
export const EFE = SUPPORTS_OPTIONAL_DEC ? decset(DEC.FOCUS_EVENTS) : ''
export const DFE = SUPPORTS_OPTIONAL_DEC ? decreset(DEC.FOCUS_EVENTS) : ''
export const ENABLE_MOUSE_TRACKING = SUPPORTS_OPTIONAL_DEC
  ? decset(DEC.MOUSE_NORMAL) +
    decset(DEC.MOUSE_BUTTON) +
    decset(DEC.MOUSE_ANY) +
    decset(DEC.MOUSE_SGR)
  : ''
export const DISABLE_MOUSE_TRACKING = SUPPORTS_OPTIONAL_DEC
  ? decreset(DEC.MOUSE_SGR) +
    decreset(DEC.MOUSE_ANY) +
    decreset(DEC.MOUSE_BUTTON) +
    decreset(DEC.MOUSE_NORMAL)
  : ''
