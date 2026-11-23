import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dnsEncrypted, type NetInfo } from '@shared/network'
import {
  buildChecks,
  isSystemProcess,
  parseHosts,
  wifiRisk,
  type ListeningApp,
  type SecFixRequest,
  type SecFixResult,
  type SecurityFacts,
  type SecurityReport,
  type WifiProfile
} from '@shared/security'
import { fromArg, powershell, psArg, toArray } from './powershell'

/** Firewall rules this app creates carry this group, so they can be listed and removed again. */
const RULE_GROUP = 'net-sleuth'

export const hostsPath = (): string => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')

/**
 * Everything the checklist needs except the hosts file, in one PowerShell call. Each part is wrapped so that one
 * failure (SMB settings without admin, no Wi-Fi service) leaves the others intact.
 */
const SCAN = (arg: string): string => String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$req = ${fromArg(arg)}

$firewall = @(Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; enabled = [bool]$_.Enabled } })

$netProfile = $null
if ($req.alias) {
  $p = Get-NetConnectionProfile -InterfaceAlias $req.alias | Select-Object -First 1
  if ($p) { $netProfile = [pscustomobject]@{ alias = [string]$req.alias; category = [string]$p.NetworkCategory } }
}

$blockedPaths = @(Get-NetFirewallRule -Group '${RULE_GROUP}' | Get-NetFirewallApplicationFilter | ForEach-Object { [string]$_.Program })
$listen = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -notmatch '^(127\.|::1$)' }
$listening = @($listen | Group-Object OwningProcess | ForEach-Object {
  $proc = Get-Process -Id ([int]$_.Name)
  [pscustomobject]@{
    process = [string]$proc.ProcessName; description = [string]$proc.Description; path = [string]$proc.Path
    ports = @($_.Group | ForEach-Object { [int]$_.LocalPort } | Sort-Object -Unique)
  }
})

