/**
 * Devices tests: MAC handling, the sweep range (own home subnet only), merging scans with the user's marks.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import {
  applyAction,
  deviceLabel,
  isPrivateMac,
  isUsableNeighbor,
  mergeScan,
  normalizeMac,
  sweepAddresses,
  sweepRange,
  type DeviceRecord,
  type Neighbor
} from '../src/shared/devices'

let checks = 0
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg)
  checks++
}

// ---------- addresses ----------
eq(normalizeMac('2c-f0-5d-8a-14-3e'), '2C:F0:5D:8A:14:3E', 'Windows dashes to colons')
eq(normalizeMac('nope'), null, 'not a MAC')
eq(isPrivateMac('DA:7E:4A:91:0C:2B'), true, 'randomized phone address')
eq(isPrivateMac('8C:F5:A3:12:77:E1'), false, 'manufacturer address')
eq(isUsableNeighbor('192.168.0.255', 'FF-FF-FF-FF-FF-FF'), false, 'broadcast')
eq(isUsableNeighbor('224.0.0.22', '01-00-5E-00-00-16'), false, 'multicast')
eq(isUsableNeighbor('192.168.0.23', '8C-F5-A3-12-77-E1'), true, 'a phone')

// ---------- sweep range ----------
eq(sweepRange('192.168.0.12/24'), { first: '192.168.0.1', last: '192.168.0.254', count: 254 }, 'home /24')
eq(sweepRange('10.0.5.20/16'), { first: '10.0.5.1', last: '10.0.5.254', count: 254 }, 'big subnet: only the PC\'s /24')
eq(sweepRange('192.168.1.130/26'), { first: '192.168.1.129', last: '192.168.1.190', count: 62 }, 'small subnet')
eq(sweepRange('200.150.10.5/24'), null, 'public address: never swept')
eq(sweepRange('100.64.1.2/24'), null, 'carrier NAT range: not a home network')
eq(sweepAddresses({ first: '192.168.0.1', last: '192.168.0.254' }).length, 254, '254 addresses')

// ---------- merge ----------
const vendorOf = (mac: string) => ({ '8C:F5:A3': 'Samsung', '50:C7:BF': 'TP-Link', '2C:F0:5D': 'Micro-Star' })[mac.slice(0, 8)] ?? null
const self = { mac: '2C:F0:5D:8A:14:3E', ip: '192.168.0.12' }
const router: Neighbor = { ip: '192.168.0.1', mac: '50-C7-BF-21-9A-04', hostname: null }
const phone: Neighbor = { ip: '192.168.0.23', mac: '8C-F5-A3-12-77-E1', hostname: 'Galaxy-S24.home' }
const stranger: Neighbor = { ip: '192.168.0.57', mac: 'DA-7E-4A-91-0C-2B', hostname: null }

const first = mergeScan({ records: [], neighbors: [router, phone], self, gateway: '192.168.0.1', vendorOf, now: 1000 })
eq(first.firstScan, true, 'first look at the network')
eq(first.arrived, [], 'the first scan only sets the baseline: no notification')
eq(first.devices.map((d) => d.status), ['self', 'router', 'new'], 'this PC, the router, then the phone as new')
eq(first.devices[1].vendor, 'TP-Link', 'manufacturer from the table')

const known = applyAction(first.records, { op: 'rename', mac: '8C:F5:A3:12:77:E1', name: 'Celular do João' }, 2000)
eq(known.find((r) => r.mac === '8C:F5:A3:12:77:E1')?.status, 'known', 'naming a new device marks it known')

const second = mergeScan({ records: known, neighbors: [router, phone, stranger], self, gateway: '192.168.0.1', vendorOf, now: 3000 })
eq(second.arrived.map((d) => d.mac), ['DA:7E:4A:91:0C:2B'], 'a device never seen before arrives')
eq(second.arrived[0].privateMac, true, 'with a private address, so no manufacturer')
eq(deviceLabel(second.devices.find((d) => d.mac === '8C:F5:A3:12:77:E1')!), 'Celular do João', 'the user\'s name wins')

const blocked = applyAction(second.records, { op: 'blocked', mac: 'DA:7E:4A:91:0C:2B' }, 4000)
eq(blocked.find((r) => r.status === 'blocked')?.blockedAt, 4000, 'blocking keeps the date')
const third = mergeScan({ records: blocked, neighbors: [router, phone], self, gateway: '192.168.0.1', vendorOf, now: 5000 })
const gone = third.devices.find((d) => d.mac === 'DA:7E:4A:91:0C:2B')!
eq([gone.status, gone.online, gone.lastSeen], ['blocked', false, 3000], 'blocked device away: kept, offline, last seen kept')
eq(third.arrived, [], 'nothing new')
eq(third.devices[third.devices.length - 1].mac, 'DA:7E:4A:91:0C:2B', 'offline devices go last')

const undone = applyAction(blocked, { op: 'unblock', mac: 'DA:7E:4A:91:0C:2B' }, 6000)
eq(undone.find((r) => r.mac === 'DA:7E:4A:91:0C:2B')?.status, 'known', 'undo: back to known')
eq(applyAction(undone, { op: 'forget', mac: 'DA:7E:4A:91:0C:2B' }, 7000).length, undone.length - 1, 'forget removes it')

const unnamed: DeviceRecord = { mac: 'AA:BB:CC:00:11:22', name: null, status: 'new', firstSeen: 0, lastSeen: 0, lastIp: null, hostname: 'Galaxy-S24.home', blockedAt: null }
eq(deviceLabel({ ...unnamed, status: 'new' }), 'Galaxy-S24', 'announced name without the .home suffix')
eq(deviceLabel({ name: null, hostname: null, status: 'new' }), 'Aparelho desconhecido', 'no name at all')

console.log(`All ${checks} devices checks passed`)
