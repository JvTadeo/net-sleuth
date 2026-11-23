import { useEffect, useMemo, useState } from 'react'
import { RiAlertLine, RiCheckboxCircleLine, RiLoader4Line, RiPauseLine, RiPlayLine } from '@remixicon/react'
import { PING_TARGETS, pingVerdict, statsOf, type PingSample, type PingTarget, type VerdictKind } from '@shared/network'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { msText } from '@/lib/net'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

const WINDOW = 60

const VERDICT: Record<VerdictKind, { tone: 'ok' | 'warn' | 'wait'; title: string; text: string }> = {
  waiting: { tone: 'wait', title: 'Medindo…', text: 'Em alguns segundos dá para dizer se está tudo certo e, se não estiver, de que lado está o problema.' },
  ok: { tone: 'ok', title: 'Tudo certo', text: 'Roteador e internet respondem rápido e sem perder pacotes.' },
  isp: {
    tone: 'warn',
    title: 'A lentidão está na operadora',
    text: 'O roteador responde rápido, mas a internet está lenta ou perdendo pacotes. A rede de casa está bem: vale falar com a operadora.'
  },
  home: {
    tone: 'warn',
    title: 'O problema está na rede de casa',
    text: 'Até o roteador está lento ou instável. Confira o cabo, a distância do Wi-Fi ou reinicie o roteador antes de culpar a operadora.'
  },
  internetDown: {
    tone: 'warn',
    title: 'A internet não responde',
    text: 'O roteador responde, mas a internet não. Reinicie o roteador; se continuar, o problema está na operadora.'
  },
  routerDown: { tone: 'warn', title: 'Nada responde', text: 'Nem o roteador responde. Confira o cabo ou o Wi-Fi e use os Consertos.' }
}

const PLOT = { x0: 44, x1: 748, y0: 20, y1: 200 }

