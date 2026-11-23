import { useCallback, useEffect, useState } from 'react'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFileCopyLine,
  RiKey2Line,
  RiLoader4Line,
  RiLockLine,
  RiPencilLine,
  RiPrinterLine,
  RiRefreshLine,
  RiShieldUserLine,
  RiWindowsLine
} from '@remixicon/react'
import {
  KIND_LABEL,
  SECURITY_LABEL,
  WIFI_SECURITIES,
  strongPassword,
  type QrDrawing,
  type VaultEntry,
  type VaultKind,
  type WifiSecurity,
  type WindowsWifiProfile
} from '@shared/vault'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/layout/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { cleanError, useApp } from '@/store/app'

const MASK = '••••••••••••'
const weak = (s: WifiSecurity | null): boolean => s === 'open' || s === 'WEP' || s === 'WPA'
const subtitle = (e: VaultEntry): string =>
  e.kind === 'router'
    ? [e.url?.replace(/^https?:\/\//, ''), e.user ? `usuário ${e.user}` : null].filter(Boolean).join(' · ') || 'Painel do roteador'
    : `${e.source === 'windows' ? 'Importada do Windows' : 'Digitada por você'} · ${e.security === 'open' ? 'aberta' : (e.security ?? 'WPA2')}`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm break-all">{children}</span>
    </div>
  )
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-medium">
      {children}
    </label>
  )
}

// ---------- add / edit ----------

interface FormState {
  kind: VaultKind
  name: string
  security: WifiSecurity
  hidden: boolean
  url: string
  user: string
  password: string
}

