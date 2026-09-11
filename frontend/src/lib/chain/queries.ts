/** TanStack Query bindings for every contract read. */

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'

import {
  getBettingState,
  getClaimableMarkets,
  getConfig,
  getMarket,
  getMarketByCategoryStart,
  getMarkets,
  getOpenMarkets,
  getSourceEvidence,
  getUserActivity,
  getUserActivityCount,
  getUserPosition,
  getUserPositions,
} from '~/lib/chain/contract'
import type {
  ActivityEntry,
  BettingState,
  Market,
  Position,
  ProtocolConfig,
  SourceEvidence,
} from '~/lib/chain/types'
import { env } from '~/lib/env'
import { withRetry } from '~/lib/wallet/tx'

export const queryKeys = {
  config: ['fluff', 'config'] as const,
  markets: (offset: number, limit: number) => ['fluff', 'markets', offset, limit] as const,
  openMarkets: (offset: number, limit: number) => ['fluff', 'openMarkets', offset, limit] as const,
  market: (id: number) => ['fluff', 'market', id] as const,
  bettingState: (id: number) => ['fluff', 'bettingState', id] as const,
  evidence: (id: number) => ['fluff', 'evidence', id] as const,
  position: (id: number, wallet: string) => ['fluff', 'position', id, wallet] as const,
  positions: (wallet: string) => ['fluff', 'positions', wallet] as const,
  claimable: (wallet: string) => ['fluff', 'claimable', wallet] as const,
  activity: (wallet: string) => ['fluff', 'activity', wallet] as const,
  activityCount: (wallet: string) => ['fluff', 'activityCount', wallet] as const,
  slot: (category: string, start: number) => ['fluff', 'slot', category, start] as const,
}

/** Reads are safe to retry; writes never are. */
function retrying<T>(load: () => Promise<T>): () => Promise<T> {
  return () => withRetry(load, { attempts: 3, baseDelayMs: 400 })
}

const LIVE_REFETCH_MS = 15_000
const SLOW_REFETCH_MS = 60_000

export function useConfig(): UseQueryResult<ProtocolConfig> {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: retrying(getConfig),
    enabled: env.isConfigured,
    staleTime: 5 * 60_000,
  })
}

export function useMarkets(offset = 0, limit = 50): UseQueryResult<Market[]> {
  return useQuery({
    queryKey: queryKeys.markets(offset, limit),
    queryFn: retrying(() => getMarkets(offset, limit)),
    enabled: env.isConfigured,
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useOpenMarkets(offset = 0, limit = 50): UseQueryResult<Market[]> {
  return useQuery({
    queryKey: queryKeys.openMarkets(offset, limit),
    queryFn: retrying(() => getOpenMarkets(offset, limit)),
    enabled: env.isConfigured,
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useMarket(marketId: number | null): UseQueryResult<Market> {
  return useQuery({
    queryKey: queryKeys.market(marketId ?? -1),
    queryFn: retrying(() => getMarket(marketId as number)),
    enabled: env.isConfigured && marketId !== null,
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useBettingState(marketId: number | null): UseQueryResult<BettingState> {
  return useQuery({
    queryKey: queryKeys.bettingState(marketId ?? -1),
    queryFn: retrying(() => getBettingState(marketId as number)),
    enabled: env.isConfigured && marketId !== null,
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useEvidence(marketId: number | null, enabled = true): UseQueryResult<SourceEvidence[]> {
  return useQuery({
    queryKey: queryKeys.evidence(marketId ?? -1),
    queryFn: retrying(() => getSourceEvidence(marketId as number)),
    enabled: env.isConfigured && marketId !== null && enabled,
    staleTime: SLOW_REFETCH_MS,
  })
}

export function usePosition(
  marketId: number | null,
  wallet: string | null,
): UseQueryResult<Position> {
  return useQuery({
    queryKey: queryKeys.position(marketId ?? -1, wallet ?? ''),
    queryFn: retrying(() => getUserPosition(marketId as number, wallet as string)),
    enabled: env.isConfigured && marketId !== null && wallet !== null,
  })
}

export function usePositions(wallet: string | null): UseQueryResult<Position[]> {
  return useQuery({
    queryKey: queryKeys.positions(wallet ?? ''),
    queryFn: retrying(() => getUserPositions(wallet as string, 0, 50)),
    enabled: env.isConfigured && wallet !== null,
    refetchInterval: SLOW_REFETCH_MS,
  })
}

export function useClaimable(wallet: string | null): UseQueryResult<Position[]> {
  return useQuery({
    queryKey: queryKeys.claimable(wallet ?? ''),
    queryFn: retrying(() => getClaimableMarkets(wallet as string, 0, 50)),
    enabled: env.isConfigured && wallet !== null,
    refetchInterval: SLOW_REFETCH_MS,
  })
}

export function useActivity(wallet: string | null, limit = 20): UseQueryResult<ActivityEntry[]> {
  return useQuery({
    queryKey: queryKeys.activity(wallet ?? ''),
    queryFn: retrying(() => getUserActivity(wallet as string, 0, limit)),
    enabled: env.isConfigured && wallet !== null,
    refetchInterval: SLOW_REFETCH_MS,
  })
}

export function useActivityCount(wallet: string | null): UseQueryResult<number> {
  return useQuery({
    queryKey: queryKeys.activityCount(wallet ?? ''),
    queryFn: retrying(() => getUserActivityCount(wallet as string)),
    enabled: env.isConfigured && wallet !== null,
    refetchInterval: SLOW_REFETCH_MS,
  })
}

export interface SlotAvailability {
  exists: boolean
  marketId: number | null
  aligned: boolean
}

export function useSlotAvailability(
  category: string,
  starts: number[],
): UseQueryResult<Record<number, SlotAvailability>> {
  return useQuery({
    queryKey: [...queryKeys.slot(category, starts[0] ?? 0), starts.length],
    queryFn: retrying(async () => {
      const results = await Promise.all(
        starts.map(async (start) => [start, await getMarketByCategoryStart(category, start)] as const),
      )
      return Object.fromEntries(results) as Record<number, SlotAvailability>
    }),
    enabled: env.isConfigured && starts.length > 0,
    staleTime: 30_000,
  })
}

/**
 * Refetch everything a confirmed write could have changed.
 * Called only after a receipt confirms, never optimistically.
 */
export function useRefreshAfterWrite(): (marketId: number | null, wallet: string | null) => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(
    async (marketId, wallet) => {
      const invalidations: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey: ['fluff', 'markets'] }),
        queryClient.invalidateQueries({ queryKey: ['fluff', 'openMarkets'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.config }),
      ]
      if (marketId !== null) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: queryKeys.market(marketId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.bettingState(marketId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.evidence(marketId) }),
        )
      }
      if (wallet !== null) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: queryKeys.positions(wallet) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.claimable(wallet) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.activity(wallet) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(wallet) }),
        )
        if (marketId !== null) {
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: queryKeys.position(marketId, wallet) }),
          )
        }
      }
      await Promise.all(invalidations)
    },
    [queryClient],
  )
}
