import { useMemo, useState, type ReactNode } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { placeBetCall } from '~/lib/chain/contract'
import { useRefreshAfterWrite } from '~/lib/chain/queries'
import { TOKENS, type Market, type Position, type TokenSymbol } from '~/lib/chain/types'
import {
  MIN_BET,
  formatGen,
  formatGenWithUnit,
  formatMultiple,
  parseGen,
  poolShares,
  previewMultiple,
  previewPayoutForNewBet,
} from '~/lib/market/payout'
import { tokenStyle } from '~/lib/tokens'
import { cn } from '~/lib/utils'
import { useWallet } from '~/lib/wallet/WalletProvider'

const QUICK_STAKES = [1n, 5n, 25n].map((amount) => amount * MIN_BET)

function TokenChoice({
  token,
  selected,
  locked,
  share,
  onSelect,
}: {
  token: TokenSymbol
  selected: boolean
  locked: boolean
  share: number
  onSelect: () => void
}): ReactNode {
  const style = tokenStyle(token)
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={locked}
      aria-pressed={selected}
      className={cn(
        'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
        selected ? cn(style.border, style.wash) : 'border-line hover:border-line-bright',
        locked && 'cursor-not-allowed opacity-40',
      )}
    >
      <span className={cn('flex items-center gap-2 text-sm', style.text)}>
        <span className={cn('h-2 w-2 rounded-full', style.fill)} />
        {token}
      </span>
      <span className="text-xs text-cream-faint">{style.name}</span>
      <span className="tnum text-xs text-cream-dim">{share.toFixed(0)}% of pool</span>
    </button>
  )
}

export function BetPanel({
  market,
  position,
  bettingOpen,
}: {
  market: Market
  position: Position | undefined
  bettingOpen: boolean
}): ReactNode {
  const wallet = useWallet()
  const refresh = useRefreshAfterWrite()

  const lockedToken = position && position.amount > 0n ? position.token : null
  const [selected, setSelected] = useState<TokenSymbol | null>(lockedToken)
  const [amountText, setAmountText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const activeToken = lockedToken ?? selected
  const stake = useMemo(() => parseGen(amountText), [amountText])
  const shares = poolShares(market.pools)

  const payout = useMemo(() => {
    if (!activeToken || stake === null) return 0n
    return previewPayoutForNewBet(stake, market.pools, activeToken)
  }, [activeToken, stake, market.pools])

  const multiple = useMemo(() => {
    if (!activeToken || stake === null) return 0
    return previewMultiple(stake, market.pools, activeToken)
  }, [activeToken, stake, market.pools])

  if (!bettingOpen) return null

  const insufficient = stake !== null && wallet.address !== null && stake > wallet.balance
  const belowMinimum = stake !== null && stake < MIN_BET

  async function submit(): Promise<void> {
    setFormError(null)
    if (!activeToken) {
      setFormError('Pick a token first.')
      return
    }
    if (stake === null) {
      setFormError('Enter an amount in GEN.')
      return
    }
    if (belowMinimum) {
      setFormError('The minimum bet is 1 GEN.')
      return
    }
    try {
      await wallet.send(
        placeBetCall(market.id, activeToken, stake),
        lockedToken ? `Add ${formatGen(stake, 2)} GEN to ${activeToken}` : `Bet on ${activeToken}`,
      )
      setAmountText('')
      await refresh(market.id, wallet.address)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The bet did not go through.')
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>{lockedToken ? `Add to ${lockedToken}` : 'Place a bet'}</CardTitle>
        <Badge tone="accent">0% fee</Badge>
      </CardHeader>

      <CardBody className="space-y-5">
        <div>
          <div className="grid grid-cols-3 gap-2">
            {TOKENS.map((token) => (
              <TokenChoice
                key={token}
                token={token}
                selected={activeToken === token}
                locked={lockedToken !== null && lockedToken !== token}
                share={shares[token]}
                onSelect={() => setSelected(token)}
              />
            ))}
          </div>
          {lockedToken ? (
            <p className="mt-2 text-xs text-cream-faint">
              You already back {lockedToken} here. One outcome per wallet, so you can add to it
              but not switch.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="stake" className="text-sm text-cream-dim">
              Stake
            </label>
            {wallet.address ? (
              <span className="tnum text-xs text-cream-faint">
                Balance {formatGen(wallet.balance, 2)} GEN
              </span>
            ) : null}
          </div>
          <div className="relative">
            <Input
              id="stake"
              inputMode="decimal"
              placeholder="0.0"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              className="pr-16"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-cream-faint">
              GEN
            </span>
          </div>
          <div className="flex gap-2">
            {QUICK_STAKES.map((quick) => (
              <button
                key={quick.toString()}
                type="button"
                onClick={() => setAmountText(formatGen(quick, 0))}
                className="rounded-full bg-ink-high px-3 py-1 text-xs text-cream-dim transition-colors hover:text-cream"
              >
                {formatGen(quick, 0)}
              </button>
            ))}
          </div>
        </div>

        {stake !== null && stake > 0n && activeToken ? (
          <div className="rounded-xl border border-line bg-ink p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-cream-dim">If {activeToken} leads</span>
              <span className="tnum text-base text-cream">{formatGenWithUnit(payout, 2)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-xs text-cream-faint">At the pools as they stand</span>
              <span className="tnum text-xs text-apricot">{formatMultiple(multiple)}</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-cream-faint">
              A preview, not a quote. The pools keep moving until the window starts, and the
              contract computes the real payout.
            </p>
          </div>
        ) : null}

        {formError ? <p className="text-sm text-alarm">{formError}</p> : null}
        {insufficient ? (
          <p className="text-sm text-alarm">That is more GEN than this wallet holds.</p>
        ) : null}

        {!wallet.address ? (
          <Button className="w-full" size="lg" onClick={() => void wallet.connect()}>
            Connect wallet to bet
          </Button>
        ) : !wallet.onCorrectNetwork ? (
          <Button className="w-full" size="lg" onClick={() => void wallet.switchNetwork()}>
            Switch to Bradbury
          </Button>
        ) : (
          <Button
            className="w-full"
            size="lg"
            onClick={() => void submit()}
            disabled={!activeToken || stake === null || belowMinimum || insufficient}
          >
            {lockedToken ? `Add to ${lockedToken}` : activeToken ? `Bet on ${activeToken}` : 'Pick a token'}
          </Button>
        )}

        <p className="text-xs leading-relaxed text-cream-faint">
          Betting closes the moment the window starts. Stakes cannot be cancelled, switched or
          cashed out.
        </p>
      </CardBody>
    </Card>
  )
}
