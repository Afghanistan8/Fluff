/**
 * The Fluff contract adapter.
 *
 * Every read the app performs goes through here and comes back as a typed value. The
 * app never computes a winner, a payout or a settlement price: it asks the contract.
 */

import { env } from '~/lib/env'
import { sharedReadClient, type FluffClient } from '~/lib/chain/client'
import {
  asArray,
  asBigInt,
  asNumber,
  asRecord,
  asString,
  readAddress,
  readBigInt,
  readBoolean,
  readMember,
  readNumber,
  readOptionalMember,
  readRecord,
  readString,
} from '~/lib/chain/decode'
import {
  SOURCES,
  TOKENS,
  isSourceId,
  isTokenSymbol,
  type ActivityEntry,
  type ActivityKind,
  type BettingState,
  type EvidenceRow,
  type EvidenceStatus,
  type Market,
  type MarketPhase,
  type MarketState,
  type Position,
  type ProtocolConfig,
  type SourceEvidence,
  type TokenAmounts,
  type TokenCounts,
  type TokenSymbol,
} from '~/lib/chain/types'

export const PAGE_LIMIT = 50

const MARKET_STATES = ['OPEN', 'SETTLED', 'INCONCLUSIVE'] as const satisfies readonly MarketState[]
const MARKET_PHASES = [
  'UPCOMING',
  'LIVE',
  'PENDING_SETTLEMENT',
  'SETTLED',
  'INCONCLUSIVE',
] as const satisfies readonly MarketPhase[]
const ACTIVITY_KINDS = [
  'MARKET_CREATED',
  'BET_PLACED',
  'BET_TOPPED_UP',
  'MARKET_SETTLED',
  'PAYOUT_CLAIMED',
  'REFUND_CLAIMED',
] as const satisfies readonly ActivityKind[]
const EVIDENCE_STATUSES = ['VALID', 'TIE', 'UNAVAILABLE'] as const satisfies readonly EvidenceStatus[]

export class ContractNotConfiguredError extends Error {
  constructor() {
    super('Set VITE_FLUFF_CONTRACT_ADDRESS to the deployed Fluff address.')
    this.name = 'ContractNotConfiguredError'
  }
}

async function read(
  functionName: string,
  args: (string | number | bigint)[] = [],
  client: FluffClient = sharedReadClient(),
): Promise<unknown> {
  if (!env.isConfigured) throw new ContractNotConfiguredError()
  return client.readContract({ address: env.contractAddress, functionName, args })
}

// -------------------------------------------------------------------------------------
// Decoders
// -------------------------------------------------------------------------------------

function tokenAmounts(source: Record<string, unknown>, path: string): TokenAmounts {
  return {
    ZEC: readBigInt(source, 'ZEC', path),
    BNB: readBigInt(source, 'BNB', path),
    SOL: readBigInt(source, 'SOL', path),
  }
}

function tokenCounts(source: Record<string, unknown>, path: string): TokenCounts {
  return {
    ZEC: readNumber(source, 'ZEC', path),
    BNB: readNumber(source, 'BNB', path),
    SOL: readNumber(source, 'SOL', path),
  }
}

