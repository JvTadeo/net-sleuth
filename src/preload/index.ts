import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, EventMap, InvokeMap, SendMap, Unsubscribe } from '@shared/ipc'

// The window has no Node access: only this small, typed API.

function invoke<K extends keyof InvokeMap>(channel: K, ...args: InvokeMap[K][0]): Promise<InvokeMap[K][1]> {
  return ipcRenderer.invoke(channel, ...args)
}

function send<K extends keyof SendMap>(channel: K, ...args: SendMap[K]): void {
  ipcRenderer.send(channel, ...args)
}

function subscribe<K extends keyof EventMap>(channel: K, cb: (...args: EventMap[K]) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as EventMap[K]))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  window: {
    minimize: () => send('window:minimize'),
    toggleMaximize: () => send('window:toggleMaximize'),
    close: () => send('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
    onMaximizedChange: (cb) => subscribe('window:maximized', cb)
  },
  theme: {
    get: () => invoke('theme:get'),
    set: (source) => invoke('theme:set', source),
    onChange: (cb) => subscribe('theme:changed', cb)
  },
  net: {
    info: () => invoke('net:info'),
    path: () => invoke('net:path')
  },
  fixes: {
    run: (id) => invoke('fix:run', id)
  },
  devices: {
    scan: (withRouter) => invoke('devices:scan', withRouter),
    last: () => invoke('devices:last'),
    act: (action) => invoke('devices:act', action),
    openRouter: () => invoke('devices:openRouter'),
    getNotify: () => invoke('devices:getNotify'),
    setNotify: (on) => invoke('devices:setNotify', on),
    getRouterNames: () => invoke('devices:getRouterNames'),
    setRouterNames: (on) => invoke('devices:setRouterNames', on),
    onChanged: (cb) => subscribe('devices:changed', cb)
  },
  vault: {
    list: () => invoke('vault:list'),
    save: (input) => invoke('vault:save', input),
    remove: (id) => invoke('vault:remove', id),
    reveal: (id) => invoke('vault:reveal', id),
    copy: (id) => invoke('vault:copy', id),
    qr: (id) => invoke('vault:qr', id),
    print: (id) => invoke('vault:print', id),
    saveImage: (id) => invoke('vault:saveImage', id),
    openRouter: (id) => invoke('vault:openRouter', id),
    defaultRouterUrl: () => invoke('vault:defaultRouterUrl'),
    windowsProfiles: () => invoke('vault:windowsProfiles'),
    importWindows: (name) => invoke('vault:importWindows', name)
  },
  security: {
    scan: () => invoke('sec:scan'),
    fix: (req) => invoke('sec:fix', req)
  },
  dns: {
    measure: () => invoke('dns:measure'),
    apply: (req) => invoke('dns:apply', req)
  },
  ping: {
    start: (target) => invoke('ping:start', target),
    stop: () => invoke('ping:stop'),
    state: () => invoke('ping:state'),
    onSample: (cb) => subscribe('ping:sample', cb)
  },
  app: {
    info: () => invoke('app:info'),
    ready: () => send('app:ready'),
    relaunchAsAdmin: () => invoke('app:relaunchAsAdmin'),
    openWindowsSettings: (page) => invoke('app:openWindowsSettings', page),
    onNavigate: (cb) => subscribe('app:navigate', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
