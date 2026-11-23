/**
 * Discovery tests: mDNS answers (DNS wire format, with name compression), SSDP replies, UPnP descriptions and the
 * device type guess built from them.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { buildQuery, mdnsHints, parseDnsMessage, parseSsdpReply, parseUpnpDescription, reverseName, TYPE_A, TYPE_PTR } from '../src/main/discovery-parse'
import { guessType, type DeviceHints } from '../src/shared/devices'

let checks = 0
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg)
  checks++
}

// ---------- a hand-built mDNS answer, as a Chromecast sends it ----------
const name = (s: string) => Buffer.concat([...s.split('.').map((l) => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)])), Buffer.from([0])])
const rr = (owner: Buffer, type: number, rdata: Buffer) => {
  const fixed = Buffer.alloc(10)
  fixed.writeUInt16BE(type, 0)
  fixed.writeUInt16BE(1, 2)
  fixed.writeUInt32BE(120, 4)
  fixed.writeUInt16BE(rdata.length, 8)
  return Buffer.concat([owner, fixed, rdata])
}
const txt = (pairs: string[]) => Buffer.concat(pairs.map((p) => Buffer.concat([Buffer.from([Buffer.byteLength(p)]), Buffer.from(p)])))
const header = Buffer.alloc(12)
header.writeUInt16BE(0x8400, 2)
header.writeUInt16BE(1, 6) // 1 answer
header.writeUInt16BE(2, 10) // 2 additional
const service = name('_googlecast._tcp.local') // starts at offset 12
const instanceOwner = Buffer.concat([Buffer.from([39]), Buffer.from('Chromecast-0123456789abcdef0123456789ab'), Buffer.from([0xc0, 12])])
const packet = Buffer.concat([
  header,
  rr(service, TYPE_PTR, instanceOwner),
  rr(instanceOwner, 16, txt(['id=0123456789abcdef', 'md=Chromecast', 'fn=Sala de Estar', 've=05'])),
  rr(Buffer.concat([Buffer.from([4]), Buffer.from('cast'), Buffer.from([5]), Buffer.from('local'), Buffer.from([0])]), 1, Buffer.from([192, 168, 0, 33]))
])
const records = parseDnsMessage(packet)
eq(records.length, 3, 'PTR, TXT and A records')
eq(records[0].data, 'Chromecast-0123456789abcdef0123456789ab._googlecast._tcp.local', 'compressed name followed')
const hints = mdnsHints(records)
eq(hints.services, ['_googlecast._tcp'], 'service type')
eq(hints.names, [], 'opaque Chromecast id is not shown as a name')
eq([hints.txt.md, hints.txt.fn], ['Chromecast', 'Sala de Estar'], 'model and friendly name from TXT')
eq(parseDnsMessage(Buffer.from([1, 2, 3])), [], 'garbage is ignored')
eq(buildQuery(['_ipp._tcp.local']).readUInt16BE(4), 1, 'one question in the query')

// ---------- names over mDNS ----------
eq(reverseName('192.168.100.8'), '8.100.168.192.in-addr.arpa', 'reverse lookup name')
eq(
  mdnsHints([{ name: '8.100.168.192.in-addr.arpa', type: TYPE_PTR, data: 'Joaos-iPhone.local' }], '192.168.100.8').host,
  'Joaos-iPhone',
  'reverse answer gives the host name'
)
eq(mdnsHints([{ name: 'DESKTOP-7QK2M1A.local', type: TYPE_A, data: '192.168.100.12' }], '192.168.100.12').host, 'DESKTOP-7QK2M1A', 'address record gives the host name')
eq(mdnsHints([{ name: 'other.local', type: TYPE_A, data: '192.168.100.99' }], '192.168.100.12').host, null, 'another device\'s address is ignored')
const hostQuery = parseDnsMessage(Buffer.concat([buildQuery([reverseName('192.168.100.8')]), Buffer.alloc(0)]))
eq(hostQuery, [], 'a query has no answers')

// ---------- SSDP + UPnP ----------
const reply = 'HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.0.31:9197/dmr\r\nSERVER: Samsung-Linux/4.1, UPnP/1.0, Samsung_UPnP_SDK/1.0\r\nST: upnp:rootdevice\r\n\r\n'
eq(parseSsdpReply(reply)?.location, 'http://192.168.0.31:9197/dmr', 'LOCATION header')
eq(parseSsdpReply('GET / HTTP/1.1\r\n\r\n'), null, 'not an SSDP reply')
const xml = `<?xml version="1.0"?><root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
<friendlyName>[TV] Samsung 7 Series (55)</friendlyName><manufacturer>Samsung Electronics</manufacturer><modelName>UN55TU7000</modelName>
<deviceList><device><deviceType>urn:x:device:Other:1</deviceType><friendlyName>inner</friendlyName></device></deviceList></device></root>`
const up = parseUpnpDescription(xml, 'Samsung-Linux/4.1')
eq([up.deviceType, up.friendlyName, up.modelName], ['MediaRenderer', '[TV] Samsung 7 Series (55)', 'UN55TU7000'], 'root device only, not the nested one')
eq(parseUpnpDescription('<root><device><friendlyName>A &amp; B</friendlyName></device></root>').friendlyName, 'A & B', 'XML entities decoded')

// ---------- type guess ----------
const H = (h: Partial<DeviceHints>): DeviceHints => ({ friendlyName: null, model: null, manufacturer: null, services: [], upnpType: null, server: null, ...h })
const g = (hints: DeviceHints | null, extra: Partial<Parameters<typeof guessType>[0]> = {}) =>
  guessType({ status: 'new', vendor: null, hostname: null, privateMac: false, hints, ...extra })

eq(g(H({ services: ['_googlecast._tcp'], model: 'Chromecast', friendlyName: 'Sala de Estar' })).type, 'streamer', 'Chromecast')
eq(g(H({ services: ['_googlecast._tcp'], model: 'Google Nest Mini' })).type, 'speaker', 'Nest Mini')
eq(g(H({ services: ['_googlecast._tcp'], model: 'BRAVIA 4K VH2' })).type, 'tv', 'Sony TV with Cast')
eq(g(H({ upnpType: 'MediaRenderer', friendlyName: '[TV] Samsung 7 Series (55)', manufacturer: 'Samsung Electronics' })), { type: 'tv', confidence: 'high', reason: 'anuncia que exibe vídeo (TV)' }, 'Samsung TV over UPnP')
eq(g(H({ services: ['_ipp._tcp'], model: 'EPSON L3250 Series' })).type, 'printer', 'printer')
eq(g(H({ services: ['_airplay._tcp'], model: 'AppleTV11,1' })).type, 'streamer', 'Apple TV')
eq(g(H({ services: ['_companion-link._tcp'], model: 'iPhone15,2' })).type, 'phone', 'iPhone with model')
eq(g(H({ services: ['_device-info._tcp'], model: 'MacBookPro18,3' })).type, 'laptop', 'MacBook')
eq(g(H({ server: 'Microsoft-Windows/10.0 UPnP/1.0 Xbox/2.0', upnpType: 'MediaRenderer' })).type, 'console', 'Xbox')
eq(g(H({ upnpType: 'InternetGatewayDevice', manufacturer: 'TP-Link' })).type, 'router', 'mesh node / second router')
eq(g(H({ services: ['_hap._tcp'] })).type, 'smarthome', 'HomeKit accessory')
eq(g(H({ friendlyName: '32" SEMP Roku TV', server: 'Roku/12.5.5 UPnP/1.0' })), { type: 'tv', confidence: 'high', reason: 'anuncia que é uma Roku TV' }, 'a Roku TV is a TV')
eq(g(H({ friendlyName: 'Roku Express', server: 'Roku/12.5.5 UPnP/1.0' })).type, 'streamer', 'a Roku stick is a streaming box')
eq(g(null, { vendor: 'Hui Zhou Gaoshengda' }).type, 'tv', 'Wi-Fi module maker for TVs')
eq(g(H({ services: ['_smb._tcp', '_spotify-connect._tcp'] })).type, 'computer', 'a PC with Spotify is still a computer')
eq(g(null, { hostname: 'Galaxy-S24.home' }), { type: 'phone', confidence: 'medium', reason: 'pelo nome na rede ("Galaxy-S24.home")' }, 'phone by name')
eq(g(null, { hostname: 'LGwebOSTV' }).type, 'tv', 'LG TV by name')
eq(g(null, { hostname: 'DESKTOP-7QK2M1A' }).type, 'computer', 'Windows PC by name')
eq(g(null, { hostname: 'LAPTOP-AB12' }).type, 'laptop', 'Windows laptop by name')
eq(g(null, { hostname: 'HP3C52A1' }).type, 'printer', 'HP printer default name')
eq(g(null, { vendor: 'Amazon' }).confidence, 'low', 'Amazon: only a low-confidence guess')
eq(g(null, { vendor: 'Espressif' }).type, 'smarthome', 'ESP chips are smart-home gadgets')
eq(g(null, { privateMac: true }), { type: 'phone', confidence: 'low', reason: 'endereço privado, comum em celulares' }, 'private address')
eq(g(null).type, 'unknown', 'nothing to go on')
eq(guessType({ status: 'router', vendor: null, hostname: null, privateMac: false, hints: null }).type, 'router', 'the gateway')

console.log(`All ${checks} discovery checks passed`)
