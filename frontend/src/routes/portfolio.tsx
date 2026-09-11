import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'

import { useChainClock } from '~/components/countdown'
import { PhaseBadge } from '~/components/market-card'
import { BrowseMarketsButton, EmptyState, ScreenState, RowSkeleton } from '~/components/states'
import { Button } from '~/components/ui/button'
import { Card, CardBody } from '~/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { claimCall, claimRefundCall } from '~/lib/chain/contract'
import {
  useActivity,
  useClaimable,
  usePositions,
  useRefreshAfterWrite,
} from '~/lib/chain/queries'
import type { ActivityEntry, Position } from '~/lib/chain/types'
import { derivePhase } from '~/lib/market/phase'
import { formatGenWithUnit } from '~/lib/market/payout'
import { formatRelative, formatWindow } from '~/lib/market/time'
import { tokenStyle } from '~/lib/tokens'
import { PAYOUT_BALANCE_NOTE } from '~/lib/wallet/tx'
import { useWallet } from '~/lib/wallet/WalletProvider'

export const Route = createFileRoute('/portfolio')({ component: PortfolioPage })

const ACTIVITY_COPY: Record<ActivityEntry['kind'], string> = {
  MARKET_CREATED: 'Opened a window',
  BET_PLACED: 'Placed a bet',
  BET_TOPPED_UP: 'Added to a bet',
  MARKET_SETTLED: 'Settled a window',
  PAYOUT_CLAIMED: 'Claimed winnings',
  REFUND_CLAIMED: 'Claimed a refund',
}

function Total({ label, value, accent }: { label: string; value: string; accent?: boolean }): ReactNode {
  return (
    <div className="rounded-puff border border-line bg-ink-raised px-5 py-4">
      <p className="text-xs text-cream-faint">{label}</p>
      <p className={`tnum mt-1 text-xl ${accent ? 'text-apricot' : 'text-cream'}`}>{value}</p>
    </div>
  )
}

