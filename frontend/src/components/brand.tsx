import type { ReactNode } from 'react'

import { cn } from '~/lib/utils'

/**
 * The Fluff mark: three soft lobes forming a puff, with the accent lobe in front.
 * Not a crown, not a candlestick.
 */
export function PuffMark({ className }: { className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Fluff"
      className={cn('h-7 w-7', className)}
    >
      <circle cx="11" cy="17" r="7" className="fill-cream/25" />
      <circle cx="21" cy="17" r="6" className="fill-cream/20" />
      <circle cx="16" cy="12.5" r="7.5" className="fill-apricot" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }): ReactNode {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <PuffMark />
      <span className="text-xl font-semibold tracking-tight text-cream">Fluff</span>
    </span>
  )
}
