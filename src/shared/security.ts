/**
 * The security checklist: facts read from Windows go in, checks with Portuguese text come out.
 * Pure functions only, so the wording and the verdicts are tested without Windows.
 */

export type CheckStatus = 'ok' | 'warn' | 'info' | 'na'

export type CheckId = 'ports' | 'doh' | 'firewall' | 'profile' | 'rdp' | 'smb1' | 'hosts' | 'proxy' | 'router' | 'wifi'

export type SecFixId = 'firewallOn' | 'profilePublic' | 'profilePrivate' | 'smb1Off' | 'blockApp' | 'unblockApp' | 'forgetWifi'

export const SEC_FIX_IDS: readonly SecFixId[] = ['firewallOn', 'profilePublic', 'profilePrivate', 'smb1Off', 'blockApp', 'unblockApp', 'forgetWifi']

export type SettingsTarget = 'remoteDesktop' | 'proxy' | 'firewall' | 'hosts'

export type CheckAction =
  | { kind: 'fix'; fix: SecFixId; label: string; admin: boolean }
  | { kind: 'page'; page: 'dns' | 'passwords'; label: string }
  | { kind: 'settings'; target: SettingsTarget; label: string }

export interface SecurityCheck {
  id: CheckId
  status: CheckStatus
  title: string
  /** One line for the list. */
  short: string
  found: string
  why: string
  action?: CheckAction
}

export type FirewallProfileName = 'Domain' | 'Private' | 'Public'

export interface ListeningApp {
  /** Friendly name: the program's description, else its process name. */
  name: string
  process: string
  /** Full path to the .exe; empty when Windows did not tell (system processes without admin). */
  path: string
  ports: number[]
  /** Part of Windows itself (file sharing, network discovery…). */
  system: boolean
  /** Blocked by a firewall rule this app created. */
  blocked: boolean
}

export interface HostsEntry {
  ip: string
  name: string
  /** "block": sent to 0.0.0.0 or 127.0.0.1 (ad blockers do this); "redirect": sent somewhere else. */
  kind: 'block' | 'redirect'
}

export interface WifiProfile {
  name: string
  /** As stored in the profile XML: open, shared, WPAPSK, WPA2PSK, WPA3SAE, OWE… */
  auth: string
  /** none, WEP, TKIP, AES, GCMP… */
  encryption: string
}

export interface SecurityFacts {
  firewall: { name: FirewallProfileName; enabled: boolean }[] | null
  profile: { alias: string; category: 'Public' | 'Private' | 'DomainAuthenticated' } | null
  listening: ListeningApp[]
  rdpEnabled: boolean | null
  smb1Enabled: boolean | null
  hosts: HostsEntry[] | null
  proxy: { enabled: boolean; server: string | null; pac: string | null }
  hasWifiAdapter: boolean
  /** null when the profiles could not be read. */
  wifiProfiles: WifiProfile[] | null
}

export interface SecurityContext {
  dnsEncrypted: boolean
  dohSupported: boolean
}

export interface SecurityReport {
  facts: SecurityFacts
  checks: SecurityCheck[]
  checkedAt: number
}

export interface SecFixRequest {
  id: SecFixId
  /** The program path (block/unblock) or the Wi-Fi name (forget). */
  arg?: string
}

export interface SecFixResult {
  done: boolean
  message: string
  /** The checklist again, after the change. */
  report?: SecurityReport
}

// ---------- helpers ----------

/** Windows processes that listen on the network as part of the system itself. */
const SYSTEM_PROCESSES = new Set([
  'system',
  'svchost',
  'lsass',
  'wininit',
  'services',
  'spoolsv',
  'winlogon',
  'csrss',
  'smss',
  'lsaiso',
  'searchindexer',
  'msmpeng',
  'nissrv',
  'wmpnetwk',
  'mdnsresponder'
])

/** True for a Windows component (by name, or by living in the Windows folder). */
export function isSystemProcess(process: string, path: string): boolean {
  if (SYSTEM_PROCESSES.has(process.toLowerCase().replace(/\.exe$/, ''))) return true
  return /^[a-z]:\\windows\\/i.test(path)
}

const LOCAL_NAMES = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost'])
const BLOCK_IPS = new Set(['0.0.0.0', '127.0.0.1', '::1', '::', '::0'])

/** Non-default lines of the hosts file. Comments, blank lines and the localhost entries are skipped. */
export function parseHosts(text: string): HostsEntry[] {
  const out: HostsEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const [ip, ...names] = line.split(/\s+/)
    for (const name of names) {
      if (LOCAL_NAMES.has(name.toLowerCase())) continue
      out.push({ ip, name, kind: BLOCK_IPS.has(ip) ? 'block' : 'redirect' })
    }
  }
  return out
}

