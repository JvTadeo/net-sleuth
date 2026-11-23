/**
 * IPC contract between the main process, the preload and the window.
 * Everything that crosses processes goes through these types: if one side changes, the other stops compiling.
 */

import type { DeviceAction, DeviceScan } from './devices'
import type { QrDrawing, VaultActionResult, VaultEntry, VaultInput, WindowsWifiProfile } from './vault'
import type { SecFixRequest, SecFixResult, SecurityReport } from './security'
import type { DnsApplyRequest, DnsApplyResult, DnsTiming, FixId, FixResult, NetInfo, PathResult, PingSample, PingState, PingTarget } from './network'

export type ThemeSource = 'light' | 'dark' | 'system'

export const THEME_SOURCES: readonly ThemeSource[] = ['light', 'dark', 'system']

export interface ThemeState {
  /** What the user picked. */
  source: ThemeSource
  /** The theme in effect right now ("system" resolved). */
  dark: boolean
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  platform: string
  /** Time from process start until the window responds, in ms. Null until the window reports in. */
  startupMs: number | null
  /** Running with administrator rights (needed to change DNS, firewall and network settings). */
  isAdmin: boolean
}

/** Windows Settings pages the app may open (a fixed list: the window never sends a URL). */
export type WindowsSettingsPage = 'location' | 'network' | 'remoteDesktop' | 'proxy' | 'firewall' | 'hosts'

/** Requests with a reply (ipcRenderer.invoke → ipcMain.handle). Shape: [args, return]. */
export interface InvokeMap {
  'theme:get': [[], ThemeState]
  'theme:set': [[source: ThemeSource], ThemeState]
  'window:isMaximized': [[], boolean]
  'app:info': [[], AppInfo]
  'app:relaunchAsAdmin': [[], { ok: boolean }]
  'app:openWindowsSettings': [[page: WindowsSettingsPage], void]
  'net:info': [[], NetInfo]
  'net:path': [[], PathResult]
  'fix:run': [[id: FixId], FixResult]
  'dns:measure': [[], DnsTiming[]]
  'sec:scan': [[], SecurityReport]
  'devices:scan': [[withRouter?: boolean], DeviceScan]
  'devices:last': [[], DeviceScan | null]
  'devices:act': [[action: DeviceAction], DeviceScan]
  'devices:openRouter': [[], void]
  'devices:getNotify': [[], boolean]
  'devices:setNotify': [[on: boolean], boolean]
  'devices:getRouterNames': [[], boolean]
  'devices:setRouterNames': [[on: boolean], boolean]
  'vault:list': [[], VaultEntry[]]
  'vault:save': [[input: VaultInput], VaultEntry]
  'vault:remove': [[id: string], VaultActionResult]
  'vault:reveal': [[id: string], string]
  'vault:copy': [[id: string], VaultActionResult]
  'vault:qr': [[id: string], QrDrawing]
  'vault:print': [[id: string], VaultActionResult]
  'vault:saveImage': [[id: string], VaultActionResult]
  'vault:openRouter': [[id: string], void]
  'vault:defaultRouterUrl': [[], string | null]
  'vault:windowsProfiles': [[], WindowsWifiProfile[]]
  'vault:importWindows': [[name: string], VaultEntry]
  'sec:fix': [[req: SecFixRequest], SecFixResult]
  'dns:apply': [[req: DnsApplyRequest], DnsApplyResult]
  'ping:start': [[target: PingTarget], PingState]
  'ping:stop': [[], void]
  'ping:state': [[], PingState]
}

/** Fire-and-forget messages (window → main). */
export interface SendMap {
  'window:minimize': []
  'window:toggleMaximize': []
  'window:close': []
  'app:ready': []
}

/** Events (main → window). */
export interface EventMap {
  'window:maximized': [maximized: boolean]
  'theme:changed': [state: ThemeState]
  /** A device scan finished (background or asked for). */
  'devices:changed': [scan: DeviceScan]
  /** The main process asks the window to open a page (a notification was clicked). */
  'app:navigate': [page: 'devices']
  'ping:sample': [sample: PingSample]
}

export type Unsubscribe = () => void

/** API exposed to the window as `window.api`. */
export interface Api {
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizedChange(cb: (maximized: boolean) => void): Unsubscribe
  }
  theme: {
    get(): Promise<ThemeState>
    set(source: ThemeSource): Promise<ThemeState>
    onChange(cb: (state: ThemeState) => void): Unsubscribe
  }
  net: {
    /** The connection in use: adapter, addresses, DNS, Wi-Fi details. */
    info(): Promise<NetInfo>
    /** Pings the router and the internet and times a DNS lookup, all at once (about a second). */
    path(): Promise<PathResult>
  }
  fixes: {
    /** Runs a fix. Restarting the adapter and resetting the network ask for confirmation and need admin rights. */
    run(id: FixId): Promise<FixResult>
  }
  devices: {
    /** Pings the PC's own subnet and reads who answered (a few seconds); `withRouter` also reads the router's list. */
    scan(withRouter?: boolean): Promise<DeviceScan>
    /** The last scan, without touching the network. */
    last(): Promise<DeviceScan | null>
    act(action: DeviceAction): Promise<DeviceScan>
    openRouter(): Promise<void>
    getNotify(): Promise<boolean>
    setNotify(on: boolean): Promise<boolean>
    getRouterNames(): Promise<boolean>
    setRouterNames(on: boolean): Promise<boolean>
    onChanged(cb: (scan: DeviceScan) => void): Unsubscribe
  }
  vault: {
    list(): Promise<VaultEntry[]>
    /** Adds or edits; a missing password on edit keeps the old one. */
    save(input: VaultInput): Promise<VaultEntry>
    /** Asks for confirmation first. */
    remove(id: string): Promise<VaultActionResult>
    /** The password, only when the user clicks "Mostrar". */
    reveal(id: string): Promise<string>
    /** Copies in the main process and wipes the clipboard after 30 s. */
    copy(id: string): Promise<VaultActionResult>
    qr(id: string): Promise<QrDrawing>
    print(id: string): Promise<VaultActionResult>
    saveImage(id: string): Promise<VaultActionResult>
    openRouter(id: string): Promise<void>
    defaultRouterUrl(): Promise<string | null>
    windowsProfiles(): Promise<WindowsWifiProfile[]>
    importWindows(name: string): Promise<VaultEntry>
  }
  security: {
    /** Runs the whole checklist (a few seconds). */
    scan(): Promise<SecurityReport>
    /** Applies one fix. Most ask for confirmation and need admin rights. */
    fix(req: SecFixRequest): Promise<SecFixResult>
  }
  dns: {
    /** Lookup time through each preset's server (and the router's). */
    measure(): Promise<DnsTiming[]>
    /** Switches the primary adapter's DNS. Needs admin rights and asks for confirmation. */
    apply(req: DnsApplyRequest): Promise<DnsApplyResult>
  }
  ping: {
    /** Starts (or retargets) the one-per-second ping to the router and the chosen internet host. */
    start(target: PingTarget): Promise<PingState>
    stop(): Promise<void>
    state(): Promise<PingState>
    onSample(cb: (sample: PingSample) => void): Unsubscribe
  }
  app: {
    info(): Promise<AppInfo>
    /** The window reports its first render (measures startup time). */
    ready(): void
    /** Restarts the app with administrator rights (UAC prompt). Resolves { ok: false } if declined; on success this instance quits. */
    relaunchAsAdmin(): Promise<{ ok: boolean }>
    openWindowsSettings(page: WindowsSettingsPage): Promise<void>
    onNavigate(cb: (page: 'devices') => void): Unsubscribe
  }
}
