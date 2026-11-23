/**
 * Network logic tests: ping and netsh parsing in several languages, verdicts, diagnosis, VPN detection and DNS.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { linkKindOf, parseNetshWifi, parsePingTime } from '../src/main/network/parse'
import {
  bandOf,
  currentPreset,
  diagnose,
  dnsEncrypted,
  dnsPlan,
  formatSpeed,
  pickPrimary,
  pingVerdict,
  statsOf,
  virtualLabel,
  type NetInfo,
  type PathResult,
  type PingSample
} from '../src/shared/network'

let checks = 0
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg)
  checks++
}

// ---------- ping.exe ----------
const ptBR = `
Disparando 1.1.1.1 com 32 bytes de dados:
Resposta de 1.1.1.1: bytes=32 tempo=14ms TTL=57

Estatísticas do Ping para 1.1.1.1:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de perda),`
eq(parsePingTime(ptBR), 14, 'Portuguese reply')
eq(parsePingTime('Reply from 192.168.0.1: bytes=32 time<1ms TTL=64'), 0.5, 'English "<1ms" counts as half a millisecond')
eq(parsePingTime('Antwort von 8.8.8.8: Bytes=32 Zeit=23ms TTL=117'), 23, 'German reply')
eq(parsePingTime('Respuesta desde 8.8.8.8: bytes=32 tiempo=19ms TTL=117'), 19, 'Spanish reply')
eq(parsePingTime('64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=12.4 ms'), 12.4, 'Linux reply')
eq(parsePingTime('Esgotado o tempo limite do pedido.'), null, 'timeout (Portuguese)')
eq(parsePingTime('Resposta de 192.168.0.12: Host de destino inacessível.'), null, '"unreachable" has no TTL: not a reply')
eq(parsePingTime('A solicitação ping não pôde encontrar o host google.com.'), null, 'name not found')

// ---------- netsh wlan show interfaces ----------
const netshPt = `
Há 1 interface no sistema:

    Nome                   : Wi-Fi
    Descrição              : Intel(R) Wi-Fi 6 AX201 160MHz
    Estado                 : conectado
    SSID                   : Casa_5G
    BSSID                  : 50:c7:bf:21:9a:05
    Tipo de rede           : Infraestrutura
    Tipo de rádio          : 802.11ax
    Autenticação           : WPA2-Personal
    Codificação            : CCMP
    Canal                  : 36
    Taxa de recepção (Mbps) : 866.7
    Sinal                  : 78%
    Perfil                 : Casa_5G
`
eq(parseNetshWifi(netshPt), { ssid: 'Casa_5G', signal: 78, channel: 36, band: '5 GHz', auth: 'WPA2-Personal' }, 'Portuguese netsh')
const netshEn = `    Name                   : Wi-Fi
    SSID                   : Office
    BSSID                  : aa:bb:cc:dd:ee:ff
    Authentication         : WPA3-Personal
    Channel                : 6
    Band                   : 2.4 GHz
    Signal                 : 54%`
eq(parseNetshWifi(netshEn), { ssid: 'Office', signal: 54, channel: 6, band: '2,4 GHz', auth: 'WPA3-Personal' }, 'English netsh with a Band line')
eq(parseNetshWifi('Network shell commands need location permission to access WLAN information.'), null, 'location blocked: no SSID')
eq(parseNetshWifi(null), null, 'no output')
eq(linkKindOf('802.3'), 'ethernet', 'cable')
eq(linkKindOf('Native 802.11'), 'wifi', 'Wi-Fi')
eq(linkKindOf('Unspecified'), 'other', 'VPN and others')
eq(bandOf(11), '2,4 GHz', 'band from channel 11')
eq(bandOf(149), '5 GHz', 'band from channel 149')
eq(formatSpeed(1e9), '1 Gbps', '1 Gbps')
eq(formatSpeed(866.7e6), '867 Mbps', 'Mbps rounded')

// ---------- statistics and verdicts ----------
const st = statsOf([10, 12, null, 14])
eq([st.avg, st.max, st.loss, st.jitter], [12, 14, 0.25, 2], 'stats over answered pings')
const series = (router: (i: number) => number | null, internet: (i: number) => number | null): PingSample[] =>
  Array.from({ length: 20 }, (_, i) => ({ t: i, router: router(i), internet: internet(i) }))
eq(pingVerdict(series(() => 2, () => 14).slice(0, 3)), 'waiting', 'too few samples')
eq(pingVerdict(series(() => 2, () => 14)), 'ok', 'all good')
eq(pingVerdict(series(() => 2, (i) => (i % 2 ? 150 : 120))), 'isp', 'slow internet, fast router: the provider')
eq(pingVerdict(series((i) => (i % 3 ? 4 : 60), (i) => (i % 3 ? 16 : 75))), 'home', 'unstable router: the home network')
eq(pingVerdict(series(() => null, () => 14)), 'ok', 'a router that ignores ping is not a problem')
eq(pingVerdict(series(() => 2, () => null)), 'internetDown', 'no internet')
eq(pingVerdict(series(() => null, () => null)), 'routerDown', 'nothing answers')

// ---------- diagnosis ----------
const info: NetInfo = {
  primary: { alias: 'Ethernet', description: 'Realtek', kind: 'ethernet', speedBps: 1e9, mac: '2C-F0', ipv4: ['192.168.0.12/24'], gateway: '192.168.0.1', dns: ['192.168.0.1'], dnsStatic: false, dhcp: true, ipv6: true, dhcpDns: ['192.168.0.1'], doh: [], virtualOf: null },
  others: [],
  virtual: [],
  dohSupported: true,
  wifi: null,
  hasWifiAdapter: false,
  wifiBlocked: false,
  supported: true,
  readAt: 0
}
const path = (router: boolean, dns: boolean, internet: boolean): PathResult => ({
  checkedAt: 0,
  hops: [
    { id: 'router', ok: router, ms: router ? 2 : null, target: '192.168.0.1' },
    { id: 'dns', ok: dns, ms: dns ? 18 : null, target: 'www.google.com' },
    { id: 'internet', ok: internet, ms: internet ? 14 : null, target: '1.1.1.1' }
  ]
})
eq(diagnose(info, path(true, true, true)).failed, null, 'healthy path')
eq(diagnose(info, path(true, false, true)).suggestion, 'flushDns', 'DNS failing: flush the cache')
eq(diagnose(info, path(false, true, true)).failed, null, 'router silent but internet answers: fine')
eq(diagnose(info, path(false, false, false)).suggestion, 'restartAdapter', 'router unreachable: restart the adapter')
eq(diagnose({ ...info, primary: { ...info.primary!, ipv4: ['169.254.10.4/16'] } }, path(false, false, false)).suggestion, 'renewIp', 'self-assigned address: renew the IP')
eq(diagnose({ ...info, primary: null }, null).failed, 'adapter', 'no adapter connected')

// ---------- VPN and virtual adapters ----------
eq(virtualLabel('Famatech Radmin VPN Ethernet Adapter', 'Radmin VPN'), 'Radmin VPN', 'Radmin is a VPN')
eq(virtualLabel('LogMeIn Hamachi Virtual Ethernet Adapter', 'Hamachi'), 'Hamachi', 'Hamachi is a VPN')
eq(virtualLabel('Hyper-V Virtual Ethernet Adapter', 'vEthernet (WSL)'), 'WSL', 'WSL switch')
eq(virtualLabel('VirtualBox Host-Only Ethernet Adapter', 'Ethernet 2'), 'VirtualBox', 'VirtualBox host-only')
eq(virtualLabel('Realtek PCIe GbE Family Controller', 'Ethernet'), null, 'a real card')
eq(virtualLabel('Intel(R) Wi-Fi 6 AX201 160MHz', 'Wi-Fi'), null, 'a real Wi-Fi card')
eq(virtualLabel('Some Unknown Adapter', 'Ethernet 3', false), 'VPN ou virtual', 'no hardware behind it: virtual')
const radmin = { name: 'radmin', virtualOf: 'Radmin VPN', metric: 1 }
const cable = { name: 'cable', virtualOf: null, metric: 25 }
eq(pickPrimary([radmin, cable])?.name, 'cable', 'Radmin forces metric 1 but the cable carries the internet')
eq(pickPrimary([radmin])?.name, 'radmin', 'only a virtual adapter: use it')
eq(pickPrimary([]), null, 'nothing connected')

// ---------- DNS ----------
eq(currentPreset({ dns: ['192.168.0.1'], dnsStatic: false }), 'auto', 'from the router')
eq(currentPreset({ dns: ['1.1.1.1', '1.0.0.1'], dnsStatic: true }), 'cloudflare', 'Cloudflare by hand')
eq(currentPreset({ dns: ['8.8.4.4'], dnsStatic: true }), 'google', 'secondary Google server alone')
eq(currentPreset({ dns: ['208.67.222.222'], dnsStatic: true }), 'custom', 'OpenDNS is not a preset')
eq(dnsEncrypted({ dns: ['1.1.1.1', '1.0.0.1'], doh: ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111'] }), true, 'both servers encrypted')
eq(dnsEncrypted({ dns: ['1.1.1.1', '1.0.0.1'], doh: ['1.1.1.1'] }), false, 'one server in plain text')
eq(dnsEncrypted({ dns: ['192.168.0.1'], doh: [] }), false, 'router DNS: not encrypted')
eq(dnsPlan({ preset: 'auto', encrypted: true }, true), { servers: [], doh: [] }, 'automatic: reset, nothing to encrypt')
eq(dnsPlan({ preset: 'quad9', encrypted: false }, false).servers, ['9.9.9.9', '149.112.112.112'], 'no IPv6: IPv4 servers only')
eq(dnsPlan({ preset: 'google', encrypted: true }, true).doh.length, 4, 'IPv6 on: all four servers encrypted')
eq(dnsPlan({ preset: 'cloudflare', encrypted: true }, false).doh[0], { ip: '1.1.1.1', template: 'https://cloudflare-dns.com/dns-query' }, 'DoH address')

console.log(`All ${checks} network checks passed`)