function decodeMarket(value: unknown, path = 'market'): Market {
  const row = asRecord(value, path)
  return {
    id: readNumber(row, 'id', path),
    category: readString(row, 'category', path),
    categoryLabel: readString(row, 'category_label', path),
    tokens: asArray(row.assets, `${path}.assets`).map((entry, index) => {
      const symbol = asString(entry, `${path}.assets[${index}]`)
      if (!isTokenSymbol(symbol)) throw new Error(`${path}.assets[${index}]: unknown token ${symbol}`)
      return symbol
    }),
    marketStart: readNumber(row, 'market_start', path),
    marketEnd: readNumber(row, 'market_end', path),
    timezone: readString(row, 'timezone', path),
    state: readMember(row, 'state', MARKET_STATES, path),
    contractPhase: readMember(row, 'phase', MARKET_PHASES, path),
    bettingOpen: readBoolean(row, 'betting_open', path),
    winner: readOptionalMember(row, 'winner', TOKENS, path),
    consensusWinner: readOptionalMember(row, 'consensus_winner', TOKENS, path),
    consensusVotes: readNumber(row, 'consensus_votes', path),
    totalPool: readBigInt(row, 'total_pool', path),
    pools: tokenAmounts(readRecord(row, 'pools', path), `${path}.pools`),
    backers: tokenCounts(readRecord(row, 'backers', path), `${path}.backers`),
    bettorCount: readNumber(row, 'bettor_count', path),
    winnerPool: readBigInt(row, 'winner_pool', path),
    winnerBackers: readNumber(row, 'winner_backers', path),
    paidOut: readBigInt(row, 'paid_out', path),
    claimsDone: readNumber(row, 'claims_done', path),
    creator: readAddress(row, 'creator', path),
    createdAt: readNumber(row, 'created_at', path),
    settledAt: readNumber(row, 'settled_at', path),
    settler: readAddress(row, 'settler', path),
    settleAttempts: readNumber(row, 'settle_attempts', path),
    lastAttemptAt: readNumber(row, 'last_attempt_at', path),
    settlementDeadline: readNumber(row, 'settlement_deadline', path),
    chainNow: readNumber(row, 'now', path),
  }
}

function decodePosition(value: unknown, path = 'position'): Position {
  const row = asRecord(value, path)
  const action = typeof row.action === 'string' ? row.action : undefined
  return {
    marketId: readNumber(row, 'market_id', path),
    wallet: readAddress(row, 'wallet', path),
    token: readOptionalMember(row, 'asset', TOKENS, path),
    amount: readBigInt(row, 'amount', path),
    claimed: readBoolean(row, 'claimed', path),
    refunded: readBoolean(row, 'refunded', path),
    won: readBoolean(row, 'won', path),
    claimable: readBigInt(row, 'claimable', path),
    refundable: readBigInt(row, 'refundable', path),
    phase: readMember(row, 'phase', MARKET_PHASES, path),
    state: readMember(row, 'state', MARKET_STATES, path),
    marketStart: readNumber(row, 'market_start', path),
    marketEnd: readNumber(row, 'market_end', path),
    winner: readOptionalMember(row, 'winner', TOKENS, path),
    totalPool: readBigInt(row, 'total_pool', path),
    winnerPool: readBigInt(row, 'winner_pool', path),
    ...(action === 'CLAIM' || action === 'REFUND' ? { action } : {}),
  }
}

/** Parses one stored evidence document. A malformed blob degrades, it never throws. */
function decodeEvidenceDocument(document: string): {
  status: EvidenceStatus | null
  reason: string
  windowStart: number
  windowEnd: number
  interval: string
  rows: EvidenceRow[]
} {
  const empty = {
    status: null,
    reason: '',
    windowStart: 0,
    windowEnd: 0,
    interval: '',
    rows: [] as EvidenceRow[],
  }
  if (document === '') return empty
  try {
    const parsed: unknown = JSON.parse(document)
    const body = asRecord(parsed, 'evidence')
    const statusText = asString(body.status, 'evidence.status')
    const status = (EVIDENCE_STATUSES as readonly string[]).includes(statusText)
      ? (statusText as EvidenceStatus)
      : null
    const rows = asArray(body.rows ?? [], 'evidence.rows').flatMap((entry, index): EvidenceRow[] => {
      const cell = asRecord(entry, `evidence.rows[${index}]`)
      const token = asString(cell.asset, `evidence.rows[${index}].asset`)
      if (!isTokenSymbol(token)) return []
      return [
        {
          token,
          open: asBigInt(cell.open, `evidence.rows[${index}].open`),
          close: asBigInt(cell.close, `evidence.rows[${index}].close`),
          returnUnits: asNumber(cell.return_units, `evidence.rows[${index}].return_units`),
        },
      ]
    })
    return {
      status,
      reason: typeof body.reason === 'string' ? body.reason : '',
      windowStart: asNumber(body.window_start ?? 0, 'evidence.window_start'),
      windowEnd: asNumber(body.window_end ?? 0, 'evidence.window_end'),
      interval: typeof body.interval === 'string' ? body.interval : '',
      rows,
    }
  } catch {
    return empty
  }
}

