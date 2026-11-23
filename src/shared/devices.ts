/**
 * Devices on the local network ("Aparelhos"): types and the pure logic that merges what Windows sees with what the
 * user told the app (names, known, blocked). No Node or DOM here, so the tests run it as is.
 */

export type DeviceStatus = 'self' | 'router' | 'new' | 'known' | 'blocked'

export type DeviceType =
  | 'router'
  | 'computer'
  | 'laptop'
  | 'phone'
  | 'tablet'
  | 'tv'
  | 'streamer'
  | 'console'
  | 'printer'
  | 'speaker'
  | 'camera'
  | 'smarthome'
  | 'nas'
  | 'unknown'

export const DEVICE_TYPES: readonly DeviceType[] = [
  'phone',
  'tablet',
  'laptop',
  'computer',
  'tv',
  'streamer',
  'console',
  'speaker',
  'printer',
  'camera',
  'smarthome',
  'nas',
  'router',
  'unknown'
]

export const TYPE_LABEL: Record<DeviceType, string> = {
  router: 'Roteador ou repetidor',
  computer: 'Computador',
  laptop: 'Notebook',
  phone: 'Celular',
  tablet: 'Tablet',
  tv: 'TV',
  streamer: 'Aparelho de streaming',
  console: 'Videogame',
  printer: 'Impressora',
  speaker: 'Caixa de som ou assistente',
  camera: 'Câmera',
  smarthome: 'Casa inteligente',
  nas: 'Armazenamento (NAS)',
  unknown: 'Desconhecido'
}

/** What a device announced about itself on the network (mDNS/Bonjour and UPnP), merged. */
export interface DeviceHints {
  friendlyName: string | null
  model: string | null
  manufacturer: string | null
  /** mDNS service types, "_googlecast._tcp". */
  services: string[]
  /** UPnP device type, "MediaRenderer". */
  upnpType: string | null
  /** UPnP SERVER header. */
  server: string | null
  /** The device's own name over mDNS ("iPhone-de-Joao", "DESKTOP-7QK2M1A"). */
  host?: string | null
}

export type TypeConfidence = 'high' | 'medium' | 'low'

export interface TypeGuess {
  type: DeviceType
  confidence: TypeConfidence
  /** Why, in Portuguese: "anuncia Google Cast", "pelo nome na rede"… */
  reason: string
}

/** What the app remembers about a device, keyed by MAC address. */
export interface DeviceRecord {
  mac: string
  name: string | null
  status: 'new' | 'known' | 'blocked'
  firstSeen: number
  lastSeen: number
  lastIp: string | null
  hostname: string | null
  blockedAt: number | null
  /** The type the user chose; null = use the app's guess. */
  type?: DeviceType | null
  /** Last thing the device announced about itself, kept so it still shows while it is away. */
  hints?: DeviceHints | null
  /** The name the router knows (from DHCP), read from its panel when the user turned that on. */
  routerName?: string | null
  /** System the router reports: "Android", "iOS", "Windows"… */
  os?: string | null
}

/** What the router's own list says about one device. */
export interface RouterInfo {
  hostname: string | null
  os: string | null
}

export type RouterReadState = 'unsupported' | 'off' | 'noPassword' | 'ok' | 'busy' | 'auth' | 'error'

export interface RouterReadStatus {
  state: RouterReadState
  /** "TP-Link EX/Aginet" when the router speaks a panel the app can read. */
  model: string | null
  lastRead: number | null
  message: string | null
}

/** A neighbor Windows confirmed on the network just now. */
export interface Neighbor {
  ip: string
  mac: string
  hostname: string | null
}

