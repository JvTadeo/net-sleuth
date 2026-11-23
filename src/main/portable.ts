import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { argValue } from './elevation'

/**
 * Portable build support. electron-builder's portable .exe unpacks the app to a temp folder and sets
 * PORTABLE_EXECUTABLE_FILE / PORTABLE_EXECUTABLE_DIR. In that mode, settings and saved data go to a
 * folder next to the .exe, so the app leaves nothing behind in %APPDATA% and travels with the .exe.
 *
 * An elevated relaunch starts with a fresh environment, so the data folder is also passed as an argument.
 */

export const PORTABLE_DATA_FLAG = '--portable-data='

/** The original portable .exe (not the unpacked temp copy), when running portable. */
export function portableExecutable(): string | undefined {
  return process.env.PORTABLE_EXECUTABLE_FILE || undefined
}

export function portableDataDir(): string | undefined {
  const fromArg = argValue(PORTABLE_DATA_FLAG)
  if (fromArg) return fromArg
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || (portableExecutable() && dirname(portableExecutable()!))
  return exeDir ? join(exeDir, 'net-sleuth - dados') : undefined
}

/** Must run before the app is ready (userData is read early). */
export function setupPortableMode(): void {
  const dir = portableDataDir()
  if (!dir) return
  try {
    mkdirSync(dir, { recursive: true })
    app.setPath('userData', dir)
  } catch (err) {
    // Read-only location (e.g. a locked USB stick): fall back to %APPDATA%.
    console.error('[portable] cannot use data folder next to the exe:', err)
  }
}
