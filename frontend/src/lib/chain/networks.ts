/**
 * The networks Fluff can talk to.
 *
 * The contract behaves identically on either; only the endpoint and the chain id
 * differ. Which one the client uses is a build-time choice, so a redeploy to the
 * other network is a single environment variable.
 */

import { studionet, testnetBradbury } from 'genlayer-js/chains'
import type { GenLayerChain } from 'genlayer-js/types'

export type NetworkId = 'bradbury' | 'studionet'

export interface NetworkDescriptor {
  id: NetworkId
  chain: GenLayerChain
  /** Short name shown in the header chip. */
  label: string
  /** Full name used when asking a wallet to add the network. */
  chainName: string
  chainId: number
  rpcUrl: string
  explorerUrl: string | null
}

export const NETWORKS: Record<NetworkId, NetworkDescriptor> = {
  bradbury: {
    id: 'bradbury',
    chain: testnetBradbury,
    label: 'Bradbury',
    chainName: 'GenLayer Bradbury Testnet',
    chainId: 4221,
    rpcUrl: 'https://rpc-bradbury.genlayer.com',
    explorerUrl: 'https://explorer-bradbury.genlayer.com',
  },
  studionet: {
    id: 'studionet',
    chain: studionet,
    label: 'Studio',
    chainName: 'GenLayer Studio Network',
    chainId: 61999,
    rpcUrl: 'https://studio.genlayer.com/api',
    // The studio sandbox has no public explorer.
    explorerUrl: null,
  },
}

export const DEFAULT_NETWORK: NetworkId = 'bradbury'

export function isNetworkId(value: string): value is NetworkId {
  return value === 'bradbury' || value === 'studionet'
}

export function resolveNetwork(name: string): NetworkDescriptor {
  return NETWORKS[isNetworkId(name) ? name : DEFAULT_NETWORK]
}
