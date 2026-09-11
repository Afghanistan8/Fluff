import { useEffect, useState, type ReactNode } from 'react'

import type { MarketPhase, MarketState } from '~/lib/chain/types'
import { PHASE_COUNTDOWN_LABELS, derivePhase, secondsRemaining } from '~/lib/market/phase'
import { formatCountdown, nowSeconds } from '~/lib/market/time'
import { cn } from '~/lib/utils'

/**
 * A local clock, anchored to the chain's own clock at read time.
 *
 * The skew correction keeps the countdown honest on a machine whose clock drifts. It is
 * display only: the contract decides when betting actually closes.
 */
export function useChainClock(chainNow: number | undefined): number {
  const [local, setLocal] = useState(() => nowSeconds())

  useEffect(() => {
    const timer = setInterval(() => setLocal(nowSeconds()), 1000)
    return () => clearInterval(timer)
  }, [])

  const [skew, setSkew] = useState(0)
  useEffect(() => {
    if (chainNow === undefined) return
    setSkew(chainNow - nowSeconds())
  }, [chainNow])

  return local + skew
}

export interface CountdownProps {
  state: MarketState
  marketStart: number
  marketEnd: number
  now: number
  className?: string
  withLabel?: boolean
}

export function Countdown({
  state,
  marketStart,
  marketEnd,
  now,
  className,
  withLabel = false,
}: CountdownProps): ReactNode {
  const phase = derivePhase({ state, marketStart, marketEnd, now })
  const remaining = secondsRemaining({ state, marketStart, marketEnd, now })

  if (phase === 'SETTLED' || phase === 'INCONCLUSIVE') return null

  return (
    <span className={cn('tnum inline-flex items-baseline gap-1.5', className)}>
      {withLabel ? (
        <span className="text-cream-faint">{PHASE_COUNTDOWN_LABELS[phase as MarketPhase]}</span>
      ) : null}
      <span className={phase === 'LIVE' ? 'text-apricot' : 'text-cream'}>
        {formatCountdown(remaining)}
      </span>
    </span>
  )
}
