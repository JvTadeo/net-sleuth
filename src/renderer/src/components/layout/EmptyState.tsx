import type { ReactNode } from 'react'
import type { RemixiconComponentType } from '@remixicon/react'

type Icon = RemixiconComponentType

export function EmptyState({
  icon: Icon,
  title,
  children,
  action
}: {
  icon: Icon
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon size={24} aria-hidden />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{children}</p>}
      {action}
    </div>
  )
}
