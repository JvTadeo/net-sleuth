import { app, Notification, shell } from 'electron'
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  applyAction,
  deviceLabel,
  mergeScan,
  normalizeMac,
  osOf,
  sweepAddresses,
  sweepRange,
  TYPE_LABEL,
  type DeviceAction,
  type DeviceHints,
  type DeviceRecord,
  type RouterInfo,
  type RouterReadStatus,
  type DeviceScan,
  type Neighbor
} from '@shared/devices'
import type { NetInfo } from '@shared/network'
import { fromArg, powershell, psArg, toArray } from './powershell'
import { discover, type DiscoveryHints } from './discovery'
import { RouterError, TplinkExClient, type RouterHost } from './routers/tplink-ex'

/** How often the app looks for new devices while it is open. */
const BACKGROUND_MS = 5 * 60_000
const FIRST_BACKGROUND_MS = 60_000

/**
 * Pings every address of the PC's own subnet at once (one .NET call, no extra processes) so Windows refreshes its
 * table of neighbors, then reads that table. Only entries Windows just confirmed count as online. The router's DNS
 * often knows device names (from DHCP), so a quick reverse lookup is tried for each.
 */
/** mDNS and UPnP answers for one device, as the shared logic reads them. */
function toHints(d: DiscoveryHints): DeviceHints {
  const txt = d.mdns?.txt ?? {}
  const up = d.upnp
  return {
    friendlyName: txt.fn || up?.friendlyName || d.mdns?.names[0] || null,
    // Google Cast "md", Apple "model"/"am", printers "ty", else the UPnP model.
    model: txt.md || txt.model || txt.am || txt.ty || [up?.modelName, up?.modelDescription].filter(Boolean).join(' · ') || null,
    manufacturer: up?.manufacturer ?? null,
    services: d.mdns?.services ?? [],
    upnpType: up?.deviceType ?? null,
    server: up?.server ?? null,
    host: d.mdns?.host ?? null
  }
}

