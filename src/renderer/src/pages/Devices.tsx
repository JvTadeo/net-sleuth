import { useEffect, useState } from 'react'
import {
  RiCastLine,
  RiComputerLine,
  RiDeviceLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiGamepadLine,
  RiHardDrive3Line,
  RiHome4Line,
  RiLoader4Line,
  RiMacbookLine,
  RiPrinterLine,
  RiQuestionLine,
  RiRefreshLine,
  RiRouterLine,
  RiSmartphoneLine,
  RiSpeaker2Line,
  RiTabletLine,
  RiTvLine,
  RiWebcamLine,
  type RemixiconComponentType
} from '@remixicon/react'
import { DEVICE_TYPES, TYPE_LABEL, deviceLabel, type Device, type DeviceAction, type DeviceStatus, type DeviceType } from '@shared/devices'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { cleanError, useApp } from '@/store/app'

type Tab = 'all' | 'new' | 'blocked'
type Step = 'none' | 'options' | 'block' | 'guest'

const STATUS: Record<DeviceStatus, { label: string; className: string }> = {
  self: { label: 'Este PC', className: 'bg-secondary text-secondary-foreground' },
  router: { label: 'Roteador', className: 'bg-secondary text-secondary-foreground' },
  new: { label: 'Novo', className: 'bg-brand/15 text-brand' },
  known: { label: 'Conhecido', className: 'bg-status-ok/15 text-status-ok' },
  blocked: { label: 'Bloqueado', className: 'bg-status-bad/15 text-status-bad' }
}

const TYPE_ICON: Record<DeviceType, RemixiconComponentType> = {
  router: RiRouterLine,
  computer: RiComputerLine,
  laptop: RiMacbookLine,
  phone: RiSmartphoneLine,
  tablet: RiTabletLine,
  tv: RiTvLine,
  streamer: RiCastLine,
  console: RiGamepadLine,
  printer: RiPrinterLine,
  speaker: RiSpeaker2Line,
  camera: RiWebcamLine,
  smarthome: RiHome4Line,
  nas: RiHardDrive3Line,
  unknown: RiQuestionLine
}

/** "TV" when sure, "TV (provável)" when it is a guess. */
const typeText = (d: Device): string =>
  d.type === 'unknown' ? 'Tipo desconhecido' : `${TYPE_LABEL[d.type]}${d.typeSource === 'auto' && d.typeConfidence !== 'high' ? ' (provável)' : ''}`

const GRID = 'grid-cols-[minmax(180px,1.5fr)_minmax(96px,1fr)_104px_72px_92px]'

