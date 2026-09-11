/** genlayer-js client construction, for reads and for an injected wallet. */

import { createClient } from 'genlayer-js'

import { CHAIN, EXPLORER_URL } from '~/lib/chain/network'

export type FluffClient = ReturnType<typeof createClient>

export { CHAIN_ID, CHAIN_ID_HEX, CHAIN_LABEL } from '~/lib/chain/network'

/** Read-only client. Needs no wallet and no account. */
export function createReadClient(): FluffClient {
  return createClient({ chain: CHAIN })
}

/** Signing client bound to an injected provider and the connected address. */
export function createWalletClient(provider: unknown, account: `0x${string}`): FluffClient {
  return createClient({
    chain: CHAIN,
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

/** Null on a network with no public explorer, so callers render plain text instead. */
export function explorerTxUrl(hash: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : null
}

export function explorerAddressUrl(address: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/address/${address}` : null
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
