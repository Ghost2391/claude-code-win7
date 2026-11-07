/**
 * Shared mock for src/services/analytics/growthbook.ts
 *
 * WHY A SHARED MOCK
 * Bun's `mock.module` is process-global and last-write-wins. A test that
 * installs a PARTIAL surface (e.g. only `getFeatureValue_CACHED_MAY_BE_STALE`)
 * breaks every later test file in the same process whose import graph touches
 * any other export of this module — the failure surfaces as
 * "Export named 'getDynamicConfig_CACHED_MAY_BE_STALE' not found in module
 * growthbook.ts" between otherwise-unrelated tests. Keeping the mock's surface
 * complete means the blast radius of install order drops to the mocked
 * *behaviors*, which is what tests actually mean to control.
 *
 * USAGE
 * ```ts
 * import { growthbookMock } from '../../../tests/mocks/growthbook'
 *
 * mock.module('src/services/analytics/growthbook.js', () => growthbookMock())
 *
 * // Override only what this file cares about:
 * mock.module('src/services/analytics/growthbook.js', () =>
 *   growthbookMock({ getFeatureValue_CACHED_MAY_BE_STALE: () => true }),
 * )
 * ```
 *
 * Exported as a factory so every call produces a fresh object (mock.module
 * requirement) and overrides never leak between files.
 */

/** All runtime exports of src/services/analytics/growthbook.ts, defaulted safe. */
export function growthbookMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    getFeatureValue_CACHED_MAY_BE_STALE: () => false,
    getFeatureValue_DEPRECATED: async () => undefined,
    getFeatureValue_CACHED_WITH_REFRESH: async () => undefined,
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE: () => false,
    checkSecurityRestrictionGate: async () => false,
    checkGate_CACHED_OR_BLOCKING: async () => false,
    getDynamicConfig_CACHED_MAY_BE_STALE: () => undefined,
    getDynamicConfig_BLOCKS_ON_INIT: async () => undefined,
    hasGrowthBookEnvOverride: () => false,
    getAllGrowthBookFeatures: () => ({}),
    getGrowthBookConfigOverrides: () => ({}),
    setGrowthBookConfigOverride: () => {},
    clearGrowthBookConfigOverrides: () => {},
    getApiBaseUrlHost: () => undefined,
    // Subscribes to refreshes and returns an unsubscribe function.
    onGrowthBookRefresh: () => () => {},
    initializeGrowthBook: async () => {},
    refreshGrowthBookAfterAuthChange: () => {},
    resetGrowthBook: () => {},
    refreshGrowthBookFeatures: async () => {},
    setupPeriodicGrowthBookRefresh: () => {},
    stopPeriodicGrowthBookRefresh: () => {},
    ...overrides,
  }
}