export interface Device {
  mac: string
  ip: string | null
  /** The name the user gave, else null. */
  name: string | null
  /** The name the device announces on the network, when the router knows it. */
  hostname: string | null
  vendor: string | null
  /** Randomized address (phones do this per network), so the manufacturer cannot be known. */
  privateMac: boolean
  status: DeviceStatus
  online: boolean
  firstSeen: number
  lastSeen: number
  blockedAt: number | null
  type: DeviceType
  /** "user" when the user chose the type, else the app's guess with its confidence. */
  typeSource: 'user' | 'auto'
  typeConfidence: TypeConfidence
  typeReason: string
  /** Model the device announced ("Chromecast", "UN55TU7000", "AppleTV11,1"). */
  model: string | null
  /** The name the device gave itself ("Sala de Estar", "[TV] Samsung 7 Series"). */
  friendlyName: string | null
  /** System the router reports ("Android", "Windows"…). */
  os: string | null
}

export interface DeviceScan {
  devices: Device[]
  scannedAt: number
  /** The very first look at this network: everything shows as new until the user sorts it out. */
  firstScan: boolean
  /** Router panel address, from "Senhas e QR" or the gateway. */
  routerUrl: string | null
  supported: boolean
  /** Reading names from the router's panel. */
  router: RouterReadStatus
}

export type DeviceAction =
  | { op: 'rename'; mac: string; name: string }
  | { op: 'known'; mac: string }
  | { op: 'blocked'; mac: string }
  | { op: 'unblock'; mac: string }
  | { op: 'forget'; mac: string }
  | { op: 'setType'; mac: string; type: DeviceType | null }

export const DEVICE_OPS = ['rename', 'known', 'blocked', 'unblock', 'forget', 'setType'] as const

// ---------- addresses ----------

/** "2c-f0-5d-8a-14-3e" or "2C:F0:5D:8A:14:3E" → "2C:F0:5D:8A:14:3E"; null when it is not a MAC. */
export function normalizeMac(raw: string): string | null {
  const hex = raw.replace(/[^0-9a-f]/gi, '').toUpperCase()
  if (hex.length !== 12) return null
  return hex.match(/../g)!.join(':')
}

/** Locally administered bit set: a randomized "private" address, as phones and laptops use per network. */
export function isPrivateMac(mac: string): boolean {
  const first = parseInt(mac.slice(0, 2), 16)
  return !Number.isNaN(first) && (first & 0b10) !== 0
}

const ipToInt = (ip: string): number => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0
const intToIp = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')

/** Home network ranges (RFC 1918). The app never sweeps addresses outside them. */
export function isPrivateIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** A neighbor entry worth showing: a real device address, not broadcast or multicast. */
export function isUsableNeighbor(ip: string, mac: string): boolean {
  const first = Number(ip.split('.')[0])
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || first >= 224 || ip.endsWith('.255') || ip.endsWith('.0')) return false
  const m = normalizeMac(mac)
  if (!m || m === '00:00:00:00:00:00' || m === 'FF:FF:FF:FF:FF:FF') return false
  return (parseInt(m.slice(0, 2), 16) & 1) === 0 // multicast MACs have the lowest bit of the first byte set
}

/**
 * The addresses to ping so Windows learns who is around: the PC's own subnet, capped at its /24 (254 addresses),
 * and only on home network ranges.
 */
export function sweepRange(cidr: string): { first: string; last: string; count: number } | null {
  const [ip, prefixText] = cidr.split('/')
  const prefix = Math.max(Number(prefixText) || 24, 24)
  if (!ip || !isPrivateIp(ip) || prefix > 30) return null
  const size = 2 ** (32 - prefix)
  const network = ipToInt(ip) & ~(size - 1)
  return { first: intToIp(network + 1), last: intToIp(network + size - 2), count: size - 2 }
}

/** Every address in a sweep range, in order. */
export function sweepAddresses(range: { first: string; last: string }): string[] {
  const out: string[] = []
  for (let n = ipToInt(range.first); n <= ipToInt(range.last); n++) out.push(intToIp(n))
  return out
}

/** The router's client type and DHCP vendor class → a system name. */
export function osOf(clientType: string | null, vendorClass: string | null): string | null {
  const t = `${clientType ?? ''} ${vendorClass ?? ''}`.toLowerCase()
  if (/android/.test(t)) return 'Android'
  if (/\bios\b|iphone|ipad/.test(t)) return 'iOS'
  if (/windows|msft/.test(t)) return 'Windows'
  if (/mac ?os|macintosh|osx/.test(t)) return 'macOS'
  if (/linux|dhcpcd|udhcp/.test(t)) return 'Linux'
  return null
}