function EntryDialog({
  open,
  editing,
  onClose,
  onSaved
}: {
  open: boolean
  editing: VaultEntry | null
  onClose: () => void
  onSaved: (e: VaultEntry) => void
}) {
  const [f, setF] = useState<FormState>({
    kind: 'wifi',
    name: '',
    security: 'WPA2',
    hidden: false,
    url: '',
    user: '',
    password: ''
  })
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setShow(false)
    if (editing) {
      setF({
        kind: editing.kind,
        name: editing.name,
        security: editing.security ?? 'WPA2',
        hidden: editing.hidden,
        url: editing.url ?? '',
        user: editing.user ?? '',
        password: ''
      })
    } else {
      setF({
        kind: 'wifi',
        name: '',
        security: 'WPA2',
        hidden: false,
        url: '',
        user: '',
        password: ''
      })
      void window.api.vault.defaultRouterUrl().then((url) => setF((p) => (p.url ? p : { ...p, url: url ?? '' })))
    }
  }, [open, editing])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]): void => setF((p) => ({ ...p, [k]: v }))
  const isWifi = f.kind !== 'router'

  const submit = async (ev: React.FormEvent): Promise<void> => {
    ev.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await window.api.vault.save({
        id: editing?.id,
        kind: f.kind,
        name: f.name,
        security: isWifi ? f.security : null,
        hidden: isWifi && f.hidden,
        url: isWifi ? null : f.url,
        user: isWifi ? null : f.user,
        password: f.password || (editing ? undefined : '')
      })
      onSaved(saved)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar' : 'Adicionar senha'}</DialogTitle>
          <DialogDescription>Fica criptografada pelo Windows e só abre na sua conta de usuário.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          {!editing && (
            <div role="radiogroup" aria-label="Tipo" className="inline-flex gap-0.5 self-start rounded-lg bg-muted p-[3px]">
              {(['wifi', 'guest', 'router'] as VaultKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.kind === k}
                  onClick={() => set('kind', k)}
                  className={cn(
                    'h-7 rounded-md px-3 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    f.kind === k ? 'bg-background text-foreground shadow-xs dark:bg-input/40' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}

          {isWifi ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="v-name">Nome da rede</Label>
                <Input id="v-name" value={f.name} maxLength={32} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="Casa_5G" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="v-sec">Segurança</Label>
                <Select value={f.security} onValueChange={(v) => set('security', v as WifiSecurity)}>
                  <SelectTrigger id="v-sec" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WIFI_SECURITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SECURITY_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="v-url">Endereço do painel</Label>
                <Input id="v-url" value={f.url} autoFocus onChange={(e) => set('url', e.target.value)} placeholder="http://192.168.0.1" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="v-user">Usuário</Label>
                <Input id="v-user" value={f.user} onChange={(e) => set('user', e.target.value)} placeholder="admin" />
              </div>
            </>
          )}

          {(!isWifi || f.security !== 'open') && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-pw">Senha</Label>
              <div className="flex gap-2">
                <Input
                  id="v-pw"
                  type={show ? 'text' : 'password'}
                  value={f.password}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  onChange={(e) => set('password', e.target.value)}
                  placeholder={editing?.hasPassword ? 'Deixe em branco para manter a atual' : ''}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={show ? 'Esconder senha' : 'Mostrar senha'}
                  onClick={() => setShow((s) => !s)}
                >
                  {show ? <RiEyeOffLine aria-hidden /> : <RiEyeLine aria-hidden />}
                </Button>
              </div>
              {isWifi && (
                <button
                  type="button"
                  className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => {
                    set(
                      'password',
                      strongPassword((n) => crypto.getRandomValues(new Uint32Array(n)))
                    )
                    setShow(true)
                  }}
                >
                  Gerar senha forte (para quando for trocar a senha no roteador)
                </button>
              )}
            </div>
          )}

          {isWifi && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="size-4 accent-primary" checked={f.hidden} onChange={(e) => set('hidden', e.target.checked)} />
              Rede oculta (não aparece na lista de redes)
            </label>
          )}

          {error && <p className="text-[13px] text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <RiLoader4Line className="animate-spin" aria-hidden />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- import from Windows ----------

function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (e: VaultEntry) => void }) {
  const isAdmin = useApp((s) => s.isAdmin)
  const relaunch = useApp((s) => s.relaunchAsAdmin)
  const [list, setList] = useState<WindowsWifiProfile[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setList(null)
    setError(null)
    window.api.vault
      .windowsProfiles()
      .then(setList)
      .catch((err: unknown) => setError(cleanError(err)))
  }, [open])

  const take = async (name: string): Promise<void> => {
    setBusy(name)
    setError(null)
    try {
      onImported(await window.api.vault.importWindows(name))
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar do Windows</DialogTitle>
          <DialogDescription>Redes Wi-Fi que este PC já conhece, com a senha que o Windows guardou.</DialogDescription>
        </DialogHeader>
        {!list && !error && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <RiLoader4Line className="animate-spin" aria-hidden /> Lendo as redes salvas…
          </div>
        )}
        {list && !list.length && <p className="py-4 text-sm text-muted-foreground">Nenhuma rede Wi-Fi salva neste PC.</p>}
        {list && !!list.length && (
          <ul className="flex flex-col divide-y rounded-lg border">
            {list.map((p) => (
              <li key={p.name} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium">{p.name}</span>
                  <span className={cn('text-xs', weak(p.security) ? 'text-status-warn' : 'text-muted-foreground')}>{SECURITY_LABEL[p.security]}</span>
                </div>
                {p.saved && <Badge variant="secondary">Já guardada</Badge>}
                {p.hasKey ? (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void take(p.name)}>
                    {busy === p.name && <RiLoader4Line className="animate-spin" aria-hidden />}
                    {p.saved ? 'Atualizar' : 'Importar'}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Pede admin</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {list?.some((p) => !p.hasKey) && !isAdmin && (
          <Button size="sm" variant="outline" className="self-start" onClick={() => void relaunch()}>
            <RiShieldUserLine aria-hidden />
            Reabrir como admin para ver todas
          </Button>
        )}
        {error && <p className="text-[13px] text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}

// ---------- page ----------

export default function Passwords() {
  const hasWifi = useApp((s) => s.net?.hasWifiAdapter ?? false)
  const [entries, setEntries] = useState<VaultEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [qr, setQr] = useState<QrDrawing | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{
    open: boolean
    editing: VaultEntry | null
  }>({ open: false, editing: null })
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    try {
      setEntries(await window.api.vault.list())
      setLoadError(null)
    } catch (err) {
      setLoadError(cleanError(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sel = entries?.find((e) => e.id === selId) ?? entries?.[0] ?? null

  // A new selection starts hidden, with its own QR code.
  useEffect(() => {
    setRevealed(null)
    setNote(null)
    setQr(null)
    if (sel && sel.kind !== 'router')
      void window.api.vault
        .qr(sel.id)
        .then(setQr)
        .catch(() => setQr(null))
  }, [sel?.id, sel?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, fn: () => Promise<{ done: boolean; message: string } | void>): Promise<void> => {
    setBusy(key)
    setNote(null)
    try {
      const r = await fn()
      if (r && r.message) setNote({ ok: r.done, text: r.message })
    } catch (err) {
      setNote({ ok: false, text: cleanError(err) })
    } finally {
      setBusy(null)
    }
  }

  const saved = (e: VaultEntry): void => {
    setDialog({ open: false, editing: null })
    setImporting(false)
    setSelId(e.id)
    void load()
  }

  const headerActions = (
    <div className="flex gap-2">
      {hasWifi && (
        <Button variant="outline" onClick={() => setImporting(true)}>
          <RiWindowsLine aria-hidden />
          Importar do Windows
        </Button>
      )}
      <Button onClick={() => setDialog({ open: true, editing: null })}>
        <RiAddLine aria-hidden />
        Adicionar
      </Button>
    </div>
  )

  return (
    <>
      <PageHeader
        title="Senhas e QR"
        subtitle="Senhas do Wi-Fi e do roteador guardadas com criptografia, e QR code para visitas entrarem sem digitar nada."
        actions={headerActions}
      />

      <section className="flex items-start gap-3 rounded-xl border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
        <RiLockLine size={18} className="mt-px shrink-0" aria-hidden />
        <span>
          {hasWifi
            ? 'As senhas ficam criptografadas pelo Windows e só abrem na sua conta de usuário; nada vai para a internet.'
            : 'Este PC está no cabo, então as senhas do Wi-Fi são digitadas por você. Elas ficam criptografadas pelo Windows e só abrem na sua conta de usuário; nada vai para a internet.'}
        </span>
      </section>

      {loadError && <p className="selectable rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">{loadError}</p>}

      {!entries ? (
        !loadError && (
          <div className="flex flex-1 items-center justify-center py-20">
            <RiLoader4Line size={28} className="animate-spin text-muted-foreground" aria-hidden />
          </div>
        )
      ) : !entries.length ? (
        <EmptyState
          icon={RiKey2Line}
          title="Nenhuma senha guardada"
          action={
            <Button onClick={() => setDialog({ open: true, editing: null })}>
              <RiAddLine aria-hidden />
              Adicionar a primeira
            </Button>
          }
        >
          Guarde a senha do Wi-Fi para gerar o QR code das visitas, e a do painel do roteador para não perder quando trocar a de fábrica.
        </EmptyState>
      ) : (
        sel && (
          <section className="flex flex-wrap items-start gap-4">
            <ul aria-label="Senhas guardadas" className="flex min-w-0 flex-[1_1_240px] flex-col gap-2">
              {entries.map((e) => {
                const on = e.id === sel.id
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelId(e.id)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-xl bg-card px-3.5 py-3 text-left shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        on ? 'border-2 border-foreground px-[13px] py-[11px]' : 'border hover:border-foreground/30'
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{e.name}</span>
                        <Badge variant="secondary">{KIND_LABEL[e.kind]}</Badge>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{subtitle(e)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <article className="flex min-w-0 flex-[999_1_540px] flex-col gap-5 rounded-xl border bg-card px-5 py-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{KIND_LABEL[sel.kind]}</span>
                  <h2 className="text-xl font-semibold break-words">{sel.name}</h2>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, editing: sel })}>
                    <RiPencilLine aria-hidden />
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Apagar"
                    onClick={() =>
                      void act('remove', async () => {
                        const r = await window.api.vault.remove(sel.id)
                        if (r.done) {
                          setSelId(null)
                          await load()
                        }
                        return r
                      })
                    }
                  >
                    <RiDeleteBinLine aria-hidden />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-start gap-6">
                <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5">
                  {sel.kind === 'router' ? (
                    <>
                      <Field label="Endereço do painel">{sel.url ?? '—'}</Field>
                      <Field label="Usuário">{sel.user ?? '—'}</Field>
                    </>
                  ) : (
                    <>
                      <Field label="Nome da rede">{sel.name}</Field>
                      <Field label="Segurança">
                        <span className={cn(weak(sel.security) && 'text-status-warn')}>{SECURITY_LABEL[sel.security ?? 'WPA2']}</span>
                      </Field>
                      {sel.hidden && <Field label="Visibilidade">Rede oculta</Field>}
                    </>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">Senha</span>
                    {sel.security === 'open' ? (
                      <span className="text-sm">Rede aberta, sem senha</span>
                    ) : (
                      <div className="flex flex-col items-start gap-2">
                        <span className="selectable w-full rounded-md bg-muted px-3 py-2 font-mono text-[15px] break-all">{revealed ?? MASK}</span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              revealed !== null
                                ? setRevealed(null)
                                : void window.api.vault
                                    .reveal(sel.id)
                                    .then(setRevealed)
                                    .catch(() => setRevealed(null))
                            }
                          >
                            {revealed !== null ? <RiEyeOffLine aria-hidden /> : <RiEyeLine aria-hidden />}
                            {revealed !== null ? 'Esconder' : 'Mostrar'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void act('copy', () => window.api.vault.copy(sel.id))}>
                            <RiFileCopyLine aria-hidden />
                            Copiar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {sel.kind === 'router' && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[13px] leading-relaxed text-foreground/80">
                        Trocou a senha de fábrica do roteador? Guarde a nova aqui para não perder. O app nunca testa senhas do roteador.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="self-start"
                        onClick={() => void act('open', () => window.api.vault.openRouter(sel.id))}
                      >
                        <RiExternalLinkLine aria-hidden />
                        Abrir o painel do roteador
                      </Button>
                    </div>
                  )}

                  {sel.kind !== 'router' && weak(sel.security) && (
                    <p className="rounded-lg bg-status-warn/10 px-3 py-2.5 text-[13px] text-status-warn">
                      Esta rede usa proteção fraca. No painel do roteador, troque para WPA2 ou WPA3 e atualize a senha aqui.
                    </p>
                  )}
                </div>

                {sel.kind !== 'router' && (
                  <div className="flex flex-[0_1_260px] flex-col items-center gap-2.5 rounded-xl border px-4 py-4">
                    {qr ? (
                      <svg
                        viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
                        role="img"
                        aria-label={`QR code para entrar em ${sel.name}`}
                        className="block size-[200px] rounded-md bg-white"
                      >
                        <path d={qr.path} fill="#09090b" shapeRendering="crispEdges" />
                      </svg>
                    ) : (
                      <div className="flex size-[200px] items-center justify-center rounded-md bg-muted">
                        <RiLoader4Line className="animate-spin text-muted-foreground" aria-hidden />
                      </div>
                    )}
                    <span className="text-center text-[13px] font-medium">Aponte a câmera do celular para entrar em {sel.name}</span>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void act('print', () => window.api.vault.print(sel.id))}
                      >
                        {busy === 'print' ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiPrinterLine aria-hidden />}
                        Imprimir cartão
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void act('image', () => window.api.vault.saveImage(sel.id))}
                      >
                        {busy === 'image' ? <RiLoader4Line className="animate-spin" aria-hidden /> : <RiDownloadLine aria-hidden />}
                        Salvar imagem
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {sel.kind === 'guest' && (
                <p className="rounded-lg bg-status-ok/10 px-3 py-2.5 text-[13px] text-status-ok">
                  Rede de convidados: quem entra por ela não enxerga seus PCs e arquivos. É o QR ideal para visitas.
                </p>
              )}
              {sel.source === 'windows' && sel.kind !== 'router' && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RiRefreshLine size={14} aria-hidden />
                  Importada do Windows. Se a senha mudar no roteador, use "Importar do Windows" de novo ou edite aqui.
                </p>
              )}
              {note && <p className={cn('text-xs', note.ok ? 'text-status-ok' : 'text-status-bad')}>{note.text}</p>}
            </article>
          </section>
        )
      )}

      <EntryDialog open={dialog.open} editing={dialog.editing} onClose={() => setDialog({ open: false, editing: null })} onSaved={saved} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onImported={saved} />
    </>
  )
}
