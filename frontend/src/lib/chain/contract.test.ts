import { describe, expect, it } from 'vitest'

import { addressArg } from './contract'

/**
 * Address arguments have their own calldata type. Sending the hex string instead
 * encodes it as a string, the contract's `TreeMap[Address, ...]` lookup never matches,
 * and the node answers with a bare "execution failed". Every wallet-scoped read
 * depends on this conversion, so it is pinned here.
 */
describe('addressArg', () => {
  it('converts a hex address to its 20 bytes', () => {
    const arg = addressArg('0x81224AAb51103CFabD9De9CE020f7858702E4631')
    expect(arg.bytes).toHaveLength(20)
    expect(arg.bytes[0]).toBe(0x81)
    expect(arg.bytes[1]).toBe(0x22)
    expect(arg.bytes[19]).toBe(0x31)
  })

  it('accepts an address without the 0x prefix', () => {
    const withPrefix = addressArg('0x4184bc5e5444f250767e8d33a49817a9b4fb0df3')
    const without = addressArg('4184bc5e5444f250767e8d33a49817a9b4fb0df3')
    expect([...without.bytes]).toEqual([...withPrefix.bytes])
  })

  it('is case insensitive, so a checksummed address round-trips', () => {
    const lower = addressArg('0x81224aab51103cfabd9de9ce020f7858702e4631')
    const checksummed = addressArg('0x81224AAb51103CFabD9De9CE020f7858702E4631')
    expect([...lower.bytes]).toEqual([...checksummed.bytes])
  })

  it('round-trips back to the same hex', () => {
    const hex = '0x4611b896db0b5ea49bb8d9229107b6bd46701085'
    const bytes = addressArg(hex).bytes
    const back = `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
    expect(back).toBe(hex)
  })

  it('rejects anything that is not 20 bytes', () => {
    expect(() => addressArg('0x1234')).toThrow(/not an address/)
    expect(() => addressArg('')).toThrow(/not an address/)
    expect(() => addressArg('0x4611b896db0b5ea49bb8d9229107b6bd4670108')).toThrow(/not an address/)
  })
})
