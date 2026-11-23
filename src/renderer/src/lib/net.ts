import type { Hop, LinkKind, NetInfo, PathResult } from '@shared/network'

export const KIND_LABEL: Record<LinkKind, string> = { ethernet: 'Cabo (Ethernet)', wifi: 'Wi-Fi', other: 'Outra conexão' }

export function msText(ms: number | null): string {
  if (ms === null) return 'sem resposta'
  return ms < 1 ? '<1 ms' : `${Math.round(ms)} ms`
}

export type PathStatus = 'ok' | 'routerSilent' | 'dns' | 'internet' | 'router' | 'none'

/** One word on the whole path, read left to right. */
export function pathStatus(info: NetInfo | null, path: PathResult | null): PathStatus {
  if (!info?.primary) return 'none'
  if (!path) return 'ok'
  const ok = (id: Hop['id']): boolean => !!path.hops.find((h) => h.id === id)?.ok
  if (ok('internet') && ok('dns')) return ok('router') ? 'ok' : 'routerSilent'
  if (ok('internet')) return 'dns'
  if (ok('router')) return 'internet'
  return 'router'
}
