import { app, BrowserWindow, clipboard, dialog, safeStorage, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  securityFromProfile,
  validateInput,
  wifiQrText,
  type QrDrawing,
  type VaultActionResult,
  type VaultEntry,
  type VaultInput,
  type WifiSecurity,
  type WindowsWifiProfile
} from '@shared/vault'
import { powershell, toArray } from './powershell'
import { cardHtml, qrPath } from './wifi-card'

interface StoredEntry extends Omit<VaultEntry, 'hasPassword'> {
  password: string
}

interface StoredFile {
  version: 1
  entries: StoredEntry[]
}

/** Copied passwords are wiped from the clipboard after this long, if nothing else was copied meanwhile. */
const CLIPBOARD_MS = 30_000

/**
 * Reads the PC's saved Wi-Fi profiles with their passwords. Exported XML is the same in every Windows language.
 * Passwords of profiles shared by all users come back still encrypted ("protected") unless the app runs as admin.
 */
const WINDOWS_PROFILES =
  String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dir = Join-Path ([IO.Path]::GetTempPath()) ('net-sleuth-wlan-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
try {
  Start-Process -FilePath netsh -ArgumentList "wlan export profile key=clear folder=` +
  '`"$dir`"' +
  String.raw`" -NoNewWindow -Wait
  $list = @(Get-ChildItem -LiteralPath $dir -Filter *.xml | ForEach-Object {
    $x = [xml](Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8)
    $sec = $x.WLANProfile.MSM.security
    $key = $sec.sharedKey
    [pscustomobject]@{
      name = [string]$x.WLANProfile.name
      auth = [string]$sec.authEncryption.authentication; encryption = [string]$sec.authEncryption.encryption
      hidden = ([string]$x.WLANProfile.SSIDConfig.nonBroadcast -eq 'true')
      key = $(if ($key -and [string]$key.protected -eq 'false') { [string]$key.keyMaterial } else { $null })
    }
  })
  ConvertTo-Json -Compress -Depth 3 -InputObject $list
} finally { Remove-Item -LiteralPath $dir -Recurse -Force }
`

interface RawProfile {
  name: string
  auth: string
  encryption: string
  hidden: boolean
  key: string | null
}

export interface VaultDeps {
  confirm: (options: Electron.MessageBoxOptions) => Promise<boolean>
  parent: () => BrowserWindow | null
  gateway: () => Promise<string | null>
}

export class VaultService {
  private entries: StoredEntry[] | null = null
  private writing: Promise<void> = Promise.resolve()
  private clipboardTimer: NodeJS.Timeout | null = null

  constructor(private deps: VaultDeps) {}

  private file(): string {
    return join(app.getPath('userData'), 'senhas.dat')
  }

  private async ensureCrypto(): Promise<void> {
    // Linux test runs only (no keyring in CI): Windows always has DPAPI and never takes this branch.
    if (process.platform === 'linux' && process.env.NET_SLEUTH_FIXTURE) safeStorage.setUsePlainTextEncryption(true)
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('A criptografia do Windows não está disponível nesta conta, então nada foi salvo.')
    }
  }

  private async load(): Promise<StoredEntry[]> {
    if (this.entries) return this.entries
    let buf: Buffer
    try {
      buf = await readFile(this.file())
    } catch {
      this.entries = []
      return this.entries
    }
    await this.ensureCrypto()
    let reEncrypt = false
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(buf)
      const data = JSON.parse(result) as StoredFile
      this.entries = Array.isArray(data.entries) ? data.entries : []
      reEncrypt = shouldReEncrypt
    } catch {
      throw new Error('O arquivo de senhas não abre nesta conta do Windows. Ele só abre no PC e na conta de usuário onde foi criado.')
    }
    // Windows rotated the key: save again so the file uses the new one.
    if (reEncrypt) await this.persist()
    return this.entries
  }

  /** Encrypts the whole list with the Windows account's key (DPAPI) and replaces the file in one step. */
  private persist(): Promise<void> {
    const json = JSON.stringify({ version: 1, entries: this.entries ?? [] } satisfies StoredFile)
    const target = this.file()
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await this.ensureCrypto()
        const blob = await safeStorage.encryptStringAsync(json)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(`${target}.tmp`, blob)
        await rename(`${target}.tmp`, target)
      })
    return this.writing
  }

  private view(e: StoredEntry): VaultEntry {
    const { password, ...rest } = e
    return { ...rest, hasPassword: password.length > 0 }
  }

  private async find(id: string): Promise<StoredEntry> {
    const e = (await this.load()).find((x) => x.id === id)
    if (!e) throw new Error('Item não encontrado.')
    return e
  }

  async list(): Promise<VaultEntry[]> {
    const order = { wifi: 0, guest: 1, router: 2 }
    return [...(await this.load())].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)).map((e) => this.view(e))
  }

  async save(input: VaultInput): Promise<VaultEntry> {
    const list = await this.load()
    const existing = input.id ? list.find((e) => e.id === input.id) : undefined
    if (input.id && !existing) throw new Error('Item não encontrado.')
    const errors = validateInput(input, !existing)
    if (errors.length) throw new Error(errors.join(' '))
    const isWifi = input.kind !== 'router'
    const security: WifiSecurity | null = isWifi ? (input.security ?? 'WPA2') : null
    const entry: StoredEntry = {
      id: existing?.id ?? randomUUID(),
      kind: input.kind,
      name: input.name.trim() || (isWifi ? '' : 'Painel do roteador'),
      security,
      hidden: isWifi ? !!input.hidden : false,
      url: isWifi ? null : input.url?.trim() || null,
      user: isWifi ? null : input.user?.trim() || null,
      password: security === 'open' ? '' : (input.password ?? existing?.password ?? ''),
      source: existing?.source ?? 'typed',
      updatedAt: Date.now()
    }
    this.entries = existing ? list.map((e) => (e.id === entry.id ? entry : e)) : [...list, entry]
    await this.persist()
    return this.view(entry)
  }

  async remove(id: string): Promise<VaultActionResult> {
    const e = await this.find(id)
    const ok = await this.deps.confirm({
      type: 'warning',
      title: 'Apagar',
      message: `Apagar "${e.name}" das senhas guardadas?`,
      detail: 'A senha some deste app. A rede e o roteador não mudam.',
      buttons: ['Apagar', 'Cancelar']
    })
    if (!ok) return { done: false, message: '' }
    this.entries = (this.entries ?? []).filter((x) => x.id !== id)
    await this.persist()
    return { done: true, message: `"${e.name}" apagado.` }
  }

  async reveal(id: string): Promise<string> {
    return (await this.find(id)).password
  }

  /** Copies in the main process, so the password is never handed to the window for this. */
  async copy(id: string): Promise<VaultActionResult> {
    const pw = (await this.find(id)).password
    await clipboard.writeText(pw)
    if (this.clipboardTimer) clearTimeout(this.clipboardTimer)
    this.clipboardTimer = setTimeout(async () => {
      if ((await clipboard.readText()) === pw) clipboard.clear()
    }, CLIPBOARD_MS)
    return {
      done: true,
      message: 'Senha copiada. Ela sai da área de transferência em 30 segundos.'
    }
  }

  async qr(id: string): Promise<QrDrawing> {
    const e = await this.find(id)
    if (e.kind === 'router') throw new Error('Só redes Wi-Fi têm QR code.')
    return qrPath(wifiQrText(e.name, e.password, e.security ?? 'WPA2', e.hidden))
  }

  private async cardWindow(id: string, offscreen: boolean): Promise<{ win: BrowserWindow; entry: StoredEntry }> {
    const entry = await this.find(id)
    if (entry.kind === 'router') throw new Error('Só redes Wi-Fi têm cartão.')
    const html = cardHtml(entry, qrPath(wifiQrText(entry.name, entry.password, entry.security ?? 'WPA2', entry.hidden)))
    const win = new BrowserWindow({
      show: false,
      width: 520,
      height: 720,
      useContentSize: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        javascript: false,
        offscreen
      }
    })
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return { win, entry }
  }

  async print(id: string): Promise<VaultActionResult> {
    const { win } = await this.cardWindow(id, false)
    return new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => {
        win.destroy()
        resolve(
          ok
            ? { done: true, message: 'Cartão enviado para a impressora.' }
            : {
                done: false,
                message: reason === 'cancelled' ? '' : 'Não foi possível imprimir.'
              }
        )
      })
    })
  }

  async saveImage(id: string): Promise<VaultActionResult> {
    const { win, entry } = await this.cardWindow(id, true)
    try {
      await new Promise((r) => setTimeout(r, 150)) // let the offscreen page paint once
      const png = (await win.webContents.capturePage()).toPNG()
      const parent = this.deps.parent()
      const opts: Electron.SaveDialogOptions = {
        title: 'Salvar cartão do Wi-Fi',
        defaultPath: join(app.getPath('pictures'), `Wi-Fi ${entry.name.replace(/[\\/:*?"<>|]/g, '_')}.png`),
        filters: [{ name: 'Imagem PNG', extensions: ['png'] }]
      }
      const { canceled, filePath } = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
      if (canceled || !filePath) return { done: false, message: '' }
      await writeFile(filePath, png)
      return { done: true, message: 'Imagem salva.' }
    } finally {
      win.destroy()
    }
  }

  async openRouter(id: string): Promise<void> {
    const e = await this.find(id)
    const url = e.url ?? (await this.defaultRouterUrl())
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('Endereço do painel inválido.')
    await shell.openExternal(url)
  }

  async defaultRouterUrl(): Promise<string | null> {
    const gw = await this.deps.gateway()
    return gw ? `http://${gw}` : null
  }

  /**
   * The saved router password, for the main process only (reading device names from the panel). Prefers the entry
   * whose panel address points at the current gateway.
   */
  async routerSecret(gateway: string | null): Promise<{ password: string; updatedAt: number } | null> {
    const routers = (await this.load()).filter((e) => e.kind === 'router' && e.password)
    const host = (e: StoredEntry): string | null => {
      try {
        return e.url ? new URL(e.url).hostname : null
      } catch {
        return null
      }
    }
    const pick = routers.find((e) => gateway && host(e) === gateway) ?? (routers.length === 1 ? routers[0] : undefined)
    return pick ? { password: pick.password, updatedAt: pick.updatedAt } : null
  }

  // ---------- Windows profiles ----------

  private async readProfiles(): Promise<RawProfile[]> {
    if (process.platform !== 'win32') return []
    const raw = (await powershell(WINDOWS_PROFILES, 60_000)) || '[]'
    return toArray(JSON.parse(raw) as RawProfile[]).filter((p) => p && p.name)
  }

  async windowsProfiles(): Promise<WindowsWifiProfile[]> {
    const saved = new Set((await this.load()).filter((e) => e.kind !== 'router').map((e) => e.name))
    return (await this.readProfiles()).map((p) => ({
      name: p.name,
      security: securityFromProfile(p.auth, p.encryption),
      hasKey: !!p.key || securityFromProfile(p.auth, p.encryption) === 'open',
      saved: saved.has(p.name)
    }))
  }

  async importWindows(name: string): Promise<VaultEntry> {
    const p = (await this.readProfiles()).find((x) => x.name === name)
    if (!p) throw new Error('Rede não encontrada no Windows.')
    const security = securityFromProfile(p.auth, p.encryption)
    if (security !== 'open' && !p.key) throw new Error('O Windows só entrega a senha desta rede no modo administrador.')
    const list = await this.load()
    const existing = list.find((e) => e.kind !== 'router' && e.name === name)
    const entry: StoredEntry = {
      id: existing?.id ?? randomUUID(),
      kind: existing?.kind ?? 'wifi',
      name,
      security,
      hidden: p.hidden === true,
      url: null,
      user: null,
      password: p.key ?? '',
      source: 'windows',
      updatedAt: Date.now()
    }
    this.entries = existing ? list.map((e) => (e.id === entry.id ? entry : e)) : [...list, entry]
    await this.persist()
    return this.view(entry)
  }
}
