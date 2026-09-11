/** genlayer-js client construction, for reads and for an injected wallet. */

import { createClient } from 'genlayer-js'

import { env } from '~/lib/env'
import { resolveNetwork } from '~/lib/chain/networks'

export type FluffClient = ReturnType<typeof createClient>

export const network = resolveNetwork(env.network)
export const chain = network.chain

export const CHAIN_LABEL = network.label
export const CHAIN_ID = network.chainId
export const CHAIN_ID_HEX = `0x${network.chainId.toString(16)}`

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

/** Null on networks with no public explorer, so callers render plain text instead. */
export function explorerTxUrl(hash: string): string | null {
  return network.explorerUrl ? `${network.explorerUrl}/tx/${hash}` : null
}

export function explorerAddressUrl(address: string): string | null {
  return network.explorerUrl ? `${network.explorerUrl}/address/${address}` : null
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