const SCAN = (arg: string): string => String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$req = ${fromArg(arg)}
$idx = (Get-NetAdapter -Name $req.alias).ifIndex
if (@($req.sweep).Count) {
  $pings = foreach ($ip in @($req.sweep)) { (New-Object Net.NetworkInformation.Ping).SendPingAsync($ip, 600) }
  try { [void][Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($pings), 5000) } catch {}
  Start-Sleep -Milliseconds 300
}
$live = @(Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex $idx | Where-Object { @('Reachable', 'Delay', 'Probe', 'Permanent') -contains [string]$_.State -or $_.IPAddress -eq $req.gateway })
$lookups = foreach ($n in $live) { [pscustomobject]@{ ip = [string]$n.IPAddress; task = [Net.Dns]::GetHostEntryAsync([string]$n.IPAddress) } }
try { [void][Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($lookups | ForEach-Object { $_.task }), 2500) } catch {}
$out = foreach ($n in $live) {
  $l = $lookups | Where-Object { $_.ip -eq [string]$n.IPAddress } | Select-Object -First 1
  $h = $null
  if ($l -and $l.task.Status -eq 'RanToCompletion' -and $l.task.Result.HostName -ne [string]$n.IPAddress) { $h = [string]$l.task.Result.HostName }
  [pscustomobject]@{ ip = [string]$n.IPAddress; mac = [string]$n.LinkLayerAddress; hostname = $h }
}
ConvertTo-Json -Compress -InputObject @($out)
`

interface StoredFile {
  version: 1
  devices: DeviceRecord[]
}

export interface DevicesDeps {
  net: () => Promise<NetInfo>
  routerUrl: () => Promise<string | null>
  notifyEnabled: () => boolean
  /** Reading names from the router: on/off, the saved password and the one the router refused. */
  routerNames: () => { enabled: boolean; failedFor: number | null }
  routerSecret: (gateway: string | null) => Promise<{ password: string; updatedAt: number } | null>
  routerAuthFailed: (updatedAt: number | null) => void
  onChanged: (scan: DeviceScan) => void
  onOpen: () => void
}

export class DevicesService {
  private records: DeviceRecord[] | null = null
  private vendors: Map<string, string> | null = null
  private last: DeviceScan | null = null
  private scanning: Promise<DeviceScan> | null = null
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  /** Gateway → speaks the TP-Link EX panel, checked once per app session. */
  private routerKind = new Map<string, boolean>()
  private router: RouterReadStatus = { state: 'unsupported', model: null, lastRead: null, message: null }

  constructor(private deps: DevicesDeps) {}

  /**
   * Reads the router's device list when the user turned it on and asked for a refresh. Never retries a password the
   * router refused (it locks the panel after several wrong ones) and never logs in over someone already in the panel.
   */
  private async readRouter(gateway: string | null, wanted: boolean): Promise<Map<string, RouterInfo>> {
    const out = new Map<string, RouterInfo>()
    const lastRead = this.router.lastRead
    const set = (state: RouterReadStatus['state'], message: string | null = null): void => {
      this.router = { state, model: state === 'unsupported' ? null : 'TP-Link EX/Aginet', lastRead: this.router.lastRead, message }
    }
    let hosts: RouterHost[] | null = null
    const fixture = process.env.NET_SLEUTH_ROUTER_FIXTURE
    if (!gateway) {
      set('unsupported')
      return out
    }
    if (!fixture) {
      if (process.platform !== 'win32') {
        set('unsupported')
        return out
      }
      if (!this.routerKind.has(gateway)) this.routerKind.set(gateway, await TplinkExClient.detect(gateway))
      if (!this.routerKind.get(gateway)) {
        set('unsupported')
        return out
      }
    }
    const { enabled, failedFor } = this.deps.routerNames()
    if (!enabled) {
      set('off')
      return out
    }
    const secret = await this.deps.routerSecret(gateway).catch(() => null)
    if (!secret && !fixture) {
      set('noPassword', 'Guarde a senha do painel do roteador em Senhas e QR.')
      return out
    }
    if (secret && failedFor === secret.updatedAt) {
      set('auth', 'O roteador recusou a senha guardada. Corrija-a em Senhas e QR para tentar de novo.')
      return out
    }
    if (!wanted) {
      // Background scans keep the names already read; only a refresh the user asks for logs in.
      this.router = { ...this.router, state: lastRead ? 'ok' : 'off', model: 'TP-Link EX/Aginet' }
      return out
    }
    try {
      hosts = fixture ? (JSON.parse(await readFile(fixture, 'utf8')) as RouterHost[]) : await new TplinkExClient(gateway).readHosts(secret!.password)
      for (const h of hosts) {
        const mac = normalizeMac(h.mac)
        if (mac) out.set(mac, { hostname: h.hostname, os: osOf(h.clientType, h.vendorClass) })
      }
      this.router = { state: 'ok', model: 'TP-Link EX/Aginet', lastRead: Date.now(), message: null }
    } catch (err) {
      const e = err instanceof RouterError ? err : new RouterError('protocol', 'Não foi possível ler a lista do roteador.')
      if (e.code === 'auth' && secret) this.deps.routerAuthFailed(secret.updatedAt)
      set(e.code === 'busy' ? 'busy' : e.code === 'auth' ? 'auth' : 'error', e.message)
    }
    return out
  }

  private file(): string {
    return join(app.getPath('userData'), 'aparelhos.json')
  }

  private async load(): Promise<DeviceRecord[]> {
    if (this.records) return this.records
    try {
      const data = JSON.parse(await readFile(this.file(), 'utf8')) as StoredFile
      this.records = Array.isArray(data.devices) ? data.devices : []
    } catch {
      this.records = []
    }
    return this.records
  }

  private persist(): Promise<void> {
    const text = JSON.stringify({ version: 1, devices: this.records ?? [] } satisfies StoredFile, null, 1)
    const target = this.file()
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(`${target}.tmp`, text)
        await rename(`${target}.tmp`, target)
      })
    return this.writing
  }

  /** The IEEE manufacturer table (resources/oui.txt.gz), loaded the first time a device is shown. */
  private async vendorTable(): Promise<Map<string, string>> {
    if (this.vendors) return this.vendors
    const map = new Map<string, string>()
    try {
      const text = gunzipSync(await readFile(join(app.getAppPath(), 'resources', 'oui.txt.gz'))).toString('utf8')
      const [namesPart, linesPart] = text.split('\n\n')
      const names = namesPart.split('\n')
      for (const line of linesPart.split('\n')) {
        const tab = line.indexOf('\t')
        if (tab === 6) map.set(line.slice(0, 6), names[parseInt(line.slice(7), 36)])
      }
    } catch {
      // Without the table devices simply show no manufacturer.
    }
    this.vendors = map
    return map
  }

  get lastScan(): DeviceScan | null {
    return this.last
  }

  /** One scan at a time: a second caller waits for the one already running. `withRouter`: the user asked for it. */
  scan(withRouter = false): Promise<DeviceScan> {
    this.scanning ??= this.doScan(withRouter).finally(() => {
      this.scanning = null
    })
    return this.scanning
  }

  private async doScan(withRouter: boolean): Promise<DeviceScan> {
    const [net, records, vendors] = await Promise.all([this.deps.net(), this.load(), this.vendorTable()])
    const p = net.primary
    const routerUrl = await this.deps.routerUrl()
    const vendorOf = (mac: string): string | null => vendors.get(mac.replace(/:/g, '').slice(0, 6)) ?? null
    const now = Date.now()

    let neighbors: Neighbor[] = []
    const hintsByIp = new Map<string, DeviceHints>()
    const fixture = process.env.NET_SLEUTH_DEVICES_FIXTURE
    if (fixture) {
      neighbors = JSON.parse(await readFile(fixture, 'utf8')) as Neighbor[]
      const hintsFixture = process.env.NET_SLEUTH_DISCOVERY_FIXTURE
      if (hintsFixture) {
        for (const [ip, h] of Object.entries(JSON.parse(await readFile(hintsFixture, 'utf8')) as Record<string, DiscoveryHints>)) hintsByIp.set(ip, toHints(h))
      }
    } else if (process.platform === 'win32' && p) {
      const cidr = p.ipv4[0] ?? ''
      const localIp = cidr.split('/')[0]
      const range = cidr ? sweepRange(cidr) : null
      const inRange = new Set(range ? sweepAddresses(range) : [])
      // The neighbor sweep and the "who are you?" questions run at the same time.
      const [raw, found] = await Promise.all([
        powershell(SCAN(psArg({ alias: p.alias, gateway: p.gateway, sweep: [...inRange] })), 60_000),
        localIp && range ? discover(localIp, (ip) => inRange.has(ip), [...inRange].filter((ip) => ip !== localIp)) : Promise.resolve(new Map<string, DiscoveryHints>())
      ])
      neighbors = toArray(JSON.parse(raw || '[]') as Neighbor[])
      for (const [ip, h] of found) hintsByIp.set(ip, toHints(h))
    }

    const routerInfo = await this.readRouter(p?.gateway ?? null, withRouter)

    // The router's DNS often does not know names; the device's own mDNS name fills the gap.
    neighbors = neighbors.map((n) => (n.hostname ? n : { ...n, hostname: hintsByIp.get(n.ip)?.host ?? null }))

    const selfMac = p ? normalizeMac(p.mac) : null
    const merged = mergeScan({
      records,
      neighbors,
      self: selfMac ? { mac: selfMac, ip: p?.ipv4[0]?.split('/')[0] ?? null } : null,
      gateway: p?.gateway ?? null,
      vendorOf,
      hintsByIp,
      routerInfo,
      now
    })
    this.records = merged.records
    await this.persist()
    this.last = {
      devices: merged.devices,
      scannedAt: now,
      firstScan: merged.firstScan,
      routerUrl,
      supported: process.platform === 'win32' || !!fixture,
      router: this.router
    }
    if (merged.arrived.length && this.deps.notifyEnabled() && Notification.isSupported()) {
      const d = merged.arrived[0]
      const more = merged.arrived.length > 1 ? ` e mais ${merged.arrived.length - 1}` : ''
      const n = new Notification({
        title: 'Aparelho novo na rede',
        body: `${deviceLabel(d)}${d.type !== 'unknown' ? ` · ${TYPE_LABEL[d.type]}${d.typeConfidence === 'high' ? '' : ' (provável)'}` : ''}${d.vendor ? ` · ${d.vendor}` : ''} · ${d.ip ?? ''}${more}. Abra o net-sleuth para ver quem é.`
      })
      n.on('click', () => this.deps.onOpen())
      n.show()
    }
    this.deps.onChanged(this.last)
    return this.last
  }

  async act(action: DeviceAction): Promise<DeviceScan> {
    const records = await this.load()
    if (!records.some((r) => r.mac === action.mac)) throw new Error('Aparelho não encontrado.')
    this.records = applyAction(records, action, Date.now())
    await this.persist()
    if (!this.last) return this.scan(false)
    // Recompute the view from the last scan without touching the network again.
    const vendors = await this.vendorTable()
    const onlineIps = new Map(this.last.devices.filter((d) => d.online && d.status !== 'self').map((d) => [d.mac, d.ip]))
    const self = this.last.devices.find((d) => d.status === 'self')
    const net = await this.deps.net()
    const merged = mergeScan({
      records: this.records,
      neighbors: [...onlineIps].map(([mac, ip]) => ({ mac, ip: ip ?? '', hostname: null })),
      self: self ? { mac: self.mac, ip: self.ip } : null,
      gateway: net.primary?.gateway ?? null,
      vendorOf: (mac) => vendors.get(mac.replace(/:/g, '').slice(0, 6)) ?? null,
      now: this.last.scannedAt
    })
    const next: DeviceScan = { ...this.last, devices: merged.devices, firstScan: false }
    this.last = next
    this.deps.onChanged(next)
    return next
  }

  async openRouter(): Promise<void> {
    const url = await this.deps.routerUrl()
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('Endereço do roteador desconhecido.')
    await shell.openExternal(url)
  }

  /** Looks for new devices every few minutes while the app is open. */
  startBackground(): void {
    if (this.timer || (process.platform !== 'win32' && !process.env.NET_SLEUTH_DEVICES_FIXTURE)) return
    const tick = (): void => void this.scan(false).catch(() => undefined)
    this.timer = setTimeout(() => {
      tick()
      this.timer = setInterval(tick, BACKGROUND_MS)
    }, FIRST_BACKGROUND_MS)
  }

  stopBackground(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
