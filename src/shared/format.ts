const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** Formats bytes the way Windows Explorer does (base 1024): 476 GB, 1,2 GB, 640 MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let i = 0
  let v = bytes
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${(v >= 10 || i === 0 ? nf0 : nf1).format(v)} ${UNITS[i]}`
}

const nfInt = new Intl.NumberFormat('pt-BR')

export function formatInt(n: number): string {
  return nfInt.format(Math.round(n))
}
