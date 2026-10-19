import { initializeErrorLogSink } from './errorLogSink.js'

/**
 * Attach the local error log sink. Idempotent. Called from setup() for the
 * default command; other entrypoints (subcommands, daemon, bridge) call this
 * directly since they bypass setup().
 *
 * Remote analytics/telemetry sinks are intentionally not attached.
 *
 * Leaf module — kept out of setup.ts to avoid the setup → commands → bridge
 * → setup import cycle.
 */
export function initSinks(): void {
  initializeErrorLogSink()
}
