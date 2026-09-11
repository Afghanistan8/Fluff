import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '~/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>): ReactNode {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/80 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))]',
          '-translate-x-1/2 -translate-y-1/2 rounded-puff border border-line',
          'bg-ink-raised p-6 shadow-2xl',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>): ReactNode {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-medium text-cream', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>): ReactNode {
  return (
    <DialogPrimitive.Description
      className={cn('mt-2 text-sm leading-relaxed text-cream-dim', className)}
      {...props}
    />
  )
}
