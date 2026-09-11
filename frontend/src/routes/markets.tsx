import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'

import { useChainClock } from '~/components/countdown'
import { MarketCard } from '~/components/market-card'
import { BrowseMarketsButton, CardSkeletonGrid, EmptyState, ScreenState } from '~/components/states'
import { Button } from '~/components/ui/button'
import { useMarkets } from '~/lib/chain/queries'
import type { Market } from '~/lib/chain/types'
import { MARKET_FILTERS, derivePhase, matchesFilter, type MarketFilter } from '~/lib/market/phase'
import { formatGenWithUnit } from '~/lib/market/payout'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/markets')({ component: MarketsPage })

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="rounded-puff border border-line bg-ink-raised px-5 py-4">
      <p className="text-xs text-cream-faint">{label}</p>
      <p className="tnum mt-1 text-xl text-cream">{value}</p>
    </div>
  )
}

function MarketsPage(): ReactNode {
  const markets = useMarkets()
  const now = useChainClock(markets.data?.[0]?.chainNow)
  const [filter, setFilter] = useState<MarketFilter>('ALL')

  const withPhase = useMemo(
    () =>
      (markets.data ?? []).map((market: Market) => ({
        market,
        phase: derivePhase({
          state: market.state,
          marketStart: market.marketStart,
          marketEnd: market.marketEnd,
          now,
        }),
      })),
    [markets.data, now],
  )

  const stats = useMemo(() => {
    const liquidity = withPhase.reduce((sum, row) => sum + row.market.totalPool, 0n)
    return {
      liquidity,
      open: withPhase.filter((row) => row.phase === 'UPCOMING').length,
      live: withPhase.filter((row) => row.phase === 'LIVE').length,
    }
  }, [withPhase])

  const visible = withPhase.filter((row) => matchesFilter(row.phase, filter))

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-cream sm:text-4xl">
          Thirty minutes. Three tokens. One leader.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-cream-dim">
          Every market is one exact half hour on the GMT+1 clock. Stake GEN on the token you
          think prints the strongest percentage return. Three price sources each pick a winner
          and two matching answers pay the pool, at a zero fee. Without agreement everyone
          takes their stake back.
        </p>
      </header>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Total liquidity" value={formatGenWithUnit(stats.liquidity, 2)} />
        <Stat label="Windows open for betting" value={String(stats.open)} />
        <Stat label="Windows running now" value={String(stats.live)} />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {MARKET_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm transition-colors',
              filter === option.id
                ? 'bg-apricot text-ink'
                : 'bg-ink-high text-cream-dim hover:text-cream',
            )}
          >
            {option.label}
          </button>
        ))}
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <Link to="/create">Open a window</Link>
        </Button>
      </div>

      <div className="mt-6">
        <ScreenState
          isLoading={markets.isLoading}
          error={markets.error}
          onRetry={() => void markets.refetch()}
          loadingFallback={<CardSkeletonGrid count={6} />}
        >
          {visible.length === 0 ? (
            <EmptyState
              title={filter === 'ALL' ? 'No windows yet' : 'Nothing in this state'}
              body={
                filter === 'ALL'
                  ? 'Anyone can open the first one. Pick a half-hour slot in the future and it goes live immediately.'
                  : 'Try another filter, or open a window of your own.'
              }
              action={
                filter === 'ALL' ? (
                  <Button asChild>
                    <Link to="/create">Open a window</Link>
                  </Button>
                ) : (
                  <BrowseMarketsButton />
                )
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((row) => (
                <MarketCard key={row.market.id} market={row.market} now={now} />
              ))}
            </div>
          )}
        </ScreenState>
      </div>
    </div>
  )
}