// ---------- device type ----------

const has = (re: RegExp, ...texts: (string | null | undefined)[]): boolean => texts.some((t) => !!t && re.test(t))

const TV_BRANDS = /\b(tv|bravia|webos|tizen|android ?tv|smart ?tv|samsung|lg electronics|tcl|hisense|philips|aoc|semp|panasonic|vizio|sharp)\b/i

/**
 * The most likely kind of device, from the strongest evidence available: what it announces on the network (high
 * confidence), the name it gives the router (medium), then the manufacturer or a private address (low).
 */
export function guessType(d: {
  status: DeviceStatus
  vendor: string | null
  hostname: string | null
  privateMac: boolean
  hints: DeviceHints | null
  os?: string | null
}): TypeGuess {
  const high = (type: DeviceType, reason: string): TypeGuess => ({ type, confidence: 'high', reason })
  const medium = (type: DeviceType, reason: string): TypeGuess => ({ type, confidence: 'medium', reason })
  const low = (type: DeviceType, reason: string): TypeGuess => ({ type, confidence: 'low', reason })

  if (d.status === 'self') return high('computer', 'este PC')
  if (d.status === 'router') return high('router', 'é o roteador da rede')

  const h = d.hints
  const svc = new Set(h?.services ?? [])
  const s = (name: string): boolean => svc.has(name)
  const model = h?.model ?? ''
  const all = [h?.friendlyName, h?.model, h?.manufacturer, h?.server, h?.upnpType].filter(Boolean).join(' ')

  // ---- what the device announces ----
  if (h) {
    if (has(/InternetGatewayDevice|WANDevice|WANConnectionDevice/i, h.upnpType)) return high('router', 'anuncia que é roteador (UPnP)')
    if (s('_ipp._tcp') || s('_ipps._tcp') || s('_printer._tcp') || s('_pdl-datastream._tcp') || has(/printer/i, h.upnpType))
      return high('printer', 'anuncia serviço de impressão')
    if (has(/xbox|playstation|ps[345]\b|nintendo/i, all)) return high('console', 'anuncia que é videogame')
    if (s('_googlecast._tcp')) {
      if (has(/chromecast|google tv/i, all)) return high('streamer', 'anuncia Google Cast (Chromecast)')
      if (has(/nest hub|home hub/i, all)) return high('smarthome', 'anuncia Google Cast (Nest Hub)')
      if (has(/google home|nest (mini|audio)|home mini|speaker|soundbar/i, all)) return high('speaker', 'anuncia Google Cast (caixa de som)')
      if (TV_BRANDS.test(all)) return high('tv', 'anuncia Google Cast (TV)')
      return high('streamer', 'anuncia Google Cast')
    }
    if (/^appletv/i.test(model)) return high('streamer', 'anuncia AirPlay (Apple TV)')
    if (/^iphone/i.test(model)) return high('phone', 'modelo anunciado (iPhone)')
    if (/^ipad/i.test(model)) return high('tablet', 'modelo anunciado (iPad)')
    if (/^macbook/i.test(model)) return high('laptop', 'modelo anunciado (MacBook)')
    if (/^(imac|macmini|macpro|mac\d)/i.test(model)) return high('computer', 'modelo anunciado (Mac)')
    if (/audioaccessory|homepod/i.test(model)) return high('speaker', 'modelo anunciado (HomePod)')
    if (s('_amzn-wplay._tcp')) return high('streamer', 'anuncia Fire TV')
    if (s('_androidtvremote2._tcp')) return high('tv', 'anuncia controle remoto de Android TV')
    if (s('_sonos._tcp') || has(/sonos|zoneplayer/i, all)) return high('speaker', 'anuncia que é Sonos')
    // A "Roku TV" is a TV with Roku inside (SEMP, TCL, AOC…); a plain Roku is a streaming box.
    if (has(/roku/i, all)) return /roku ?tv|\d{2}"|\btv\b/i.test(all) ? high('tv', 'anuncia que é uma Roku TV') : high('streamer', 'anuncia que é Roku')
    if ((s('_airplay._tcp') || has(/MediaRenderer/i, h.upnpType)) && TV_BRANDS.test(all)) return high('tv', 'anuncia que exibe vídeo (TV)')
    if (s('_hap._tcp') || s('_homekit._tcp') || s('_matter._tcp') || s('_matterc._udp')) return high('smarthome', 'anuncia HomeKit ou Matter')
    if (s('_axis-video._tcp') || has(/camera|ipcam|hikvision|dahua|ezviz|imou|NetworkVideo/i, all)) return high('camera', 'anuncia que é câmera')
    if (has(/synology|diskstation|qnap|\bnas\b/i, all)) return high('nas', 'anuncia que é armazenamento')
    if (s('_rdlink._tcp') || s('_apple-mobdev2._tcp')) return medium('phone', 'anuncia serviços de iPhone ou iPad')
    if (s('_smb._tcp') || s('_workstation._tcp')) return medium('computer', 'compartilha arquivos como um computador')
    if (s('_spotify-connect._tcp') || s('_raop._tcp')) return medium('speaker', 'anuncia que toca música')
    if (s('_companion-link._tcp')) return medium('phone', 'anuncia serviços da Apple')
    if (has(/MediaRenderer/i, h.upnpType)) return medium('tv', 'anuncia que exibe mídia')
  }

  // ---- the name it gives the router ----
  const host = d.hostname?.toLowerCase() ?? ''
  if (host) {
    const byName: [RegExp, DeviceType][] = [
      [/iphone/, 'phone'],
      [/ipad/, 'tablet'],
      [/macbook/, 'laptop'],
      [/imac|mac-?mini|mac-?pro/, 'computer'],
      [/chromecast|roku|fire-?tv|firestick|amazon-fire|appletv|apple-tv/, 'streamer'],
      [/lgwebostv|webos|bravia|tizen|smart-?tv|samsung-?tv|(^|[^a-z])tv([^a-z]|$)/, 'tv'],
      [/echo|alexa|google-?home|nest-?(mini|audio)|homepod|sonos/, 'speaker'],
      [/ps[345]|playstation|xbox|nintendo|switch/, 'console'],
      [/printer|epson|^hp[0-9a-f]{6}|^br[nw][0-9a-f]|canon|laserjet|deskjet|officejet/, 'printer'],
      [/ipcam|camera|(^|[^a-z])cam([^a-z]|$)|ezviz|imou|hikvision|tapo-?c/, 'camera'],
      [/esp[_-]|tasmota|shelly|tuya|sonoff|smart-?plug|wled|lampada|tomada/, 'smarthome'],
      [/synology|diskstation|qnap|(^|[^a-z])nas([^a-z]|$)/, 'nas'],
      [/android|galaxy|redmi|xiaomi|poco|moto|pixel|oneplus|realme|oppo|vivo|huawei|honor|^sm-[a-z]\d|celular|phone/, 'phone'],
      [/(^|[^a-z])tab|tablet/, 'tablet'],
      [/^laptop-|notebook|^nb-|book/, 'laptop'],
      [/^desktop-|^pc[-_]|[-_]pc$|raspberrypi|workstation/, 'computer']
    ]
    for (const [re, type] of byName) if (re.test(host)) return medium(type, `pelo nome na rede ("${d.hostname}")`)
  }

  // ---- the system the router reports ----
  if (d.os === 'Android' || d.os === 'iOS') return medium('phone', `o roteador diz que roda ${d.os}`)
  if (d.os === 'Windows' || d.os === 'macOS') return medium('computer', `o roteador diz que roda ${d.os}`)

  // ---- the manufacturer ----
  const v = d.vendor?.toLowerCase() ?? ''
  if (v) {
    const byVendor: [RegExp, DeviceType, string][] = [
      [/amazon/, 'speaker', 'fabricante Amazon: provavelmente Alexa (Echo) ou Fire TV'],
      [/roku/, 'streamer', 'fabricante Roku'],
      [/tcl|hisense|skyworth|vestel|funai|semp|gaoshengda|toshiba visual|vizio/, 'tv', 'fabricante de TVs ou de peças de TV'],
      [/sony interactive|nintendo/, 'console', 'fabricante de videogames'],
      [/espressif|tuya|shelly|allterco|itead|lumi united|signify|wiz connected|sonoff|broadlink/, 'smarthome', 'fabricante de aparelhos de casa inteligente'],
      [/hikvision|dahua|ezviz|imou|reolink|wyze/, 'camera', 'fabricante de câmeras'],
      [/synology|qnap|western digital/, 'nas', 'fabricante de armazenamento'],
      [/epson|brother|canon|lexmark|kyocera|ricoh|xerox/, 'printer', 'fabricante de impressoras'],
      [/raspberry/, 'computer', 'Raspberry Pi'],
      [/sonos/, 'speaker', 'fabricante Sonos'],
      [/apple/, 'phone', 'fabricante Apple: iPhone, iPad ou Mac'],
      [/xiaomi|motorola|huawei|oppo|vivo|realme|oneplus|zte|honor|guangdong oppo/, 'phone', 'fabricante de celulares'],
      [
        /intel|realtek|micro-star|asustek|giga-byte|gigabyte|dell|lenovo|hewlett|hp inc|acer|azurewave|liteon|quanta|wistron|compal|pegatron|foxconn|hon hai/,
        'computer',
        'fabricante de computadores ou placas de rede'
      ],
      [/tp-link|d-link|netgear|ubiquiti|mikrotik|zyxel|tenda|mercusys|intelbras|multilaser|arcadyan|sagemcom|askey|technicolor/, 'router', 'fabricante de roteadores']
    ]
    for (const [re, type, reason] of byVendor) if (re.test(v)) return low(type, reason)
  }

  if (d.privateMac) return low('phone', 'endereço privado, comum em celulares')
  return low('unknown', 'o aparelho não anuncia o que é')
}

