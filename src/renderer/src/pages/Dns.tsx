import { useCallback, useEffect, useState } from 'react'
import { RiLoader4Line, RiRefreshLine, RiServerLine, RiShieldUserLine } from '@remixicon/react'
import {
  DNS_PRESETS,
  currentPreset,
  dnsEncrypted,
  presetById,
  type AdapterInfo,
  type DnsPresetId,
  type DnsTiming
} from '@shared/network'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { msText } from '@/lib/net'
import { cn } from '@/lib/utils'
import { cleanError, useApp } from '@/store/app'

type Choice = DnsPresetId | 'custom'

/** The servers the router hands out, even while hand-typed ones are in use. */
const routerServers = (p: AdapterInfo): string[] => (p.dnsStatic ? p.dhcpDns : p.dns)

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={cn('relative block h-5 w-9 rounded-full transition-colors', on ? 'bg-primary' : 'bg-input dark:bg-input/80')}>
        <span
          className={cn(
            'absolute top-[3px] size-3.5 rounded-full bg-background transition-[left] dark:bg-foreground',
            on ? 'left-[19px] dark:bg-primary-foreground' : 'left-[3px]'
          )}
        />
      </span>
    </button>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export default function Dns() {
  const info = useApp((s) => s.net)
  const isAdmin = useApp((s) => s.isAdmin)
  const relaunch = useApp((s) => s.relaunchAsAdmin)
  const refreshNet = useApp((s) => s.refreshNet)
  const p = info?.primary ?? null

  const current: Choice = p ? currentPreset(p) : 'auto'
  const encNow = p ? dnsEncrypted(p) : false
  const dohSupported = info?.dohSupported ?? false

  const [timings, setTimings] = useState<DnsTiming[] | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [sel, setSel] = useState<Choice>(current)
  const [enc, setEnc] = useState(true)
  const [applying, setApplying] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  // Start from what the PC uses now; again after every change is applied.
  useEffect(() => {
    setSel(current)
    setEnc(current === 'auto' || current === 'custom' ? dohSupported : encNow)
  }, [current, encNow, dohSupported])

  const measure = useCallback(async () => {
    setMeasuring(true)
    try {
      setTimings(await window.api.dns.measure())
    } catch {
      setTimings(null)
    } finally {
      setMeasuring(false)
    }
  }, [])

  useEffect(() => {
    if (p) void measure()
    // Measure once per page visit; "Medir de novo" repeats it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!p])

  if (info && (!info.supported || !p)) {
    return (
      <>
        <PageHeader title="DNS" />
        <EmptyState icon={RiServerLine} title={!info.supported ? 'Disponível apenas no Windows' : 'Nenhuma conexão ativa'}>
          {!info.supported
            ? 'O DNS é lido e trocado com as ferramentas de rede do Windows.'
            : 'Conecte o cabo ou o Wi-Fi para ver e trocar o DNS.'}
        </EmptyState>
      </>
    )
  }

  const timingOf = (id: DnsPresetId): DnsTiming | undefined => timings?.find((t) => t.id === id)
  const valid = (timings ?? []).filter((t) => t.ms !== null)
  const fastest = valid.length > 1 ? valid.reduce((a, b) => (b.ms! < a.ms! ? b : a)).id : null

  const selPreset = sel === 'custom' ? null : presetById(sel)
  const canEnc = !!selPreset?.dohTemplate && dohSupported
  const effEnc = canEnc && enc
  const changed = sel !== 'custom' && (sel !== current || (sel !== 'auto' && effEnc !== encNow))

  const currentName =
    current === 'auto' ? 'Do roteador' : current === 'custom' ? 'Definido à mão' : presetById(current).name
  const currentMs = current === 'custom' ? undefined : timingOf(current)

  const summary = !changed
    ? current === 'auto'
      ? 'Nada muda: o PC continua usando o DNS do roteador.'
      : `Nada muda: o PC continua usando ${currentName}${encNow ? ', criptografado' : ''}.`
    : sel === 'auto'
      ? 'Vai voltar a usar o DNS do roteador.'
      : `Vai passar a usar ${selPreset!.name}${effEnc ? ', criptografado.' : ', sem criptografia.'} Dá para voltar ao automático a qualquer momento.`

  const encNote = !dohSupported
    ? 'O DNS criptografado precisa do Windows 11. Os servidores podem ser trocados mesmo assim.'
    : !selPreset?.dohTemplate
      ? `${sel === 'custom' ? 'Para servidores digitados à mão, a criptografia é ligada nas Configurações do Windows.' : 'O DNS do roteador não oferece criptografia.'} Escolha outro servidor para ligar.`
      : effEnc
        ? 'Ninguém no caminho consegue ver ou alterar quais sites você acessa. Recomendado.'
        : 'Desligado: a operadora e quem estiver na mesma rede conseguem ver quais sites você acessa.'

  const apply = async (): Promise<void> => {
    if (sel === 'custom') return
    setApplying(true)
    setNote(null)
    try {
      const res = await window.api.dns.apply({ preset: sel, encrypted: effEnc })
      if (res.done) {
        setNote({ ok: true, text: res.message })
        await refreshNet()
        void measure()
      }
    } catch (err) {
      setNote({ ok: false, text: cleanError(err) })
    } finally {
      setApplying(false)
    }
  }

  const options: { id: Choice; name: string; ips: string; note: string }[] = [
    ...DNS_PRESETS.map((o) => ({
      id: o.id as Choice,
      name: o.name,
      ips: o.id === 'auto' ? (p && routerServers(p).length ? `${routerServers(p).join(' · ')} (do roteador)` : 'do roteador') : o.v4.join(' · '),
      note: o.note
    })),
    ...(current === 'custom' && p
      ? [{ id: 'custom' as Choice, name: 'Definido à mão', ips: p.dns.join(' · '), note: 'Servidores digitados à mão, que não são de nenhuma das opções acima.' }]
      : [])
  ]

  return (
    <>
      <PageHeader
        title="DNS"
        subtitle="O DNS traduz nomes de sites em endereços. Um servidor mais rápido ou criptografado pode deixar a navegação mais ágil e mais privada."
        actions={
          <Button variant="outline" disabled={measuring || !p} onClick={() => void measure()}>
            {measuring ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiRefreshLine aria-hidden />}
            {measuring ? 'Medindo…' : 'Medir de novo'}
          </Button>
        }
      />

      {!p ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <RiLoader4Line size={28} className="animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : (
        <>
          <section aria-label="Situação atual" className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border bg-card px-4.5 py-4 shadow-xs">
            <Fact label="Em uso agora">
              <span className="text-[15px] font-semibold">
                {currentName} · <span className="font-mono text-sm">{p.dns.join(', ') || '—'}</span>
              </span>
            </Fact>
            <Fact label="Tempo de resposta">
              <span className="font-mono text-[15px] font-semibold">
                {current === 'custom' ? '—' : !timings ? (measuring ? 'medindo…' : '—') : msText(currentMs?.ms ?? null)}
              </span>
            </Fact>
            <Fact label="Criptografia">
              <Badge variant={encNow ? 'ok' : 'warn'} className="self-start">
                {encNow ? 'Ligada: ninguém no caminho vê quais sites você acessa' : 'Desligada: a rede e a operadora veem quais sites você acessa'}
              </Badge>
            </Fact>
          </section>

          <section aria-label="Escolher servidor" role="radiogroup" className="grid grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-3">
            {options.map((o) => {
              const on = o.id === sel
              const t = o.id === 'custom' ? undefined : timingOf(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setSel(o.id)
                    setNote(null)
                  }}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5 text-left shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    on ? 'border-2 border-foreground px-[15px] py-[13px]' : 'border hover:border-foreground/30'
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold">{o.name}</span>
                      {o.id === current && <Badge variant="secondary">Em uso</Badge>}
                    </span>
                    <span
                      className={cn('size-4 shrink-0 rounded-full', on ? 'border-[5px] border-foreground' : 'border-[1.5px] border-muted-foreground/60')}
                    />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{o.ips}</span>
                  <span className="text-xs leading-normal text-foreground/80">{o.note}</span>
                  {o.id !== 'custom' && (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-medium">
                        {t ? msText(t.ms) : measuring ? 'medindo…' : '—'}
                      </span>
                      {fastest === o.id && <Badge variant="ok">Mais rápido aqui</Badge>}
                    </span>
                  )}
                </button>
              )
            })}
          </section>

          <section aria-label="Criptografia" className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-4.5 py-4 shadow-xs">
            <Switch on={effEnc} disabled={!canEnc} onChange={() => setEnc((e) => !e)} label="DNS criptografado" />
            <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-0.5">
              <span className="text-sm font-medium">DNS criptografado (DNS por HTTPS)</span>
              <span className="text-[13px] text-muted-foreground">{encNote}</span>
            </div>
          </section>

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/50 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px]">{summary}</span>
              {note && <span className={cn('text-xs', note.ok ? 'text-status-ok' : 'text-status-bad')}>{note.text}</span>}
              {!isAdmin && changed && !note && <span className="text-xs text-muted-foreground">Trocar o DNS pede o modo administrador.</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={sel === 'auto' || applying} onClick={() => setSel('auto')}>
                Voltar ao automático
              </Button>
              {isAdmin ? (
                <Button size="sm" disabled={!changed || applying} onClick={() => void apply()}>
                  {applying && <RiLoader4Line className="animate-spin" aria-hidden />}
                  {applying ? 'Aplicando…' : 'Aplicar'}
                </Button>
              ) : (
                <Button size="sm" disabled={!changed} onClick={() => void relaunch()}>
                  <RiShieldUserLine aria-hidden />
                  Reabrir como admin
                </Button>
              )}
            </div>
          </section>
        </>
      )}
    </>
  )
}
