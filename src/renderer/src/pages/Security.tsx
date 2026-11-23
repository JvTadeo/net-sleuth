import { useCallback, useEffect, useState } from 'react'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiIndeterminateCircleLine,
  RiInformationFill,
  RiLoader4Line,
  RiRefreshLine,
  RiShieldLine,
  RiShieldUserLine
} from '@remixicon/react'
import { wifiRisk, type CheckAction, type CheckStatus, type SecFixRequest, type SecurityCheck, type SecurityReport } from '@shared/security'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { cleanError, useApp } from '@/store/app'

const STATUS: Record<CheckStatus, { label: string; variant: 'ok' | 'warn' | 'secondary'; icon: typeof RiCheckboxCircleFill; color: string }> = {
  ok: { label: 'Em dia', variant: 'ok', icon: RiCheckboxCircleFill, color: 'text-status-ok' },
  warn: { label: 'Aviso', variant: 'warn', icon: RiErrorWarningFill, color: 'text-status-warn' },
  info: { label: 'Dica', variant: 'secondary', icon: RiInformationFill, color: 'text-muted-foreground' },
  na: { label: 'Sem uso aqui', variant: 'secondary', icon: RiIndeterminateCircleLine, color: 'text-muted-foreground/70' }
}

/** Buttons in the narrow side panel may wrap to two lines instead of overflowing it. */
const WRAP = 'h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left'

const ports = (list: number[]): string => `${list.length === 1 ? 'porta' : 'portas'} ${list.slice(0, 4).join(', ')}${list.length > 4 ? '…' : ''}`

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </div>
  )
}

function Stat({ label, value, className }: { label: string; value: number | string; className: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-card px-4 py-3 shadow-xs">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-2xl font-semibold tabular-nums', className)}>{value}</span>
    </div>
  )
}