/** Why a saved Wi-Fi network is weak, or null when its protection is fine. */
export function wifiRisk(p: Pick<WifiProfile, 'auth' | 'encryption'>): string | null {
  const auth = p.auth.toLowerCase()
  const enc = p.encryption.toLowerCase()
  if (auth === 'open' && (enc === 'none' || enc === '')) return 'Aberta, sem senha'
  if (auth === 'shared' || enc === 'wep') return 'Proteção WEP, quebrada há anos'
  if (auth === 'wpapsk' || auth === 'wpa') return 'WPA da primeira geração, considerado inseguro'
  if (enc === 'tkip') return 'Criptografia TKIP, antiga e fraca'
  return null
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const PROFILE_NAME: Record<FirewallProfileName, string> = { Domain: 'de domínio', Private: 'privada', Public: 'pública' }

const ORDER: Record<CheckStatus, number> = { warn: 0, ok: 1, info: 2, na: 3 }

// ---------- the checklist ----------

export function buildChecks(f: SecurityFacts, ctx: SecurityContext): SecurityCheck[] {
  const checks: SecurityCheck[] = []

  // Open ports
  const exposed = f.listening.filter((a) => !a.system && !a.blocked)
  const blocked = f.listening.filter((a) => a.blocked)
  const portsWhy =
    'Cada porta aberta é uma porta de entrada. Programas que você não usa mais não deveriam ficar escutando. O firewall ainda pode estar barrando parte dessas conexões.'
  checks.push(
    exposed.length
      ? {
          id: 'ports',
          status: 'warn',
          title: 'Portas abertas',
          short: `${plural(exposed.length, 'programa aceita', 'programas aceitam')} conexões de outros aparelhos`,
          found:
            'Estes programas estão aceitando conexões vindas da rede. Isso não quer dizer que sejam perigosos: muitos fazem isso para funcionar (jogos, música em outros aparelhos, servidores de desenvolvimento). Vale saber quem está aberto.',
          why: portsWhy
        }
      : {
          id: 'ports',
          status: 'ok',
          title: 'Portas abertas',
          short: blocked.length ? `Nenhuma aberta; ${plural(blocked.length, 'programa bloqueado', 'programas bloqueados')} por você` : 'Nenhum programa aceita conexões de fora',
          found: 'Só serviços do próprio Windows aceitam conexões vindas da rede.',
          why: portsWhy
        }
  )

  // Encrypted DNS
  const dohWhy = 'Sem criptografia, a rede e a operadora conseguem ver, e até alterar, quais sites você acessa.'
  checks.push(
    ctx.dnsEncrypted
      ? { id: 'doh', status: 'ok', title: 'DNS criptografado', short: 'Ligado', found: 'As consultas de DNS saem criptografadas.', why: dohWhy }
      : !ctx.dohSupported
        ? {
            id: 'doh',
            status: 'info',
            title: 'DNS criptografado',
            short: 'Precisa do Windows 11',
            found: 'Esta versão do Windows não criptografa o DNS. Navegadores como Chrome, Edge e Firefox têm a opção "DNS seguro" nas configurações.',
            why: dohWhy
          }
        : {
            id: 'doh',
            status: 'warn',
            title: 'DNS criptografado',
            short: 'Desligado',
            found: 'As consultas de DNS saem sem criptografia.',
            why: dohWhy,
            action: { kind: 'page', page: 'dns', label: 'Ligar na página DNS' }
          }
  )

  // Firewall
  const fwWhy = 'O firewall bloqueia conexões que você não pediu. Desligado, qualquer aparelho da rede tenta falar com o PC.'
  if (!f.firewall?.length) {
    checks.push({ id: 'firewall', status: 'info', title: 'Firewall do Windows', short: 'Não foi possível ler', found: 'O Windows não respondeu sobre o firewall.', why: fwWhy })
  } else {
    const off = f.firewall.filter((p) => !p.enabled)
    checks.push(
      off.length
        ? {
            id: 'firewall',
            status: 'warn',
            title: 'Firewall do Windows',
            short: `Desligado na rede ${off.map((p) => PROFILE_NAME[p.name]).join(' e ')}`,
            found: `O Firewall do Windows está desligado na rede ${off.map((p) => PROFILE_NAME[p.name]).join(' e ')}. Se um antivírus com firewall próprio estiver instalado, ele pode ter assumido esse papel.`,
            why: fwWhy,
            action: { kind: 'fix', fix: 'firewallOn', label: 'Ligar o firewall', admin: true }
          }
        : {
            id: 'firewall',
            status: 'ok',
            title: 'Firewall do Windows',
            short: 'Ligado nas redes públicas e privadas',
            found: 'O Firewall do Windows está ligado em todos os tipos de rede.',
            why: fwWhy
          }
    )
  }

  // Network profile
  const profWhy = 'Em cafés, hotéis e aeroportos, a rede deve ser Pública: o PC fica invisível para os outros aparelhos.'
  if (!f.profile) {
    checks.push({ id: 'profile', status: 'info', title: 'Tipo de rede', short: 'Sem conexão ativa', found: 'Não há uma rede ativa para conferir.', why: profWhy })
  } else if (f.profile.category === 'Private') {
    checks.push({
      id: 'profile',
      status: 'ok',
      title: 'Tipo de rede',
      short: 'Marcada como Privada',
      found: `A rede atual (${f.profile.alias}) está como Privada: outros aparelhos da rede conseguem ver este PC, o que faz sentido em casa.`,
      why: profWhy,
      action: { kind: 'fix', fix: 'profilePublic', label: 'Mudar para Pública', admin: true }
    })
  } else if (f.profile.category === 'Public') {
    checks.push({
      id: 'profile',
      status: 'ok',
      title: 'Tipo de rede',
      short: 'Marcada como Pública',
      found: `A rede atual (${f.profile.alias}) está como Pública: o PC fica invisível para outros aparelhos. É a opção mais protegida; em casa, só mude para Privada se quiser compartilhar arquivos ou impressora.`,
      why: profWhy,
      action: { kind: 'fix', fix: 'profilePrivate', label: 'Mudar para Privada', admin: true }
    })
  } else {
    checks.push({
      id: 'profile',
      status: 'ok',
      title: 'Tipo de rede',
      short: 'Rede de empresa',
      found: 'A rede atual é gerenciada por uma empresa (domínio).',
      why: profWhy
    })
  }

  // Remote Desktop
  const rdpWhy = 'Ligada e exposta, é um dos alvos mais atacados na internet.'
  checks.push(
    f.rdpEnabled
      ? {
          id: 'rdp',
          status: 'warn',
          title: 'Área de Trabalho Remota',
          short: 'Ligada',
          found: 'Outros computadores podem pedir para controlar este PC pelo recurso do Windows. Se você não usa, desligue.',
          why: rdpWhy,
          action: { kind: 'settings', target: 'remoteDesktop', label: 'Abrir configurações' }
        }
      : f.rdpEnabled === false
        ? { id: 'rdp', status: 'ok', title: 'Área de Trabalho Remota', short: 'Desligada', found: 'Ninguém consegue controlar este PC remotamente pelo recurso do Windows.', why: rdpWhy }
        : { id: 'rdp', status: 'na', title: 'Área de Trabalho Remota', short: 'Não existe nesta versão', found: 'Esta edição do Windows não recebe conexões da Área de Trabalho Remota.', why: rdpWhy }
  )

  // SMBv1
  const smbWhy =
    'O SMBv1 foi a porta de entrada de ataques famosos, como o WannaCry. Só aparelhos muito antigos (NAS ou impressoras de mais de dez anos) ainda precisam dele.'
  checks.push(
    f.smb1Enabled
      ? {
          id: 'smb1',
          status: 'warn',
          title: 'Compartilhamento antigo (SMBv1)',
          short: 'Ligado',
          found: 'A versão antiga e insegura do compartilhamento de arquivos está ativa.',
          why: smbWhy,
          action: { kind: 'fix', fix: 'smb1Off', label: 'Desligar o SMBv1', admin: true }
        }
      : f.smb1Enabled === false
        ? { id: 'smb1', status: 'ok', title: 'Compartilhamento antigo (SMBv1)', short: 'Desligado', found: 'A versão antiga e insegura do compartilhamento de arquivos está desativada.', why: smbWhy }
        : {
            id: 'smb1',
            status: 'info',
            title: 'Compartilhamento antigo (SMBv1)',
            short: 'Confere no modo administrador',
            found: 'O Windows só informa esse item no modo administrador.',
            why: smbWhy
          }
  )

  // Hosts file
  const hostsWhy = 'Programas maliciosos editam esse arquivo para mandar o navegador a sites falsos.'
  const show: CheckAction = { kind: 'settings', target: 'hosts', label: 'Mostrar o arquivo' }
  if (!f.hosts) {
    checks.push({ id: 'hosts', status: 'info', title: 'Arquivo hosts', short: 'Não foi possível ler', found: 'O arquivo não pôde ser aberto.', why: hostsWhy })
  } else {
    const redirects = f.hosts.filter((h) => h.kind === 'redirect')
    const blocks = f.hosts.filter((h) => h.kind === 'block')
    if (redirects.length) {
      checks.push({
        id: 'hosts',
        status: 'warn',
        title: 'Arquivo hosts',
        short: `${plural(redirects.length, 'endereço desviado', 'endereços desviados')}`,
        found: 'Estes sites estão sendo mandados para outro endereço. Se não foi você (ou um programa que você conhece, como um servidor de desenvolvimento), desconfie.',
        why: hostsWhy,
        action: show
      })
    } else if (blocks.length) {
      checks.push({
        id: 'hosts',
        status: 'info',
        title: 'Arquivo hosts',
        short: `${plural(blocks.length, 'site bloqueado', 'sites bloqueados')}`,
        found:
          'Estes sites estão bloqueados no próprio PC, algo comum em bloqueadores de anúncios. Confira se nenhum é de um antivírus ou do Windows Update: vírus bloqueiam esses endereços para não serem removidos.',
        why: hostsWhy,
        action: show
      })
    } else {
      checks.push({ id: 'hosts', status: 'ok', title: 'Arquivo hosts', short: 'Sem desvios', found: 'O arquivo tem só as linhas padrão do Windows.', why: hostsWhy })
    }
  }

  // Proxy
  const proxyWhy = 'Um proxy que você não configurou pode estar espionando ou desviando sua navegação.'
  const proxyOn = f.proxy.enabled || !!f.proxy.pac
  checks.push(
    proxyOn
      ? {
          id: 'proxy',
          status: 'warn',
          title: 'Proxy',
          short: `Em uso: ${f.proxy.enabled && f.proxy.server ? f.proxy.server : f.proxy.pac ?? 'script automático'}`,
          found: `A navegação passa por ${f.proxy.enabled && f.proxy.server ? `um proxy (${f.proxy.server})` : `um script de configuração (${f.proxy.pac})`}. Em empresas e escolas isso é normal; em casa, só se você mesmo configurou.`,
          why: proxyWhy,
          action: { kind: 'settings', target: 'proxy', label: 'Abrir configurações de proxy' }
        }
      : { id: 'proxy', status: 'ok', title: 'Proxy', short: 'Nenhum configurado', found: 'O tráfego não passa por nenhum proxy.', why: proxyWhy }
  )

  // Router password (never tested, on purpose)
  checks.push({
    id: 'router',
    status: 'info',
    title: 'Senha do roteador',
    short: 'Confira se não é a de fábrica',
    found: 'O app não testa a senha do roteador, de propósito. Ele só lembra de conferir.',
    why: 'Senhas de fábrica (admin/admin) estão em listas públicas. Quem entra no painel do roteador controla a rede toda.',
    action: { kind: 'page', page: 'passwords', label: 'Guardar a senha nova' }
  })

  // Saved Wi-Fi networks
  const wifiWhy = 'Redes abertas ou com proteção antiga (WEP, WPA) permitem que alguém espione ou crie uma rede falsa com o mesmo nome.'
  if (!f.hasWifiAdapter) {
    checks.push({ id: 'wifi', status: 'na', title: 'Redes Wi-Fi inseguras salvas', short: 'Este PC está no cabo', found: 'Sem placa Wi-Fi, não há redes salvas para conferir.', why: wifiWhy })
  } else if (!f.wifiProfiles) {
    checks.push({ id: 'wifi', status: 'info', title: 'Redes Wi-Fi inseguras salvas', short: 'Não foi possível ler', found: 'O Windows não entregou a lista de redes salvas.', why: wifiWhy })
  } else {
    const risky = f.wifiProfiles.filter((p) => wifiRisk(p))
    checks.push(
      risky.length
        ? {
            id: 'wifi',
            status: 'warn',
            title: 'Redes Wi-Fi inseguras salvas',
            short: `${plural(risky.length, 'rede salva', 'redes salvas')} sem proteção boa`,
            found: 'O PC se conecta sozinho a estas redes quando elas aparecem. Esquecer as que você não usa evita cair numa rede falsa com o mesmo nome.',
            why: wifiWhy
          }
        : {
            id: 'wifi',
            status: 'ok',
            title: 'Redes Wi-Fi inseguras salvas',
            short: f.wifiProfiles.length ? `${plural(f.wifiProfiles.length, 'rede salva', 'redes salvas')}, todas protegidas` : 'Nenhuma rede salva',
            found: 'Todas as redes salvas usam WPA2 ou WPA3.',
            why: wifiWhy
          }
    )
  }

  return checks.sort((a, b) => ORDER[a.status] - ORDER[b.status])
}
