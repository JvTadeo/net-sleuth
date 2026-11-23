export { formatBytes, formatInt } from '@shared/format'

const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

export function formatPercent(part: number, total: number): string {
  if (!total) return '0%'
  return `${Math.round((part / total) * 100)}%`
}


/** 850 ms → "0,9 s", 48 s → "48 s", 125 s → "2 min 05 s". */
export function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 10) return `${nf1.format(s)} s`
  if (s < 60) return `${Math.round(s)} s`
  const m = Math.floor(s / 60)
  return `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s`
}

/** "hoje às 11:32" or "21/11 às 11:32". */
export function formatWhen(date: Date): string {
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const today = new Date().toDateString() === date.toDateString()
  return today ? `hoje às ${time}` : `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${time}`
}
