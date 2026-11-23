import { execFile } from 'node:child_process'
import { Resolver } from 'node:dns/promises'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import {
  PING_TARGETS,
  dnsPlan,
  pickPrimary,
  presetById,
  virtualLabel,
  DNS_PRESETS,
  type AdapterInfo,
  type DnsApplyRequest,
  type DnsApplyResult,
  type DnsTiming,
  type FixId,
  type FixResult,
  type Hop,
  type NetInfo,
  type PathResult,
  type PingSample,
  type PingState,
  type PingTarget
} from '@shared/network'
import { fromArg, powershell, psArg, toArray } from '../powershell'
import { linkKindOf, parseNetshWifi, parsePingTime } from './parse'

const run = promisify(execFile)

/**
 * One PowerShell call reads every connected adapter that has a default gateway, with its addresses, DNS servers,
 * DHCP state and link speed. For a Wi-Fi primary adapter it also returns the raw `netsh wlan show interfaces`
 * text, parsed on the Node side.
 */
const COLLECT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$cfgs = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' }
$out = foreach ($c in $cfgs) {
  $a = $c.NetAdapter
  $ipif = Get-NetIPInterface -InterfaceIndex $c.InterfaceIndex -AddressFamily IPv4
  $v6 = @(Get-NetIPAddress -InterfaceIndex $c.InterfaceIndex -AddressFamily IPv6 | Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -notlike 'fe80*' })
  $reg = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($a.InterfaceGuid)"
  $dohKey = "HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters\$($a.InterfaceGuid)\DohInterfaceSettings"
  $doh = @(Get-ChildItem -LiteralPath "$dohKey\Doh", "$dohKey\Doh6" | Where-Object { (Get-ItemProperty -LiteralPath $_.PSPath).DohFlags } | ForEach-Object { $_.PSChildName })
  [pscustomobject]@{
    alias = [string]$c.InterfaceAlias; description = [string]$a.InterfaceDescription
    media = [string]$a.PhysicalMediaType; speedBps = [double]$a.ReceiveLinkSpeed; mac = [string]$a.MacAddress
    ipv4 = @($c.IPv4Address | ForEach-Object { $_.IPAddress + '/' + $_.PrefixLength })
    gateway = [string](@($c.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) | Select-Object -First 1)
    dns = @(Get-DnsClientServerAddress -InterfaceIndex $c.InterfaceIndex -AddressFamily IPv4 | ForEach-Object { $_.ServerAddresses })
    dnsStatic = [bool]$reg.NameServer
    dhcp = ([string]$ipif.Dhcp -eq 'Enabled'); ipv6 = ($v6.Count -gt 0); metric = [int]$ipif.InterfaceMetric
    dhcpDns = @(([string]$reg.DhcpNameServer) -split '[ ,]+' | Where-Object { $_ })
    doh = $doh; guid = [string]$a.InterfaceGuid; hardware = [bool]$a.HardwareInterface
  }
}
$hasWifi = [bool](Get-NetAdapter | Where-Object { $_.PhysicalMediaType -match '802\.11' })
$wifiText = $null
if ($cfgs | Where-Object { $_.NetAdapter.PhysicalMediaType -match '802\.11' }) { $wifiText = (netsh wlan show interfaces) -join [char]10 }
$dohSupported = [bool](Get-Command Get-DnsClientDohServerAddress)
ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{ adapters = @($out); hasWifi = $hasWifi; wifiText = $wifiText; dohSupported = $dohSupported })
`

/**
 * Points the adapter at new DNS servers (or back to the router's) and sets DNS over HTTPS for it the way the
 * Windows 11 Settings app does: each encrypted server gets a DohFlags = 1 key ("encrypted only") under the
 * adapter's DohInterfaceSettings. Servers Windows does not know yet are registered with their DoH address first.
 */
const APPLY_DNS = (arg: string): string => String.raw`
$ErrorActionPreference = 'Stop'
$req = ${fromArg(arg)}
if (@($req.servers).Count -eq 0) { Set-DnsClientServerAddress -InterfaceAlias $req.alias -ResetServerAddresses }
else { Set-DnsClientServerAddress -InterfaceAlias $req.alias -ServerAddresses @($req.servers) }
$base = "HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters\$($req.guid)\DohInterfaceSettings"
if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force }
foreach ($s in @($req.doh)) {
  if (-not $s) { continue }
  if (-not (Get-DnsClientDohServerAddress -ServerAddress $s.ip -ErrorAction SilentlyContinue)) {
    Add-DnsClientDohServerAddress -ServerAddress $s.ip -DohTemplate $s.template -AllowFallbackToUdp $false -AutoUpgrade $true | Out-Null
  }
  $key = if ($s.ip -like '*:*') { "$base\Doh6\$($s.ip)" } else { "$base\Doh\$($s.ip)" }
  New-Item -Path $key -Force | Out-Null
  New-ItemProperty -LiteralPath $key -Name DohFlags -PropertyType QWord -Value 1 -Force | Out-Null
}
Clear-DnsClientCache
`

interface RawAdapter extends Omit<AdapterInfo, 'kind' | 'virtualOf'> {
  media: string
  metric: number
  guid: string
  hardware: boolean
}

type FullAdapter = AdapterInfo & { metric: number; guid: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** One ping with ping.exe (no admin needed, unlike raw ICMP sockets). Resolves to ms or null. */
async function pingOnce(host: string, timeoutMs = 1000): Promise<number | null> {
  const args = process.platform === 'win32' ? ['-n', '1', '-w', String(timeoutMs), host] : ['-c', '1', '-W', String(Math.ceil(timeoutMs / 1000)), host]
  try {
    const { stdout } = await run('ping', args, { windowsHide: true, timeout: timeoutMs + 2000, encoding: 'latin1' })
    return parsePingTime(stdout)
  } catch (err) {
    // ping exits with an error code on timeouts; its output still says why.
    const out = (err as { stdout?: string }).stdout
    return out ? parsePingTime(out) : null
  }
}

/** Time to resolve a name through the PC's own DNS servers (not the OS cache, which would answer instantly). */
async function lookupTime(name: string, servers: string[]): Promise<number | null> {
  const resolver = new Resolver({ timeout: 2000, tries: 1 })
  if (servers.length) resolver.setServers(servers)
  const t0 = performance.now()
  try {
    await resolver.resolve4(name)
    return performance.now() - t0
  } catch {
    return null
  }
}

export interface NetworkDeps {
  isAdmin: () => Promise<boolean>
  confirm: (options: Electron.MessageBoxOptions) => Promise<boolean>
  onSample: (sample: PingSample) => void
}

const MAX_SAMPLES = 60
const DNS_PROBE = 'www.google.com'
const INTERNET_PROBE = '1.1.1.1'
/** Popular names, so the timing measures the trip to the server and not its lookup of a rare name. */
const DNS_TIMING_NAMES = ['www.google.com', 'www.youtube.com', 'www.wikipedia.org']

export class NetworkService {
  private lastInfo: NetInfo | null = null
  /** The primary adapter's GUID, needed for its DNS over HTTPS registry keys. */
  private primaryGuid: string | null = null
  private ping: PingState = { running: false, target: '1.1.1.1', gateway: null, samples: [] }
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(private deps: NetworkDeps) {}

  async info(): Promise<NetInfo> {
    const fixture = process.env.NET_SLEUTH_FIXTURE
    if (fixture) {
      const base: NetInfo = { primary: null, others: [], virtual: [], wifi: null, hasWifiAdapter: false, wifiBlocked: false, dohSupported: true, supported: true, readAt: 0 }
      this.lastInfo = { ...base, ...(JSON.parse(readFileSync(fixture, 'utf8')) as Partial<NetInfo>), readAt: Date.now() }
      this.primaryGuid = '{fixture}'
      return this.lastInfo
    }
    if (process.platform !== 'win32') {
      this.lastInfo = {
        primary: null,
        others: [],
        virtual: [],
        wifi: null,
        hasWifiAdapter: false,
        wifiBlocked: false,
        dohSupported: false,
        supported: false,
        readAt: Date.now()
      }
      return this.lastInfo
    }
    const raw = JSON.parse((await powershell(COLLECT, 30_000)) || '{}') as Record<string, unknown>
    const adapters: FullAdapter[] = toArray(raw.adapters as RawAdapter[]).map((a) => ({
      alias: str(a.alias),
      description: str(a.description),
      kind: linkKindOf(str(a.media)),
      speedBps: Number(a.speedBps) || 0,
      mac: str(a.mac).replace(/-/g, ':'),
      ipv4: toArray(a.ipv4).map(String),
      gateway: str(a.gateway) || null,
      dns: toArray(a.dns).map(String),
      dnsStatic: a.dnsStatic === true,
      dhcp: a.dhcp === true,
      ipv6: a.ipv6 === true,
      dhcpDns: toArray(a.dhcpDns).map(String),
      doh: toArray(a.doh).map(String),
      virtualOf: virtualLabel(str(a.description), str(a.alias), a.hardware !== false),
      metric: Number(a.metric) || 9999,
      guid: str(a.guid)
    }))
    const main = pickPrimary(adapters)
    this.primaryGuid = main?.guid ?? null
    const strip = ({ metric: _m, guid: _g, ...rest }: FullAdapter): AdapterInfo => rest
    const rest = adapters.filter((a) => a !== main).sort((a, b) => a.metric - b.metric)
    const primary = main ? strip(main) : null
    const wifi = primary?.kind === 'wifi' ? parseNetshWifi(str(raw.wifiText)) : null
    this.lastInfo = {
      primary,
      others: rest.filter((a) => !a.virtualOf).map(strip),
      virtual: rest.filter((a) => a.virtualOf).map(strip),
      wifi,
      hasWifiAdapter: raw.hasWifi === true,
      wifiBlocked: primary?.kind === 'wifi' && !wifi,
      dohSupported: raw.dohSupported === true,
      supported: true,
      readAt: Date.now()
    }
    return this.lastInfo
  }

  private async gateway(): Promise<string | null> {
    return (this.lastInfo ?? (await this.info())).primary?.gateway ?? null
  }

  /** Router, DNS and internet, measured at the same time. */
  async path(): Promise<PathResult> {
    const info = this.lastInfo ?? (await this.info())
    const gw = info.primary?.gateway ?? null
    const [router, dns, internet] = await Promise.all([
      gw ? pingOnce(gw) : Promise.resolve(null),
      lookupTime(DNS_PROBE, info.primary?.dns ?? []),
      pingOnce(INTERNET_PROBE)
    ])
    const hop = (id: Hop['id'], ms: number | null, target: string): Hop => ({ id, ok: ms !== null, ms, target })
    return {
      checkedAt: Date.now(),
      hops: [hop('router', router, gw ?? '—'), hop('dns', dns, DNS_PROBE), hop('internet', internet, INTERNET_PROBE)]
    }
  }

  // ---------- fixes ----------

  private async needAdmin(): Promise<void> {
    if (!(await this.deps.isAdmin())) {
      throw new Error('Este conserto pede o modo administrador: use "Reabrir como admin" no menu e tente de novo.')
    }
  }

  async fix(id: FixId): Promise<FixResult> {
    const alias = (this.lastInfo ?? (await this.info())).primary?.alias
    switch (id) {
      case 'flushDns':
        await run('ipconfig', ['/flushdns'], { windowsHide: true, timeout: 15_000 })
        return { done: true, ok: true, message: 'Cache de DNS limpo.' }
      case 'renewIp': {
        if (!alias) throw new Error('Nenhuma conexão ativa para renovar.')
        try {
          await run('ipconfig', ['/renew', alias], { windowsHide: true, timeout: 60_000 })
        } catch {
          throw new Error('O roteador não respondeu ao pedido de endereço novo. Confira o cabo ou o Wi-Fi, ou tente como administrador.')
        }
        const info = await this.info()
        return { done: true, ok: true, message: `Novo endereço: ${info.primary?.ipv4[0]?.split('/')[0] ?? '—'}` }
      }
      case 'restartAdapter': {
        if (!alias) throw new Error('Nenhuma placa de rede conectada.')
        await this.needAdmin()
        const ok = await this.deps.confirm({
          type: 'question',
          title: 'Reiniciar a placa de rede',
          message: `Reiniciar "${alias}"?`,
          detail: 'A conexão cai por alguns segundos, como tirar o cabo e pôr de novo.',
          buttons: ['Reiniciar placa', 'Cancelar']
        })
        if (!ok) return { done: false, ok: false, message: '' }
        await powershell(`$ErrorActionPreference = 'Stop'\nRestart-NetAdapter -Name ${fromArg(psArg(alias))} -Confirm:$false`, 60_000)
        return { done: true, ok: true, message: 'Placa reiniciada.' }
      }
      case 'resetNetwork': {
        await this.needAdmin()
        const ok = await this.deps.confirm({
          type: 'warning',
          title: 'Redefinir a rede do Windows',
          message: 'Redefinir as configurações de rede do Windows?',
          detail:
            'Volta a pilha de rede ao padrão de fábrica. Configurações de VPN e adaptadores virtuais podem precisar ser refeitas, ' +
            'e o PC precisa reiniciar para concluir. Use quando os outros consertos não resolverem.',
          buttons: ['Redefinir', 'Cancelar']
        })
        if (!ok) return { done: false, ok: false, message: '' }
        await run('netsh', ['winsock', 'reset'], { windowsHide: true, timeout: 60_000 })
        await run('netsh', ['int', 'ip', 'reset'], { windowsHide: true, timeout: 60_000 })
        return { done: true, ok: true, message: 'Rede redefinida. Reinicie o PC para concluir.', needsRestart: true }
      }
    }
  }

  // ---------- DNS ----------

  /** Median of a few lookups through each preset's first server; the router's for "Automático". */
  async dnsMeasure(): Promise<DnsTiming[]> {
    const p = (this.lastInfo ?? (await this.info())).primary
    const routerDns = p ? (p.dnsStatic ? p.dhcpDns[0] : p.dns[0]) ?? p.gateway : null
    return Promise.all(
      DNS_PRESETS.map(async (preset): Promise<DnsTiming> => {
        const server = preset.id === 'auto' ? routerDns ?? null : preset.v4[0]
        if (!server) return { id: preset.id, ms: null, server }
        const times: number[] = []
        for (const name of DNS_TIMING_NAMES) {
          const ms = await lookupTime(name, [server])
          if (ms !== null) times.push(ms)
        }
        times.sort((a, b) => a - b)
        return { id: preset.id, ms: times.length ? times[Math.floor(times.length / 2)] : null, server }
      })
    )
  }

  async dnsApply(req: DnsApplyRequest): Promise<DnsApplyResult> {
    const info = this.lastInfo ?? (await this.info())
    const p = info.primary
    if (!p || !this.primaryGuid) throw new Error('Nenhuma conexão ativa para ajustar.')
    if (!(await this.deps.isAdmin())) {
      throw new Error('Trocar o DNS pede o modo administrador: use "Reabrir como admin" e tente de novo.')
    }
    const preset = presetById(req.preset)
    const encrypted = req.encrypted && !!preset.dohTemplate && info.dohSupported
    const plan = dnsPlan({ preset: req.preset, encrypted }, p.ipv6)
    const ok = await this.deps.confirm({
      type: 'question',
      title: 'Trocar o DNS',
      message:
        req.preset === 'auto'
          ? `Voltar "${p.alias}" ao DNS do roteador?`
          : `Usar ${preset.name}${encrypted ? ', criptografado,' : ''} em "${p.alias}"?`,
      detail: 'A troca vale na hora e não derruba a conexão. Dá para voltar ao automático a qualquer momento.',
      buttons: ['Trocar', 'Cancelar']
    })
    if (!ok) return { done: false, message: '' }
    if (process.env.NET_SLEUTH_FIXTURE) return { done: true, message: 'Simulação: nada foi alterado.' }
    await powershell(APPLY_DNS(psArg({ alias: p.alias, guid: this.primaryGuid, servers: plan.servers, doh: plan.doh })), 60_000)
    await this.info()
    return {
      done: true,
      message:
        req.preset === 'auto'
          ? 'Pronto: o PC voltou a usar o DNS do roteador.'
          : `Pronto: usando ${preset.name}${encrypted ? ' com criptografia' : ''}.`
    }
  }

  // ---------- live ping ----------

  get pingState(): PingState {
    return this.ping
  }

  async startPing(target: PingTarget): Promise<PingState> {
    if (!PING_TARGETS.includes(target)) throw new Error('Destino inválido.')
    if (target !== this.ping.target) this.ping = { ...this.ping, target, samples: [] }
    this.ping = { ...this.ping, running: true, gateway: await this.gateway() }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), 1000)
      void this.tick()
    }
    return this.ping
  }

  stopPing(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.ping = { ...this.ping, running: false }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return // a slow round (timeouts) never stacks up
    this.ticking = true
    try {
      const gw = this.ping.gateway
      const [router, internet] = await Promise.all([gw ? pingOnce(gw, 900) : Promise.resolve(null), pingOnce(this.ping.target, 900)])
      const sample: PingSample = { t: Date.now(), router, internet }
      this.ping = { ...this.ping, samples: [...this.ping.samples, sample].slice(-MAX_SAMPLES) }
      this.deps.onSample(sample)
    } finally {
      this.ticking = false
    }
  }
}