// ---------- merge ----------

export interface MergeInput {
  records: DeviceRecord[]
  neighbors: Neighbor[]
  self: { mac: string; ip: string | null } | null
  gateway: string | null
  vendorOf: (mac: string) => string | null
  /** What devices announced in this scan, by IP. */
  hintsByIp?: Map<string, DeviceHints>
  /** The router's own list, by MAC, when it was read in this scan. */
  routerInfo?: Map<string, RouterInfo>
  now: number
}

export interface MergeResult {
  records: DeviceRecord[]
  devices: Device[]
  /** Devices seen for the very first time in this scan (empty on the first scan, which only sets the baseline). */
  arrived: Device[]
  firstScan: boolean
}

const ORDER: Record<DeviceStatus, number> = { self: 0, router: 1, new: 2, known: 3, blocked: 4 }

export function mergeScan(input: MergeInput): MergeResult {
  const { neighbors, self, gateway, vendorOf, now } = input
  const hintsByIp = input.hintsByIp ?? new Map<string, DeviceHints>()
  const routerInfo = input.routerInfo ?? new Map<string, RouterInfo>()
  const firstScan = input.records.length === 0
  const byMac = new Map(input.records.map((r) => [r.mac, { ...r }]))
  const online = new Map<string, Neighbor>()
  const arrivedMacs: string[] = []

  for (const n of neighbors) {
    const mac = normalizeMac(n.mac)
    if (!mac || mac === self?.mac || !isUsableNeighbor(n.ip, mac)) continue
    online.set(mac, n)
    const rec = byMac.get(mac)
    if (rec) {
      rec.lastSeen = now
      rec.lastIp = n.ip
      rec.hostname = n.hostname || rec.hostname
      rec.hints = hintsByIp.get(n.ip) ?? rec.hints ?? null
    } else {
      byMac.set(mac, {
        mac,
        name: null,
        status: 'new',
        firstSeen: now,
        lastSeen: now,
        lastIp: n.ip,
        hostname: n.hostname || null,
        blockedAt: null,
        type: null,
        hints: hintsByIp.get(n.ip) ?? null
      })
      if (!firstScan) arrivedMacs.push(mac)
    }
  }

  // The router remembers names even for devices that are away right now.
  for (const [mac, info] of routerInfo) {
    const rec = byMac.get(mac)
    if (!rec) continue
    rec.routerName = info.hostname || rec.routerName || null
    rec.os = info.os || rec.os || null
  }

  const records = [...byMac.values()]
  const devices: Device[] = records.map((r) => {
    const n = online.get(r.mac)
    const ip = n?.ip ?? r.lastIp
    const isRouter = !!gateway && ip === gateway && !!n && r.status !== 'blocked'
    const status: DeviceStatus = isRouter ? 'router' : r.status
    const vendor = vendorOf(r.mac)
    const privateMac = isPrivateMac(r.mac)
    const hints = r.hints ?? null
    const hostname = r.routerName || r.hostname
    const guess = guessType({ status, vendor, hostname, privateMac, hints, os: r.os ?? null })
    return {
      mac: r.mac,
      ip,
      name: r.name,
      hostname,
      vendor,
      privateMac,
      status,
      online: !!n,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      blockedAt: r.blockedAt,
      type: r.type ?? guess.type,
      typeSource: r.type ? 'user' : 'auto',
      typeConfidence: r.type ? 'high' : guess.confidence,
      typeReason: r.type ? 'escolhido por você' : guess.reason,
      model: hints?.model ?? null,
      friendlyName: hints?.friendlyName ?? null,
      os: r.os ?? null
    }
  })
  if (self) {
    devices.push({
      mac: self.mac,
      ip: self.ip,
      name: null,
      hostname: null,
      vendor: vendorOf(self.mac),
      privateMac: isPrivateMac(self.mac),
      status: 'self',
      online: true,
      firstSeen: now,
      lastSeen: now,
      blockedAt: null,
      type: 'computer',
      typeSource: 'auto',
      typeConfidence: 'high',
      typeReason: 'este PC',
      model: null,
      friendlyName: null,
      os: 'Windows'
    })
  }
  devices.sort((a, b) => Number(b.online) - Number(a.online) || ORDER[a.status] - ORDER[b.status] || b.lastSeen - a.lastSeen)
  return { records, devices, arrived: devices.filter((d) => arrivedMacs.includes(d.mac)), firstScan }
}

