import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { DNS_PRESET_IDS, type FixId } from '@shared/network'
import { SEC_FIX_IDS } from '@shared/security'
import { DEVICE_OPS, DEVICE_TYPES, normalizeMac, type DeviceAction, type DeviceType } from '@shared/devices'
import { VAULT_KINDS, WIFI_SECURITIES, type VaultInput } from '@shared/vault'
import { THEME_SOURCES, type EventMap, type InvokeMap, type SendMap, type ThemeSource, type ThemeState } from '@shared/ipc'
import { getSettings, updateSettings } from './settings'
import { getStartupMs, markReady } from './perf'
import { isAdmin, markHandedOff, relaunchElevated } from './elevation'
import { NetworkService } from './network'
import { SecurityService, hostsPath } from './security'
import { VaultService } from './vault'
import { DevicesService } from './devices'

// ---------- typed helpers ----------

export function handle<K extends keyof InvokeMap>(
  channel: K,
  fn: (event: IpcMainInvokeEvent, ...args: InvokeMap[K][0]) => InvokeMap[K][1] | Promise<InvokeMap[K][1]>
): void {
  ipcMain.handle(channel, (event, ...args) => fn(event, ...(args as InvokeMap[K][0])))
}

function on<K extends keyof SendMap>(channel: K, fn: (event: IpcMainEvent, ...args: SendMap[K]) => void): void {
  ipcMain.on(channel, (event, ...args) => fn(event, ...(args as SendMap[K])))
}

export function emit<K extends keyof EventMap>(win: BrowserWindow, channel: K, ...args: EventMap[K]): void {
  if (!win.isDestroyed()) win.webContents.send(channel, ...args)
}

export function broadcast<K extends keyof EventMap>(channel: K, ...args: EventMap[K]): void {
  for (const win of BrowserWindow.getAllWindows()) emit(win, channel, ...args)
}

const senderWindow = (e: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)

export function themeState(): ThemeState {
  return { source: getSettings().theme, dark: nativeTheme.shouldUseDarkColors }
}

/** Native confirmation (Cancel is the default button), attached to the focused window. */
async function confirm(options: Electron.MessageBoxOptions): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opts: Electron.MessageBoxOptions = { cancelId: 1, defaultId: 1, noLink: true, ...options }
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return response === 0
}

export const network = new NetworkService({
  isAdmin: () => isAdmin(),
  confirm,
  onSample: (sample) => broadcast('ping:sample', sample)
})

export const security = new SecurityService({
  isAdmin: () => isAdmin(),
  confirm,
  net: () => network.info()
})

export const vault = new VaultService({
  confirm,
  parent: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
  gateway: async () => (await network.info()).primary?.gateway ?? null
})

export const devices = new DevicesService({
  net: () => network.info(),
  routerUrl: async () => {
    try {
      const router = (await vault.list()).find((e) => e.kind === 'router' && e.url)
      if (router?.url) return router.url
    } catch {
      // The password file may not open (another account); the gateway still works.
    }
    return vault.defaultRouterUrl()
  },
  notifyEnabled: () => getSettings().notifyNewDevices,
  routerNames: () => ({ enabled: getSettings().routerNames, failedFor: getSettings().routerAuthRefused }),
  routerSecret: (gateway) => vault.routerSecret(gateway),
  routerAuthFailed: (updatedAt) => void updateSettings({ routerAuthRefused: updatedAt }),
  onChanged: (scan) => broadcast('devices:changed', scan),
  onOpen: () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    emit(win, 'app:navigate', 'devices')
  }
})

function deviceAction(raw: unknown): DeviceAction {
  const r = (raw ?? {}) as Record<string, unknown>
  const mac = typeof r.mac === 'string' ? normalizeMac(r.mac) : null
  if (!mac || !DEVICE_OPS.includes(r.op as DeviceAction['op'])) throw new Error('Pedido inválido.')
  if (r.op === 'rename') {
    if (typeof r.name !== 'string' || r.name.length > 200) throw new Error('Nome inválido.')
    return { op: 'rename', mac, name: r.name }
  }
  if (r.op === 'setType') {
    if (r.type !== null && !DEVICE_TYPES.includes(r.type as DeviceType)) throw new Error('Tipo inválido.')
    return { op: 'setType', mac, type: r.type as DeviceType | null }
  }
  return { op: r.op as Exclude<DeviceAction['op'], 'rename' | 'setType'>, mac }
}

const optStr = (v: unknown, max: number): boolean => v === undefined || v === null || (typeof v === 'string' && v.length <= max)

/** Rebuilds the input field by field, so nothing unexpected from the window reaches the store. */
function vaultInput(raw: unknown): VaultInput {
  const r = (raw ?? {}) as Record<string, unknown>
  const ok =
    VAULT_KINDS.includes(r.kind as VaultInput['kind']) &&
    typeof r.name === 'string' &&
    r.name.length <= 200 &&
    optStr(r.id, 100) &&
    optStr(r.url, 500) &&
    optStr(r.user, 200) &&
    optStr(r.password, 256) &&
    (r.security === undefined || r.security === null || WIFI_SECURITIES.includes(r.security as never)) &&
    (r.hidden === undefined || typeof r.hidden === 'boolean')
  if (!ok) throw new Error('Dados inválidos.')
  return {
    id: r.id as string | undefined,
    kind: r.kind as VaultInput['kind'],
    name: r.name as string,
    security: (r.security as VaultInput['security']) ?? null,
    hidden: r.hidden === true,
    url: (r.url as string | null | undefined) ?? null,
    user: (r.user as string | null | undefined) ?? null,
    password: r.password as string | undefined
  }
}

