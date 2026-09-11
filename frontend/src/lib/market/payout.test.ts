import { describe, expect, it } from 'vitest'

import {
  formatGen,
  formatReturnUnits,
  formatScaledPrice,
  parseGen,
  poolShares,
  previewPayout,
  previewPayoutForNewBet,
  totalOf,
  GEN_SCALE,
} from './payout'

const pools = (zec: bigint, bnb: bigint, sol: bigint) => ({
  ZEC: zec * GEN_SCALE,
  BNB: bnb * GEN_SCALE,
  SOL: sol * GEN_SCALE,
})

describe('previewPayout', () => {
  it('doubles a stake when the winning side holds half the pool', () => {
    expect(previewPayout(2n * GEN_SCALE, 16n * GEN_SCALE, 8n * GEN_SCALE)).toBe(4n * GEN_SCALE)
  })

  it('returns the whole pool to a sole winner', () => {
    expect(previewPayout(4n * GEN_SCALE, 10n * GEN_SCALE, 4n * GEN_SCALE)).toBe(10n * GEN_SCALE)
  })

  it('floors rather than rounding up, so a preview never overstates', () => {
    // 1 * 10 / 3 in base units: the true value has a repeating tail.
    const payout = previewPayout(GEN_SCALE, 10n * GEN_SCALE, 3n * GEN_SCALE)
    expect(payout).toBe(3_333_333_333_333_333_333n)
    expect(payout * 3n).toBeLessThan(10n * GEN_SCALE)
  })

  it('is zero for an empty stake or an empty winning pool', () => {
    expect(previewPayout(0n, 10n * GEN_SCALE, 5n * GEN_SCALE)).toBe(0n)
    expect(previewPayout(GEN_SCALE, 10n * GEN_SCALE, 0n)).toBe(0n)
  })
})

describe('previewPayoutForNewBet', () => {
  it('accounts for the bettor joining the pool they are backing', () => {
    // Staking 5 into a 5/5 book: total 15, winning side 10, so 5 pays 7.5.
    const payout = previewPayoutForNewBet(5n * GEN_SCALE, pools(5n, 0n, 5n), 'SOL')
    expect(payout).toBe(7n * GEN_SCALE + GEN_SCALE / 2n)
  })

  it('returns the stake itself when nobody is on the other side', () => {
    expect(previewPayoutForNewBet(3n * GEN_SCALE, pools(0n, 0n, 0n), 'ZEC')).toBe(3n * GEN_SCALE)
  })
})

describe('poolShares', () => {
  it('splits a populated book into percentages', () => {
    expect(poolShares(pools(25n, 25n, 50n))).toEqual({ ZEC: 25, BNB: 25, SOL: 50 })
  })

  it('reports zeroes for an empty book rather than dividing by zero', () => {
    expect(poolShares(pools(0n, 0n, 0n))).toEqual({ ZEC: 0, BNB: 0, SOL: 0 })
  })
})

describe('totalOf', () => {
  it('adds the three pools', () => {
    expect(totalOf(pools(1n, 2n, 3n))).toBe(6n * GEN_SCALE)
  })
})

describe('parseGen', () => {
  it('reads whole and fractional amounts exactly', () => {
    expect(parseGen('1')).toBe(GEN_SCALE)
    expect(parseGen('0.5')).toBe(GEN_SCALE / 2n)
    expect(parseGen('12.345')).toBe(12_345_000_000_000_000_000n)
  })

  it('keeps precision a float would lose', () => {
    expect(parseGen('0.1')).toBe(100_000_000_000_000_000n)
    expect(parseGen('1234567.891234567891')).toBe(1_234_567_891_234_567_891_000_000n)
  })

  it('rejects junk, negatives and over-precise input', () => {
    expect(parseGen('')).toBeNull()
    expect(parseGen('abc')).toBeNull()
    expect(parseGen('-1')).toBeNull()
    expect(parseGen('1.2.3')).toBeNull()
    expect(parseGen(`0.${'1'.repeat(19)}`)).toBeNull()
  })

  it('accepts a bare decimal point form', () => {
    expect(parseGen('.5')).toBe(GEN_SCALE / 2n)
  })
})

describe('formatGen', () => {
  it('trims trailing zeros and groups thousands', () => {
    expect(formatGen(GEN_SCALE)).toBe('1')
    expect(formatGen(1_500_000_000_000_000_000n)).toBe('1.5')
    expect(formatGen(1_234_567n * GEN_SCALE)).toBe('1,234,567')
  })

  it('truncates to the requested precision', () => {
    expect(formatGen(3_333_333_333_333_333_333n, 2)).toBe('3.33')
  })

  it('round-trips with parseGen', () => {
    for (const text of ['1', '0.5', '123.25']) {
      const parsed = parseGen(text)
      expect(parsed).not.toBeNull()
      expect(formatGen(parsed as bigint)).toBe(text === '1' ? '1' : text)
    }
  })
})

describe('formatReturnUnits', () => {
  it('renders scaled units as a signed percentage', () => {
    expect(formatReturnUnits(2_000_000)).toBe('+2.00%')
    expect(formatReturnUnits(-1_000_000)).toBe('-1.00%')
    expect(formatReturnUnits(0)).toBe('0.00%')
  })
})

describe('formatScaledPrice', () => {
  it('renders a 10^18 scaled price as dollars', () => {
    expect(formatScaledPrice(231n * GEN_SCALE)).toBe('$231.0000')
  })
})
