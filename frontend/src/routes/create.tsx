import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'

import { useChainClock } from '~/components/countdown'
import { ScreenState, RowSkeleton } from '~/components/states'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '~/components/ui/card'
import { createMarketCall } from '~/lib/chain/contract'
import { useConfig, useRefreshAfterWrite, useSlotAvailability } from '~/lib/chain/queries'
import { CATEGORY_ID, TOKENS } from '~/lib/chain/types'
import { formatWindowDate, formatWindowTimes, sameWallDay, upcomingSlots } from '~/lib/market/time'
import { tokenStyle } from '~/lib/tokens'
import { cn } from '~/lib/utils'
import { useWallet } from '~/lib/wallet/WalletProvider'

export const Route = createFileRoute('/create')({ component: CreatePage })

/** A day of half-hour slots is plenty to plan around without paging. */
const SLOT_COUNT = 48

function CreatePage(): ReactNode {
  const wallet = useWallet()
  const navigate = useNavigate()
  const config = useConfig()
  const refresh = useRefreshAfterWrite()

  const now = useChainClock(config.data?.chainNow)
  // Slots are pinned to a coarse clock so the list does not reshuffle every second.
  const anchor = Math.floor(now / 300) * 300
  const slots = useMemo(() => upcomingSlots(anchor, SLOT_COUNT), [anchor])
  const availability = useSlotAvailability(CATEGORY_ID, slots)

  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function open(): Promise<void> {
    if (selected === null) return
    setError(null)
    try {
      await wallet.send(createMarketCall(CATEGORY_ID, selected), 'Open this window')
      await refresh(null, wallet.address)
      const created = await availability.refetch()
      const marketId = created.data?.[selected]?.marketId
      if (marketId != null) {
        await navigate({ to: '/market/$id', params: { id: String(marketId) } })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The window was not opened.')
    }
  }

  const grouped = useMemo(() => {
    const days: { day: number; slots: number[] }[] = []
    for (const slot of slots) {
      const last = days.at(-1)
      if (last && sameWallDay(last.day, slot)) last.slots.push(slot)
      else days.push({ day: slot, slots: [slot] })
    }
    return days
  }, [slots])

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-cream">Open a window</h1>
        <p className="mt-3 text-base leading-relaxed text-cream-dim">
          Anyone can open a market on any future half hour. There is no fee, no approval and no
          privilege attached to opening one: you are simply the first person to put the window on
          the board.
        </p>
      </header>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Crypto Majors</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {TOKENS.map((token) => {
              const style = tokenStyle(token)
              return (
                <span
                  key={token}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm',
                    style.text,
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', style.fill)} />
                  {token}
                  <span className="text-xs text-cream-faint">{style.name}</span>
                </span>
              )
            })}
          </div>
          <p className="text-sm leading-relaxed text-cream-dim">
            This is the only category Fluff has, and its three tokens are fixed in the contract.
            Nobody, including whoever deployed it, can add, remove or replace them.
          </p>
        </CardBody>
      </Card>

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg text-cream">Pick a half-hour slot</h2>
          <p className="text-sm text-cream-dim">All times GMT+1</p>
        </div>

        <div className="mt-4">
          <ScreenState
            isLoading={availability.isLoading}
            error={availability.error}
            onRetry={() => void availability.refetch()}
            loadingFallback={<RowSkeleton count={3} />}
          >
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.day}>
                  <p className="text-sm text-cream-dim">{formatWindowDate(group.day)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {group.slots.map((slot) => {
                      const taken = availability.data?.[slot]?.exists ?? false
                      const isSelected = selected === slot
                      return (
                        <button
                          key={slot}
                          type="button"
                          disabled={taken}
                          onClick={() => setSelected(slot)}
                          className={cn(
                            'tnum rounded-xl border px-3 py-2.5 text-sm transition-colors',
                            taken
                              ? 'cursor-not-allowed border-line bg-ink text-cream-faint line-through'
                              : isSelected
                                ? 'border-apricot bg-apricot-wash text-apricot'
                                : 'border-line text-cream hover:border-line-bright',
                          )}
                          title={taken ? 'A market already exists for this window' : undefined}
                        >
                          {formatWindowTimes(slot)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScreenState>
        </div>
      </section>

      <Card className="mt-8">
        <CardBody className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-cream-faint">Selected window</p>
              <p className="mt-1 text-base text-cream">
                {selected === null
                  ? 'Nothing selected yet'
                  : `${formatWindowDate(selected)} · ${formatWindowTimes(selected)} GMT+1`}
              </p>
            </div>
            <Badge tone="outline">One market per window</Badge>
          </div>

          <p className="text-sm leading-relaxed text-cream-dim">
            Betting stays open right up to the start of the window and closes the moment it
            begins. Once the thirty minutes are over, anyone can trigger settlement.
          </p>

          {error ? <p className="text-sm text-alarm">{error}</p> : null}

          {!wallet.address ? (
            <Button className="w-full sm:w-auto" onClick={() => void wallet.connect()}>
              Connect wallet to open a window
            </Button>
          ) : (
            <Button
              className="w-full sm:w-auto"
              onClick={() => void open()}
              disabled={selected === null}
            >
              Open this window
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
