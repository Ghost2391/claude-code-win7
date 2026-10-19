/**
 * Analytics sink implementation
 *
 * Telemetry export has been removed from this fork. Both functions are kept
 * as no-ops so existing startup call sites continue to work, but no sink is
 * attached and no events leave the process.
 */

/**
 * No-op: remote feature gates are not fetched.
 */
export function initializeAnalyticsGates(): void {}

/**
 * No-op: no analytics backend is attached.
 *
 * Idempotent by construction.
 */
export function initializeAnalyticsSink(): void {}