export default function Security() {
  const isAdmin = useApp((s) => s.isAdmin)
  const relaunch = useApp((s) => s.relaunchAsAdmin)
  const setPage = useApp((s) => s.setPage)
  const [report, setReport] = useState<SecurityReport | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selId, setSelId] = useState<SecurityCheck['id'] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const scan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      setReport(await window.api.security.scan())
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void scan()
  }, [scan])

  const run = async (req: SecFixRequest, key: string): Promise<void> => {
    setBusy(key)
    setNote(null)
    try {
      const res = await window.api.security.fix(req)
      if (res.done) {
        setNote({ ok: true, text: res.message })
        if (res.report) setReport(res.report)
      }
    } catch (err) {
      setNote({ ok: false, text: cleanError(err) })
    } finally {
      setBusy(null)
    }
  }

  const checks = report?.checks ?? []
  const sel = checks.find((c) => c.id === selId) ?? checks[0] ?? null
  const count = (...st: CheckStatus[]): number => checks.filter((c) => st.includes(c.status)).length
  const facts = report?.facts

  const actionButton = (a: CheckAction): React.ReactNode => {
    if (a.kind === 'page') {
      return (
        <Button size="sm" className={WRAP} onClick={() => setPage(a.page)}>
          {a.label}
        </Button>
      )
    }
    if (a.kind === 'settings') {
      return (
        <Button size="sm" className={WRAP} onClick={() => void window.api.app.openWindowsSettings(a.target)}>
          {a.label}
        </Button>
      )
    }
    if (a.admin && !isAdmin) {
      // Short button, the reason above it: a long label would not fit the side panel.
      return (
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-xs text-muted-foreground">
            {a.label} pede o modo administrador.
          </span>
          <Button size="sm" variant="outline" className={WRAP} onClick={() => void relaunch()}>
            <RiShieldUserLine aria-hidden />
            Reabrir como admin
          </Button>
        </div>
      )
    }
    return (
      <Button size="sm" className={WRAP} disabled={busy !== null} onClick={() => void run({ id: a.fix }, a.fix)}>
        {busy === a.fix && <RiLoader4Line className="animate-spin" aria-hidden />}
        {a.label}
      </Button>
    )
  }

  return (
    <>
      <PageHeader
        title="Segurança"
        subtitle="Uma verificação da rede e da conexão deste PC. Não é antivírus: para vírus, use a Segurança do Windows."
        actions={
          <Button variant="outline" disabled={scanning} onClick={() => void scan()}>
            {scanning ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiRefreshLine aria-hidden />}
            {scanning ? 'Verificando…' : 'Verificar de novo'}
          </Button>
        }
      />

      {error && <p className="selectable rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">{error}</p>}

      {!report ? (
        scanning ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
            <RiLoader4Line size={28} className="animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Conferindo firewall, portas, compartilhamentos e configurações de rede…</p>
          </div>
        ) : (
          <EmptyState icon={RiShieldLine} title="Não foi possível verificar">
            Tente de novo em alguns segundos.
          </EmptyState>
        )
      ) : (
        <>
          <section aria-label="Resumo" className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <Stat label="Em dia" value={count('ok')} className="text-status-ok" />
            <Stat label="Avisos" value={count('warn')} className="text-status-warn" />
            <Stat label="Dicas e itens sem uso aqui" value={count('info', 'na')} className="text-muted-foreground" />
          </section>

          <section className="flex flex-wrap items-start gap-4">
            <ul aria-label="Verificações" className="min-w-0 flex-[999_1_480px] overflow-hidden rounded-xl border bg-card shadow-xs">
              {checks.map((c) => {
                const s = STATUS[c.status]
                const on = c.id === sel?.id
                return (
                  <li key={c.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSelId(c.id)
                        setNote(null)
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:bg-accent',
                        on ? 'bg-accent' : 'hover:bg-accent/50'
                      )}
                    >
                      <s.icon size={18} className={cn('shrink-0', s.color)} aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="text-sm font-medium">{c.title}</span>
                        <span className="truncate text-xs text-muted-foreground">{c.short}</span>
                      </span>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </button>
                  </li>
                )
              })}
            </ul>

            {sel && facts && (
              <aside aria-label="Detalhes" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-xl border bg-card px-4.5 py-4.5 shadow-xs">
                <div className="flex flex-col gap-1.5">
                  <Badge variant={STATUS[sel.status].variant} className="self-start">
                    {STATUS[sel.status].label}
                  </Badge>
                  <h2 className="text-lg font-semibold">{sel.title}</h2>
                </div>

                <Section title="O que encontramos">
                  <p className="text-[13px] leading-relaxed">{sel.found}</p>
                </Section>

                {sel.id === 'ports' && (
                  <div className="flex flex-col gap-1.5">
                    {facts.listening
                      .filter((a) => !a.system)
                      .map((a) => (
                        <div key={a.path || a.process} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium">{a.name}</span>
                              {a.blocked && <Badge variant="ok">Bloqueado</Badge>}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">{ports(a.ports)}</span>
                            <span className="truncate text-xs text-muted-foreground" title={a.path}>
                              {a.path || `${a.process}.exe`}
                            </span>
                          </div>
                          {a.path && isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void run({ id: a.blocked ? 'unblockApp' : 'blockApp', arg: a.path }, a.path)}
                            >
                              {busy === a.path && <RiLoader4Line className="animate-spin" aria-hidden />}
                              {a.blocked ? 'Desbloquear' : 'Bloquear'}
                            </Button>
                          )}
                        </div>
                      ))}
                    {facts.listening.some((a) => a.system) && (
                      <p className="text-xs text-muted-foreground">
                        Mais {facts.listening.filter((a) => a.system).length} serviços do próprio Windows aceitam conexões (compartilhamento de
                        arquivos, descoberta de rede). São normais.
                      </p>
                    )}
                    {!isAdmin && facts.listening.some((a) => !a.system && a.path) && (
                      <div className="flex flex-col items-start gap-1.5 pt-1">
                        <span className="text-xs text-muted-foreground">Bloquear um programa no firewall pede o modo administrador.</span>
                        <Button size="sm" variant="outline" className={WRAP} onClick={() => void relaunch()}>
                          <RiShieldUserLine aria-hidden />
                          Reabrir como admin
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {sel.id === 'hosts' && !!facts.hosts?.length && (
                  <ul className="flex flex-col gap-1 rounded-lg border px-3 py-2.5 font-mono text-xs">
                    {facts.hosts.slice(0, 12).map((h, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="truncate">{h.name}</span>
                        <span className={cn('shrink-0', h.kind === 'redirect' ? 'text-status-warn' : 'text-muted-foreground')}>→ {h.ip}</span>
                      </li>
                    ))}
                    {facts.hosts.length > 12 && <li className="text-muted-foreground">e mais {facts.hosts.length - 12}</li>}
                  </ul>
                )}

                {sel.id === 'wifi' &&
                  facts.wifiProfiles
                    ?.filter((w) => wifiRisk(w))
                    .map((w) => (
                      <div key={w.name} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[13px] font-medium">{w.name}</span>
                          <span className="text-xs text-status-warn">{wifiRisk(w)}</span>
                        </div>
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run({ id: 'forgetWifi', arg: w.name }, w.name)}>
                          {busy === w.name && <RiLoader4Line className="animate-spin" aria-hidden />}
                          Esquecer
                        </Button>
                      </div>
                    ))}

                <Section title="Por que importa">
                  <p className="text-[13px] leading-relaxed text-foreground/80">{sel.why}</p>
                </Section>

                {(sel.action || note) && (
                  <div className="flex flex-col gap-2 border-t pt-3">
                    {sel.action && <div className="flex flex-wrap gap-2">{actionButton(sel.action)}</div>}
                    {note && <p className={cn('text-xs', note.ok ? 'text-status-ok' : 'text-status-bad')}>{note.text}</p>}
                  </div>
                )}
              </aside>
            )}
          </section>
        </>
      )}
    </>
  )
}