function PositionRow({
  position,
  now,
  onChange,
}: {
  position: Position
  now: number
  onChange: () => void
}): ReactNode {
  const wallet = useWallet()
  const refresh = useRefreshAfterWrite()
  const [busy, setBusy] = useState(false)

  const phase = derivePhase({
    state: position.state,
    marketStart: position.marketStart,
    marketEnd: position.marketEnd,
    now,
  })
  const style = position.token ? tokenStyle(position.token) : null

  async function pull(kind: 'CLAIM' | 'REFUND'): Promise<void> {
    setBusy(true)
    try {
      await wallet.send(
        kind === 'CLAIM' ? claimCall(position.marketId) : claimRefundCall(position.marketId),
        kind === 'CLAIM' ? 'Claim winnings' : 'Claim refund',
        { successNote: PAYOUT_BALANCE_NOTE },
      )
      await refresh(position.marketId, wallet.address)
      onChange()
    } catch {
      // The dialog already shows what the chain said.
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PhaseBadge phase={phase} />
            <span className={`text-sm ${style?.text ?? 'text-cream'}`}>{position.token}</span>
          </div>
          <Link
            to="/market/$id"
            params={{ id: String(position.marketId) }}
            className="mt-2 block text-sm text-cream transition-colors hover:text-apricot"
          >
            {formatWindow(position.marketStart)}
          </Link>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs text-cream-faint">Stake</p>
            <p className="tnum text-sm text-cream">{formatGenWithUnit(position.amount, 2)}</p>
          </div>

          {position.claimable > 0n ? (
            <Button size="sm" disabled={busy} onClick={() => void pull('CLAIM')}>
              Claim {formatGenWithUnit(position.claimable, 2)}
            </Button>
          ) : position.refundable > 0n ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void pull('REFUND')}>
              Refund {formatGenWithUnit(position.refundable, 2)}
            </Button>
          ) : (
            <span className="text-xs text-cream-faint">
              {position.claimed ? 'Claimed' : position.refunded ? 'Refunded' : '—'}
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function PortfolioPage(): ReactNode {
  const wallet = useWallet()
  const positions = usePositions(wallet.address)
  const claimable = useClaimable(wallet.address)
  const activity = useActivity(wallet.address, 25)
  const now = useChainClock(undefined)

  const refetchAll = (): void => {
    void positions.refetch()
    void claimable.refetch()
    void activity.refetch()
  }

  const totals = useMemo(() => {
    const rows = positions.data ?? []
    const active = rows
      .filter((row) => row.state === 'OPEN')
      .reduce((sum, row) => sum + row.amount, 0n)
    const winnings = (claimable.data ?? []).reduce((sum, row) => sum + row.claimable, 0n)
    const refunds = (claimable.data ?? []).reduce((sum, row) => sum + row.refundable, 0n)
    return { active, winnings, refunds }
  }, [positions.data, claimable.data])

  const active = (positions.data ?? []).filter((row) => row.state === 'OPEN')
  const history = (positions.data ?? []).filter((row) => row.state !== 'OPEN')

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-cream">Portfolio</h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-cream-dim">
          Everything you are holding, everything you can pull, and everything you have done.
          Claims and refunds never expire, so nothing here is ever lost by waiting.
        </p>
      </header>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Total label="Active stake" value={formatGenWithUnit(totals.active, 2)} />
        <Total label="Claimable winnings" value={formatGenWithUnit(totals.winnings, 2)} accent />
        <Total label="Claimable refunds" value={formatGenWithUnit(totals.refunds, 2)} />
      </div>

      <div className="mt-8">
        <ScreenState
          requiresWallet
          connectBody="Connect to see your stakes, claims and refunds."
          isLoading={positions.isLoading}
          error={positions.error}
          onRetry={refetchAll}
          loadingFallback={<RowSkeleton count={4} />}
        >
          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="claimable">Claimable</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="mt-5 space-y-3">
              {active.length === 0 ? (
                <EmptyState
                  title="No open positions"
                  body="Nothing of yours is riding on a window right now."
                  action={<BrowseMarketsButton />}
                />
              ) : (
                active.map((row) => (
                  <PositionRow
                    key={row.marketId}
                    position={row}
                    now={now}
                    onChange={refetchAll}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="claimable" className="mt-5 space-y-3">
              {(claimable.data ?? []).length === 0 ? (
                <EmptyState
                  title="Nothing to pull"
                  body="When a window you backed settles in your favour, or ends without consensus, it shows up here."
                  action={<BrowseMarketsButton />}
                />
              ) : (
                (claimable.data ?? []).map((row) => (
                  <PositionRow
                    key={row.marketId}
                    position={row}
                    now={now}
                    onChange={refetchAll}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-5 space-y-3">
              {history.length === 0 ? (
                <EmptyState
                  title="No finished windows yet"
                  body="Settled and inconclusive windows you took part in collect here."
                />
              ) : (
                history.map((row) => (
                  <PositionRow
                    key={row.marketId}
                    position={row}
                    now={now}
                    onChange={refetchAll}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>

          <section className="mt-12">
            <h2 className="text-lg text-cream">Activity</h2>
            {(activity.data ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-cream-dim">Nothing recorded for this wallet yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line rounded-puff border border-line bg-ink-raised">
                {(activity.data ?? []).map((entry, index) => (
                  <li
                    key={`${entry.at}-${entry.kind}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-cream">{ACTIVITY_COPY[entry.kind]}</p>
                      <p className="text-xs text-cream-faint">
                        Window #{entry.marketId}
                        {entry.token ? ` · ${entry.token}` : ''} ·{' '}
                        {formatRelative(entry.at, now)}
                      </p>
                    </div>
                    {entry.amount > 0n ? (
                      <span className="tnum text-sm text-cream-dim">
                        {formatGenWithUnit(entry.amount, 2)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </ScreenState>
      </div>
    </div>
  )
}
