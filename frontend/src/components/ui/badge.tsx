import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '~/lib/utils'

const badge = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-ink-high text-cream-dim',
        accent: 'bg-apricot-wash text-apricot',
        live: 'bg-apricot/15 text-apricot',
        good: 'bg-good/15 text-good',
        alarm: 'bg-alarm/15 text-alarm',
        outline: 'border border-line-bright text-cream-dim',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {}

export function Badge({ className, tone, ...props }: BadgeProps): ReactNode {
  return <span className={cn(badge({ tone }), className)} {...props} />
}
