/**
 * Pure parsers for Windows command output. ping.exe and netsh are translated into the Windows display language,
 * so these rely on what stays the same everywhere (TTL=, ms, %, SSID) plus short lists of translated labels.
 */

import { bandOf, type LinkKind, type WifiDetails } from '@shared/network'

/**
 * Round-trip time from one ping reply, in ms; null when there was no reply.
 * Windows: "Resposta de 1.1.1.1: bytes=32 tempo=14ms TTL=57" or "… tempo<1ms TTL=64" (any language).
 * Linux (used when developing): "64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=14.2 ms".
 */
export function parsePingTime(output: string): number | null {
  for (const line of output.split(/\r?\n/)) {
    if (!/ttl[=:]/i.test(line)) continue
    const m = line.match(/([=<])\s*(\d+(?:[.,]\d+)?)\s*ms\b/i)
    if (!m) continue
    const value = Number(m[2].replace(',', '.'))
    return m[1] === '<' ? Math.min(value, 1) / 2 : value
  }
  return null
}

const CHANNEL = new Set(['channel', 'canal', 'kanal', 'canale'])
const AUTH = new Set(['authentication', 'autenticação', 'autenticación', 'authentification', 'authentifizierung', 'autenticazione'])
const SIGNAL = new Set(['signal', 'sinal', 'señal', 'segnale'])

/** Reads `netsh wlan show interfaces`: "    SSID                   : Casa_5G". Returns null when there is no SSID. */
export function parseNetshWifi(text: string | null | undefined): WifiDetails | null {
  if (!text) return null
  let ssid: string | null = null
  let signal: number | null = null
  let channel: number | null = null
  let auth: string | null = null
  let band: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const i = raw.indexOf(':')
    if (i < 0) continue
    const key = raw.slice(0, i).trim().toLowerCase()
    const value = raw.slice(i + 1).trim()
    if (!value) continue
    if (key === 'ssid' && ssid === null) ssid = value
    else if ((SIGNAL.has(key) || /^\d{1,3}\s*%$/.test(value)) && signal === null) {
      const m = value.match(/^(\d{1,3})\s*%$/)
      if (m) signal = Math.min(100, Number(m[1]))
    } else if (CHANNEL.has(key) && channel === null && /^\d+$/.test(value)) channel = Number(value)
    else if (AUTH.has(key) && auth === null) auth = value
    else if (/^\d+([.,]\d+)?\s*GHz$/i.test(value) && band === null) band = value.replace('.', ',')
  }
  if (!ssid) return null
  return { ssid, signal, channel, band: band ?? bandOf(channel), auth }
}

/** Get-NetAdapter's PhysicalMediaType: "802.3" (cable), "Native 802.11" (Wi-Fi), others. */
export function linkKindOf(physicalMediaType: string): LinkKind {
  if (/802\.11/.test(physicalMediaType)) return 'wifi'
  if (/802\.3/.test(physicalMediaType)) return 'ethernet'
  return 'other'
}
