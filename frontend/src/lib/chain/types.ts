/** Shapes the Fluff contract returns. Mirrors the views in contracts/Fluff.py. */

export const TOKENS = ['ZEC', 'BNB', 'SOL'] as const
export type TokenSymbol = (typeof TOKENS)[number]

export const SOURCES = ['COINGECKO', 'BITGET', 'BINANCE'] as const
export type SourceId = (typeof SOURCES)[number]

export const CATEGORY_ID = 'CRYPTO_MAJORS'

/** What the contract itself stores. Only these three values exist on chain. */
export type MarketState = 'OPEN' | 'SETTLED' | 'INCONCLUSIVE'

/** What the clock adds on top of the stored state. */
export type MarketPhase =
  | 'UPCOMING'
  | 'LIVE'
  | 'PENDING_SETTLEMENT'
  | 'SETTLED'
  | 'INCONCLUSIVE'

export type EvidenceStatus = 'VALID' | 'TIE' | 'UNAVAILABLE'

export type ActivityKind =
  | 'MARKET_CREATED'
  | 'BET_PLACED'
  | 'BET_TOPPED_UP'
  | 'MARKET_SETTLED'
  | 'PAYOUT_CLAIMED'
  | 'REFUND_CLAIMED'

export type TokenAmounts = Record<TokenSymbol, bigint>
export type TokenCounts = Record<TokenSymbol, number>

export interface Market {
  id: number
  category: string
  categoryLabel: string
  tokens: TokenSymbol[]
  /** Unix seconds. The window is always exactly 1800 seconds long. */
  marketStart: number
  marketEnd: number
  timezone: string
  state: MarketState
  /** The contract's own phase, computed from the transaction clock. */
  contractPhase: MarketPhase
  bettingOpen: boolean
  winner: TokenSymbol | null
  /** Set even when a market ends inconclusive because nobody backed the winner. */
  consensusWinner: TokenSymbol | null
  consensusVotes: number
  totalPool: bigint
  pools: TokenAmounts
  backers: TokenCounts
  bettorCount: number
  winnerPool: bigint
  winnerBackers: number
  paidOut: bigint
  claimsDone: number
  creator: string
  createdAt: number
  settledAt: number
  settler: string
  settleAttempts: number
  lastAttemptAt: number
  settlementDeadline: number
  /** The chain's clock at read time, used to anchor the local countdown. */
  chainNow: number
}

export interface BettingState {
  marketId: number
  chainNow: number
  marketStart: number
  marketEnd: number
  phase: MarketPhase
  state: MarketState
  bettingOpen: boolean
  secondsUntilStart: number
  secondsUntilEnd: number
  settleable: boolean
  settlementDeadline: number
  pastDeadline: boolean
  minBet: bigint
}

export interface Position {
  marketId: number
  wallet: string
  token: TokenSymbol | null
  amount: bigint
  claimed: boolean
  refunded: boolean
  won: boolean
  claimable: bigint
  refundable: bigint
  phase: MarketPhase
  state: MarketState
  marketStart: number
  marketEnd: number
  winner: TokenSymbol | null
  totalPool: bigint
  winnerPool: bigint
  /** Present on `get_claimable_markets` rows only. */
  action?: 'CLAIM' | 'REFUND'
}

export interface EvidenceRow {
  token: TokenSymbol
  /** Integer scaled by 10^18. */
  open: bigint
  close: bigint
  /** Percentage return scaled by 10^6, so 1_250_000 is +1.25%. */
  returnUnits: number
}

export interface SourceEvidence {
  source: SourceId
  hasEvidence: boolean
  vote: TokenSymbol | null
  status: EvidenceStatus | null
  /** One of the closed set of failure codes, empty when the source succeeded. */
  reason: string
  windowStart: number
  windowEnd: number
  interval: string
  rows: EvidenceRow[]
  /** The canonical document exactly as stored on chain. */
  raw: string
}

export interface ActivityEntry {
  kind: ActivityKind
  marketId: number
  token: TokenSymbol | null
  amount: bigint
  at: number
}

export interface ProtocolConfig {
  protocol: string
  version: string
  protocolFeeBps: number
  minBet: bigint
  windowSeconds: number
  timezone: string
  timezoneOffsetSeconds: number
  sources: SourceId[]
  consensusRule: string
  consensusThreshold: number
  settlementRetryWindowSeconds: number
  candleInterval: string
  categories: string[]
  categoryLabel: string
  tokens: TokenSymbol[]
  tokenNames: Record<string, string>
  priceScale: bigint
  returnScale: bigint
  genDecimals: number
  pageLimit: number
  marketCount: number
  chainNow: number
}

export interface WindowSlot {
  start: number
  end: number
  taken: boolean
  marketId: number | null
}

export function isTokenSymbol(value: unknown): value is TokenSymbol {
  return typeof value === 'string' && (TOKENS as readonly string[]).includes(value)
}

export function isSourceId(value: unknown): value is SourceId {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value)
}
