import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'

import { PuffMark } from '~/components/brand'
import { useChainClock } from '~/components/countdown'
import { MarketCard } from '~/components/market-card'
import { CardSkeletonGrid, EmptyState, ScreenState } from '~/components/states'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useOpenMarkets } from '~/lib/chain/queries'
import { TOKENS } from '~/lib/chain/types'
import { derivePhase } from '~/lib/market/phase'
import { tokenStyle } from '~/lib/tokens'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/')({ component: HomePage })

const PROMISES = [
  {
    title: 'Anyone opens a window',
    body: 'Pick any future half hour on the GMT+1 clock. No approval, no listing process, no privileged creator.',
  },
  {
    title: 'Two of three sources decide',
    body: 'CoinGecko, Bitget and Binance each read their own candles and name their own leader. Prices are never averaged.',
  },
  {
    title: 'Winners take the whole pool',
    body: 'Pari-mutuel payouts at a zero fee. The last claimant sweeps the dust, so the pool distributes exactly.',
  },
  {
    title: 'No agreement, no loss',
    body: 'If the sources cannot agree, the window is inconclusive and every wallet reclaims its original stake.',
  },
]

function HomePage(): ReactNode {
  const markets = useOpenMarkets()
  const now = useChainClock(markets.data?.[0]?.chainNow)

  // The soonest windows a visitor can still act on: live first, then the next to open.
  // Chosen from every open market rather than whichever happened to be in the first
  // page, so a busy board cannot hide the window that is about to lock.
  const upcoming = useMemo(() => {
    const phaseOf = (market: (typeof markets.data extends (infer T)[] | undefined ? T : never)) =>
      derivePhase({
        state: market.state,
        marketStart: market.marketStart,
        marketEnd: market.marketEnd,
        now,
      })
    const rows = (markets.data ?? []).filter((market) => {
      const phase = phaseOf(market)
      return phase === 'LIVE' || phase === 'UPCOMING'
    })
    return rows
      .sort((a, b) => {
        const live = (m: typeof a) => (phaseOf(m) === 'LIVE' ? 0 : 1)
        return live(a) - live(b) || a.marketStart - b.marketStart
      })
      .slice(0, 3)
  }, [markets.data, now])

  return (
    <div>
      <section className="haze">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-3xl">
            <Badge tone="accent">
              <PuffMark className="h-4 w-4" />
              Permissionless on GenLayer
            </Badge>

            <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-cream sm:text-6xl">
              Thirty minutes.
              <br />
              Three tokens.
              <br />
              <span className="text-apricot">One leader.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-cream-dim">
              Fluff asks one question at a time: which of ZEC, BNB and SOL prints the strongest
              percentage return across a single half hour. Stake GEN on your answer, and let three
              independent price sources settle it.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link to="/markets">See open windows</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/how-it-works">How it works</Link>
              </Button>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              {TOKENS.map((token) => {
                const style = tokenStyle(token)
                return (
                  <span key={token} className="flex items-center gap-2 text-sm text-cream-dim">
                    <span className={cn('h-2.5 w-2.5 rounded-full', style.fill)} />
                    <span className={style.text}>{token}</span>
                    <span className="text-cream-faint">{style.name}</span>
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl text-cream">Current windows</h2>
          <Link to="/markets" className="text-sm text-cream-dim transition-colors hover:text-cream">
            All markets →
          </Link>
        </div>

        <div className="mt-5">
          <ScreenState
            isLoading={markets.isLoading}
            error={markets.error}
            onRetry={() => void markets.refetch()}
            loadingFallback={<CardSkeletonGrid count={3} />}
          >
            {upcoming.length === 0 ? (
              <EmptyState
                title="No windows are open right now"
                body="Fluff has no schedule of its own. The next market exists as soon as somebody opens it."
                action={
                  <Button asChild>
                    <Link to="/create">Open the next window</Link>
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {upcoming.map((market) => (
                  <MarketCard key={market.id} market={market} now={now} />
                ))}
              </div>
            )}
          </ScreenState>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-xl text-cream">What Fluff promises</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {PROMISES.map((promise) => (
            <div key={promise.title} className="rounded-puff border border-line bg-ink-raised p-6">
              <p className="text-base text-cream">{promise.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-cream-dim">{promise.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-puff border border-line bg-ink-raised p-6 sm:p-8">
          <p className="max-w-2xl text-base leading-relaxed text-cream-dim">
            There is no house here. No protocol fee, no creator cut, no settlement reward, and no
            owner key that can pause, change or upgrade anything. What the contract does on the
            day it ships is what it does forever.
          </p>
          <Button variant="outline" className="mt-6" asChild>
            <Link to="/how-it-works">Read the rules</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