function seen(d: Device, now: number): string {
  if (d.online) return 'agora'
  const min = Math.round((now - d.lastSeen) / 60_000)
  if (min < 60) return `há ${Math.max(min, 1)} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  if (h < 48) return 'ontem'
  return new Date(d.lastSeen).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const vendorText = (d: Device): string => d.vendor ?? (d.privateMac ? 'Endereço privado' : 'Desconhecido')

function StatusPill({ status }: { status: DeviceStatus }) {
  return <span className={cn('inline-flex h-5 items-center rounded-md px-2 text-xs font-medium', STATUS[status].className)}>{STATUS[status].label}</span>
}

function Option({ title, text, onClick }: { title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-0.5 rounded-lg border bg-card px-3.5 py-3 text-left outline-none hover:border-foreground/30 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{text}</span>
    </button>
  )
}

export default function Devices() {
  const scan = useApp((s) => s.deviceScan)
  const setScan = useApp((s) => s.setDeviceScan)
  const setPage = useApp((s) => s.setPage)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [selMac, setSelMac] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('none')
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setScanning(true)
    setError(null)
    try {
      setScan(await window.api.devices.scan(true))
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setScanning(false)
    }
  }

  // Show the last background scan at once; scan now only if there is none yet.
  useEffect(() => {
    if (scan) return
    void window.api.devices.last().then((last) => (last ? setScan(last) : refresh()))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (action: Omit<DeviceAction, 'mac'> & { name?: string; type?: DeviceType | null }, after?: () => void): Promise<void> => {
    if (!sel) return
    setError(null)
    try {
      setScan(await window.api.devices.act({ ...action, mac: sel.mac } as DeviceAction))
      setStep('none')
      after?.()
    } catch (err) {
      setError(cleanError(err))
    }
  }

  const devices = scan?.devices ?? []
  const counts = {
    all: devices.length,
    new: devices.filter((d) => d.status === 'new').length,
    blocked: devices.filter((d) => d.status === 'blocked').length
  }
  const shown = devices.filter((d) => tab === 'all' || d.status === tab)
  const sel = devices.find((d) => d.mac === selMac) ?? shown[0] ?? devices[0] ?? null
  const now = scan?.scannedAt ?? Date.now()
  const routerHost = scan?.routerUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? 'o endereço do roteador'
  const actionable = !!sel && (sel.status === 'new' || sel.status === 'known')

  const pick = (mac: string): void => {
    setSelMac(mac)
    setStep('none')
    setDraft('')
    setNote(null)
  }

  const copyMac = (): void => {
    if (!sel) return
    void navigator.clipboard.writeText(sel.mac).then(() => setNote('Endereço copiado.'))
  }

  const openPanel = (): void => {
    void window.api.devices.openRouter().catch((err: unknown) => setError(cleanError(err)))
  }

  if (scan && !scan.supported) {
    return (
      <>
        <PageHeader title="Aparelhos" />
        <EmptyState icon={RiDeviceLine} title="Disponível apenas no Windows">
          A lista de aparelhos vem da tabela de vizinhos de rede do Windows.
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Aparelhos"
        subtitle={
          scan
            ? `${counts.all} ${counts.all === 1 ? 'aparelho' : 'aparelhos'} · ${counts.new} ${counts.new === 1 ? 'novo' : 'novos'} · ${counts.blocked} ${counts.blocked === 1 ? 'bloqueado' : 'bloqueados'}`
            : 'Procurando aparelhos na rede…'
        }
        actions={
          <Button variant="outline" disabled={scanning} onClick={() => void refresh()}>
            {scanning ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiRefreshLine aria-hidden />}
            {scanning ? 'Procurando…' : 'Atualizar lista'}
          </Button>
        }
      />

      {error && <p className="selectable rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">{error}</p>}

      {scan?.firstScan && (
        <p className="rounded-lg bg-brand/10 px-3.5 py-2.5 text-[13px] text-brand">
          Primeira verificação desta rede: todos aparecem como novos. Dê um nome aos aparelhos que você reconhece; a partir daí, o app avisa só quando
          chegar alguém diferente.
        </p>
      )}

      {scan && scan.router.state !== 'unsupported' && scan.router.state !== 'ok' && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-[13px]',
            scan.router.state === 'auth' || scan.router.state === 'error' ? 'bg-status-warn/10 text-status-warn' : 'border border-dashed text-muted-foreground'
          )}
        >
          <span className="min-w-0 flex-1">
            {scan.router.state === 'off'
              ? 'Seu roteador (TP-Link EX/Aginet) sabe o nome de cada aparelho, como "Galaxy-S23". O app pode ler essa lista com a senha do painel guardada em Senhas e QR. Nada é alterado no roteador.'
              : scan.router.message}
          </span>
          {scan.router.state === 'off' && (
            <Button
              size="sm"
              onClick={() => void window.api.devices.setRouterNames(true).then(() => refresh())}
              disabled={scanning}
            >
              Ler os nomes do roteador
            </Button>
          )}
          {(scan.router.state === 'noPassword' || scan.router.state === 'auth') && (
            <Button size="sm" variant="outline" onClick={() => setPage('passwords')}>
              Ir para Senhas e QR
            </Button>
          )}
        </div>
      )}

      {!scan ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <RiLoader4Line size={28} className="animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Perguntando a cada endereço da rede de casa quem está conectado…</p>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Filtrar" className="inline-flex gap-0.5 self-start rounded-lg bg-muted p-[3px]">
            {(['all', 'new', 'blocked'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'inline-flex h-[30px] items-center gap-1.5 rounded-md px-3 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  tab === t ? 'bg-background text-foreground shadow-xs dark:bg-input/40' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {{ all: 'Todos', new: 'Novos', blocked: 'Bloqueados' }[t]}
                <span className="text-xs text-muted-foreground">{counts[t]}</span>
              </button>
            ))}
          </div>

          <section className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-[999_1_620px] overflow-hidden rounded-xl border bg-card shadow-xs">
              <div className="overflow-x-auto">
                <div className="min-w-[620px]">
                  <div className={cn('grid gap-3 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground', GRID)}>
                    <span>Aparelho</span>
                    <span>Fabricante</span>
                    <span>Endereço IP</span>
                    <span>Visto</span>
                    <span>Situação</span>
                  </div>
                  {shown.map((d) => {
                    const on = d.mac === sel?.mac
                    const unnamed = !d.name && d.status !== 'self' && d.status !== 'router'
                    return (
                      <button
                        key={d.mac}
                        type="button"
                        aria-pressed={on}
                        onClick={() => pick(d.mac)}
                        className={cn(
                          'grid w-full items-center gap-3 border-b px-4 py-2.5 text-left outline-none last:border-b-0 focus-visible:bg-accent',
                          GRID,
                          on ? 'bg-accent' : 'hover:bg-accent/50',
                          !d.online && 'opacity-70'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          {(() => {
                            const Icon = TYPE_ICON[d.type]
                            return (
                              <span
                                title={typeText(d)}
                                className={cn(
                                  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted',
                                  d.typeSource === 'auto' && d.typeConfidence === 'low' ? 'text-muted-foreground/70' : 'text-foreground/80'
                                )}
                              >
                                <Icon size={17} aria-hidden />
                                <span className="sr-only">{typeText(d)}</span>
                              </span>
                            )
                          })()}
                          <span className="flex min-w-0 flex-col gap-px">
                            <span className={cn('truncate text-sm font-medium', unnamed && deviceLabel(d) === 'Aparelho desconhecido' && 'text-muted-foreground')}>{deviceLabel(d)}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">{d.mac}</span>
                          </span>
                        </span>
                        <span className="truncate text-[13px] text-foreground/80">{vendorText(d)}</span>
                        <span className="font-mono text-[13px]">{d.ip ?? '—'}</span>
                        <span className="text-[13px] text-muted-foreground">{seen(d, now)}</span>
                        <span>
                          <StatusPill status={d.status} />
                        </span>
                      </button>
                    )
                  })}
                  {!shown.length && <div className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum aparelho com esse filtro.</div>}
                </div>
              </div>
              <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                Fotografia da rede agora. Alguns aparelhos só aparecem quando estão em uso.
                {scan.router.state === 'ok' &&
                  scan.router.lastRead &&
                  ` Nomes lidos do roteador às ${new Date(scan.router.lastRead).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`}
              </div>
            </div>

            {sel && (
              <aside aria-label="Detalhes do aparelho" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-xl border bg-card px-4.5 py-4.5 shadow-xs">
                <div className="flex flex-col gap-1.5">
                  <span className="self-start">
                    <StatusPill status={sel.status} />
                  </span>
                  <h2 className="text-lg font-semibold break-words">{deviceLabel(sel)}</h2>
                  <span className="text-[13px] text-muted-foreground">
                    {vendorText(sel)} · {sel.ip ?? '—'} · visto {seen(sel, now)}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Tipo</span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {(() => {
                      const Icon = TYPE_ICON[sel.type]
                      return <Icon size={18} className="shrink-0 text-foreground/80" aria-hidden />
                    })()}
                    {typeText(sel)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sel.typeSource === 'user' ? 'Escolhido por você.' : `Como o app sabe: ${sel.typeReason}.`}
                    {sel.model && ` Modelo: ${sel.model}.`}
                    {sel.os && sel.status !== 'self' && ` Sistema: ${sel.os} (segundo o roteador).`}
                  </span>
                  {sel.status !== 'self' && sel.status !== 'router' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={sel.typeSource === 'user' ? sel.type : ''}
                        onValueChange={(v) => void act({ op: 'setType', type: v as DeviceType })}
                      >
                        <SelectTrigger size="sm" className="w-56" aria-label="Escolher o tipo">
                          <SelectValue placeholder={sel.typeSource === 'user' ? undefined : 'Não é isso? Escolha o tipo'} />
                        </SelectTrigger>
                        <SelectContent>
                          {DEVICE_TYPES.map((t) => {
                            const Icon = TYPE_ICON[t]
                            return (
                              <SelectItem key={t} value={t}>
                                <Icon aria-hidden />
                                {TYPE_LABEL[t]}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                      {sel.typeSource === 'user' && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => void act({ op: 'setType', type: null })}
                        >
                          Voltar ao automático
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {sel.status === 'new' && (
                  <p className="rounded-lg bg-brand/10 px-3 py-2.5 text-[13px] leading-relaxed text-brand">
                    {scan.firstScan ? 'Encontrado na primeira verificação' : `Este aparelho entrou na rede ${seen({ ...sel, online: false, lastSeen: sel.firstSeen }, now)}`}{' '}
                    e você ainda não deu um nome a ele.
                    {sel.privateMac && ' O fabricante não aparece porque ele usa um endereço privado, comum em celulares.'}
                    {sel.hostname && ` Ele se apresenta na rede como "${sel.hostname}".`}
                    {sel.friendlyName && !sel.hostname && ` Ele se anuncia como "${sel.friendlyName}".`}
                  </p>
                )}

                {sel.status === 'blocked' && (
                  <p className="rounded-lg bg-status-bad/10 px-3 py-2.5 text-[13px] leading-relaxed text-status-bad">
                    Marcado como bloqueado no roteador
                    {sel.blockedAt ? ` em ${new Date(sel.blockedAt).toLocaleDateString('pt-BR')}` : ''}. Enquanto o bloqueio valer no roteador, ele não volta
                    para a rede.
                    {sel.online && ' Atenção: ele apareceu de novo, então o bloqueio não pegou no roteador.'}
                  </p>
                )}

                {sel.status !== 'self' && sel.status !== 'router' && (
                  <form
                    className="flex flex-col gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (draft.trim()) void act({ op: 'rename', name: draft }, () => setDraft(''))
                    }}
                  >
                    <label htmlFor="d-name" className="text-xs text-muted-foreground">
                      {sel.name ? 'Mudar o nome' : 'Dar um nome'}
                    </label>
                    <div className="flex gap-2">
                      <Input id="d-name" value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} placeholder={sel.name ?? 'Ex.: Celular da Maria'} />
                      <Button type="submit" size="sm" variant="outline" className="h-9" disabled={!draft.trim()}>
                        Salvar
                      </Button>
                    </div>
                  </form>
                )}

                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Endereço físico (MAC)</span>
                  <span className="flex items-center gap-2">
                    <span className="selectable font-mono text-[13px]">{sel.mac}</span>
                    <Button size="sm" variant="outline" className="h-7 px-2" aria-label="Copiar endereço" onClick={copyMac}>
                      <RiFileCopyLine aria-hidden />
                    </Button>
                  </span>
                  {note && <span className="text-xs text-status-ok">{note}</span>}
                </div>

                {actionable && step === 'none' && (
                  <Button className="self-start" onClick={() => setStep('options')}>
                    O que fazer com este aparelho
                  </Button>
                )}

                {actionable && step === 'options' && (
                  <div className="flex flex-col gap-2">
                    {sel.status === 'new' && (
                      <Option
                        title="É meu ou de alguém que eu conheço"
                        text="Tira o aviso. Dê um nome para reconhecer depois."
                        onClick={() => void act({ op: 'known' }, () => document.getElementById('d-name')?.focus())}
                      />
                    )}
                    <Option title="Bloquear pelo roteador" text="O app guia você no painel do roteador. Bloqueio permanente e reversível." onClick={() => setStep('block')} />
                    <Option
                      title="Trocar a senha do Wi-Fi"
                      text="Tira todo mundo de uma vez. Gere o QR novo e deixe voltar só quem você quiser."
                      onClick={() => setPage('passwords')}
                    />
                    <Option
                      title="Criar uma rede de convidados"
                      text="Visitas entram por uma rede separada e não enxergam seus PCs e arquivos."
                      onClick={() => setStep('guest')}
                    />
                  </div>
                )}

                {actionable && step === 'block' && (
                  <div className="flex flex-col gap-2.5">
                    <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed">
                      <li>Copie o endereço MAC acima.</li>
                      <li>
                        Abra o painel do roteador em <span className="font-mono">{routerHost}</span> (a senha pode estar em Senhas e QR).
                      </li>
                      <li>Procure por "Controle de acesso", "Bloquear dispositivo" ou "Filtro de MAC".</li>
                      <li>Cole o endereço, salve, e volte aqui.</li>
                    </ol>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={openPanel}>
                        <RiExternalLinkLine aria-hidden />
                        Abrir o painel
                      </Button>
                      <Button size="sm" onClick={() => void act({ op: 'blocked' })}>
                        Já bloqueei no roteador
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setStep('options')}>
                        Voltar
                      </Button>
                    </div>
                  </div>
                )}

                {actionable && step === 'guest' && (
                  <div className="flex flex-col gap-2.5">
                    <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed">
                      <li>
                        Abra o painel do roteador em <span className="font-mono">{routerHost}</span>.
                      </li>
                      <li>Procure por "Rede de convidados" ou "Guest Network" e ative, com uma senha própria.</li>
                      <li>Em Senhas e QR, adicione essa rede como "Convidados" para ter o QR das visitas.</li>
                    </ol>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={openPanel}>
                        <RiExternalLinkLine aria-hidden />
                        Abrir o painel
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPage('passwords')}>
                        Ir para Senhas e QR
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setStep('options')}>
                        Voltar
                      </Button>
                    </div>
                  </div>
                )}

                {sel.status === 'blocked' && (
                  <div className="flex flex-col gap-2.5 border-t pt-3">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Desfazer o bloqueio</h3>
                    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-relaxed">
                      <li>No painel do roteador, remova este endereço da lista de bloqueio.</li>
                      <li>Depois, tire a marca aqui.</li>
                    </ol>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={openPanel}>
                        <RiExternalLinkLine aria-hidden />
                        Abrir o painel
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void act({ op: 'unblock' })}>
                        Tirar a marca de bloqueado
                      </Button>
                    </div>
                  </div>
                )}

                {!sel.online && sel.status !== 'blocked' && sel.status !== 'self' && (
                  <button
                    type="button"
                    className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => void act({ op: 'forget' }, () => setSelMac(null))}
                  >
                    Remover da lista (volta como novo se aparecer de novo)
                  </button>
                )}
              </aside>
            )}
          </section>
        </>
      )}
    </>
  )
}