function decodeEvidence(value: unknown, path = 'evidence'): SourceEvidence {
  const row = asRecord(value, path)
  const sourceText = readString(row, 'source', path)
  if (!isSourceId(sourceText)) throw new Error(`${path}.source: unknown source ${sourceText}`)
  const document = readString(row, 'document', path)
  const parsed = decodeEvidenceDocument(document)
  return {
    source: sourceText,
    hasEvidence: readBoolean(row, 'has_evidence', path),
    vote: readOptionalMember(row, 'vote', TOKENS, path),
    raw: document,
    ...parsed,
  }
}

function decodeActivity(value: unknown, path = 'activity'): ActivityEntry {
  const row = asRecord(value, path)
  return {
    kind: readMember(row, 'kind', ACTIVITY_KINDS, path),
    marketId: readNumber(row, 'market_id', path),
    token: readOptionalMember(row, 'asset', TOKENS, path),
    amount: readBigInt(row, 'amount', path),
    at: readNumber(row, 'at', path),
  }
}

function decodeConfig(value: unknown, path = 'config'): ProtocolConfig {
  const row = asRecord(value, path)
  const names = readRecord(row, 'asset_names', path)
  return {
    protocol: readString(row, 'protocol', path),
    version: readString(row, 'version', path),
    protocolFeeBps: readNumber(row, 'protocol_fee_bps', path),
    minBet: readBigInt(row, 'min_bet', path),
    windowSeconds: readNumber(row, 'window_seconds', path),
    timezone: readString(row, 'timezone', path),
    timezoneOffsetSeconds: readNumber(row, 'timezone_offset_seconds', path),
    sources: asArray(row.sources, `${path}.sources`).flatMap((entry) =>
      isSourceId(entry) ? [entry] : [],
    ),
    consensusRule: readString(row, 'consensus_rule', path),
    consensusThreshold: readNumber(row, 'consensus_threshold', path),
    settlementRetryWindowSeconds: readNumber(row, 'settlement_retry_window_seconds', path),
    candleInterval: readString(row, 'candle_interval', path),
    categories: asArray(row.categories, `${path}.categories`).map((entry, index) =>
      asString(entry, `${path}.categories[${index}]`),
    ),
    categoryLabel: readString(row, 'category_label', path),
    tokens: asArray(row.assets, `${path}.assets`).flatMap((entry) =>
      isTokenSymbol(entry) ? [entry] : [],
    ),
    tokenNames: Object.fromEntries(
      Object.entries(names).map(([key, entry]) => [key, asString(entry, `${path}.asset_names.${key}`)]),
    ),
    priceScale: readBigInt(row, 'price_scale', path),
    returnScale: readBigInt(row, 'return_scale', path),
    genDecimals: readNumber(row, 'gen_decimals', path),
    pageLimit: readNumber(row, 'page_limit', path),
    marketCount: readNumber(row, 'market_count', path),
    chainNow: readNumber(row, 'now', path),
  }
}

function decodeBettingState(value: unknown, path = 'bettingState'): BettingState {
  const row = asRecord(value, path)
  return {
    marketId: readNumber(row, 'market_id', path),
    chainNow: readNumber(row, 'now', path),
    marketStart: readNumber(row, 'market_start', path),
    marketEnd: readNumber(row, 'market_end', path),
    phase: readMember(row, 'phase', MARKET_PHASES, path),
    state: readMember(row, 'state', MARKET_STATES, path),
    bettingOpen: readBoolean(row, 'betting_open', path),
    secondsUntilStart: readNumber(row, 'seconds_until_start', path),
    secondsUntilEnd: readNumber(row, 'seconds_until_end', path),
    settleable: readBoolean(row, 'settleable', path),
    settlementDeadline: readNumber(row, 'settlement_deadline', path),
    pastDeadline: readBoolean(row, 'past_deadline', path),
    minBet: readBigInt(row, 'min_bet', path),
  }
}

