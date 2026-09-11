/**
 * The GenLayer network Fluff talks to.
 *
 * One network, named once. The chain id, the endpoint and the wallet's idea of the
 * network all come from here, so they cannot drift apart.
 */

import { studionet } from 'genlayer-js/chains'
import type { GenLayerChain } from 'genlayer-js/types'

export const CHAIN: GenLayerChain = studionet

/** Short name for the header chip. */
export const CHAIN_LABEL = 'Studio'

/** Full name used when asking a wallet to add the network. */
export const CHAIN_NAME = 'GenLayer Studio Network'

export const CHAIN_ID = 61999
export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`

export const RPC_URL = 'https://studio.genlayer.com/api'

export const NATIVE_CURRENCY = { name: 'GEN', symbol: 'GEN', decimals: 18 } as const

export const EXPLORER_URL: string | null = 'https://explorer-studio.genlayer.com'

/** Where a visitor gets test GEN. The Studio faucet is the only source on this network. */
export const FAUCET_URL = 'https://studio.genlayer.com'

