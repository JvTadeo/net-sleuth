/**
 * Parsers for what devices announce on the home network: mDNS/Bonjour answers (DNS wire format) and UPnP/SSDP
 * replies with their device description XML. Pure functions, no sockets, so the tests feed them real packets.
 */

// ---------- mDNS (DNS wire format) ----------

export const TYPE_A = 1
export const TYPE_PTR = 12
export const TYPE_TXT = 16
export const TYPE_SRV = 33

export interface DnsRecord {
  name: string
  type: number
  /** PTR: target name. SRV: target host. A: address. TXT: key=value pairs. */
  data: string | Record<string, string>
}

/** One query packet asking for each name's PTR records, with the "unicast response" bit set. */
export function buildQuery(names: string[], id = 0x4e53): Buffer {
  const parts: Buffer[] = []
  const header = Buffer.alloc(12)
  header.writeUInt16BE(id, 0)
  header.writeUInt16BE(names.length, 4)
  parts.push(header)
  for (const name of names) {
    for (const label of name.split('.').filter(Boolean)) {
      const b = Buffer.from(label, 'utf8')
      parts.push(Buffer.from([b.length]), b)
    }
    const tail = Buffer.alloc(5)
    tail.writeUInt16BE(TYPE_PTR, 1)
    tail.writeUInt16BE(0x8001, 3) // class IN with the QU bit
    parts.push(tail)
  }
  return Buffer.concat(parts)
}

/** Reads a possibly compressed name; returns it and the offset right after it in the original position. */
function readName(buf: Buffer, start: number): [string, number] {
  const labels: string[] = []
  let offset = start
  let end = -1
  for (let jumps = 0; jumps < 32; jumps++) {
    if (offset >= buf.length) throw new Error('name out of range')
    const len = buf[offset]
    if (len === 0) {
      offset++
      break
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = offset + 2
      offset = ((len & 0x3f) << 8) | buf[offset + 1]
      continue
    }
    labels.push(buf.toString('utf8', offset + 1, offset + 1 + len))
    offset += 1 + len
  }
  return [labels.join('.'), end < 0 ? offset : end]
}

function readTxt(buf: Buffer, start: number, length: number): Record<string, string> {
  const out: Record<string, string> = {}
  let o = start
  while (o < start + length) {
    const len = buf[o]
    const entry = buf.toString('utf8', o + 1, o + 1 + len)
    const eq = entry.indexOf('=')
    if (eq > 0) out[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1)
    else if (entry) out[entry.toLowerCase()] = ''
    o += 1 + len
  }
  return out
}

/** Every record in a DNS message (answers and additional records), skipping types the app does not use. */
export function parseDnsMessage(buf: Buffer): DnsRecord[] {
  if (buf.length < 12) return []
  const qd = buf.readUInt16BE(4)
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10)
  let o = 12
  try {
    for (let i = 0; i < qd; i++) o = readName(buf, o)[1] + 4
    const out: DnsRecord[] = []
    for (let i = 0; i < total; i++) {
      const [name, next] = readName(buf, o)
      const type = buf.readUInt16BE(next)
      const rdlen = buf.readUInt16BE(next + 8)
      const rd = next + 10
      if (rd + rdlen > buf.length) break
      if (type === TYPE_PTR) out.push({ name, type, data: readName(buf, rd)[0] })
      else if (type === TYPE_SRV) out.push({ name, type, data: readName(buf, rd + 6)[0] })
      else if (type === TYPE_TXT) out.push({ name, type, data: readTxt(buf, rd, rdlen) })
      else if (type === TYPE_A && rdlen === 4) out.push({ name, type, data: [...buf.subarray(rd, rd + 4)].join('.') })
      o = rd + rdlen
    }
    return out
  } catch {
    return []
  }
}

export interface MdnsHints {
  /** The device's own host name, from a reverse lookup or its address record ("Joaos-iPhone"). */
  host: string | null
  /** Service types, "_googlecast._tcp". */
  services: string[]
  /** Instance names the device gave itself, "Sala de Estar". */
  names: string[]
  /** Merged TXT values: md (model), fn (friendly name), model, ty (printer), am (AirPlay model)… */
  txt: Record<string, string>
}

