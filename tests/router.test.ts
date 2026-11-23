/**
 * TP-Link EX/Aginet panel tests. The expected values were produced by the router's own JavaScript (EX141 panel)
 * with a fake password and a fixed AES key, so the app's encryption must match them byte for byte.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { aesDecrypt, aesEncrypt, encryptBody, md5, parseVars, rsaNoPad } from '../src/main/routers/tplink-ex-crypto'
import { mergeScan, osOf, type RouterInfo } from '../src/shared/devices'

let checks = 0
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg)
  checks++
}

const nn = 'D4AD45A2249B242D70AB55B56044D4EF9CF56E0B89097E8A92E93403001D47BD26F4911D606631DF692825418E51B92C8BBC355FC55CF33582C2E3D9D8623531'
const session = { nn, ee: '010001', seq: 838041913, hash: md5('usersenha-de-teste'), aes: { key: '1234567890123456', iv: '6543210987654321' } }

eq(session.hash, '736aa005dfdb9ea7e2e341c6384b0f9e', 'login hash = md5("user" + password)')

const loginPlain =
  JSON.stringify({
    data: { UserName: 'dXNlcg==', Passwd: Buffer.from('senha-de-teste').toString('base64'), Action: '1', stack: '0,0,0,0,0,0', pstack: '0,0,0,0,0,0' },
    operation: 'cgi',
    oid: '/cgi/login'
  }) + '\r\n'
const loginBody = encryptBody(loginPlain, session, true)
eq(
  loginBody,
  'sign=9ac3a023653f6a93fadd7981b0010cb3e44a42a461860c11cab21ee8ba0cdeea7f4c91acb435607138ca6b1b09a486981a2a440db97fa8ee5b65c9bf9dfe6b40ad89c113573f30a065059bad0d1eb41efc34460f00becb483446fe14216578e18c0ce48b8ac214cc3c3aa45f143bcd3d769fb581d3a97eba087399e728b0fb3a\r\n' +
    'data=B4y0IXtDu0/oiuAXm5w8Sa6D3M7gmng8D8ZcSd6pXAOmFLH/fCQZLtobz2ane28FFHa2o3I95KGChmUCKe6GAsfY6wn0//3QGoyy6X3smjxDsKNb5hy605nawJqoK0iGIHK2wyElumh2XPTj3EUmgGy/S1CuYkhhkpQlsZb7qqUGFvt98knzmNYlC4GR7Pq+mRXkz0OSG2J+qvj+tLxZHq9mbkvaD6oqIpdgDL2eNr0=\r\n',
  'login request identical to the panel\'s (AES data + 2-block RSA signature)'
)
const listPlain = '{"data":{"stack":"0,0,0,0,0,0","pstack":"0,0,0,0,0,0"},"operation":"gl","oid":"DEV2_HOST_ENTRY"}\r\n'
eq(
  encryptBody(listPlain, session, false).split('\r\n')[0],
  'sign=ca0d2bd19eb61b32d5885b6b4d424c077c34203a37ad5b65ec4f649a102ece5e93af0e00061445f56f5e6bfceaa4918b318e5817beb6c509f2b28dbe6049b044',
  'device list request signed like the panel'
)
eq(aesDecrypt(aesEncrypt('{"data":[]}', session.aes), session.aes), '{"data":[]}', 'AES round trip')
eq(rsaNoPad('a', nn, '010001').length, 128, 'one RSA block is 128 hex characters')
eq(parseVars('var ee="010001";\nvar nn="ABCD";\nvar seq="123";'), { ee: '010001', nn: 'ABCD', seq: '123' }, 'panel variables')
eq(parseVars('var isLogined=1;\nvar isBusy=0;'), { isLogined: '1', isBusy: '0' }, 'getBusy reply')

// ---------- what the router says about devices ----------
eq(osOf('Android', 'android-dhcp-17'), 'Android', 'Android phone')
eq(osOf(null, 'MSFT 5.0'), 'Windows', 'Windows PC')
eq(osOf('Other', ''), null, 'unknown')

const routerInfo = new Map<string, RouterInfo>([
  ['DA:5E:00:12:34:56', { hostname: 'moto-g54', os: 'Android' }],
  ['6E:2A:00:65:43:21', { hostname: 'Galaxy-S23', os: 'Android' }]
])
const merged = mergeScan({
  records: [
    { mac: '6E:2A:00:65:43:21', name: null, status: 'new', firstSeen: 1, lastSeen: 1, lastIp: '192.168.0.8', hostname: null, blockedAt: null }
  ],
  neighbors: [{ ip: '192.168.0.4', mac: 'DA-5E-00-12-34-56', hostname: null }],
  self: null,
  gateway: '192.168.0.1',
  vendorOf: () => null,
  routerInfo,
  now: 10
})
const moto = merged.devices.find((d) => d.mac === 'DA:5E:00:12:34:56')!
eq([moto.hostname, moto.type, moto.typeConfidence, moto.os], ['moto-g54', 'phone', 'medium', 'Android'], 'router name and system for a private-address phone')
const away = merged.devices.find((d) => d.mac === '6E:2A:00:65:43:21')!
eq([away.online, away.hostname], [false, 'Galaxy-S23'], 'a device that is away still gets its router name')

console.log(`All ${checks} router checks passed`)
