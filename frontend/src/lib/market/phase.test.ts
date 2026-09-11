import { describe, expect, it } from 'vitest'

import {
  derivePhase,
  isBettingOpen,
  isPastSettlementDeadline,
  isSettleable,
  matchesFilter,
  secondsRemaining,
  SETTLEMENT_RETRY_WINDOW_SECONDS,
  WINDOW_SECONDS,
} from './phase'

const START = 1_767_225_600
const END = START + WINDOW_SECONDS

const openAt = (now: number) => ({ state: 'OPEN' as const, marketStart: START, marketEnd: END, now })

describe('derivePhase', () => {
  it('is upcoming before the window starts', () => {
    expect(derivePhase(openAt(START - 1))).toBe('UPCOMING')
  })

  it('flips to live on the exact second the window starts', () => {
    expect(derivePhase(openAt(START))).toBe('LIVE')
  })

  it('stays live until the last second of the window', () => {
    expect(derivePhase(openAt(END - 1))).toBe('LIVE')
  })

  it('is pending settlement from the exact second the window ends', () => {
    expect(derivePhase(openAt(END))).toBe('PENDING_SETTLEMENT')
  })

  it('reports the stored state once the contract has resolved the market', () => {
    expect(derivePhase({ ...openAt(START - 1000), state: 'SETTLED' })).toBe('SETTLED')
    expect(derivePhase({ ...openAt(START - 1000), state: 'INCONCLUSIVE' })).toBe('INCONCLUSIVE')
  })

  it('never reports a clock phase for a resolved market', () => {
    for (const now of [START - 1, START, END - 1, END, END + 100_000]) {
      expect(derivePhase({ ...openAt(now), state: 'SETTLED' })).toBe('SETTLED')
    }
  })
})

describe('betting window', () => {
  it('is open right up to the start and closed from the start onwards', () => {
    expect(isBettingOpen(openAt(START - 1))).toBe(true)
    expect(isBettingOpen(openAt(START))).toBe(false)
    expect(isBettingOpen(openAt(START + 1))).toBe(false)
  })

  it('is closed once the market has resolved', () => {
    expect(isBettingOpen({ ...openAt(START - 1), state: 'SETTLED' })).toBe(false)
    expect(isBettingOpen({ ...openAt(START - 1), state: 'INCONCLUSIVE' })).toBe(false)
  })
})

describe('settlement timing', () => {
  it('becomes settleable exactly when the window ends', () => {
    expect(isSettleable(openAt(END - 1))).toBe(false)
    expect(isSettleable(openAt(END))).toBe(true)
  })

  it('crosses the retry deadline three hours after the end', () => {
    const deadline = END + SETTLEMENT_RETRY_WINDOW_SECONDS
    expect(isPastSettlementDeadline(openAt(deadline - 1))).toBe(false)
    expect(isPastSettlementDeadline(openAt(deadline))).toBe(true)
  })
})

describe('secondsRemaining', () => {
  it('counts down to the start while betting is open', () => {
    expect(secondsRemaining(openAt(START - 90))).toBe(90)
  })

  it('counts down to the end while the window runs', () => {
    expect(secondsRemaining(openAt(START + 100))).toBe(WINDOW_SECONDS - 100)
  })

  it('counts down to the settlement deadline once the window has ended', () => {
    expect(secondsRemaining(openAt(END + 60))).toBe(SETTLEMENT_RETRY_WINDOW_SECONDS - 60)
  })

  it('never goes negative', () => {
    expect(secondsRemaining(openAt(END + SETTLEMENT_RETRY_WINDOW_SECONDS + 5000))).toBe(0)
  })

  it('is zero for a resolved market', () => {
    expect(secondsRemaining({ ...openAt(START - 500), state: 'SETTLED' })).toBe(0)
  })
})

describe('matchesFilter', () => {
  it('lets everything through on ALL', () => {
    expect(matchesFilter('LIVE', 'ALL')).toBe(true)
    expect(matchesFilter('SETTLED', 'ALL')).toBe(true)
  })

  it('matches only the named phase otherwise', () => {
    expect(matchesFilter('LIVE', 'LIVE')).toBe(true)
    expect(matchesFilter('LIVE', 'SETTLED')).toBe(false)
  })
})
