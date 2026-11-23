import { cn } from '@/lib/utils'

interface UsageBarProps {
  value: number
  max: number
  className?: string
  barClassName?: string
  label?: string
}

/** Simple usage bar (no need for Radix Progress here). */
export function UsageBar({ value, max, className, barClassName, label }: UsageBarProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className={cn('h-full rounded-full bg-brand', barClassName)} style={{ width: `${pct}%` }} />
    </div>
  )
}