/** "192.168.0.23" → "23.0.168.192.in-addr.arpa", the name a reverse lookup asks for. */
export const reverseName = (ip: string): string => `${ip.split('.').reverse().join('.')}.in-addr.arpa`

const stripLocal = (n: string): string => n.replace(/\.local\.?$/i, '')

/** What one device's answers say about it. `ip` is the address the answers came from. */
export function mdnsHints(records: DnsRecord[], ip?: string): MdnsHints {
  const services = new Set<string>()
  const names = new Set<string>()
  const txt: Record<string, string> = {}
  let host: string | null = null
  for (const r of records) {
    // Reverse lookup answer: "23.0.168.192.in-addr.arpa → Joaos-iPhone.local".
    if (r.type === TYPE_PTR && typeof r.data === 'string' && /\.in-addr\.arpa$/i.test(r.name)) {
      if (!ip || r.name.toLowerCase() === reverseName(ip)) host = stripLocal(r.data)
      continue
    }
    // Address record for the device itself: its name is the host name.
    if (r.type === TYPE_A && ip && r.data === ip && /\.local$/i.test(r.name)) {
      host ??= stripLocal(r.name)
      continue
    }
    if (r.type === TYPE_PTR && typeof r.data === 'string') {
      const m = /^(.*?)\.(_[^.]+\._(?:tcp|udp))\.local$/i.exec(r.data)
      if (m) {
        services.add(m[2].toLowerCase())
        // Google Cast instance names are opaque ids; the friendly name is in TXT "fn".
        if (!/^[0-9a-f-]{20,}$/i.test(m[1]) && !/^(google|chromecast)-[0-9a-f]{20,}/i.test(m[1])) names.add(m[1].replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(Number(d))))
      } else if (/^_[^.]+\._(tcp|udp)\.local$/i.test(r.data) && /^_services\._dns-sd/i.test(r.name)) {
        services.add(r.data.replace(/\.local$/i, '').toLowerCase())
      }
    } else if (r.type === TYPE_TXT && typeof r.data === 'object') {
      for (const [k, v] of Object.entries(r.data)) if (v && !(k in txt)) txt[k] = v
    }
  }
  return { host, services: [...services], names: [...names], txt }
}

// ---------- UPnP / SSDP ----------

/** Headers of one SSDP reply ("HTTP/1.1 200 OK" + "LOCATION: …"), names in lower case. */
export function parseSsdpReply(text: string): Record<string, string> | null {
  const lines = text.split(/\r?\n/)
  if (!/^HTTP\/1\.\d\s+200/i.test(lines[0] ?? '') && !/^NOTIFY\s/i.test(lines[0] ?? '')) return null
  const out: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return out
}

export interface UpnpHints {
  friendlyName: string | null
  manufacturer: string | null
  modelName: string | null
  modelDescription: string | null
  /** "urn:schemas-upnp-org:device:MediaRenderer:1" → "MediaRenderer". */
  deviceType: string | null
  /** The SERVER header ("Linux/4.4 UPnP/1.0 Xbox/…"). */
  server: string | null
}

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .trim()

/** The first (root) device of a UPnP description document. */
export function parseUpnpDescription(xml: string, server: string | null = null): UpnpHints {
  const device = /<device>([\s\S]*)<\/device>/i.exec(xml)?.[1] ?? xml
  // Only the root device's own tags: cut nested device lists out first.
  const own = device.replace(/<deviceList>[\s\S]*<\/deviceList>/i, '')
  const tag = (name: string): string | null => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(own)
    return m ? decodeXml(m[1]) || null : null
  }
  const type = tag('deviceType')
  return {
    friendlyName: tag('friendlyName'),
    manufacturer: tag('manufacturer'),
    modelName: tag('modelName'),
    modelDescription: tag('modelDescription'),
    deviceType: type ? (type.split(':')[3] ?? type) : null,
    server
  }
}