/** Applies a user action to the stored records. */
export function applyAction(records: DeviceRecord[], action: DeviceAction, now: number): DeviceRecord[] {
  if (action.op === 'forget') return records.filter((r) => r.mac !== action.mac)
  return records.map((r) => {
    if (r.mac !== action.mac) return r
    switch (action.op) {
      case 'rename': {
        const name = action.name.trim().slice(0, 60) || null
        // Naming a new device means the user knows it.
        return { ...r, name, status: r.status === 'new' && name ? 'known' : r.status }
      }
      case 'known':
        return { ...r, status: 'known', blockedAt: null }
      case 'blocked':
        return { ...r, status: 'blocked', blockedAt: now }
      case 'unblock':
        return { ...r, status: 'known', blockedAt: null }
      case 'setType':
        return { ...r, type: action.type }
    }
  })
}

/** The label a device shows: the user's name, the name it announces, or a placeholder. */
export function deviceLabel(
  d: Pick<Device, 'name' | 'hostname' | 'status'> & { friendlyName?: string | null; routerName?: string | null }
): string {
  if (d.status === 'self') return 'Este PC'
  if (d.name) return d.name
  if (d.status === 'router') return 'Roteador'
  if (d.routerName) return d.routerName
  if (d.friendlyName) return d.friendlyName
  if (d.hostname) return d.hostname.replace(/\.(home|lan|local|localdomain)$/i, '')
  return 'Aparelho desconhecido'
}
