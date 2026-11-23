import { useEffect, useState } from 'react'
import type { AppInfo, ThemeSource } from '@shared/ipc'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

const OPTIONS: { value: ThemeSource; label: string; hint: string }[] = [
  { value: 'light', label: 'Claro', hint: 'Sempre claro' },
  { value: 'dark', label: 'Escuro', hint: 'Sempre escuro' },
  { value: 'system', label: 'Padrão do Windows', hint: 'Segue o tema do sistema' }
]

/** Window thumbnail for each theme. */
function Preview({ variant }: { variant: ThemeSource }) {
  const pane = (dark: boolean) => (
    <div className={cn('flex h-full flex-1 gap-1.5 p-1.5', dark ? 'bg-zinc-900' : 'bg-white')}>
      <div className={cn('w-1/4 rounded-sm', dark ? 'bg-zinc-800' : 'bg-zinc-100')} />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className={cn('h-2 w-2/3 rounded-sm', dark ? 'bg-zinc-600' : 'bg-zinc-300')} />
        <div className={cn('flex-1 rounded-sm border', dark ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50')} />
      </div>
    </div>
  )
  return (
    <div className="flex h-20 overflow-hidden rounded-md border" aria-hidden>
      {variant === 'light' && pane(false)}
      {variant === 'dark' && pane(true)}
      {variant === 'system' && (
        <>
          {pane(false)}
          {pane(true)}
        </>
      )}
    </div>
  )
}

function ThemePicker() {
  const source = useApp((s) => s.theme.source)
  const dark = useApp((s) => s.theme.dark)
  const setTheme = useApp((s) => s.setTheme)

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-semibold">Tema</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        {OPTIONS.map((o) => {
          const checked = source === o.value
          return (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer flex-col gap-2.5 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                checked ? 'border-brand ring-1 ring-brand' : 'hover:bg-accent/40'
              )}
            >
              <input
                type="radio"
                name="theme"
                value={o.value}
                checked={checked}
                onChange={() => void setTheme(o.value)}
                className="sr-only"
              />
              <Preview variant={o.value} />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          )
        })}
      </div>
      {source === 'system' && (
        <p className="text-xs text-muted-foreground">O Windows está usando o tema {dark ? 'escuro' : 'claro'} agora.</p>
      )}
    </fieldset>
  )
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])

  const rows: [string, string][] = info
    ? [
        ['Versão', info.version],
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['Tempo de abertura', info.startupMs === null ? 'medindo…' : `${info.startupMs} ms (meta: < 1.500 ms)`],
        ['Permissão', info.isAdmin ? 'Administrador' : 'Usuário comum']
      ]
    : []

  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="selectable text-sm font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function NotifyToggle() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    void window.api.devices.getNotify().then(setOn)
  }, [])
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={!!on}
        disabled={on === null}
        onChange={(e) => void window.api.devices.setNotify(e.target.checked).then(setOn)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Avisar quando um aparelho novo entrar na rede</span>
        <span className="text-[13px] text-muted-foreground">
          Com o app aberto, a rede é conferida a cada 5 minutos e o Windows mostra um aviso para aparelhos que o app nunca viu.
        </span>
      </span>
    </label>
  )
}

function RouterNamesToggle() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    void window.api.devices.getRouterNames().then(setOn)
  }, [])
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={!!on}
        disabled={on === null}
        onChange={(e) => void window.api.devices.setRouterNames(e.target.checked).then(setOn)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Ler os nomes dos aparelhos no roteador</span>
        <span className="text-[13px] text-muted-foreground">
          Para roteadores TP-Link EX/Aginet (como o EX141). Ao clicar em "Atualizar lista" em Aparelhos, o app entra no painel com a senha guardada em
          Senhas e QR, lê a lista de aparelhos e sai. Nada é alterado. Se o painel estiver aberto em outro lugar, ele não entra.
        </span>
      </span>
    </label>
  )
}

export default function Settings() {
  return (
    <>
      <PageHeader title="Configurações" />
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">Aparência</h2>
        </CardHeader>
        <CardContent>
          <ThemePicker />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">Aparelhos</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <NotifyToggle />
          <RouterNamesToggle />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">Sobre</h2>
        </CardHeader>
        <CardContent>
          <About />
        </CardContent>
      </Card>
    </>
  )
}
