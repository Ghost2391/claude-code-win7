/**
 * Cross-platform terminal clearing with scrollback support.
 * Detects modern terminals that support ESC[3J for clearing scrollback.
 */

import {
  CURSOR_HOME,
  csi,
  ERASE_SCREEN,
  ERASE_SCROLLBACK,
} from './termio/csi.js'

// HVP (Horizontal Vertical Position) - legacy Windows cursor home
const CURSOR_HOME_WINDOWS = csi(0, 'f')

function isWindowsTerminal(): boolean {
  return process.platform === 'win32' && !!process.env.WT_SESSION
}

function isMintty(): boolean {
  // mintty 3.1.5+ sets TERM_PROGRAM to 'mintty'
  if (process.env.TERM_PROGRAM === 'mintty') {
    return true
  }
  // GitBash/MSYS2/MINGW use mintty and set MSYSTEM
  if (process.platform === 'win32' && process.env.MSYSTEM) {
    return true
  }
  return false
}

function isModernWindowsTerminal(): boolean {
  // Windows Terminal sets WT_SESSION environment variable
  if (isWindowsTerminal()) {
    return true
  }

  // VS Code integrated terminal on Windows with ConPTY support
  if (
    process.platform === 'win32' &&
    process.env.TERM_PROGRAM === 'vscode' &&
    process.env.TERM_PROGRAM_VERSION
  ) {
    return true
  }

  // mintty (GitBash/MSYS2/Cygwin) supports modern escape sequences
  if (isMintty()) {
    return true
  }

  // xterm.js (browser terminal via --web mode) is a fully capable terminal
  if (process.env.TERM_PROGRAM === 'xterm.js') {
    return true
  }

  return false
}

/**
 * True on a legacy Windows console (conhost via Node/libuv) that lacks native
 * VT: it silently drops the alt-screen switch (ESC[?1049h) and the scrollback
 * clear (ESC[3J). This is the EXACT condition under which
 * getClearTerminalSequence() falls into its legacy branch (ESC[2J only, no
 * ESC[3J) — so a full-frame repaint can't wipe the scrollback copy and old
 * frames stack. Modern Windows terminals (Windows Terminal / VS Code / mintty)
 * are excluded because they handle ESC[3J and don't stack.
 *
 * Covers Win7 (NT 6.1) and any later Windows running in a non-modern console.
 */
export function isLegacyWindowsConsole(): boolean {
  return process.platform === 'win32' && !isModernWindowsTerminal()
}

/**
 * Returns the ANSI escape sequence to clear the terminal including scrollback.
 * Automatically detects terminal capabilities.
 */
export function getClearTerminalSequence(): string {
  if (process.platform === 'win32') {
    if (isModernWindowsTerminal()) {
      return ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
    } else {
      // Legacy Windows console - can't clear scrollback
      return ERASE_SCREEN + CURSOR_HOME_WINDOWS
    }
  }
  return ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
}

/**
 * Clears the terminal screen. On supported terminals, also clears scrollback.
 */
export const clearTerminal = getClearTerminalSequence()
