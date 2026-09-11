import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '~/lib/utils'

export const Tabs = TabsPrimitive.Root
export const TabsContent = TabsPrimitive.Content

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>): ReactNode {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex gap-1 rounded-full bg-ink-high p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>): ReactNode {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'rounded-full px-4 py-1.5 text-sm text-cream-dim transition-colors',
        'hover:text-cream data-[state=active]:bg-apricot data-[state=active]:text-ink',
        className,
      )}
      {...props}
    />
  )
}
