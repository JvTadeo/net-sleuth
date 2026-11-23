import { request } from 'node:http'
import { aesDecrypt, encryptBody, genAesKey, md5, parseVars, type Session } from './tplink-ex-crypto'

/**
 * Reads the list of devices a TP-Link EX / Aginet router (EX141 and relatives) knows, with the user's own panel
 * password: log in the way the web panel does, read DEV2_HOST_ENTRY, log out. Nothing is changed on the router.
 *
 * Care taken: the panel allows one administrator at a time, so if someone is already logged in the app does not
 * log in (it would kick them out). The caller stops retrying after a refused password, because the router locks the
 * panel after several wrong attempts.
 */

export interface RouterHost {
  mac: string
  ip: string | null
  hostname: string | null
  active: boolean
  /** DHCP vendor class: "android-dhcp-17", "MSFT 5.0"… */
  vendorClass: string | null
  /** What the router thinks the system is: "Android", "iOS", "Windows"… */
  clientType: string | null
}

export type RouterErrorCode = 'busy' | 'auth' | 'unreachable' | 'protocol'

export class RouterError extends Error {
  constructor(
    public code: RouterErrorCode,
    message: string
  ) {
    super(message)
  }
}

const EMPTY_STACK = { stack: '0,0,0,0,0,0', pstack: '0,0,0,0,0,0' }
const TIMEOUT_MS = 6000

interface HttpResult {
  status: number
  body: string
}

export class TplinkExClient {
  private token = '0'
  /** Session cookies the panel sets (HttpOnly in the browser, so invisible to its own scripts). */
  private cookies = new Map<string, string>()

  constructor(private host: string) {}

  private remember(setCookie: string[] | undefined): void {
    for (const line of setCookie ?? []) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (!value || /deleted/i.test(value)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  private cookieHeader(): Record<string, string> {
    return this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}
  }

  private http(method: 'GET' | 'POST', path: string, body?: string): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: this.host,
          port: 80,
          method,
          path,
          timeout: TIMEOUT_MS,
          headers: {
            'Content-Type': 'text/plain',
            TokenID: this.token,
            Referer: `http://${this.host}/`,
            ...this.cookieHeader(),
            ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {})
          }
        },
        (res) => {
          this.remember(res.headers['set-cookie'])
          const chunks: Buffer[] = []
          let size = 0
          res.on('data', (c: Buffer) => {
            size += c.length
            if (size > 4 * 1024 * 1024) req.destroy(new Error('response too large'))
            else chunks.push(c)
          })
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
          res.on('error', reject)
        }
      )
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', (err) => reject(new RouterError('unreachable', `O roteador não respondeu (${err.message}).`)))
      if (body !== undefined) req.write(body)
      req.end()
    })
  }

  /** The panel's public RSA key and sequence number; also tells whether this router speaks this protocol. */
  private async params(): Promise<{ nn: string; ee: string; seq: number }> {
    const res = await this.http('POST', '/cgi/getGDPRParm', '')
    const v = parseVars(res.body)
    if (res.status !== 200 || !/^[0-9a-f]+$/i.test(v.nn ?? '') || !/^[0-9a-f]+$/i.test(v.ee ?? '') || !/^\d+$/.test(v.seq ?? '')) {
      throw new RouterError('protocol', 'Este roteador não usa o painel TP-Link EX/Aginet.')
    }
    return { nn: v.nn, ee: v.ee, seq: Number(v.seq) }
  }

  /** True when the gateway answers like a TP-Link EX/Aginet panel. Never logs in. */
  static async detect(host: string): Promise<boolean> {
    try {
      await new TplinkExClient(host).params()
      return true
    } catch {
      return false
    }
  }

  private async gdpr(plain: string, s: Session, isLogin: boolean): Promise<string> {
    const res = await this.http('POST', '/cgi_gdpr?9', encryptBody(plain, s, isLogin))
    if (res.status !== 200) throw new RouterError(res.status === 403 ? 'auth' : 'protocol', `O roteador respondeu ${res.status}.`)
    try {
      return aesDecrypt(res.body, s.aes)
    } catch {
      throw new RouterError('protocol', 'Resposta do roteador em formato inesperado.')
    }
  }

  async readHosts(password: string): Promise<RouterHost[]> {
    const busy = parseVars((await this.http('POST', '/cgi/getBusy', '')).body)
    if (busy.isLogined === '1') {
      throw new RouterError('busy', 'O painel do roteador está aberto em outro lugar; os nomes serão lidos quando ele for fechado.')
    }

    const { nn, ee, seq } = await this.params()
    const user = 'user' // the EX panel logs in as "user"; the screen only asks for the password
    const s: Session = { nn, ee, seq, hash: md5(user + password), aes: genAesKey() }

    const loginPlain = `${JSON.stringify({
      data: {
        UserName: Buffer.from(user, 'utf8').toString('base64'),
        Passwd: Buffer.from(password, 'utf8').toString('base64'),
        Action: '1',
        ...EMPTY_STACK
      },
      operation: 'cgi',
      oid: '/cgi/login'
    })}\r\n`
    // From here on a session may exist on the router, so logout always runs, whatever happens.
    try {
      const loginReply = await this.gdpr(loginPlain, s, true)
      const ret = /\$\.ret\s*=\s*(\d+)/.exec(loginReply)?.[1]
      if (ret && ret !== '0') throw new RouterError('auth', `O roteador recusou a senha guardada em Senhas e QR (código ${ret}).`)

      // The page served after login carries the session token every request must send.
      const page = await this.http('GET', '/')
      const token = /var\s+token\s*=\s*"([^"]+)"/.exec(page.body)?.[1]
      if (!token) throw new RouterError('protocol', 'O roteador aceitou o login, mas não abriu a sessão para o app. Tente de novo em alguns minutos.')
      this.token = token

      const listPlain = `${JSON.stringify({ data: EMPTY_STACK, operation: 'gl', oid: 'DEV2_HOST_ENTRY' })}\r\n`
      const reply = JSON.parse(await this.gdpr(listPlain, s, false)) as { data?: Record<string, string>[] }
      const rows = Array.isArray(reply.data) ? reply.data : []
      return rows
        .filter((h) => h && h.physAddress)
        .map((h) => ({
          mac: h.physAddress,
          ip: h.IPAddress || null,
          hostname: h.hostName || h.alias || null,
          active: h.active === '1',
          vendorClass: h.vendorClassID || null,
          clientType: h.X_TP_ClientType || null
        }))
    } finally {
      // The panel only takes one administrator at a time: never leave the app's session open.
      await this.gdpr(`${JSON.stringify({ data: EMPTY_STACK, operation: 'cgi', oid: '/cgi/logout' })}\r\n`, s, false).catch(() => undefined)
    }
  }
}
