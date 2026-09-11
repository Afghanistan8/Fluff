import type { InputHTMLAttributes, ReactNode } from 'react'

import { cn } from '~/lib/utils'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-xl border border-line bg-ink px-4 text-cream',
        'placeholder:text-cream-faint focus:border-apricot focus:outline-none',
        'disabled:opacity-40 tnum',
        className,
      )}
      {...props}
    />
  )
}
