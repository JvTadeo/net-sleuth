/**
 * Security checklist tests: hosts parsing, Wi-Fi risk, process classification and the verdict of each check.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { buildChecks, isSystemProcess, parseHosts, wifiRisk, type SecurityFacts } from '../src/shared/security'

let checks = 0
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg)
  checks++
}

// ---------- hosts ----------
const defaultHosts = `# Copyright (c) 1993-2009 Microsoft Corp.
#
# localhost name resolution is handled within DNS itself.
#	127.0.0.1       localhost
#	::1             localhost
`
eq(parseHosts(defaultHosts), [], 'default Windows hosts file: nothing to report')
eq(parseHosts('127.0.0.1 localhost\r\n::1 localhost\r\n'), [], 'localhost lines are normal')
eq(
  parseHosts('0.0.0.0 ads.example.com tracker.example.com # ad block\n'),
  [
    { ip: '0.0.0.0', name: 'ads.example.com', kind: 'block' },
    { ip: '0.0.0.0', name: 'tracker.example.com', kind: 'block' }
  ],
  'several names on one blocking line'
)
eq(parseHosts('45.10.20.30\twww.bancodobrasil.com.br')[0].kind, 'redirect', 'a bank sent elsewhere is a redirect')

// ---------- Wi-Fi ----------
eq(wifiRisk({ auth: 'open', encryption: 'none' }), 'Aberta, sem senha', 'open network')
eq(wifiRisk({ auth: 'open', encryption: 'WEP' }) !== null, true, 'WEP')
eq(wifiRisk({ auth: 'WPAPSK', encryption: 'AES' }) !== null, true, 'first-generation WPA')
eq(wifiRisk({ auth: 'WPA2PSK', encryption: 'TKIP' }) !== null, true, 'WPA2 with TKIP')
eq(wifiRisk({ auth: 'WPA2PSK', encryption: 'AES' }), null, 'WPA2 with AES is fine')
eq(wifiRisk({ auth: 'WPA3SAE', encryption: 'AES' }), null, 'WPA3 is fine')
eq(wifiRisk({ auth: 'OWE', encryption: 'AES' }), null, 'enhanced open (OWE) is encrypted')

// ---------- processes ----------
eq(isSystemProcess('svchost', ''), true, 'svchost without a path (no admin)')
eq(isSystemProcess('System', ''), true, 'System')
eq(isSystemProcess('Spotify', 'C:\\Users\\jv\\AppData\\Roaming\\Spotify\\Spotify.exe'), false, 'Spotify is an app')
eq(isSystemProcess('something', 'C:\\Windows\\System32\\something.exe'), true, 'anything in the Windows folder')

// ---------- checks ----------
const clean: SecurityFacts = {
  firewall: [
    { name: 'Domain', enabled: true },
    { name: 'Private', enabled: true },
    { name: 'Public', enabled: true }
  ],
  profile: { alias: 'Ethernet', category: 'Private' },
  listening: [{ name: 'Host de Serviço', process: 'svchost', path: '', ports: [135, 445], system: true, blocked: false }],
  rdpEnabled: false,
  smb1Enabled: false,
  hosts: [],
  proxy: { enabled: false, server: null, pac: null },
  hasWifiAdapter: false,
  wifiProfiles: null
}
const ctx = { dnsEncrypted: true, dohSupported: true }
const status = (f: SecurityFacts, c = ctx) => Object.fromEntries(buildChecks(f, c).map((x) => [x.id, x.status]))

eq(
  status(clean),
  { ports: 'ok', doh: 'ok', firewall: 'ok', profile: 'ok', rdp: 'ok', smb1: 'ok', hosts: 'ok', proxy: 'ok', router: 'info', wifi: 'na' },
  'a clean PC: everything in order, router reminder, cable-only'
)
eq(buildChecks(clean, ctx).length, 10, 'ten checks')

const spotify = { name: 'Spotify', process: 'Spotify', path: 'C:\\Spotify.exe', ports: [57621], system: false, blocked: false }
eq(status({ ...clean, listening: [spotify] }).ports, 'warn', 'an app listening on the network')
eq(status({ ...clean, listening: [{ ...spotify, blocked: true }] }).ports, 'ok', 'blocked by the user: no longer a warning')
eq(status(clean, { dnsEncrypted: false, dohSupported: true }).doh, 'warn', 'DNS in plain text')
eq(status(clean, { dnsEncrypted: false, dohSupported: false }).doh, 'info', 'Windows 10: only a tip')
const fwOff = buildChecks({ ...clean, firewall: [{ name: 'Private', enabled: false }, { name: 'Public', enabled: true }] }, ctx).find((c) => c.id === 'firewall')!
eq([fwOff.status, fwOff.short], ['warn', 'Desligado na rede privada'], 'firewall off on the private network')
eq(fwOff.action?.kind === 'fix' && fwOff.action.fix, 'firewallOn', 'offers to turn it on')
eq(buildChecks({ ...clean, profile: { alias: 'Wi-Fi', category: 'Public' } }, ctx).find((c) => c.id === 'profile')!.action, { kind: 'fix', fix: 'profilePrivate', label: 'Mudar para Privada', admin: true }, 'public network can go back to private')
eq(status({ ...clean, rdpEnabled: true }).rdp, 'warn', 'Remote Desktop on')
eq(status({ ...clean, rdpEnabled: null }).rdp, 'na', 'Home edition has no Remote Desktop host')
eq(status({ ...clean, smb1Enabled: true }).smb1, 'warn', 'SMBv1 on')
eq(status({ ...clean, smb1Enabled: null }).smb1, 'info', 'SMBv1 unknown without admin')
eq(status({ ...clean, hosts: [{ ip: '0.0.0.0', name: 'ads.x', kind: 'block' }] }).hosts, 'info', 'ad blocking in hosts')
eq(status({ ...clean, hosts: [{ ip: '1.2.3.4', name: 'bank.x', kind: 'redirect' }] }).hosts, 'warn', 'redirect in hosts')
eq(status({ ...clean, proxy: { enabled: true, server: '10.0.0.5:8080', pac: null } }).proxy, 'warn', 'proxy on')
eq(status({ ...clean, proxy: { enabled: false, server: null, pac: 'http://wpad/wpad.dat' } }).proxy, 'warn', 'automatic proxy script')
eq(status({ ...clean, hasWifiAdapter: true, wifiProfiles: [{ name: 'Café', auth: 'open', encryption: 'none' }] }).wifi, 'warn', 'open café network saved')
eq(status({ ...clean, hasWifiAdapter: true, wifiProfiles: [{ name: 'Casa', auth: 'WPA2PSK', encryption: 'AES' }] }).wifi, 'ok', 'only a WPA2 network')
eq(buildChecks({ ...clean, rdpEnabled: true }, ctx)[0].id, 'rdp', 'warnings come first')

console.log(`All ${checks} security checks passed`)
