import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Badge } from '~/components/ui/badge'
import { Card, CardBody, CardFooter } from '~/components/ui/card'
import { Countdown } from '~/components/countdown'
import { PoolBar, PoolLegend } from '~/components/pool-bar'
import type { Market } from '~/lib/chain/types'
import { PHASE_LABELS, derivePhase } from '~/lib/market/phase'
import { formatGenWithUnit } from '~/lib/market/payout'
import { formatWindow } from '~/lib/market/time'
import { cn } from '~/lib/utils'

const CALLS_TO_ACTION = {
  UPCOMING: 'Place a bet',
  LIVE: 'Watch live',
  PENDING_SETTLEMENT: 'Settle this window',
  SETTLED: 'See the result',
  INCONCLUSIVE: 'See why',
} as const

export function PhaseBadge({ phase }: { phase: keyof typeof PHASE_LABELS }): ReactNode {
  if (phase === 'LIVE') {
    return (
      <Badge tone="live">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-apricot" />
        Live
      </Badge>
    )
  }
  const tone =
    phase === 'UPCOMING'
      ? 'accent'
      : phase === 'SETTLED'
        ? 'good'
        : phase === 'INCONCLUSIVE'
          ? 'alarm'
          : 'outline'
  return <Badge tone={tone}>{PHASE_LABELS[phase]}</Badge>
}

export function MarketCard({ market, now }: { market: Market; now: number }): ReactNode {
  const phase = derivePhase({
    state: market.state,
    marketStart: market.marketStart,
    marketEnd: market.marketEnd,
    now,
  })

  return (
    <Card className="group transition-colors hover:border-line-bright">
      <CardBody className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-cream">{formatWindow(market.marketStart)}</p>
            <p className="mt-1 text-xs text-cream-faint">
              {market.tokens.join(' · ')} · {market.categoryLabel}
            </p>
          </div>
          <PhaseBadge phase={phase} />
        </div>

        <div className="mt-5">
          <PoolBar pools={market.pools} winner={market.winner} />
          <PoolLegend pools={market.pools} winner={market.winner} className="mt-3" />
        </div>

        {market.state === 'INCONCLUSIVE' ? (
          <p className="mt-4 text-xs text-cream-dim">
            {market.consensusWinner
              ? `Sources agreed on ${market.consensusWinner}, but nobody backed it. Stakes are refundable.`
              : 'Sources never agreed. Stakes are refundable.'}
          </p>
        ) : null}
      </CardBody>

      <CardFooter className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-cream-faint">Pool</p>
          <p className="tnum truncate text-sm text-cream">
            {formatGenWithUnit(market.totalPool, 2)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Countdown
            state={market.state}
            marketStart={market.marketStart}
            marketEnd={market.marketEnd}
            now={now}
            className="text-sm"
          />
          <Link
            to="/market/$id"
            params={{ id: String(market.id) }}
            className={cn(
              'rounded-full border border-line-bright px-3 py-1.5 text-xs text-cream',
              'transition-colors group-hover:border-apricot group-hover:text-apricot',
            )}
          >
            {CALLS_TO_ACTION[phase]}
          </Link>
        </div>
      </CardFooter>
    </Card>
  )
}
