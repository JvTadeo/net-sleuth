import { createSocket, type Socket } from 'node:dgram'
import { get } from 'node:http'
import {
  buildQuery,
  mdnsHints,
  reverseName,
  parseDnsMessage,
  parseSsdpReply,
  parseUpnpDescription,
  type DnsRecord,
  type MdnsHints,
  type UpnpHints
} from './discovery-parse'

/**
 * Asks the home network "who is there and what do you do?" the way phones and smart TVs already do: one mDNS
 * (Bonjour) question and one UPnP (SSDP) search, both multicast, then listens for the answers devices choose to
 * send. Nothing is sent to any device directly except fetching the description file a UPnP device itself points to.
 * No ports are probed.
 */

export interface DiscoveryHints {
  mdns?: MdnsHints
  upnp?: UpnpHints
}

/** Service types worth asking for: each one says something about what kind of device answers. */
const MDNS_SERVICES = [
  '_services._dns-sd._udp.local',
  '_googlecast._tcp.local',
  '_airplay._tcp.local',
  '_raop._tcp.local',
  '_companion-link._tcp.local',
  '_apple-mobdev2._tcp.local',
  '_rdlink._tcp.local',
  '_device-info._tcp.local',
  '_ipp._tcp.local',
  '_ipps._tcp.local',
  '_printer._tcp.local',
  '_pdl-datastream._tcp.local',
  '_spotify-connect._tcp.local',
  '_sonos._tcp.local',
  '_amzn-wplay._tcp.local',
  '_androidtvremote2._tcp.local',
  '_hap._tcp.local',
  '_homekit._tcp.local',
  '_matter._tcp.local',
  '_matterc._udp.local',
  '_smb._tcp.local',
  '_workstation._tcp.local',
  '_axis-video._tcp.local'
]

const SSDP_SEARCH = [
  'M-SEARCH * HTTP/1.1',
  'HOST: 239.255.255.250:1900',
  'MAN: "ssdp:discover"',
  'MX: 2',
  'ST: ssdp:all',
  'USER-AGENT: Windows/10 UPnP/1.1 net-sleuth/1.0',
  '',
  ''
].join('\r\n')

const LISTEN_MS = 3000
const DESCRIPTION_MAX = 128 * 1024

function openSocket(localIp: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = createSocket({ type: 'udp4', reuseAddr: true })
    s.once('error', reject)
    s.bind({ address: localIp, port: 0 }, () => {
      try {
        s.setMulticastInterface(localIp)
        s.setMulticastTTL(1) // never leaves the home network
      } catch {
        // Some adapters refuse; the default interface still works in most homes.
      }
      resolve(s)
    })
  })
}

/** Fetches a UPnP device description, only from the device that announced it and with a size cap. */
function fetchDescription(location: string, fromIp: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(location)
  } catch {
    return Promise.resolve(null)
  }
  if (url.protocol !== 'http:' || url.hostname !== fromIp) return Promise.resolve(null)
  return new Promise((resolve) => {
    const req = get(url, { timeout: 2000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(null)
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > DESCRIPTION_MAX) req.destroy()
        else chunks.push(c)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', () => resolve(null))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

/**
 * Runs both searches at once. `onLan` filters answers to the PC's own subnet; `addresses` are asked "what is your
 * name?" over mDNS (reverse lookup), which iPhones, Macs, Linux and many Windows PCs answer for themselves.
 */
export async function discover(localIp: string, onLan: (ip: string) => boolean, addresses: string[] = []): Promise<Map<string, DiscoveryHints>> {
  const mdnsRecords = new Map<string, DnsRecord[]>()
  const ssdp = new Map<string, { location: string; server: string | null; root: boolean }>()
  const sockets: Socket[] = []

  try {
    const [mdnsSock, ssdpSock] = await Promise.all([openSocket(localIp), openSocket(localIp)])
    sockets.push(mdnsSock, ssdpSock)

    mdnsSock.on('message', (msg, rinfo) => {
      if (!onLan(rinfo.address)) return
      const list = mdnsRecords.get(rinfo.address) ?? []
      list.push(...parseDnsMessage(msg))
      mdnsRecords.set(rinfo.address, list)
    })
    ssdpSock.on('message', (msg, rinfo) => {
      if (!onLan(rinfo.address)) return
      const h = parseSsdpReply(msg.toString('utf8'))
      if (!h?.location) return
      const root = /rootdevice/i.test(`${h.st ?? ''} ${h.usn ?? ''}`)
      const prev = ssdp.get(rinfo.address)
      if (!prev || (root && !prev.root)) ssdp.set(rinfo.address, { location: h.location, server: h.server ?? null, root })
    })

    const query = buildQuery(MDNS_SERVICES)
    // Reverse lookups go in packets of 32 questions, well under one network packet each.
    const reverse: Buffer[] = []
    for (let i = 0; i < addresses.length; i += 32) reverse.push(buildQuery(addresses.slice(i, i + 32).map(reverseName), 0x4e54 + i))
    const search = Buffer.from(SSDP_SEARCH)
    const send = (): void => {
      mdnsSock.send(query, 5353, '224.0.0.251')
      for (const r of reverse) mdnsSock.send(r, 5353, '224.0.0.251')
      ssdpSock.send(search, 1900, '239.255.255.250')
    }
    send()
    // UDP can drop a packet: ask once more while still listening.
    setTimeout(send, 900)
    await new Promise((r) => setTimeout(r, LISTEN_MS))
  } catch {
    // No multicast on this adapter (or the firewall said no): devices keep their name and manufacturer hints.
  } finally {
    for (const s of sockets) s.close()
  }

  const out = new Map<string, DiscoveryHints>()
  for (const [ip, records] of mdnsRecords) {
    const hints = mdnsHints(records, ip)
    if (hints.services.length || hints.names.length || hints.host) out.set(ip, { mdns: hints })
  }
  const targets = [...ssdp].slice(0, 32)
  const descriptions = await Promise.all(targets.map(([ip, s]) => fetchDescription(s.location, ip)))
  targets.forEach(([ip, s], i) => {
    const xml = descriptions[i]
    const upnp: UpnpHints = xml
      ? parseUpnpDescription(xml, s.server)
      : { friendlyName: null, manufacturer: null, modelName: null, modelDescription: null, deviceType: null, server: s.server }
    out.set(ip, { ...out.get(ip), upnp })
  })
  return out
}
