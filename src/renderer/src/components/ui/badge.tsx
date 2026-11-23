import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// shadcn/ui component, extended with the app's status variants.
const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-full px-2 h-5.5 text-xs font-medium whitespace-nowrap shrink-0 gap-1',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border text-foreground',
        ok: 'bg-status-ok/15 text-status-ok',
        warn: 'bg-status-warn/15 text-status-warn',
        bad: 'bg-status-bad/15 text-status-bad'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
