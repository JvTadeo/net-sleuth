/**
 * Network types shared by the main process and the window, plus the pure logic that judges them
 * (verdicts and diagnosis). No Node or DOM here, so every side and the tests can use it.
 */

export type LinkKind = 'ethernet' | 'wifi' | 'other'

export interface WifiDetails {
  ssid: string | null
  /** 0–100, as Windows reports it. */
  signal: number | null
  channel: number | null
  /** "2,4 GHz", "5 GHz", "6 GHz", worked out from the channel. */
  band: string | null
  /** Authentication as Windows names it, e.g. "WPA2-Personal". */
  auth: string | null
}

export interface AdapterInfo {
  /** Windows' name for it, e.g. "Ethernet" or "Wi-Fi". */
  alias: string
  /** The hardware, e.g. "Realtek PCIe GbE Family Controller". */
  description: string
  kind: LinkKind
  /** Link speed in bits per second (0 when unknown). */
  speedBps: number
  mac: string
  /** "192.168.0.12/24". */
  ipv4: string[]
  gateway: string | null
  dns: string[]
  /** DNS servers typed by hand instead of handed out by the router. */
  dnsStatic: boolean
  dhcp: boolean
  ipv6: boolean
  /** DNS servers the router hands out, even while hand-typed ones are in use. */
  dhcpDns: string[]
  /** Servers this adapter talks to over DNS over HTTPS (Windows 11 per-adapter setting). */
  doh: string[]
  /** Set for a VPN or virtual adapter: the program behind it ("Radmin VPN") or a generic label. */
  virtualOf: string | null
}

export interface NetInfo {
  /** The adapter that carries internet traffic (the one with a default gateway and the best metric). */
  primary: AdapterInfo | null
  /** Other connected physical adapters with a gateway (a second card). */
  others: AdapterInfo[]
  /** Connected VPN and virtual adapters (Radmin, Hamachi, VirtualBox…). Never chosen as primary while a real one exists. */
  virtual: AdapterInfo[]
  /** Windows can encrypt DNS per adapter (Windows 11 and later). */
  dohSupported: boolean
  /** Wi-Fi details for the primary adapter, when it is Wi-Fi and Windows let us read them. */
  wifi: WifiDetails | null
  /** The PC has a Wi-Fi adapter at all (connected or not). */
  hasWifiAdapter: boolean
  /** The primary adapter is Wi-Fi but its details could not be read (Windows 11 24H2 asks for location access). */
  wifiBlocked: boolean
  supported: boolean
  readAt: number
}

export type HopId = 'router' | 'dns' | 'internet'

export interface Hop {
  id: HopId
  ok: boolean
  /** Round trip (ping) or lookup time, in ms; null when it failed. */
  ms: number | null
  /** What was asked: the gateway address, the name looked up, the internet host. */
  target: string
}

export interface PathResult {
  hops: Hop[]
  checkedAt: number
}

export type FixId = 'flushDns' | 'renewIp' | 'restartAdapter' | 'resetNetwork'

export interface FixResult {
  /** False when the user cancelled the confirmation. */
  done: boolean
  ok: boolean
  /** One line for the user, in Portuguese. */
  message: string
  /** The PC must restart to finish (network reset). */
  needsRestart?: boolean
}

export const PING_TARGETS = ['1.1.1.1', '8.8.8.8', 'google.com'] as const
export type PingTarget = (typeof PING_TARGETS)[number]

export interface PingSample {
  t: number
  /** ms, or null when that ping got no answer. */
  router: number | null
  internet: number | null
}

export interface PingState {
  running: boolean
  target: PingTarget
  gateway: string | null
  /** Up to the last 60 samples, oldest first. */
  samples: PingSample[]
}

// ---------- pure logic ----------

/** Bits per second to "1 Gbps", "866 Mbps". */
export function formatSpeed(bps: number): string {
  if (!bps) return '—'
  if (bps >= 1e9) return `${+(bps / 1e9).toFixed(1)} Gbps`.replace('.', ',')
  return `${Math.round(bps / 1e6)} Mbps`
}

/** Wi-Fi band from the channel number. */
export function bandOf(channel: number | null): string | null {
  if (channel === null) return null
  if (channel >= 1 && channel <= 14) return '2,4 GHz'
  if (channel >= 32 && channel <= 177) return '5 GHz'
  return null
}

/** Addresses Windows gives itself when no router answers (169.254.x.x). */
export function isSelfAssigned(ipv4: string): boolean {
  return ipv4.startsWith('169.254.')
}

export interface Stats {
  avg: number | null
  max: number | null
  /** 0–1 */
  loss: number
  /** Mean absolute change between consecutive answers. */
  jitter: number | null
  count: number
}

