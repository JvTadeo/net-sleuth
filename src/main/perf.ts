import { performance } from 'node:perf_hooks'

/**
 * In Node, performance.now() counts from process start.
 * When the window reports its first paint we store that time:
 * it is the roadmap's "launch until the window responds" metric (target: < 1.5 s).
 */
let startupMs: number | null = null

export function markReady(): void {
  if (startupMs !== null) return
  startupMs = Math.round(performance.now())
  console.log(`[perf] window ready in ${startupMs} ms`)
}

export function getStartupMs(): number | null {
  return startupMs
}
