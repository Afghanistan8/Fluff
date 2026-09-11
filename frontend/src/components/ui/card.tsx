import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '~/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      className={cn('rounded-puff border border-line bg-ink-raised', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...props} />
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div className={cn('border-t border-line px-5 py-4', className)} {...props} />
  )
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return <h3 className={cn('text-base font-medium text-cream', className)} {...props} />
}
