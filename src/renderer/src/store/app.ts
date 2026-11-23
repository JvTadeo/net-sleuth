import { create } from 'zustand'
import type { ThemeSource, ThemeState } from '@shared/ipc'
import type { NetInfo, PathResult } from '@shared/network'
import type { DeviceScan } from '@shared/devices'

export type Page = 'connection' | 'fixes' | 'dns' | 'ping' | 'security' | 'passwords' | 'devices' | 'settings'

interface AppState {
  page: Page
  setPage: (page: Page) => void

  theme: ThemeState
  setTheme: (source: ThemeSource) => Promise<void>
  syncTheme: (state: ThemeState) => void

  isAdmin: boolean
  loadAppInfo: () => Promise<void>
  /** Restarts elevated (UAC). Returns false if declined. */
  relaunchAsAdmin: () => Promise<boolean>

  net: NetInfo | null
  netError: string | null
  path: PathResult | null
  checking: boolean
  /** Reads the connection and measures the path (router, DNS, internet) together. */
  refreshNet: () => Promise<void>

  /** The last device scan (background or asked for), shared by the sidebar badge and the Aparelhos page. */
  deviceScan: DeviceScan | null
  setDeviceScan: (scan: DeviceScan) => void
}

/** Applies the theme to the document. Called before the first render and on every change. */
export function applyTheme(dark: boolean): void {
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}

const initialDark = new URLSearchParams(location.search).get('theme') === 'dark'

export const useApp = create<AppState>((set, get) => ({
  page: 'connection',
  setPage: (page) => set({ page }),
  deviceScan: null,
  setDeviceScan: (scan) => set({ deviceScan: scan }),

  theme: { source: 'system', dark: initialDark },
  setTheme: async (source) => {
    // Optimistic update: the option is checked right away; the real theme arrives via theme:changed.
    set({ theme: { ...get().theme, source } })
    get().syncTheme(await window.api.theme.set(source))
  },
  syncTheme: (state) => {
    applyTheme(state.dark)
    set({ theme: state })
  },

  isAdmin: false,
  loadAppInfo: async () => {
    const info = await window.api.app.info()
    set({ isAdmin: info.isAdmin })
  },
  relaunchAsAdmin: async () => (await window.api.app.relaunchAsAdmin()).ok,

  net: null,
  netError: null,
  path: null,
  checking: false,
  refreshNet: async () => {
    if (get().checking) return
    set({ checking: true, netError: null })
    try {
      const net = await window.api.net.info()
      set({ net })
      if (net.supported) set({ path: await window.api.net.path() })
    } catch (err) {
      set({ netError: cleanError(err) })
    } finally {
      set({ checking: false })
    }
  }
}))

/** Error text without Electron's "Error invoking remote method…" prefix. */
export function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
