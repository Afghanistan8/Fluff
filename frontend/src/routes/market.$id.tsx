import { Link, createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { BetPanel } from '~/components/bet-panel'
import { Countdown, useChainClock } from '~/components/countdown'
import { EvidencePanel } from '~/components/evidence-panel'
import { PhaseBadge } from '~/components/market-card'
import { PoolBar, PoolLegend } from '~/components/pool-bar'
import { ReturnPreviewChart } from '~/components/return-preview-chart'
import { FaucetHint, ScreenState, RowSkeleton } from '~/components/states'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '~/components/ui/card'
import { shortAddress } from '~/lib/chain/client'
import { claimCall, claimRefundCall, getMarket, settleMarketCall } from '~/lib/chain/contract'
import { useEvidence, useMarket, usePosition, useRefreshAfterWrite } from '~/lib/chain/queries'
import type { Market, Position } from '~/lib/chain/types'
import { PHASE_COUNTDOWN_LABELS, derivePhase } from '~/lib/market/phase'
import { formatGenWithUnit } from '~/lib/market/payout'
import { formatMoment, formatWindow } from '~/lib/market/time'
import { tokenStyle } from '~/lib/tokens'
import { useWallet } from '~/lib/wallet/WalletProvider'

export const Route = createFileRoute('/market/$id')({ component: MarketRoom })

function Outcome({ market }: { market: Market }): ReactNode {
  if (market.state === 'SETTLED' && market.winner) {
    const style = tokenStyle(market.winner)
    return (
      <Card className="border-good/40">
        <CardBody className="py-5">
          <p className="text-xs text-cream-faint">Result</p>
          <p className="mt-1 text-lg text-cream">
            <span className={style.text}>{market.winner}</span> led this window
          </p>
          <p className="mt-2 text-sm leading-relaxed text-cream-dim">
            {market.consensusVotes} of 3 sources agreed. {market.winnerBackers}{' '}
            {market.winnerBackers === 1 ? 'wallet' : 'wallets'} split{' '}
            {formatGenWithUnit(market.totalPool, 2)} with no fee taken.
          </p>
        </CardBody>
      </Card>
    )
  }

  if (market.state === 'INCONCLUSIVE') {
    return (
      <Card className="border-alarm/40">
        <CardBody className="py-5">
          <p className="text-xs text-cream-faint">Result</p>
          <p className="mt-1 text-lg text-cream">No payout</p>
          <p className="mt-2 text-sm leading-relaxed text-cream-dim">
            {market.consensusWinner
              ? `The sources agreed on ${market.consensusWinner}, but nobody staked on it. The result stays on record and every stake is refundable in full.`
              : 'Two sources never agreed on a winner before the settlement window closed. Every stake is refundable in full.'}
          </p>
        </CardBody>
      </Card>
    )
  }

  return null
}

function YourPosition({
  market,
  position,
  onAction,
}: {
  market: Market
  position: Position
  onAction: () => void
}): ReactNode {
  const wallet = useWallet()
  const refresh = useRefreshAfterWrite()

  if (position.amount === 0n) return null
  const style = position.token ? tokenStyle(position.token) : null

  async function pull(kind: 'CLAIM' | 'REFUND'): Promise<void> {
    const call = kind === 'CLAIM' ? claimCall(market.id) : claimRefundCall(market.id)
    try {
      await wallet.send(call, kind === 'CLAIM' ? 'Claim winnings' : 'Claim refund', {
        // The pull either happened or it did not; the chain knows which.
        verify: async () => {
          const latest = await getMarket(market.id)
          return latest.paidOut > market.paidOut
        },
      })
    } finally {
      await refresh(market.id, wallet.address)
      onAction()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your position</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-cream-dim">Backing</span>
          <span className={`text-sm ${style?.text ?? 'text-cream'}`}>{position.token}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-cream-dim">Stake</span>
          <span className="tnum text-sm text-cream">{formatGenWithUnit(position.amount, 2)}</span>
        </div>

        {position.claimable > 0n ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-cream-dim">To claim</span>
              <span className="tnum text-base text-apricot">
                {formatGenWithUnit(position.claimable, 2)}
              </span>
            </div>
            <Button className="w-full" onClick={() => void pull('CLAIM')}>
              Claim winnings
            </Button>
          </>
        ) : null}

        {position.refundable > 0n ? (
          <Button className="w-full" variant="outline" onClick={() => void pull('REFUND')}>
            Claim refund of {formatGenWithUnit(position.refundable, 2)}
          </Button>
        ) : null}

        {position.claimed ? (
          <p className="text-xs text-cream-faint">Already claimed.</p>
        ) : null}
        {position.refunded ? (
          <p className="text-xs text-cream-faint">Already refunded.</p>
        ) : null}
        {position.state === 'SETTLED' && !position.won ? (
          <p className="text-xs text-cream-faint">
            This position backed {position.token}, and {market.winner} led the window.
          </p>
        ) : null}
      </CardBody>
    </Card>
  )
}

function SettleCard({ market, onSettled }: { market: Market; onSettled: () => void }): ReactNode {
  const wallet = useWallet()
  const refresh = useRefreshAfterWrite()

  async function settle(): Promise<void> {
    try {
      await wallet.send(settleMarketCall(market.id), 'Settle this window', {
        // Nine live venue reads inside equivalence blocks, then consensus.
        waitSeconds: 600,
        // If the receipt never arrives, ask the chain whether the market resolved
        // anyway rather than calling a slow settlement a failure.
        verify: async () => {
          const latest = await getMarket(market.id)
          return latest.state !== 'OPEN' || latest.settleAttempts > market.settleAttempts
        },
      })
    } finally {
      // Refetch either way: a timed-out settle may still have landed.
      await refresh(market.id, wallet.address)
      onSettled()
    }
  }

  return (
    <Card className="border-apricot/40">
      <CardHeader>
        <CardTitle>This window is ready to settle</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm leading-relaxed text-cream-dim">
          Anyone can trigger settlement, and it costs nothing beyond gas. The contract reads all
          three sources itself and pays nobody for the call.
        </p>
        {market.settleAttempts > 0 ? (
          <p className="text-xs text-cream-faint">
            {market.settleAttempts} previous {market.settleAttempts === 1 ? 'attempt' : 'attempts'}{' '}
            did not reach agreement. Anyone may retry until{' '}
            {formatMoment(market.settlementDeadline)}, after which every stake becomes refundable.
          </p>
        ) : null}
        {wallet.address ? (
          <Button className="w-full" onClick={() => void settle()}>
            Settle this window
          </Button>
        ) : (
          <Button className="w-full" onClick={() => void wallet.connect()}>
            Connect wallet to settle
          </Button>
        )}
        <FaucetHint />
      </CardBody>
    </Card>
  )
}

function MarketRoom(): ReactNode {
  const { id } = Route.useParams()
  const marketId = Number.parseInt(id, 10)
  const wallet = useWallet()

  const market = useMarket(Number.isFinite(marketId) ? marketId : null)
  const position = usePosition(Number.isFinite(marketId) ? marketId : null, wallet.address)
  const now = useChainClock(market.data?.chainNow)
  const resolved = market.data ? market.data.state !== 'OPEN' : false
  const evidence = useEvidence(
    Number.isFinite(marketId) ? marketId : null,
    resolved || (market.data?.settleAttempts ?? 0) > 0,
  )

  const refetchAll = (): void => {
    void market.refetch()
    void position.refetch()
    void evidence.refetch()
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link to="/markets" className="text-sm text-cream-dim transition-colors hover:text-cream">
        ← All markets
      </Link>

      <ScreenState
        isLoading={market.isLoading}
        error={market.error}
        onRetry={() => void market.refetch()}
        loadingFallback={<RowSkeleton count={4} />}
      >
        {market.data ? (
          <MarketBody
            market={market.data}
            position={position.data}
            evidence={evidence.data}
            evidenceLoading={evidence.isLoading}
            now={now}
            onChange={refetchAll}
          />
        ) : null}
      </ScreenState>
    </div>
  )
}

function MarketBody({
  market,
  position,
  evidence,
  evidenceLoading,
  now,
  onChange,
}: {
  market: Market
  position: Position | undefined
  evidence: ReturnType<typeof useEvidence>['data']
  evidenceLoading: boolean
  now: number
  onChange: () => void
}): ReactNode {
  const phase = derivePhase({
    state: market.state,
    marketStart: market.marketStart,
    marketEnd: market.marketEnd,
    now,
  })
  const showEvidence = market.state !== 'OPEN' || market.settleAttempts > 0

  return (
    <>
    <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-8">
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <PhaseBadge phase={phase} />
            <Badge tone="neutral">{market.categoryLabel}</Badge>
            <Badge tone="accent">0% fee</Badge>
          </div>

          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-cream sm:text-3xl">
            Which token prints the strongest % return this GMT+1 half-hour?
          </h1>
          <p className="mt-2 text-base text-cream-dim">{formatWindow(market.marketStart)}</p>

          {phase !== 'SETTLED' && phase !== 'INCONCLUSIVE' ? (
            <p className="mt-3 text-sm text-cream-dim">
              {PHASE_COUNTDOWN_LABELS[phase]}{' '}
              <Countdown
                state={market.state}
                marketStart={market.marketStart}
                marketEnd={market.marketEnd}
                now={now}
              />
            </p>
          ) : null}
        </header>

        <Outcome market={market} />

        <Card>
          <CardHeader className="flex items-baseline justify-between gap-3">
            <CardTitle>Pools</CardTitle>
            <span className="tnum text-sm text-cream-dim">
              {formatGenWithUnit(market.totalPool, 2)} total
            </span>
          </CardHeader>
          <CardBody>
            <PoolBar pools={market.pools} winner={market.winner} />
            <PoolLegend pools={market.pools} winner={market.winner} className="mt-4" />
            <p className="mt-4 text-xs text-cream-faint">
              {market.bettorCount} {market.bettorCount === 1 ? 'wallet' : 'wallets'} in this
              window · opened by {shortAddress(market.creator)}
            </p>
          </CardBody>
        </Card>

        {showEvidence ? null : (
          <Card className="border-dashed">
            <CardBody className="py-8">
              <p className="text-sm text-cream-dim">
                Evidence appears once the window ends and someone triggers settlement. Fluff
                reads Gate, Bitget and Binance separately, and each one picks its own
                winner from its own candles.
              </p>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Sticky on desktop so the bet form stays reachable while reading evidence. */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <BetPanel market={market} position={position} bettingOpen={phase === 'UPCOMING'} />

        {phase === 'LIVE' ? (
          <Card>
            <CardBody className="space-y-2 py-5">
              <p className="text-sm text-cream">Betting is closed</p>
              <p className="text-sm leading-relaxed text-cream-dim">
                The window is running. Nothing can be added, switched or withdrawn until it
                ends.
              </p>
            </CardBody>
          </Card>
        ) : null}

        {phase === 'PENDING_SETTLEMENT' ? (
          <SettleCard market={market} onSettled={onChange} />
        ) : null}

        {position ? (
          <YourPosition market={market} position={position} onAction={onChange} />
        ) : null}
      </aside>
    </div>

    {/* Evidence sits full width: three source tables need the room to stay readable. */}
    {showEvidence ? (
      <div className="mt-12 space-y-8">
        <EvidencePanel
          evidence={evidence}
          isLoading={evidenceLoading}
          winner={market.winner ?? market.consensusWinner}
          consensusVotes={market.consensusVotes}
        />
        {evidence ? <ReturnPreviewChart evidence={evidence} winner={market.winner} /> : null}
      </div>
    ) : null}
    </>
  )
}