export function statsOf(values: (number | null)[]): Stats {
  const answered = values.filter((v): v is number => v !== null)
  const count = values.length
  if (!answered.length) return { avg: null, max: null, loss: count ? 1 : 0, jitter: null, count }
  const avg = answered.reduce((a, v) => a + v, 0) / answered.length
  let jitter = 0
  for (let i = 1; i < answered.length; i++) jitter += Math.abs(answered[i] - answered[i - 1])
  return {
    avg,
    max: Math.max(...answered),
    loss: (count - answered.length) / count,
    jitter: answered.length > 1 ? jitter / (answered.length - 1) : null,
    count
  }
}

export type VerdictKind = 'waiting' | 'ok' | 'isp' | 'home' | 'internetDown' | 'routerDown'

/**
 * Where the problem is, from the two ping series. The router line is the reference: if it is slow or losing
 * packets, the problem is inside the home (cable, Wi-Fi, router); if only the internet line is, it is the provider.
 */
export function pingVerdict(samples: PingSample[]): VerdictKind {
  if (samples.length < 5) return 'waiting'
  const recent = samples.slice(-20)
  const r = statsOf(recent.map((s) => s.router))
  const n = statsOf(recent.map((s) => s.internet))
  // Some routers ignore ping: no router answers while the internet answers means "router silent", not "down".
  const routerSilent = r.loss >= 0.8 && n.loss < 0.8
  if (r.loss >= 0.8 && !routerSilent) return 'routerDown'
  if (!routerSilent && (r.loss > 0.05 || (r.avg ?? 0) > 20 || (r.jitter ?? 0) > 15)) return 'home'
  if (n.loss >= 0.8) return 'internetDown'
  if (n.loss > 0.03 || (n.avg ?? 0) > 80 || (n.jitter ?? 0) > 30) return 'isp'
  return 'ok'
}

export type DiagStepId = 'adapter' | 'address' | 'router' | 'dns' | 'internet'

export interface DiagStep {
  id: DiagStepId
  ok: boolean
  /** Short measured value: "1 Gbps", "DHCP", "2 ms". */
  value: string
}

export interface Diagnosis {
  steps: DiagStep[]
  /** The first step that failed, if any. */
  failed: DiagStepId | null
  /** The fix that makes sense for it. */
  suggestion: FixId | null
}

/** Walks the path step by step and stops at the first broken link. */
export function diagnose(info: NetInfo, path: PathResult | null): Diagnosis {
  const p = info.primary
  const hop = (id: HopId): Hop | undefined => path?.hops.find((h) => h.id === id)
  const ms = (h: Hop | undefined): string => (h?.ms === null || h?.ms === undefined ? 'sem resposta' : h.ms < 1 ? '<1 ms' : `${Math.round(h.ms)} ms`)
  const ip = p?.ipv4[0]?.split('/')[0]
  const steps: DiagStep[] = [
    { id: 'adapter', ok: !!p, value: p ? formatSpeed(p.speedBps) : 'desconectada' },
    { id: 'address', ok: !!ip && !isSelfAssigned(ip), value: !ip ? 'sem endereço' : isSelfAssigned(ip) ? 'automático (169.254)' : p?.dhcp ? 'DHCP' : 'fixo' },
    // A router that ignores ping still works when the internet answers through it.
    {
      id: 'router',
      ok: !!hop('router')?.ok || !!hop('internet')?.ok,
      value: hop('router')?.ok || !hop('internet')?.ok ? ms(hop('router')) : 'não responde a ping'
    },
    { id: 'dns', ok: !!hop('dns')?.ok, value: ms(hop('dns')) },
    { id: 'internet', ok: !!hop('internet')?.ok, value: ms(hop('internet')) }
  ]
  const failed = steps.find((s) => !s.ok)?.id ?? null
  const suggestion: Record<DiagStepId, FixId | null> = {
    adapter: 'restartAdapter',
    address: 'renewIp',
    router: 'restartAdapter',
    dns: 'flushDns',
    internet: null
  }
  return { steps, failed, suggestion: failed ? suggestion[failed] : null }
}

// ---------- VPN and virtual adapters ----------

