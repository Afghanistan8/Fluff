import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '~/lib/utils'

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('shimmer rounded-lg', className)} {...props} />
}
