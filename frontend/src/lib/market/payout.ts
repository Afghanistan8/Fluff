/**
 * Payout previews and GEN formatting.
 *
 * Everything here is informational. The contract computes the real payout and is the
 * only thing that moves money; these functions exist so a bettor can see what the pools
 * imply right now, before anything is final.
 */

import type { TokenAmounts, TokenSymbol } from '~/lib/chain/types'

export const GEN_DECIMALS = 18
export const GEN_SCALE = 10n ** 18n
export const MIN_BET = GEN_SCALE
export const RETURN_SCALE = 1_000_000

/**
 * Pari-mutuel payout at a zero fee: stake * total / winning pool.
 *
 * Uses the contract's own floor division, so the preview never quotes more than the
 * chain would pay. The last claimant's dust sweep is not modelled here: it can only
 * increase what that one wallet receives.
 */
export function previewPayout(stake: bigint, totalPool: bigint, winningPool: bigint): bigint {
  if (stake <= 0n || winningPool <= 0n) return 0n
  return (stake * totalPool) / winningPool
}

/** What a bettor would win if they staked `stake` on `token` and it won. */
export function previewPayoutForNewBet(
  stake: bigint,
  pools: TokenAmounts,
  token: TokenSymbol,
): bigint {
  if (stake <= 0n) return 0n
  const totalAfter = totalOf(pools) + stake
  const winningAfter = pools[token] + stake
  return previewPayout(stake, totalAfter, winningAfter)
}

/** Multiple returned on a winning stake, as a plain number for display only. */
export function previewMultiple(
  stake: bigint,
  pools: TokenAmounts,
  token: TokenSymbol,
): number {
  if (stake <= 0n) return 0
  const payout = previewPayoutForNewBet(stake, pools, token)
  return Number((payout * 10_000n) / stake) / 10_000
}

export function totalOf(pools: TokenAmounts): bigint {
  return pools.ZEC + pools.BNB + pools.SOL
}

/** Each token's share of the pool in percent, for the share bars. */
export function poolShares(pools: TokenAmounts): Record<TokenSymbol, number> {
  const total = totalOf(pools)
  if (total === 0n) return { ZEC: 0, BNB: 0, SOL: 0 }
  const share = (amount: bigint): number => Number((amount * 10_000n) / total) / 100
  return { ZEC: share(pools.ZEC), BNB: share(pools.BNB), SOL: share(pools.SOL) }
}

/** Parse a typed GEN amount into base units without going through a float. */
export function parseGen(input: string): bigint | null {
  const text = input.trim()
  if (text === '') return null
  if (!/^\d*\.?\d*$/.test(text)) return null
  const [whole = '', fraction = ''] = text.split('.')
  if (whole === '' && fraction === '') return null
  if (fraction.length > GEN_DECIMALS) return null
  const digits = `${whole || '0'}${fraction.padEnd(GEN_DECIMALS, '0')}`
  return BigInt(digits)
}

/** Base units to a readable GEN string, trimmed of trailing zeros. */
export function formatGen(amount: bigint, maxFractionDigits = 4): string {
  const negative = amount < 0n
  const value = negative ? -amount : amount
  const whole = value / GEN_SCALE
  const fraction = value % GEN_SCALE
  const padded = fraction.toString().padStart(GEN_DECIMALS, '0').slice(0, maxFractionDigits)
  const trimmed = padded.replace(/0+$/, '')
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = trimmed === '' ? grouped : `${grouped}.${trimmed}`
  return negative ? `-${body}` : body
}

export function formatGenWithUnit(amount: bigint, maxFractionDigits = 4): string {
  return `${formatGen(amount, maxFractionDigits)} GEN`
}

/** Scaled return units to a signed percentage string, six decimals trimmed to two. */
export function formatReturnUnits(units: number): string {
  const percent = units / RETURN_SCALE
  const sign = percent > 0 ? '+' : ''
  return `${sign}${percent.toFixed(2)}%`
}

/** A scaled 10^18 price to a readable USD figure. */
export function formatScaledPrice(scaled: bigint): string {
  const whole = scaled / GEN_SCALE
  const fraction = (scaled % GEN_SCALE).toString().padStart(GEN_DECIMALS, '0').slice(0, 4)
  return `$${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`
}

export function formatMultiple(multiple: number): string {
  if (!Number.isFinite(multiple) || multiple <= 0) return '—'
  return `${multiple.toFixed(2)}×`
}