function Chart({ samples, max }: { samples: PingSample[]; max: number }) {
  const step = (PLOT.x1 - PLOT.x0) / (WINDOW - 1)
  // Newest sample at the right edge; the line grows in from the right as samples arrive.
  const offset = WINDOW - samples.length
  const points = (pick: (s: PingSample) => number | null): string[] => {
    const runs: string[] = []
    let current: string[] = []
    samples.forEach((s, i) => {
      const v = pick(s)
      if (v === null) {
        if (current.length) runs.push(current.join(' '))
        current = []
        return
      }
      const x = PLOT.x0 + (offset + i) * step
      const y = PLOT.y1 - (Math.min(v, max) / max) * (PLOT.y1 - PLOT.y0)
      current.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    })
    if (current.length) runs.push(current.join(' '))
    return runs
  }
  const ticks = [max, (max * 2) / 3, max / 3]
  return (
    <svg viewBox="0 0 760 230" role="img" aria-label="Latência dos últimos 60 segundos" className="block h-auto w-full">
      {ticks.map((t, i) => (
        <g key={t}>
          <line x1={PLOT.x0} x2={PLOT.x1} y1={PLOT.y0 + i * 60} y2={PLOT.y0 + i * 60} className="stroke-border/60" />
          <text x={36} y={PLOT.y0 + i * 60 + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground">
            {Math.round(t)} ms
          </text>
        </g>
      ))}
      <line x1={PLOT.x0} x2={PLOT.x1} y1={PLOT.y1} y2={PLOT.y1} className="stroke-border" />
      <text x={36} y={PLOT.y1 + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground">
        0 ms
      </text>
      <text x={PLOT.x0} y={222} fontSize={11} className="fill-muted-foreground">
        60 s atrás
      </text>
      <text x={PLOT.x1} y={222} textAnchor="end" fontSize={11} className="fill-muted-foreground">
        agora
      </text>
      {points((s) => s.internet).map((p, i) => (
        <polyline key={`n${i}`} points={p} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />
      ))}
      {points((s) => s.router).map((p, i) => (
        <polyline key={`r${i}`} points={p} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" />
      ))}
      {samples.map((s, i) =>
        s.internet === null ? (
          <line
            key={`x${s.t}`}
            x1={PLOT.x0 + (offset + i) * step}
            x2={PLOT.x0 + (offset + i) * step}
            y1={PLOT.y0}
            y2={PLOT.y1}
            className="stroke-status-bad/30"
          />
        ) : null
      )}
    </svg>
  )
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-card px-3.5 py-3 shadow-xs">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('font-mono text-[22px] font-semibold tracking-tight tabular-nums', warn && 'text-status-warn')}>{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

export default function Ping() {
  const gatewayFromNet = useApp((s) => s.net?.primary?.gateway ?? null)
  const supported = useApp((s) => s.net?.supported ?? true)
  const [samples, setSamples] = useState<PingSample[]>([])
  const [target, setTarget] = useState<PingTarget>('1.1.1.1')
  const [running, setRunning] = useState(true)
  const [gateway, setGateway] = useState<string | null>(gatewayFromNet)

  // Start on open, stop on leave; samples arrive once per second.
  useEffect(() => {
    const off = window.api.ping.onSample((s) => setSamples((prev) => [...prev, s].slice(-WINDOW)))
    void window.api.ping.state().then((st) => {
      setSamples(st.samples)
      setTarget(st.target)
    })
    return () => {
      off()
      void window.api.ping.stop()
    }
  }, [])

  useEffect(() => {
    if (!supported) return
    if (running) {
      void window.api.ping.start(target).then((st) => {
        setSamples(st.samples)
        setGateway(st.gateway)
      })
    } else void window.api.ping.stop()
  }, [running, target, supported])

  const router = useMemo(() => statsOf(samples.map((s) => s.router)), [samples])
  const internet = useMemo(() => statsOf(samples.map((s) => s.internet)), [samples])
  const verdict = pingVerdict(samples)
  const v = VERDICT[verdict]
  const routerSilent = router.count >= 5 && router.loss === 1 && internet.loss < 1
  const peak = Math.max(router.max ?? 0, internet.max ?? 0)
  const max = peak <= 50 ? 60 : peak <= 140 ? 150 : peak <= 280 ? 300 : 600

  return (
    <>
      <PageHeader
        title="Ping"
        subtitle="Latência ao vivo até o roteador e até a internet. Comparar as duas linhas mostra de que lado está o problema."
        actions={
          <Button variant="outline" onClick={() => setRunning((r) => !r)}>
            {running ? <RiPauseLine aria-hidden /> : <RiPlayLine aria-hidden />}
            {running ? 'Pausar' : 'Retomar'}
          </Button>
        }
      />

      <section
        aria-label="Veredito"
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-xl px-4 py-3.5',
          v.tone === 'ok' ? 'bg-status-ok/10 text-status-ok' : v.tone === 'warn' ? 'bg-status-warn/10 text-status-warn' : 'bg-muted text-muted-foreground'
        )}
      >
        {v.tone === 'ok' ? (
          <RiCheckboxCircleLine size={20} className="mt-px shrink-0" aria-hidden />
        ) : v.tone === 'warn' ? (
          <RiAlertLine size={20} className="mt-px shrink-0" aria-hidden />
        ) : (
          <RiLoader4Line size={20} className="mt-px shrink-0 animate-spin" aria-hidden />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{v.title}</span>
          <span className="text-[13px]">{v.text}</span>
          {routerSilent && (
            <span className="text-xs">O roteador não responde a ping, o que é comum: o veredito usa só a linha da internet.</span>
          )}
        </div>
      </section>

      <section aria-label="Gráfico" className="flex flex-col gap-3 rounded-xl border bg-card px-4.5 py-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-[13px]">
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-3.5 rounded-full bg-[#0d9488]" />
              Roteador · <span className="font-mono">{gateway ?? '—'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-3.5 rounded-full bg-[#2563eb]" />
              Internet · <span className="font-mono">{target}</span>
            </span>
          </div>
          <div role="radiogroup" aria-label="Destino na internet" className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]">
            {PING_TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={t === target}
                onClick={() => {
                  setTarget(t)
                  setSamples([])
                }}
                className={cn(
                  'h-7 rounded-md px-2.5 font-mono text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  t === target ? 'bg-background text-foreground shadow-xs dark:bg-input/40' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <Chart samples={samples} max={max} />
        {!running && <p className="text-xs text-muted-foreground">Pausado. As medições recomeçam ao clicar em Retomar.</p>}
      </section>

      <section aria-label="Números" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Stat
          label="Roteador · média"
          value={routerSilent ? '—' : msText(router.avg)}
          hint={routerSilent ? 'não responde a ping' : `máx ${msText(router.max)}`}
          warn={!routerSilent && (router.avg ?? 0) > 20}
        />
        <Stat label="Internet · média" value={msText(internet.avg)} hint={`máx ${msText(internet.max)}`} warn={(internet.avg ?? 0) > 80} />
        <Stat label="Variação (jitter)" value={msText(internet.jitter)} hint="importa para chamadas e jogos" warn={(internet.jitter ?? 0) > 30} />
        <Stat
          label="Pacotes perdidos"
          value={`${Math.round(internet.loss * 100)}%`}
          hint={`nos últimos ${samples.length} s`}
          warn={internet.loss > 0.03}
        />
        <Stat label="Medições" value={String(samples.length)} hint="1 por segundo" />
      </section>
    </>
  )
}
