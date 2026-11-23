import type { RemixiconComponentType } from '@remixicon/react'
import { EmptyState } from './EmptyState'
import { PageHeader } from './PageHeader'

/** Placeholder for a page whose phase has not been built yet. */
export function ComingSoon({
  title,
  subtitle,
  icon,
  phase,
  children
}: {
  title: string
  subtitle: string
  icon: RemixiconComponentType
  phase: number
  children: string
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState icon={icon} title={`Chega na Fase ${phase}`}>
        {children}
      </EmptyState>
    </>
  )
}