const idArg = (id: unknown): string => {
  if (typeof id !== 'string' || id.length > 100) throw new Error('Item inválido.')
  return id
}

const FIX_IDS: readonly FixId[] = ['flushDns', 'renewIp', 'restartAdapter', 'resetNetwork']

// ---------- registration ----------

export function registerIpc(): void {
  // Window
  on('window:minimize', (e) => senderWindow(e)?.minimize())
  on('window:toggleMaximize', (e) => {
    const w = senderWindow(e)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  on('window:close', (e) => senderWindow(e)?.close())
  handle('window:isMaximized', (e) => senderWindow(e)?.isMaximized() ?? false)

  // Theme
  handle('theme:get', () => themeState())
  handle('theme:set', (_e, source: ThemeSource) => {
    // Never trust input from the window: validate before use.
    if (!THEME_SOURCES.includes(source)) throw new Error(`Invalid theme: ${String(source)}`)
    updateSettings({ theme: source })
    nativeTheme.themeSource = source // fires nativeTheme 'updated', which notifies the windows
    return themeState()
  })

  // Network
  handle('net:info', () => network.info())
  handle('net:path', () => network.path())
  handle('fix:run', (_e, id) => {
    if (!FIX_IDS.includes(id)) throw new Error('Conserto desconhecido.')
    return network.fix(id)
  })
  handle('dns:measure', () => network.dnsMeasure())
  handle('dns:apply', (_e, req) => {
    if (!req || !DNS_PRESET_IDS.includes(req.preset) || typeof req.encrypted !== 'boolean') throw new Error('Pedido de DNS inválido.')
    return network.dnsApply({ preset: req.preset, encrypted: req.encrypted })
  })
  handle('devices:scan', (_e, withRouter) => devices.scan(withRouter === true))
  handle('devices:last', () => devices.lastScan)
  handle('devices:act', (_e, action) => devices.act(deviceAction(action)))
  handle('devices:openRouter', () => devices.openRouter())
  handle('devices:getNotify', () => getSettings().notifyNewDevices)
  handle('devices:getRouterNames', () => getSettings().routerNames)
  handle('devices:setRouterNames', (_e, on) => {
    if (typeof on !== 'boolean') throw new Error('Valor inválido.')
    return updateSettings({ routerNames: on }).routerNames
  })
  handle('devices:setNotify', (_e, on) => {
    if (typeof on !== 'boolean') throw new Error('Valor inválido.')
    return updateSettings({ notifyNewDevices: on }).notifyNewDevices
  })
  handle('vault:list', () => vault.list())
  handle('vault:save', (_e, input) => vault.save(vaultInput(input)))
  handle('vault:remove', (_e, id) => vault.remove(idArg(id)))
  handle('vault:reveal', (_e, id) => vault.reveal(idArg(id)))
  handle('vault:copy', (_e, id) => vault.copy(idArg(id)))
  handle('vault:qr', (_e, id) => vault.qr(idArg(id)))
  handle('vault:print', (_e, id) => vault.print(idArg(id)))
  handle('vault:saveImage', (_e, id) => vault.saveImage(idArg(id)))
  handle('vault:openRouter', (_e, id) => vault.openRouter(idArg(id)))
  handle('vault:defaultRouterUrl', () => vault.defaultRouterUrl())
  handle('vault:windowsProfiles', () => vault.windowsProfiles())
  handle('vault:importWindows', (_e, name) => {
    if (typeof name !== 'string' || name.length > 64) throw new Error('Rede inválida.')
    return vault.importWindows(name)
  })
  handle('sec:scan', () => security.scan())
  handle('sec:fix', (_e, req) => {
    if (!req || !SEC_FIX_IDS.includes(req.id) || (req.arg !== undefined && typeof req.arg !== 'string')) throw new Error('Pedido inválido.')
    return security.fix({ id: req.id, arg: req.arg })
  })
  handle('ping:start', (_e, target) => network.startPing(target))
  handle('ping:stop', () => network.stopPing())
  handle('ping:state', () => network.pingState)

  // App
  handle('app:relaunchAsAdmin', async () => {
    const r = await relaunchElevated()
    if (!r.ok) return { ok: false }
    const devServer = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
    // Let the reply reach the window before it goes away.
    setTimeout(() => {
      if (!devServer) {
        app.quit()
        return
      }
      // Dev mode: the Vite dev server lives as long as this process, and the elevated copy loads its UI
      // from it. So hand the single-instance lock over, close the windows, and stay alive (windowless)
      // until the elevated copy exits.
      markHandedOff()
      network.stopPing()
      app.releaseSingleInstanceLock()
      for (const w of BrowserWindow.getAllWindows()) w.destroy()
      void r.exited.then(() => app.quit())
    }, 100)
    return { ok: true }
  })
  handle('app:openWindowsSettings', async (_e, page) => {
    if (page === 'hosts') {
      shell.showItemInFolder(hostsPath())
      return
    }
    const urls: Record<string, string> = {
      location: 'ms-settings:privacy-location',
      network: 'ms-settings:network-status',
      remoteDesktop: 'ms-settings:remotedesktop',
      proxy: 'ms-settings:network-proxy',
      firewall: 'windowsdefender://network'
    }
    const url = urls[page]
    if (!url) throw new Error('Página desconhecida.')
    await shell.openExternal(url)
  })
  handle('app:info', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    startupMs: getStartupMs(),
    isAdmin: await isAdmin()
  }))
  on('app:ready', () => markReady())
}