const VIRTUAL_NAMES: [RegExp, string][] = [
  [/radmin/i, 'Radmin VPN'],
  [/hamachi/i, 'Hamachi'],
  [/zerotier/i, 'ZeroTier'],
  [/tailscale/i, 'Tailscale'],
  [/wireguard/i, 'WireGuard'],
  [/tap-windows|openvpn/i, 'OpenVPN'],
  [/anyconnect|cisco/i, 'Cisco VPN'],
  [/fortinet|forticlient/i, 'FortiClient'],
  [/nordlynx|nordvpn/i, 'NordVPN'],
  [/virtualbox/i, 'VirtualBox'],
  [/vmware/i, 'VMware'],
  [/\(wsl/i, 'WSL'],
  [/hyper-v|vethernet/i, 'Hyper-V'],
  [/vpn|tunnel|wintun|virtual|tap adapter/i, 'VPN ou virtual']
]

/** Which program a network adapter belongs to, or null for a real card. `hardware` is Get-NetAdapter's HardwareInterface. */
export function virtualLabel(description: string, alias: string, hardware = true): string | null {
  const text = `${description} ${alias}`
  for (const [re, label] of VIRTUAL_NAMES) if (re.test(text)) return label
  return hardware ? null : 'VPN ou virtual'
}

/**
 * The adapter that carries internet traffic: the real card with the best route metric. VPN tools such as Radmin
 * force their own metric to 1, so a virtual adapter only wins when no real one is connected.
 */
export function pickPrimary<T extends { virtualOf: string | null; metric: number }>(adapters: T[]): T | null {
  const sorted = [...adapters].sort((a, b) => a.metric - b.metric)
  return sorted.find((a) => !a.virtualOf) ?? sorted[0] ?? null
}

// ---------- DNS ----------

export type DnsPresetId = 'auto' | 'cloudflare' | 'google' | 'quad9'

export interface DnsPreset {
  id: DnsPresetId
  name: string
  v4: string[]
  v6: string[]
  note: string
  /** DNS over HTTPS address; Windows 11 already knows these three. */
  dohTemplate: string | null
}

export const DNS_PRESETS: DnsPreset[] = [
  { id: 'auto', name: 'Automático', v4: [], v6: [], note: 'O que o roteador entrega. Costuma ser o DNS da operadora.', dohTemplate: null },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    v4: ['1.1.1.1', '1.0.0.1'],
    v6: ['2606:4700:4700::1111', '2606:4700:4700::1001'],
    note: 'Rápido e focado em privacidade. Não guarda seu endereço IP.',
    dohTemplate: 'https://cloudflare-dns.com/dns-query'
  },
  {
    id: 'google',
    name: 'Google',
    v4: ['8.8.8.8', '8.8.4.4'],
    v6: ['2001:4860:4860::8888', '2001:4860:4860::8844'],
    note: 'Muito estável e rápido no Brasil.',
    dohTemplate: 'https://dns.google/dns-query'
  },
  {
    id: 'quad9',
    name: 'Quad9',
    v4: ['9.9.9.9', '149.112.112.112'],
    v6: ['2620:fe::fe', '2620:fe::9'],
    note: 'Bloqueia sites conhecidos por golpes e vírus.',
    dohTemplate: 'https://dns.quad9.net/dns-query'
  }
]

export const DNS_PRESET_IDS = DNS_PRESETS.map((p) => p.id)

export const presetById = (id: DnsPresetId): DnsPreset => DNS_PRESETS.find((p) => p.id === id)!

/** Which preset the adapter uses now; "custom" for hand-typed servers that match none. */
export function currentPreset(a: Pick<AdapterInfo, 'dns' | 'dnsStatic'>): DnsPresetId | 'custom' {
  if (!a.dnsStatic) return 'auto'
  const first = a.dns.find((d) => !d.includes(':'))
  const hit = DNS_PRESETS.find((p) => first && p.v4.includes(first))
  return hit?.id ?? 'custom'
}

/** DNS over HTTPS is on when every IPv4 server in use is encrypted. */
export function dnsEncrypted(a: Pick<AdapterInfo, 'dns' | 'doh'>): boolean {
  const v4 = a.dns.filter((d) => !d.includes(':'))
  return v4.length > 0 && v4.every((d) => a.doh.includes(d))
}

export interface DnsApplyRequest {
  preset: DnsPresetId
  encrypted: boolean
}

export interface DnsPlan {
  /** Empty = back to the router's servers. */
  servers: string[]
  /** Servers to encrypt, each with its DoH address. */
  doh: { ip: string; template: string }[]
}

/** What to write for a choice. IPv6 servers only go in when the adapter uses IPv6. */
export function dnsPlan(req: DnsApplyRequest, ipv6: boolean): DnsPlan {
  const p = presetById(req.preset)
  const servers = [...p.v4, ...(ipv6 ? p.v6 : [])]
  const doh = req.encrypted && p.dohTemplate ? servers.map((ip) => ({ ip, template: p.dohTemplate! })) : []
  return { servers, doh }
}

export interface DnsTiming {
  id: DnsPresetId
  /** Median lookup time in ms; null when the server did not answer. */
  ms: number | null
  /** The server asked. */
  server: string | null
}

export interface DnsApplyResult {
  done: boolean
  message: string
}
