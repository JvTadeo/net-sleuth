import { encode } from 'uqr'
import type { QrDrawing, VaultEntry } from '@shared/vault'

/** Wi-Fi QR code and the printable card. No Electron here, so it can be rendered and checked in tests. */

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function qrPath(text: string): QrDrawing {
  const { data, size } = encode(text, { ecc: 'M', border: 0 })
  let path = ''
  data.forEach((row, y) => {
    // Runs of dark modules become one rectangle each: a much shorter path than one square per module.
    let x = 0
    while (x < size) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < size && row[x]) x++
      path += `M${start} ${y}h${x - start}v1h-${x - start}z`
    }
  })
  return { path, size }
}

/** The printable card: network name, QR code and password, in a plain page with no scripts. */
export function cardHtml(e: Pick<VaultEntry, 'kind' | 'name' | 'security'> & { password: string }, qr: QrDrawing): string {
  const pw = e.security === 'open' ? 'Rede aberta, sem senha' : esc(e.password)
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Wi-Fi ${esc(e.name)}</title><style>
  @page { size: A5; margin: 14mm }
  html, body { margin: 0; background: #fff; color: #09090b; font-family: "Segoe UI", system-ui, sans-serif }
  .card { width: 520px; margin: 0 auto; padding: 36px 32px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center }
  .kicker { font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: #52525b }
  h1 { margin: 0; font-size: 34px; font-weight: 700; word-break: break-word }
  svg { width: 300px; height: 300px }
  .hint { font-size: 17px; color: #27272a }
  .pw { display: flex; flex-direction: column; gap: 4px; padding: 12px 20px; border: 1px solid #e4e4e7; border-radius: 12px }
  .pw span { font-size: 13px; color: #71717a }
  .pw b { font-family: Consolas, "Cascadia Mono", monospace; font-size: 22px; font-weight: 600; word-break: break-all }
  </style></head><body><div class="card">
  <div class="kicker">${e.kind === 'guest' ? 'Wi-Fi para visitas' : 'Wi-Fi'}</div>
  <h1>${esc(e.name)}</h1>
  <svg viewBox="-2 -2 ${qr.size + 4} ${qr.size + 4}" role="img" aria-label="QR code para entrar no Wi-Fi"><rect x="-2" y="-2" width="${qr.size + 4}" height="${qr.size + 4}" fill="#fff"/><path d="${qr.path}" fill="#09090b" shape-rendering="crispEdges"/></svg>
  <div class="hint">Aponte a câmera do celular para entrar</div>
  <div class="pw"><span>Senha</span><b>${pw}</b></div>
  </div></body></html>`
}
