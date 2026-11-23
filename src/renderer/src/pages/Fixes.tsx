import { useState } from 'react'
import {
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiLoader4Line,
  RiShieldUserLine
} from '@remixicon/react'
import { diagnose, type DiagStepId, type FixId } from '@shared/network'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { cleanError, useApp } from '@/store/app'

interface FixDef {
  id: FixId
  title: string
  text: string
  button: string
  tag: string
  tagVariant: 'ok' | 'secondary' | 'bad'
  admin: boolean
  danger?: boolean
}

const FIXES: FixDef[] = [
  {
    id: 'flushDns',
    title: 'Limpar cache de DNS',
    text: 'Resolve sites que não abrem ou que abrem uma versão antiga. Não derruba a conexão.',
    button: 'Limpar',
    tag: 'Sem admin',
    tagVariant: 'ok',
    admin: false
  },
  {
    id: 'renewIp',
    title: 'Renovar o endereço IP',
    text: 'Pede um endereço novo ao roteador. A conexão cai por 2 a 5 segundos.',
    button: 'Renovar',
    tag: 'Sem admin',
    tagVariant: 'ok',
    admin: false
  },
  {
    id: 'restartAdapter',
    title: 'Reiniciar a placa de rede',
    text: 'Desliga e liga a placa de rede, como tirar o cabo e pôr de novo. Resolve conexão travada.',
    button: 'Reiniciar placa',
    tag: 'Pede admin',
    tagVariant: 'secondary',
    admin: true
  },
  {
    id: 'resetNetwork',
    title: 'Redefinir a rede do Windows',
    text: 'Último recurso: volta as configurações de rede ao padrão. VPNs e adaptadores virtuais podem precisar ser refeitos, e o PC precisa reiniciar.',
    button: 'Redefinir…',
    tag: 'Pede admin e reinício',
    tagVariant: 'bad',
    admin: true,
    danger: true
  }
]

const STEP_LABEL: Record<DiagStepId, string> = {
  adapter: 'Placa de rede ligada',
  address: 'Endereço IP válido',
  router: 'Roteador responde',
  dns: 'DNS traduz nomes',
  internet: 'Internet responde'
}

const FAILED_TEXT: Record<DiagStepId, string> = {
  adapter: 'Nenhuma placa de rede está conectada. Confira o cabo ou o Wi-Fi; se estiver tudo ligado, reinicie a placa.',
  address: 'O PC não recebeu endereço do roteador (ficou com um 169.254). Renovar o IP costuma resolver; se não, reinicie o roteador.',
  router: 'O roteador não responde. Reinicie a placa de rede; se continuar, reinicie o roteador.',
  dns: 'A internet responde, mas os nomes de sites não são traduzidos. Limpe o cache de DNS; se continuar, troque de servidor na página DNS.',
  internet: 'A rede de casa funciona, mas a internet não responde. Reinicie o roteador; se continuar, o problema está na operadora.'
}

export default function Fixes() {
  const net = useApp((s) => s.net)
  const path = useApp((s) => s.path)
  const checking = useApp((s) => s.checking)
  const refresh = useApp((s) => s.refreshNet)
  const isAdmin = useApp((s) => s.isAdmin)
  const relaunch = useApp((s) => s.relaunchAsAdmin)

  const [ran, setRan] = useState(false)
  const [running, setRunning] = useState<FixId | null>(null)
  const [notes, setNotes] = useState<Partial<Record<FixId, { ok: boolean; text: string }>>>({})

  const diag = net?.supported ? diagnose(net, path) : null

  const runDiag = async (): Promise<void> => {
    await refresh()
    setRan(true)
  }

  const runFix = async (id: FixId): Promise<void> => {
    setRunning(id)
    try {
      const r = await window.api.fixes.run(id)
      if (r.done) setNotes((n) => ({ ...n, [id]: { ok: r.ok, text: r.message } }))
      // The fix may have changed the connection: read it again.
      if (r.done && r.ok && id !== 'resetNetwork') void refresh()
    } catch (err) {
      setNotes((n) => ({ ...n, [id]: { ok: false, text: cleanError(err) } }))
    } finally {
      setRunning(null)
    }
  }

  const suggested = ran ? diag?.suggestion : null

  return (
    <>
      <PageHeader title="Consertos" subtitle="Os consertos clássicos de internet, um clique cada. O diagnóstico diz qual deles faz sentido." />

      <section aria-label="Diagnóstico" className="flex flex-col gap-3.5 rounded-xl border bg-card px-5 py-4.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[15px] font-semibold">Diagnóstico automático</h2>
            <span className="text-[13px] text-muted-foreground">Testa cada etapa do caminho até a internet, em poucos segundos</span>
          </div>
          <Button disabled={checking || !net?.supported} onClick={() => void runDiag()}>
            {checking && <RiLoader4Line className="animate-spin" aria-hidden />}
            {checking ? 'Testando…' : ran ? 'Rodar de novo' : 'Rodar diagnóstico'}
          </Button>
        </div>
        {ran && diag && !checking && (
          <>
            <ol className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2">
              {diag.steps.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2.5 text-[13px]">
                  {s.ok ? (
                    <RiCheckboxCircleLine size={18} className="shrink-0 text-status-ok" aria-label="Ok" />
                  ) : (
                    <RiCloseCircleLine size={18} className="shrink-0 text-status-bad" aria-label="Falhou" />
                  )}
                  <span className="flex-1">{STEP_LABEL[s.id]}</span>
                  <span className="font-mono text-xs text-muted-foreground">{s.value}</span>
                </li>
              ))}
            </ol>
            {diag.failed ? (
              <p className="rounded-lg bg-status-warn/10 px-3 py-2.5 text-[13px] text-status-warn">{FAILED_TEXT[diag.failed]}</p>
            ) : (
              <p className="rounded-lg bg-status-ok/10 px-3 py-2.5 text-[13px] text-status-ok">
                Nenhum problema encontrado. Se a internet estiver lenta, o Ping mostra se a lentidão vem da rede de casa ou da operadora.
              </p>
            )}
          </>
        )}
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        {FIXES.map((f) => {
          const locked = f.admin && !isAdmin
          const note = notes[f.id]
          return (
            <article
              key={f.id}
              className={cn(
                'flex flex-col gap-3 rounded-xl border bg-card px-4.5 py-4 shadow-xs',
                suggested === f.id && 'border-brand ring-1 ring-brand'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[15px] font-semibold">{f.title}</h2>
                <Badge variant={f.tagVariant}>{f.tag}</Badge>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{f.text}</p>
              {suggested === f.id && <p className="text-xs font-medium text-brand">Sugerido pelo diagnóstico</p>}
              <div className="mt-auto flex flex-wrap items-center gap-2.5">
                {locked ? (
                  <Button size="sm" variant="outline" onClick={() => void relaunch()}>
                    <RiShieldUserLine aria-hidden />
                    Reabrir como admin
                  </Button>
                ) : (
                  <Button size="sm" variant={f.danger ? 'destructive' : 'default'} disabled={running !== null} onClick={() => void runFix(f.id)}>
                    {running === f.id && <RiLoader4Line className="animate-spin" aria-hidden />}
                    {running === f.id ? 'Executando…' : f.button}
                  </Button>
                )}
                {note && <span className={cn('text-xs', note.ok ? 'text-status-ok' : 'text-status-bad')}>{note.text}</span>}
                {!note && f.danger && <span className="text-xs text-muted-foreground">Pede confirmação antes</span>}
              </div>
            </article>
          )
        })}
      </section>
    </>
  )
}
