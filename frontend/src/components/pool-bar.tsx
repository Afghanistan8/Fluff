import type { ReactNode } from 'react'

import { TOKENS, type TokenAmounts, type TokenSymbol } from '~/lib/chain/types'
import { formatGen, poolShares } from '~/lib/market/payout'
import { tokenStyle } from '~/lib/tokens'
import { cn } from '~/lib/utils'

/** Share of the pool per token. Empty pools render as an even, muted rail. */
export function PoolBar({
  pools,
  className,
  winner,
}: {
  pools: TokenAmounts
  className?: string
  winner?: TokenSymbol | null
}): ReactNode {
  const shares = poolShares(pools)
  const empty = shares.ZEC + shares.BNB + shares.SOL === 0

  if (empty) {
    return (
      <div className={cn('h-1.5 w-full rounded-full bg-line', className)} aria-hidden="true" />
    )
  }

  return (
    <div
      className={cn('flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full', className)}
      role="img"
      aria-label={TOKENS.map((token) => `${token} ${shares[token].toFixed(1)}%`).join(', ')}
    >
      {TOKENS.map((token) => {
        const share = shares[token]
        if (share === 0) return null
        const dimmed = winner != null && winner !== token
        return (
          <div
            key={token}
            className={cn(tokenStyle(token).fill, dimmed && 'opacity-30')}
            style={{ width: `${share}%` }}
          />
        )
      })}
    </div>
  )
}

export function PoolLegend({
  pools,
  winner,
  className,
}: {
  pools: TokenAmounts
  winner?: TokenSymbol | null
  className?: string
}): ReactNode {
  const shares = poolShares(pools)
  return (
    <dl className={cn('grid grid-cols-3 gap-3', className)}>
      {TOKENS.map((token) => {
        const style = tokenStyle(token)
        const won = winner === token
        return (
          <div key={token} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', style.fill)} />
              <span className={won ? 'text-cream' : 'text-cream-dim'}>{token}</span>
              {won ? <span className="text-apricot">★</span> : null}
            </dt>
            <dd className="tnum mt-1 truncate text-sm text-cream">
              {formatGen(pools[token], 2)}
              <span className="ml-1 text-xs text-cream-faint">
                {shares[token].toFixed(0)}%
              </span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
