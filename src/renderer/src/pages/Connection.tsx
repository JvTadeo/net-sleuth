import type { ReactNode } from 'react'
import {
  RiArrowRightLine,
  RiComputerLine,
  RiErrorWarningLine,
  RiGlobalLine,
  RiLoader4Line,
  RiMapPinLine,
  RiRefreshLine,
  RiRouterLine,
  RiWifiOffLine
} from '@remixicon/react'
import { currentPreset, dnsEncrypted, formatSpeed, isSelfAssigned, presetById, type AdapterInfo, type Hop, type NetInfo } from '@shared/network'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { KIND_LABEL, msText, pathStatus, type PathStatus } from '@/lib/net'
import { useApp } from '@/store/app'

const STATUS_TEXT: Record<PathStatus, { badge: string; variant: 'ok' | 'warn' | 'bad'; text: string }> = {
  ok: { badge: 'Tudo certo', variant: 'ok', text: 'A rede de casa e a operadora estão respondendo. Se algo parar, este caminho mostra de que lado está o problema.' },
  routerSilent: {
    badge: 'Tudo certo',
    variant: 'ok',
    text: 'A internet responde. O roteador não responde a ping, o que é comum e não indica problema.'
  },
  dns: { badge: 'DNS falhando', variant: 'warn', text: 'A internet responde, mas os nomes de sites não estão sendo traduzidos. Limpar o cache de DNS ou trocar de servidor costuma resolver.' },
  internet: { badge: 'Sem internet', variant: 'bad', text: 'A rede de casa funciona, mas a internet não responde. O problema parece estar na operadora ou no roteador.' },
  router: { badge: 'Sem resposta', variant: 'bad', text: 'Nem o roteador responde. Confira o cabo ou o Wi-Fi, e tente os Consertos.' },
  none: { badge: 'Desconectado', variant: 'bad', text: 'Nenhuma conexão ativa: confira o cabo ou conecte-se a uma rede Wi-Fi.' }
}

function Node({ icon, name, detail }: { icon: ReactNode; name: string; detail: string }) {
  return (
    <div className="flex min-w-[120px] flex-1 basis-36 flex-col items-center gap-1.5 text-center">
      <span className="inline-flex size-11 items-center justify-center rounded-xl bg-muted text-foreground">{icon}</span>
      <span className="text-sm font-semibold">{name}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  )
}

function Link({ hop, silentOk }: { hop: Hop | undefined; silentOk?: boolean }) {
  const state = !hop ? 'wait' : hop.ok ? 'ok' : silentOk ? 'silent' : 'bad'
  return (
    <div className="flex min-w-[56px] flex-1 basis-16 flex-col items-center gap-1 pt-2.5">
      <span
        className={cn(
          'font-mono text-xs font-medium tabular-nums',
          state === 'ok' ? 'text-status-ok' : state === 'bad' ? 'text-status-bad' : 'text-muted-foreground'
        )}
      >
        {state === 'wait' ? '…' : state === 'silent' ? 'sem ping' : msText(hop!.ms)}
      </span>
      <span
        className={cn(
          'block h-0.5 w-full rounded-full',
          state === 'ok' ? 'bg-status-ok' : state === 'bad' ? 'bg-status-bad' : 'bg-border'
        )}
      />
      <span className="text-[11px] text-muted-foreground">
        {state === 'ok' ? 'respondendo' : state === 'bad' ? 'falhou' : state === 'silent' ? 'normal' : 'medindo'}
      </span>
    </div>
  )
}

function Row({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn('selectable text-right', mono && 'font-mono')}>{v}</dd>
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-4.5 py-4 shadow-xs">
      <h2 className="text-[13px] font-medium text-muted-foreground">{title}</h2>
      {children}
    </div>
  )
}

