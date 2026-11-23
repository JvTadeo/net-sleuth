import { createCipheriv, createDecipheriv, createHash, randomInt } from 'node:crypto'

/**
 * The encryption the TP-Link EX / Aginet web panel (EX141 and relatives, "older firmware" variant) uses on
 * /cgi_gdpr: AES-128-CBC with PKCS#7 for the payload, and a 512-bit RSA "signature" without padding over the AES key,
 * the login hash and a sequence number. Written from the panel's own JavaScript (tpEncrypt.js, encrypt.js, proxy.js).
 * Pure functions, no network, so tests can compare them with values the router's code produced.
 */

export interface AesKey {
  key: string
  iv: string
}

/** 16 digits each, like the panel's genKey (time + random digits). */
export function genAesKey(): AesKey {
  const digits = (): string => Array.from({ length: 16 }, () => randomInt(10)).join('')
  return { key: digits(), iv: digits() }
}

export const aesKeyString = (k: AesKey): string => `key=${k.key}&iv=${k.iv}`

export function aesEncrypt(plain: string, k: AesKey): string {
  const c = createCipheriv('aes-128-cbc', Buffer.from(k.key, 'utf8'), Buffer.from(k.iv, 'utf8'))
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64')
}

export function aesDecrypt(b64: string, k: AesKey): string {
  const d = createDecipheriv('aes-128-cbc', Buffer.from(k.key, 'utf8'), Buffer.from(k.iv, 'utf8'))
  return Buffer.concat([d.update(Buffer.from(b64.trim(), 'base64')), d.final()]).toString('utf8')
}

export const md5 = (s: string): string => createHash('md5').update(s, 'utf8').digest('hex')

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base %= mod
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod
    base = (base * base) % mod
    exp >>= 1n
  }
  return result
}

/**
 * Raw RSA over 64-character chunks, each zero-filled on the right to the key size, hex output padded to the key size
 * ("nopadding" in the panel's encrypt.js). Not a safe RSA scheme, but it is what the router expects.
 */
export function rsaNoPad(text: string, nnHex: string, eeHex: string): string {
  const n = BigInt(`0x${nnHex}`)
  const e = BigInt(`0x${eeHex}`)
  const bytes = Math.ceil(n.toString(2).length / 8)
  let out = ''
  for (let i = 0; i < text.length; i += bytes) {
    const block = Buffer.alloc(bytes)
    Buffer.from(text.slice(i, i + bytes), 'utf8').copy(block)
    const c = modPow(BigInt(`0x${block.toString('hex')}`), e, n)
    out += c.toString(16).padStart(bytes * 2, '0')
  }
  return out
}

export interface Session {
  nn: string
  ee: string
  seq: number
  /** md5("user" + password). */
  hash: string
  aes: AesKey
}

/** The body the panel POSTs to /cgi_gdpr: "sign=…\r\ndata=…\r\n". */
export function encryptBody(plain: string, s: Session, isLogin: boolean): string {
  const data = aesEncrypt(plain, s.aes)
  const signed = `${isLogin ? `${aesKeyString(s.aes)}&` : ''}h=${s.hash}&s=${s.seq + data.length}`
  return `sign=${rsaNoPad(signed, s.nn, s.ee)}\r\ndata=${data}\r\n`
}

/** `var nn="…"; var ee="…"; var seq="…";` → values. */
export function parseVars(script: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of script.matchAll(/var\s+(\w+)\s*=\s*"?([^";\r\n]*)"?\s*;/g)) out[m[1]] = m[2]
  return out
}
