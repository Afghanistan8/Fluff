/** genlayer-js client construction, for reads and for an injected wallet. */

import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import type { GenLayerChain } from 'genlayer-js/types'

import { env } from '~/lib/env'

export type FluffClient = ReturnType<typeof createClient>

export const chain: GenLayerChain = testnetBradbury

export const CHAIN_LABEL = 'Bradbury'
export const CHAIN_ID = env.chainId
export const CHAIN_ID_HEX = `0x${env.chainId.toString(16)}`

/** Read-only client. Needs no wallet and no account. */
export function createReadClient(): FluffClient {
  return createClient({ chain })
}

/** Signing client bound to an injected provider and the connected address. */
export function createWalletClient(provider: unknown, account: `0x${string}`): FluffClient {
  return createClient({
    chain,
    account,
    // genlayer-js accepts any EIP-1193 provider here.
    provider: provider as never,
  })
}

let readClient: FluffClient | null = null

export function sharedReadClient(): FluffClient {
  readClient ??= createReadClient()
  return readClient
}

export const EXPLORER_URL = 'https://explorer-bradbury.genlayer.com'

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
