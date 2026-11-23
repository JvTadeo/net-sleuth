/**
 * Saved passwords ("Senhas e QR"): types and the pure helpers around them.
 * Passwords themselves never travel in these types; the window asks for one only to show or print it.
 */

export type VaultKind = 'wifi' | 'guest' | 'router'

export const VAULT_KINDS: readonly VaultKind[] = ['wifi', 'guest', 'router']

export type WifiSecurity = 'WPA2' | 'WPA3' | 'WPA' | 'WEP' | 'open'

export const WIFI_SECURITIES: readonly WifiSecurity[] = ['WPA2', 'WPA3', 'WPA', 'WEP', 'open']

export const KIND_LABEL: Record<VaultKind, string> = { wifi: 'Wi-Fi principal', guest: 'Convidados', router: 'Roteador' }

export const SECURITY_LABEL: Record<WifiSecurity, string> = {
  WPA2: 'WPA2-Personal',
  WPA3: 'WPA3-Personal',
  WPA: 'WPA (antigo)',
  WEP: 'WEP (inseguro)',
  open: 'Aberta, sem senha'
}

/** What the window sees: everything except the password. */
export interface VaultEntry {
  id: string
  kind: VaultKind
  /** Wi-Fi: the network name (SSID). Router: a label, "Painel do roteador" by default. */
  name: string
  security: WifiSecurity | null
  /** Wi-Fi network that does not broadcast its name. */
  hidden: boolean
  /** Router panel address, "http://192.168.0.1". */
  url: string | null
  user: string | null
  hasPassword: boolean
  /** "typed" by the user, or imported from a Windows Wi-Fi profile. */
  source: 'typed' | 'windows'
  updatedAt: number
}

/** Add or edit. A missing password on edit keeps the old one. */
export interface VaultInput {
  id?: string
  kind: VaultKind
  name: string
  security?: WifiSecurity | null
  hidden?: boolean
  url?: string | null
  user?: string | null
  password?: string
}

export interface WindowsWifiProfile {
  name: string
  security: WifiSecurity
  /** Windows handed over the password (some profiles need admin mode). */
  hasKey: boolean
  /** Already saved in the app. */
  saved: boolean
}

export interface QrDrawing {
  /** SVG path in module units, for viewBox "0 0 size size". */
  path: string
  size: number
}

export interface VaultActionResult {
  done: boolean
  message: string
}

// ---------- Wi-Fi QR ----------

/** Characters with a meaning in the Wi-Fi QR format get a backslash. */
export const escapeQr = (s: string): string => s.replace(/([\\;,:"])/g, '\\$1')

/**
 * The text a phone camera understands as "join this Wi-Fi":
 * WIFI:T:WPA;S:<name>;P:<password>;H:true;; ("WPA" covers WPA, WPA2 and WPA3 on iPhone and Android).
 */
export function wifiQrText(ssid: string, password: string, security: WifiSecurity, hidden: boolean): string {
  const type = security === 'open' ? 'nopass' : security === 'WEP' ? 'WEP' : 'WPA'
  const parts = [`T:${type}`, `S:${escapeQr(ssid)}`]
  if (type !== 'nopass') parts.push(`P:${escapeQr(password)}`)
  if (hidden) parts.push('H:true')
  return `WIFI:${parts.join(';')};;`
}

/** Windows profile XML authentication → the app's security names. */
export function securityFromProfile(auth: string, encryption: string): WifiSecurity {
  const a = auth.toLowerCase()
  if (a === 'open') return encryption.toLowerCase() === 'wep' ? 'WEP' : 'open'
  if (a === 'shared') return 'WEP'
  if (a.startsWith('wpa3')) return 'WPA3'
  if (a.startsWith('wpa2')) return 'WPA2'
  if (a.startsWith('wpa')) return 'WPA'
  return 'WPA2'
}

// ---------- validation ----------

/** Problems with an entry, in Portuguese; empty when it can be saved. */
export function validateInput(input: VaultInput, isNew: boolean): string[] {
  const errors: string[] = []
  const name = input.name?.trim() ?? ''
  if (!VAULT_KINDS.includes(input.kind)) errors.push('Tipo inválido.')
  if (input.kind === 'router') {
    if (input.url && !/^https?:\/\/[^\s/]+/i.test(input.url.trim())) errors.push('O endereço do painel deve começar com http:// ou https://.')
    if (isNew && !input.password) errors.push('Digite a senha do painel do roteador.')
  } else {
    if (!name) errors.push('Digite o nome da rede.')
    if (new TextEncoder().encode(name).length > 32) errors.push('O nome da rede tem no máximo 32 caracteres.')
    const security = input.security ?? 'WPA2'
    if (!WIFI_SECURITIES.includes(security)) errors.push('Tipo de segurança inválido.')
    const pw = input.password
    if (security !== 'open' && (isNew || pw !== undefined)) {
      if (!pw) errors.push('Digite a senha da rede.')
      else if (security !== 'WEP' && (pw.length < 8 || pw.length > 63)) errors.push('A senha do Wi-Fi tem de 8 a 63 caracteres.')
    }
  }
  if ((input.password?.length ?? 0) > 256) errors.push('Senha longa demais.')
  return errors
}

/** A strong password that is still easy to type on a phone: 4 groups of letters and digits, no look-alikes. */
export function strongPassword(random: (n: number) => Uint32Array): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const r = random(16)
  const groups: string[] = []
  for (let g = 0; g < 4; g++) {
    let s = ''
    for (let i = 0; i < 4; i++) s += chars[r[g * 4 + i] % chars.length]
    groups.push(s)
  }
  return groups.join('-')
}
