/**
 * The single place that turns a clock reading into a market phase.
 *
 * The contract derives the same thing from its transaction datetime. Everything in the
 * UI reads this one function so the two cannot drift: the browser clock decides only
 * what a countdown shows, never what the protocol does.
 */

import type { MarketPhase, MarketState } from '~/lib/chain/types'

export const WINDOW_SECONDS = 1800
export const SETTLEMENT_RETRY_WINDOW_SECONDS = 10800

export interface PhaseInput {
  state: MarketState
  marketStart: number
  marketEnd: number
  now: number
}

export function derivePhase({ state, marketStart, marketEnd, now }: PhaseInput): MarketPhase {
  if (state === 'SETTLED') return 'SETTLED'
  if (state === 'INCONCLUSIVE') return 'INCONCLUSIVE'
  if (now < marketStart) return 'UPCOMING'
  if (now < marketEnd) return 'LIVE'
  return 'PENDING_SETTLEMENT'
}

/** Betting is open right up to the window start and not one second past it. */
export function isBettingOpen(input: PhaseInput): boolean {
  return derivePhase(input) === 'UPCOMING'
}

export function isSettleable(input: PhaseInput): boolean {
  return derivePhase(input) === 'PENDING_SETTLEMENT'
}

export function isPastSettlementDeadline(input: PhaseInput): boolean {
  return input.now >= input.marketEnd + SETTLEMENT_RETRY_WINDOW_SECONDS
}

export function isResolved(state: MarketState): boolean {
  return state !== 'OPEN'
}

/** Seconds left in whatever the market is currently waiting for. */
export function secondsRemaining(input: PhaseInput): number {
  const phase = derivePhase(input)
  if (phase === 'UPCOMING') return Math.max(0, input.marketStart - input.now)
  if (phase === 'LIVE') return Math.max(0, input.marketEnd - input.now)
  if (phase === 'PENDING_SETTLEMENT') {
    return Math.max(0, input.marketEnd + SETTLEMENT_RETRY_WINDOW_SECONDS - input.now)
  }
  return 0
}

export const PHASE_LABELS: Record<MarketPhase, string> = {
  UPCOMING: 'Betting open',
  LIVE: 'Live',
  PENDING_SETTLEMENT: 'Awaiting settlement',
  SETTLED: 'Settled',
  INCONCLUSIVE: 'No consensus',
}

/** What the countdown is counting down to, in words. */
export const PHASE_COUNTDOWN_LABELS: Record<MarketPhase, string> = {
  UPCOMING: 'Locks in',
  LIVE: 'Ends in',
  PENDING_SETTLEMENT: 'Settlement window closes in',
  SETTLED: '',
  INCONCLUSIVE: '',
}

export type MarketFilter =
  | 'ALL'
  | 'UPCOMING'
  | 'LIVE'
  | 'PENDING_SETTLEMENT'
  | 'SETTLED'
  | 'INCONCLUSIVE'

export const MARKET_FILTERS: { id: MarketFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'UPCOMING', label: 'Betting open' },
  { id: 'LIVE', label: 'Live' },
  { id: 'PENDING_SETTLEMENT', label: 'Pending' },
  { id: 'SETTLED', label: 'Settled' },
  { id: 'INCONCLUSIVE', label: 'Inconclusive' },
]

export function matchesFilter(phase: MarketPhase, filter: MarketFilter): boolean {
  return filter === 'ALL' || phase === filter
}
