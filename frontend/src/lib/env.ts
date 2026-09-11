/** Build-time configuration, validated once so a bad deploy fails visibly. */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function readString(key: string, fallback: string): string {
  const value = import.meta.env[key as keyof ImportMetaEnv]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

const contractAddress = readString('VITE_FLUFF_CONTRACT_ADDRESS', ZERO_ADDRESS)
// Informational only. `lib/chain/network.ts` is authoritative for the network and its
// chain id, so nothing here can put the client on the wrong chain.
const network = readString('VITE_GENLAYER_NETWORK', 'studionet')
const chainId = Number(readString('VITE_GENLAYER_CHAIN_ID', '61999'))

/** The commit this bundle was built from, stamped in by Vite. */
const buildCommit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'unknown'

export const env = {
  buildCommit,
  contractAddress: contractAddress as `0x${string}`,
  network,
  chainId: Number.isFinite(chainId) ? chainId : 61999,
  /** False until a real address is configured; every screen checks this first. */
  isConfigured: /^0x[0-9a-fA-F]{40}$/.test(contractAddress) && contractAddress !== ZERO_ADDRESS,
} as const

export type Env = typeof env
