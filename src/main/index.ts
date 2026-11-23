import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { loadSettings } from './settings'
import { broadcast, devices, emit, network, registerIpc, themeState } from './ipc'
import { argValue, FLAGS, isHandedOff } from './elevation'
import { setupPortableMode } from './portable'

// Portable .exe: keep data next to the exe. Must happen before anything reads userData.
setupPortableMode()

const BG_LIGHT = '#ffffff'
const BG_DARK = '#09090b'

const relaunched = process.argv.includes(FLAGS.relaunch)

/**
 * Single instance: launching again focuses the existing window.
 * After an elevation relaunch the old instance is still closing, so the new one waits a little for the lock.
 */
async function acquireInstanceLock(): Promise<boolean> {
  if (app.requestSingleInstanceLock()) return true
  if (!relaunched) return false
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (app.requestSingleInstanceLock()) return true
  }
  return false
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false, // shown only when ready: no white flash
    frame: false, // custom title bar (TitleBar.tsx)
    backgroundColor: dark ? BG_DARK : BG_LIGHT,
    title: 'net-sleuth',
    // Packaged builds take the icon from net-sleuth.exe. In development the process is electron.exe, so the window
    // carries the icon itself (the .ico on Windows, with every size the taskbar asks for).
    ...(app.isPackaged
      ? {}
      : { icon: join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true
    }
  })

  const win = mainWindow
  win.once('ready-to-show', () => win.show())
  win.on('maximize', () => emit(win, 'window:maximized', true))
  win.on('unmaximize', () => emit(win, 'window:maximized', false))
  win.on('closed', () => {
    mainWindow = null
  })

  // External links open in the browser; the window never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('did-fail-load', (_e, code, description, url) => {
    console.error(`[window] failed to load ${url}: ${description} (${code})`)
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  // The theme goes in the URL so the window can set the class before the first render (no flash).
  const query = { theme: dark ? 'dark' : 'light' }
  const devUrl = process.env['ELECTRON_RENDERER_URL'] ?? argValue(FLAGS.rendererUrl)
  if (!app.isPackaged && devUrl) {
    void win.loadURL(`${devUrl}?${new URLSearchParams(query)}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
}

app.on('second-instance', (_e, argv) => {
  // An elevated copy is taking over: this instance is about to quit, don't steal focus.
  if (argv.includes(FLAGS.relaunch) || isHandedOff() || !mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (!(await acquireInstanceLock())) {
    app.quit()
    return
  }
  // The app id ties the taskbar button and notifications to the installed app's shortcut. In development there is no
  // shortcut, and with this id Windows 11 shows electron.exe's icon on the taskbar instead of the window's own.
  if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('com.netsleuth.app')

  const settings = loadSettings()
  nativeTheme.themeSource = settings.theme

  // Theme changed (user choice or Windows switched on its own): update the background and notify windows.
  nativeTheme.on('updated', () => {
    const state = themeState()
    for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(state.dark ? BG_DARK : BG_LIGHT)
    broadcast('theme:changed', state)
  })

  registerIpc()
  createWindow()
  devices.startBackground()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  network.stopPing()
  devices.stopBackground()
})

app.on('window-all-closed', () => {
  // After a dev-mode elevation hand-off this process must outlive its windows (see 'app:relaunchAsAdmin').
  if (isHandedOff()) return
  if (process.platform !== 'darwin') app.quit()
})