$rdp = $null
$ts = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
$edition = [string](Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
if ($ts -and $edition -notmatch 'Core|Home') { $rdp = ([int]$ts.fDenyTSConnections -eq 0) }

$smb1 = $null
try { $smb1 = [bool](Get-SmbServerConfiguration -ErrorAction Stop).EnableSMB1Protocol } catch {
  $v = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters').SMB1
  if ($null -ne $v) { $smb1 = ([int]$v -ne 0) }
}

$is = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$proxy = [pscustomobject]@{ enabled = ([int]$is.ProxyEnable -eq 1); server = [string]$is.ProxyServer; pac = [string]$is.AutoConfigURL }

$hasWifi = [bool](Get-NetAdapter | Where-Object { $_.PhysicalMediaType -match '802\.11' })
$wifi = $null
if ($hasWifi) {
  # Exported profile XML is the same in every Windows language, unlike "netsh wlan show profile".
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('net-sleuth-wlan-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $dir | Out-Null
  Start-Process -FilePath netsh -ArgumentList "wlan export profile folder=` + '`"$dir`"' + String.raw`" -NoNewWindow -Wait
  $wifi = @(Get-ChildItem -LiteralPath $dir -Filter *.xml | ForEach-Object {
    $x = [xml](Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8)
    $sec = $x.WLANProfile.MSM.security.authEncryption
    [pscustomobject]@{ name = [string]$x.WLANProfile.name; auth = [string]$sec.authentication; encryption = [string]$sec.encryption }
  })
  Remove-Item -LiteralPath $dir -Recurse -Force
}

ConvertTo-Json -Compress -Depth 5 -InputObject ([pscustomobject]@{
  firewall = $firewall; profile = $netProfile; listening = $listening; blockedPaths = $blockedPaths
  rdp = $rdp; smb1 = $smb1; proxy = $proxy; hasWifi = $hasWifi; wifi = $wifi
})
`

interface RawScan {
  firewall?: unknown
  profile?: { alias: string; category: string } | null
  listening?: unknown
  blockedPaths?: unknown
  rdp?: boolean | null
  smb1?: boolean | null
  proxy?: { enabled?: boolean; server?: string; pac?: string }
  hasWifi?: boolean
  wifi?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Merges processes of the same program (several Chrome or svchost instances) into one row. */
function toApps(raw: RawScan): ListeningApp[] {
  const blocked = new Set(toArray(raw.blockedPaths as string[]).map((p) => String(p).toLowerCase()))
  const byKey = new Map<string, ListeningApp>()
  for (const r of toArray(raw.listening as { process: string; description: string; path: string; ports: number[] }[])) {
    const process = str(r.process) || 'desconhecido'
    const path = str(r.path)
    const key = (path || process).toLowerCase()
    const ports = toArray(r.ports).map(Number)
    const prev = byKey.get(key)
    if (prev) {
      prev.ports = [...new Set([...prev.ports, ...ports])].sort((a, b) => a - b)
      continue
    }
    byKey.set(key, {
      name: str(r.description) || process,
      process,
      path,
      ports,
      system: isSystemProcess(process, path),
      blocked: !!path && blocked.has(path.toLowerCase())
    })
  }
  return [...byKey.values()].sort((a, b) => Number(a.system) - Number(b.system) || a.name.localeCompare(b.name))
}

export interface SecurityDeps {
  isAdmin: () => Promise<boolean>
  confirm: (options: Electron.MessageBoxOptions) => Promise<boolean>
  net: () => Promise<NetInfo>
}

export class SecurityService {
  private last: SecurityReport | null = null

  constructor(private deps: SecurityDeps) {}

  async scan(): Promise<SecurityReport> {
    const net = await this.deps.net()
    let facts: SecurityFacts
    const fixture = process.env.NET_SLEUTH_SECURITY_FIXTURE
    if (fixture) {
      facts = JSON.parse(await readFile(fixture, 'utf8')) as SecurityFacts
    } else if (process.platform !== 'win32') {
      facts = {
        firewall: null,
        profile: null,
        listening: [],
        rdpEnabled: null,
        smb1Enabled: null,
        hosts: null,
        proxy: { enabled: false, server: null, pac: null },
        hasWifiAdapter: false,
        wifiProfiles: null
      }
    } else {
      const [rawText, hostsText] = await Promise.all([
        powershell(SCAN(psArg({ alias: net.primary?.alias ?? null })), 60_000),
        readFile(hostsPath(), 'utf8').catch(() => null)
      ])
      const raw = JSON.parse(rawText || '{}') as RawScan
      facts = {
        firewall: toArray(raw.firewall as { name: string; enabled: boolean }[])
          .filter((p) => ['Domain', 'Private', 'Public'].includes(p.name))
          .map((p) => ({ name: p.name as 'Domain' | 'Private' | 'Public', enabled: p.enabled === true })),
        profile:
          raw.profile && ['Public', 'Private', 'DomainAuthenticated'].includes(raw.profile.category)
            ? { alias: raw.profile.alias, category: raw.profile.category as 'Public' | 'Private' | 'DomainAuthenticated' }
            : null,
        listening: toApps(raw),
        rdpEnabled: typeof raw.rdp === 'boolean' ? raw.rdp : null,
        smb1Enabled: typeof raw.smb1 === 'boolean' ? raw.smb1 : null,
        hosts: hostsText === null ? null : parseHosts(hostsText),
        proxy: { enabled: raw.proxy?.enabled === true, server: str(raw.proxy?.server) || null, pac: str(raw.proxy?.pac) || null },
        hasWifiAdapter: raw.hasWifi === true,
        wifiProfiles: raw.wifi == null ? null : toArray(raw.wifi as WifiProfile[]).map((w) => ({ name: str(w.name), auth: str(w.auth), encryption: str(w.encryption) }))
      }
    }
    const ctx = { dnsEncrypted: net.primary ? dnsEncrypted(net.primary) : false, dohSupported: net.dohSupported }
    this.last = { facts, checks: buildChecks(facts, ctx), checkedAt: Date.now() }
    return this.last
  }

  private async needAdmin(): Promise<void> {
    if (!(await this.deps.isAdmin())) throw new Error('Esta correção pede o modo administrador: use "Reabrir como admin" e tente de novo.')
  }

  private ask(title: string, message: string, detail: string, button: string): Promise<boolean> {
    return this.deps.confirm({ type: 'question', title, message, detail, buttons: [button, 'Cancelar'] })
  }

  async fix(req: SecFixRequest): Promise<SecFixResult> {
    const report = this.last ?? (await this.scan())
    const facts = report.facts
    const simulated = !!process.env.NET_SLEUTH_SECURITY_FIXTURE
    const cancelled: SecFixResult = { done: false, message: '' }
    let script: string
    let message: string

    switch (req.id) {
      case 'firewallOn':
        await this.needAdmin()
        if (!(await this.ask('Ligar o firewall', 'Ligar o Firewall do Windows em todas as redes?', 'Programas que já tinham permissão continuam funcionando.', 'Ligar')))
          return cancelled
        script = 'Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True'
        message = 'Firewall ligado em todas as redes.'
        break
      case 'profilePublic':
      case 'profilePrivate': {
        await this.needAdmin()
        const alias = facts.profile?.alias
        if (!alias) throw new Error('Nenhuma rede ativa.')
        const toPublic = req.id === 'profilePublic'
        const ok = await this.ask(
          'Tipo de rede',
          `Marcar "${alias}" como ${toPublic ? 'Pública' : 'Privada'}?`,
          toPublic
            ? 'O PC fica invisível para outros aparelhos da rede. Compartilhamento de arquivos e impressora param de funcionar nesta rede. Dá para voltar a qualquer momento.'
            : 'Outros aparelhos da rede passam a ver este PC, o que permite compartilhar arquivos e impressora. Faça isso só na rede de casa. Dá para voltar a qualquer momento.',
          toPublic ? 'Marcar como Pública' : 'Marcar como Privada'
        )
        if (!ok) return cancelled
        script = `Set-NetConnectionProfile -InterfaceAlias ${fromArg(psArg(alias))} -NetworkCategory ${toPublic ? 'Public' : 'Private'}`
        message = `Rede marcada como ${toPublic ? 'Pública' : 'Privada'}.`
        break
      }
      case 'smb1Off':
        await this.needAdmin()
        if (
          !(await this.ask(
            'Desligar o SMBv1',
            'Desligar o compartilhamento antigo (SMBv1)?',
            'Só aparelhos muito antigos (NAS ou impressoras de mais de dez anos) deixam de acessar as pastas compartilhadas deste PC. Ele pode ser religado em Recursos do Windows.',
            'Desligar'
          ))
        )
          return cancelled
        script = 'Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force -Confirm:$false'
        message = 'SMBv1 desligado.'
        break
      case 'blockApp':
      case 'unblockApp': {
        await this.needAdmin()
        // Only programs the last scan found listening can be blocked: the window never names an arbitrary file.
        const app = facts.listening.find((a) => a.path && a.path.toLowerCase() === (req.arg ?? '').toLowerCase())
        if (!app) throw new Error('Programa não encontrado. Verifique de novo e tente outra vez.')
        if (req.id === 'blockApp') {
          const ok = await this.ask(
            'Bloquear no firewall',
            `Bloquear conexões vindas da rede para "${app.name}"?`,
            'O programa continua abrindo e usando a internet normalmente; só deixa de receber conexões de outros aparelhos. Algumas funções podem parar (tocar em outro aparelho, jogar em rede local). Dá para desbloquear aqui mesmo.',
            'Bloquear'
          )
          if (!ok) return cancelled
          const a = psArg({ name: `net-sleuth: bloquear ${app.name}`, path: app.path })
          script = `$r = ${fromArg(a)}\nNew-NetFirewallRule -DisplayName $r.name -Group '${RULE_GROUP}' -Direction Inbound -Program $r.path -Action Block -Profile Any | Out-Null`
          message = `${app.name} bloqueado no firewall.`
        } else {
          script = `$p = ${fromArg(psArg(app.path))}\nGet-NetFirewallRule -Group '${RULE_GROUP}' | Where-Object { ($_ | Get-NetFirewallApplicationFilter).Program -eq $p } | Remove-NetFirewallRule`
          message = `${app.name} desbloqueado.`
        }
        break
      }
      case 'forgetWifi': {
        const profile = facts.wifiProfiles?.find((w) => w.name === req.arg && wifiRisk(w))
        if (!profile) throw new Error('Rede não encontrada. Verifique de novo e tente outra vez.')
        const ok = await this.ask(
          'Esquecer rede Wi-Fi',
          `Esquecer a rede "${profile.name}"?`,
          'O PC para de se conectar sozinho a ela. Para usar de novo, é só conectar e digitar a senha.',
          'Esquecer'
        )
        if (!ok) return cancelled
        script = `$n = ${fromArg(psArg(profile.name))}\n$o = netsh wlan delete profile "name=$n"\nif ($LASTEXITCODE -ne 0) { throw ($o -join ' ') }`
        message = `Rede "${profile.name}" esquecida.`
        break
      }
    }

    if (!simulated) {
      try {
        await powershell(`$ErrorActionPreference = 'Stop'\n${script}`, 60_000)
      } catch (err) {
        if (req.id === 'forgetWifi') throw new Error('O Windows não deixou esquecer a rede. Ela pode ser de todos os usuários: tente no modo administrador.')
        throw err
      }
    }
    const fresh = await this.scan()
    return { done: true, message: simulated ? `Simulação: ${message}` : message, report: fresh }
  }
}
