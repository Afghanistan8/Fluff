import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '~/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-apricot text-ink hover:bg-apricot-deep',
        outline: 'border border-line-bright text-cream hover:border-apricot hover:text-apricot',
        ghost: 'text-cream-dim hover:text-cream hover:bg-ink-high',
        quiet: 'bg-ink-high text-cream hover:bg-line',
        danger: 'border border-alarm/50 text-alarm hover:bg-alarm/10',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean
  children?: ReactNode
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps): ReactNode {
  const Component = asChild ? Slot : 'button'
  return <Component className={cn(button({ variant, size }), className)} {...props} />
}