function WifiCard({ info }: { info: NetInfo }) {
  const p = info.primary
  const openLocation = (): void => void window.api.app.openWindowsSettings('location')
  if (p?.kind === 'wifi' && info.wifi) {
    const w = info.wifi
    const good = (w.signal ?? 0) >= 60
    return (
      <section aria-label="Wi-Fi" className="flex flex-col gap-3 rounded-xl border bg-card px-4.5 py-4 shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-medium text-muted-foreground">Wi-Fi</h2>
          {w.signal !== null && <Badge variant={good ? 'ok' : (w.signal ?? 0) >= 35 ? 'warn' : 'bad'}>{good ? 'Sinal bom' : (w.signal ?? 0) >= 35 ? 'Sinal médio' : 'Sinal fraco'}</Badge>}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
          {[
            ['Rede', w.ssid ?? '—'],
            ['Sinal', w.signal === null ? '—' : `${w.signal}%`],
            ['Faixa e canal', [w.band, w.channel !== null ? `canal ${w.channel}` : null].filter(Boolean).join(' · ') || '—'],
            ['Segurança', w.auth ?? '—']
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="selectable text-[15px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </section>
    )
  }
  if (p?.kind === 'wifi' && info.wifiBlocked) {
    return (
      <section aria-label="Wi-Fi" className="flex flex-wrap items-center gap-3.5 rounded-xl border border-dashed px-4.5 py-4 text-muted-foreground">
        <span className="inline-flex size-10 items-center justify-center rounded-lg bg-muted">
          <RiMapPinLine size={20} aria-hidden />
        </span>
        <div className="flex flex-1 basis-80 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">O Windows não deixou ler os detalhes do Wi-Fi</span>
          <span className="text-[13px]">
            Desde o Windows 11 24H2, sinal e canal só aparecem com a permissão de localização ligada para aplicativos da área de trabalho.
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={openLocation}>
          Abrir Localização
        </Button>
      </section>
    )
  }
  return (
    <section aria-label="Wi-Fi" className="flex flex-wrap items-center gap-3.5 rounded-xl border border-dashed px-4.5 py-4 text-muted-foreground">
      <span className="inline-flex size-10 items-center justify-center rounded-lg bg-muted">
        <RiWifiOffLine size={20} aria-hidden />
      </span>
      <div className="flex flex-1 basis-80 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          {info.hasWifiAdapter ? 'Este PC está usando o cabo' : 'Este PC está no cabo'}
        </span>
        <span className="text-[13px]">
          {info.hasWifiAdapter
            ? 'O PC tem placa Wi-Fi, mas a conexão em uso é o cabo. Sinal e canal aparecem aqui quando o Wi-Fi for a conexão principal.'
            : 'Sinal, canal e redes Wi-Fi salvas aparecem aqui quando houver uma placa Wi-Fi ativa. Senhas e QR code continuam funcionando: você digita a senha da rede uma vez.'}
        </span>
      </div>
    </section>
  )
}

function Adapter({ a }: { a: AdapterInfo }) {
  const ip = a.ipv4[0]?.split('/')[0]
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
      <InfoCard title="Adaptador">
        <dl className="flex flex-col gap-2">
          <Row k="Nome" v={a.description || a.alias} mono={false} />
          <Row k="Velocidade do link" v={formatSpeed(a.speedBps)} />
          <Row k="Tipo" v={KIND_LABEL[a.kind]} mono={false} />
          <Row k="Endereço físico (MAC)" v={a.mac || '—'} />
        </dl>
      </InfoCard>
      <InfoCard title="Endereços">
        <dl className="flex flex-col gap-2">
          <Row k="IPv4" v={ip ? <span className={cn(isSelfAssigned(ip) && 'text-status-bad')}>{ip}</span> : '—'} />
          <Row k="Roteador (gateway)" v={a.gateway ?? '—'} />
          <Row k="Configuração" v={a.dhcp ? 'Automática (DHCP)' : 'Fixa (manual)'} mono={false} />
          <Row k="IPv6" v={a.ipv6 ? 'Ativo' : 'Desligado'} mono={false} />
        </dl>
      </InfoCard>
      <DnsCard a={a} />
    </section>
  )
}

function dnsOrigin(a: AdapterInfo): string {
  const preset = currentPreset(a)
  const enc = dnsEncrypted(a) ? ', criptografado' : ''
  if (preset === 'auto') return 'Do roteador (automático)'
  if (preset === 'custom') return `Digitado manualmente${enc}`
  return `${presetById(preset).name}${enc}`
}

function VirtualAdapters({ list }: { list: AdapterInfo[] }) {
  return (
    <section aria-label="VPN e adaptadores virtuais" className="flex flex-col gap-3 rounded-xl border bg-card px-4.5 py-4 shadow-xs">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[13px] font-medium text-muted-foreground">VPN e adaptadores virtuais</h2>
        <p className="text-xs text-muted-foreground">
          Criados por programas instalados. Não levam o tráfego da internet; para tirá-los daqui, desligue o programa que os criou.
        </p>
      </div>
      <ul className="flex flex-col divide-y">
        {list.map((v) => (
          <li key={v.alias} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
            <Badge variant="secondary">{v.virtualOf}</Badge>
            <span className="text-[13px] font-medium">{v.alias}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{v.description}</span>
            <span className="font-mono text-xs text-muted-foreground">{v.ipv4[0]?.split('/')[0] ?? '—'}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DnsCard({ a }: { a: AdapterInfo }) {
  const setPage = useApp((s) => s.setPage)
  return (
    <InfoCard title="DNS">
      <dl className="flex flex-col gap-2">
        <Row k={a.dns.length > 1 ? 'Servidores' : 'Servidor'} v={a.dns.length ? a.dns.join(', ') : '—'} />
        <Row k="Origem" v={dnsOrigin(a)} mono={false} />
      </dl>
      <Button size="sm" variant="outline" className="self-start" onClick={() => setPage('dns')}>
        Ajustar DNS
        <RiArrowRightLine aria-hidden />
      </Button>
    </InfoCard>
  )
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 5) return 'agora'
  if (s < 60) return `há ${s} s`
  return `há ${Math.round(s / 60)} min`
}

export default function Connection() {
  const info = useApp((s) => s.net)
  const path = useApp((s) => s.path)
  const checking = useApp((s) => s.checking)
  const error = useApp((s) => s.netError)
  const refresh = useApp((s) => s.refreshNet)

  if (info && !info.supported) {
    return (
      <>
        <PageHeader title="Conexão" />
        <EmptyState icon={RiGlobalLine} title="Disponível apenas no Windows">
          A conexão é lida com as ferramentas de rede do Windows.
        </EmptyState>
      </>
    )
  }

  const status = pathStatus(info, path)
  const st = STATUS_TEXT[status]
  const p = info?.primary ?? null
  const hop = (id: Hop['id']): Hop | undefined => path?.hops.find((h) => h.id === id)
  const label = p ? (p.kind === 'wifi' && info?.wifi?.ssid ? `Wi-Fi (${info.wifi.ssid})` : p.kind === 'wifi' ? 'Wi-Fi' : 'cabo de rede (Ethernet)') : ''

  return (
    <>
      <PageHeader
        title="Conexão"
        subtitle={
          !info
            ? 'Lendo a conexão…'
            : !p
              ? 'Nenhuma conexão ativa'
              : `${status === 'ok' || status === 'routerSilent' ? 'Internet funcionando' : st.badge} · ${label}${path ? ` · verificado ${ago(path.checkedAt)}` : ''}`
        }
        actions={
          <Button variant="outline" disabled={checking} onClick={() => void refresh()}>
            {checking ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiRefreshLine aria-hidden />}
            {checking ? 'Testando…' : 'Testar de novo'}
          </Button>
        }
      />

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 text-sm">
            <RiErrorWarningLine size={20} className="shrink-0 text-destructive" aria-hidden />
            <span className="selectable">{error}</span>
          </CardContent>
        </Card>
      )}

      {!info ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <RiLoader4Line size={28} className="animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Lendo o adaptador de rede e testando o caminho até a internet…</p>
        </div>
      ) : (
        <>
          <section aria-label="Caminho até a internet" className="flex flex-col gap-3 rounded-xl border bg-card px-5.5 py-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[13px] font-medium text-muted-foreground">Caminho até a internet</h2>
              {path || !p ? <Badge variant={st.variant}>{st.badge}</Badge> : <Badge variant="secondary">Medindo…</Badge>}
            </div>
            <div className="flex flex-wrap items-start gap-2 py-1">
              <Node
                icon={<RiComputerLine size={22} aria-hidden />}
                name="Este PC"
                detail={p ? `${p.kind === 'wifi' ? 'Wi-Fi' : p.kind === 'ethernet' ? 'Ethernet' : p.alias} · ${formatSpeed(p.speedBps)}` : 'sem conexão'}
              />
              <Link hop={hop('router')} silentOk={!!hop('internet')?.ok} />
              <Node icon={<RiRouterLine size={22} aria-hidden />} name="Roteador" detail={p?.gateway ?? '—'} />
              <Link hop={hop('internet')} />
              <Node icon={<RiGlobalLine size={22} aria-hidden />} name="Internet" detail="Cloudflare 1.1.1.1" />
            </div>
            <p className="text-[13px] text-muted-foreground">{path || !p ? st.text : 'Medindo o tempo até o roteador e até a internet…'}</p>
            {hop('dns') && (
              <p className="text-xs text-muted-foreground">
                DNS: {hop('dns')!.ok ? `respondeu em ${msText(hop('dns')!.ms)}` : 'não respondeu'} para {hop('dns')!.target}
              </p>
            )}
          </section>

          {p && <Adapter a={p} />}
          <WifiCard info={info} />

          {!!info.virtual?.length && <VirtualAdapters list={info.virtual} />}

          {!!info.others.length && (
            <p className="text-xs text-muted-foreground">
              Outras conexões ativas: {info.others.map((o) => `${o.alias} (${KIND_LABEL[o.kind]})`).join(', ')}. O tráfego da internet usa {p?.alias}.
            </p>
          )}
        </>
      )}
    </>
  )
}
