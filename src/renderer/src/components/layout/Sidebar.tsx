import {
  type RemixiconComponentType,
  RiDeviceLine,
  RiGlobalLine,
  RiPlugLine,
  RiWifiLine,
  RiKey2Line,
  RiPulseLine,
  RiServerLine,
  RiSettings3Line,
  RiShieldCheckLine,
  RiShieldLine,
  RiShieldUserLine,
  RiToolsLine
} from '@remixicon/react'
import { formatSpeed } from '@shared/network'
import { pathStatus } from '@/lib/net'
import { cn } from '@/lib/utils'
import { useApp, type Page } from '@/store/app'

type Icon = RemixiconComponentType

const NAV: { page: Page; label: string; icon: Icon }[] = [
  { page: 'connection', label: 'Conexão', icon: RiGlobalLine },
  { page: 'fixes', label: 'Consertos', icon: RiToolsLine },
  { page: 'dns', label: 'DNS', icon: RiServerLine },
  { page: 'ping', label: 'Ping', icon: RiPulseLine },
  { page: 'security', label: 'Segurança', icon: RiShieldLine },
  { page: 'passwords', label: 'Senhas e QR', icon: RiKey2Line },
  { page: 'devices', label: 'Aparelhos', icon: RiDeviceLine }
]

function NavItem({ page, label, icon: Icon }: { page: Page; label: string; icon: Icon }) {
  const active = useApp((s) => s.page === page)
  // New devices waiting for a decision show as a count next to Aparelhos.
  const badge = useApp((s) => (page === 'devices' ? (s.deviceScan?.devices.filter((d) => d.status === 'new' && d.online).length ?? 0) : 0))
  const setPage = useApp((s) => s.setPage)
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => setPage(page)}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <Icon size={18} aria-hidden />
      {label}
      {badge > 0 && (
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">
          <span className="sr-only">, </span>
          {badge}
          <span className="sr-only"> {badge === 1 ? 'novo' : 'novos'}</span>
        </span>
      )}
    </button>
  )
}

/** The connection in use, at a glance. Opens the Conexão page. */
function ConnectionCard() {
  const net = useApp((s) => s.net)
  const path = useApp((s) => s.path)
  const setPage = useApp((s) => s.setPage)
  if (!net?.supported) return null
  const p = net.primary
  const status = pathStatus(net, path)
  const healthy = status === 'ok' || status === 'routerSilent'
  const Icon = p?.kind === 'wifi' ? RiWifiLine : RiPlugLine
  const name = !p ? 'Sem conexão' : p.kind === 'wifi' ? (net.wifi?.ssid ?? 'Wi-Fi') : p.kind === 'ethernet' ? 'Ethernet' : p.alias
  const line = !p
    ? 'Confira o cabo ou o Wi-Fi'
    : !path
      ? 'Testando…'
      : healthy
        ? `Internet funcionando · ${formatSpeed(p.speedBps)}`
        : status === 'dns'
          ? 'DNS falhando'
          : 'Sem internet'
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-xs font-medium text-muted-foreground">Conexão atual</div>
      <button
        type="button"
        onClick={() => setPage('connection')}
        className="flex w-full flex-col gap-1.5 rounded-lg border bg-background p-2.5 px-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <Icon size={16} aria-hidden />
          <span className="truncate">{name}</span>
          <span
            className={cn('ml-auto size-2 shrink-0 rounded-full', !path ? 'bg-muted-foreground/40' : healthy ? 'bg-status-ok' : 'bg-status-bad')}
            aria-label={!path ? 'Testando' : healthy ? 'Conectado' : 'Com problema'}
          />
        </span>
        <span className="text-xs text-muted-foreground">{line}</span>
      </button>
    </div>
  )
}

/** "Reopen as administrator" while unelevated; a quiet badge once elevated. */
function AdminEntry() {
  const isAdmin = useApp((s) => s.isAdmin)
  const relaunch = useApp((s) => s.relaunchAsAdmin)
  if (isAdmin) {
    return (
      <div className="flex h-9 items-center gap-2.5 px-2.5 text-sm text-status-ok">
        <RiShieldCheckLine size={18} aria-hidden />
        Modo administrador
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void relaunch()}
      title="Reabre o app com permissão de administrador, necessária para mudar DNS, firewall e rede"
      className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <RiShieldUserLine size={18} aria-hidden />
      Reabrir como admin
    </button>
  )
}

export function Sidebar() {
  return (
    <nav
      aria-label="Navegação principal"
      className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4"
    >
      <div className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <NavItem key={n.page} {...n} />
        ))}
      </div>
      <ConnectionCard />
      <div className="mt-auto flex flex-col gap-0.5">
        <AdminEntry />
        <NavItem page="settings" label="Configurações" icon={RiSettings3Line} />
      </div>
    </nav>
  )
}
