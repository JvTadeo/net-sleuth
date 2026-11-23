/**
 * Saved passwords tests: the Wi-Fi QR text, Windows profile security names, validation and generated passwords.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { escapeQr, securityFromProfile, strongPassword, validateInput, wifiQrText } from '../src/shared/vault'

let checks = 0
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg)
  checks++
}

// ---------- QR text ----------
eq(wifiQrText('Casa_5G', 'laranja-azul-2026', 'WPA2', false), 'WIFI:T:WPA;S:Casa_5G;P:laranja-azul-2026;;', 'plain WPA2 network')
eq(wifiQrText('Casa', 'abcdefgh', 'WPA3', false), 'WIFI:T:WPA;S:Casa;P:abcdefgh;;', 'WPA3 still uses T:WPA, which phones accept')
eq(wifiQrText('Café', '', 'open', false), 'WIFI:T:nopass;S:Café;;', 'open network: no password field')
eq(wifiQrText('Velha', '12345', 'WEP', false), 'WIFI:T:WEP;S:Velha;P:12345;;', 'WEP')
eq(wifiQrText('Oculta', 'segredo123', 'WPA2', true), 'WIFI:T:WPA;S:Oculta;P:segredo123;H:true;;', 'hidden network')
eq(escapeQr('a;b,c:d"e\\f'), 'a\\;b\\,c\\:d\\"e\\\\f', 'special characters are escaped')
eq(wifiQrText('Rede;1', 'p:a"ss,word', 'WPA2', false), 'WIFI:T:WPA;S:Rede\\;1;P:p\\:a\\"ss\\,word;;', 'escaping inside the QR text')

// ---------- Windows profile security ----------
eq(securityFromProfile('WPA2PSK', 'AES'), 'WPA2', 'WPA2-Personal')
eq(securityFromProfile('WPA3SAE', 'AES'), 'WPA3', 'WPA3-Personal')
eq(securityFromProfile('WPAPSK', 'TKIP'), 'WPA', 'first-generation WPA')
eq(securityFromProfile('open', 'none'), 'open', 'open')
eq(securityFromProfile('open', 'WEP'), 'WEP', 'open system with WEP key')
eq(securityFromProfile('shared', 'WEP'), 'WEP', 'shared-key WEP')

// ---------- validation ----------
eq(validateInput({ kind: 'wifi', name: 'Casa', security: 'WPA2', password: 'senha-forte' }, true), [], 'a good Wi-Fi entry')
eq(validateInput({ kind: 'wifi', name: '', security: 'WPA2', password: 'senha-forte' }, true).length, 1, 'name required')
eq(validateInput({ kind: 'wifi', name: 'Casa', security: 'WPA2', password: 'curta' }, true).length, 1, 'WPA passwords have 8+ characters')
eq(validateInput({ kind: 'wifi', name: 'Casa', security: 'open' }, true), [], 'open network needs no password')
eq(validateInput({ kind: 'wifi', name: 'Casa', security: 'WPA2' }, false), [], 'editing without a new password keeps the old one')
eq(validateInput({ kind: 'wifi', name: 'x'.repeat(33), security: 'WPA2', password: 'senha-forte' }, true).length, 1, 'SSID up to 32 bytes')
eq(validateInput({ kind: 'wifi', name: 'çãçãçãçãçãçãçãçãç', security: 'WPA2', password: 'senha-forte' }, true).length, 1, '18 accented letters are 36 bytes: too long')
eq(validateInput({ kind: 'router', name: '', url: 'http://192.168.0.1', password: 'N0va' }, true), [], 'router entry')
eq(validateInput({ kind: 'router', name: '', url: 'javascript:alert(1)', password: 'x' }, true).length, 1, 'router address must be http(s)')
eq(validateInput({ kind: 'router', name: '', url: null }, true).length, 1, 'router password required')

// ---------- generated passwords ----------
let seed = 7
const fake = (n: number) => Uint32Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) >>> 0))
const pw = strongPassword(fake)
eq(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/.test(pw), true, 'four groups of four')
eq(/[01lIoO]/.test(pw), false, 'no look-alike characters')
eq(validateInput({ kind: 'wifi', name: 'Casa', security: 'WPA2', password: pw }, true), [], 'valid as a Wi-Fi password')

console.log(`All ${checks} vault checks passed`)