// -------------------------------------------------------------------------------------
// Reads
// -------------------------------------------------------------------------------------

export async function getConfig(): Promise<ProtocolConfig> {
  return decodeConfig(await read('get_config'))
}

export async function getMarket(marketId: number): Promise<Market> {
  return decodeMarket(await read('get_market', [marketId]))
}

export async function getMarkets(offset = 0, limit = PAGE_LIMIT): Promise<Market[]> {
  const rows = asArray(await read('get_markets', [offset, limit]), 'markets')
  return rows.map((row, index) => decodeMarket(row, `markets[${index}]`))
}

export async function getOpenMarkets(offset = 0, limit = PAGE_LIMIT): Promise<Market[]> {
  const rows = asArray(await read('get_open_markets', [offset, limit]), 'openMarkets')
  return rows.map((row, index) => decodeMarket(row, `openMarkets[${index}]`))
}

export async function getBettingState(marketId: number): Promise<BettingState> {
  return decodeBettingState(await read('get_betting_state', [marketId]))
}

export async function getUserPosition(marketId: number, wallet: string): Promise<Position> {
  return decodePosition(await read('get_user_position', [marketId, wallet]))
}

export async function getUserPositions(
  wallet: string,
  offset = 0,
  limit = PAGE_LIMIT,
): Promise<Position[]> {
  const rows = asArray(await read('get_user_positions', [wallet, offset, limit]), 'positions')
  return rows.map((row, index) => decodePosition(row, `positions[${index}]`))
}

export async function getClaimableMarkets(
  wallet: string,
  offset = 0,
  limit = PAGE_LIMIT,
): Promise<Position[]> {
  const rows = asArray(await read('get_claimable_markets', [wallet, offset, limit]), 'claimable')
  return rows.map((row, index) => decodePosition(row, `claimable[${index}]`))
}

export async function getMarketByCategoryStart(
  category: string,
  marketStart: number,
): Promise<{ exists: boolean; marketId: number | null; aligned: boolean }> {
  const row = asRecord(
    await read('get_market_by_category_start', [category, marketStart]),
    'slot',
  )
  const exists = readBoolean(row, 'exists', 'slot')
  return {
    exists,
    marketId: exists ? readNumber(row, 'market_id', 'slot') : null,
    aligned: readBoolean(row, 'aligned', 'slot'),
  }
}

export async function getSourceEvidence(marketId: number): Promise<SourceEvidence[]> {
  const rows = asArray(await read('get_source_evidence', [marketId]), 'evidence')
  const decoded = rows.map((row, index) => decodeEvidence(row, `evidence[${index}]`))
  // Keep the contract's vote order even if the node reorders the list.
  return [...decoded].sort((a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source))
}

export async function getUserActivityCount(wallet: string): Promise<number> {
  return asNumber(await read('get_user_activity_count', [wallet]), 'activityCount')
}

export async function getUserActivity(
  wallet: string,
  offset = 0,
  limit = 20,
): Promise<ActivityEntry[]> {
  const rows = asArray(await read('get_user_activity', [wallet, offset, limit]), 'activity')
  return rows.map((row, index) => decodeActivity(row, `activity[${index}]`))
}

// -------------------------------------------------------------------------------------
// Writes
// -------------------------------------------------------------------------------------

export interface WriteCall {
  functionName: string
  args: (string | number | bigint)[]
  value: bigint
}

export function createMarketCall(category: string, marketStart: number): WriteCall {
  return { functionName: 'create_market', args: [category, marketStart], value: 0n }
}

export function placeBetCall(marketId: number, token: TokenSymbol, stake: bigint): WriteCall {
  return { functionName: 'place_bet', args: [marketId, token], value: stake }
}

export function settleMarketCall(marketId: number): WriteCall {
  return { functionName: 'settle_market', args: [marketId], value: 0n }
}

export function claimCall(marketId: number): WriteCall {
  return { functionName: 'claim', args: [marketId], value: 0n }
}

export function claimRefundCall(marketId: number): WriteCall {
  return { functionName: 'claim_refund', args: [marketId], value: 0n }
}
