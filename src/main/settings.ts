import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { THEME_SOURCES, type ThemeSource } from '@shared/ipc'

export interface Settings {
  theme: ThemeSource
  /** Windows notification when a device the app never saw joins the network. */
  notifyNewDevices: boolean
  /** Read device names from the router's panel with the router password saved in Senhas e QR. Off until asked. */
  routerNames: boolean
  /** The saved router password (its last-change time) that the router refused, so the app does not retry it. */
  routerAuthRefused: number | null
}

const DEFAULTS: Settings = { theme: 'system', notifyNewDevices: true, routerNames: false, routerAuthRefused: null }

const file = (): string => join(app.getPath('userData'), 'settings.json')

let current: Settings = DEFAULTS

/** Reads settings once at startup. The file is tiny: a sync read is cheaper than scheduling async I/O. */
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
    current = {
      theme: THEME_SOURCES.includes(raw.theme as ThemeSource) ? (raw.theme as ThemeSource) : DEFAULTS.theme,
      notifyNewDevices: typeof raw.notifyNewDevices === 'boolean' ? raw.notifyNewDevices : DEFAULTS.notifyNewDevices,
      routerNames: typeof raw.routerNames === 'boolean' ? raw.routerNames : DEFAULTS.routerNames,
      // Earlier builds stored this as routerAuthFailedFor, sometimes wrongly (session cookie not kept): ignored on purpose.
      routerAuthRefused: typeof raw.routerAuthRefused === 'number' ? raw.routerAuthRefused : DEFAULTS.routerAuthRefused
    }
  } catch {
    current = { ...DEFAULTS }
  }
  return current
}

export function getSettings(): Settings {
  return current
}

let pending: Promise<void> = Promise.resolve()

/** Saves without blocking the main process; writes are serialized so the file never gets corrupted. */
export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch }
  const snapshot = JSON.stringify(current, null, 2)
  pending = pending
    .then(async () => {
      await mkdir(dirname(file()), { recursive: true })
      await writeFile(file(), snapshot, 'utf8')
    })
    .catch((err) => console.error('[settings] failed to save', err))
  return current
}
