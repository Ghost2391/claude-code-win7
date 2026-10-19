/**
 * Sentry integration module (disabled)
 *
 * Remote error reporting has been removed from this fork. Every export is a
 * no-op so call sites remain unchanged, and the Sentry SDK is no longer
 * imported (which also avoids loading it at startup).
 */

export function initSentry(): void {}

export function captureException(
  _error: unknown,
  _context?: Record<string, unknown>,
): void {}

export function setTag(_key: string, _value: string): void {}

export function setUser(_user: {
  id?: string
  email?: string
  username?: string
}): void {}

export async function closeSentry(_timeoutMs = 2000): Promise<void> {}

export function isSentryInitialized(): boolean {
  return false
}
