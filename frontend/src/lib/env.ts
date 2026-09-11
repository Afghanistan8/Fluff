/** Build-time configuration, validated once so a bad deploy fails visibly. */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function readString(key: string, fallback: string): string {
  const value = import.meta.env[key as keyof ImportMetaEnv]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

const contractAddress = readString('VITE_FLUFF_CONTRACT_ADDRESS', ZERO_ADDRESS)
const network = readString('VITE_GENLAYER_NETWORK', 'bradbury')
const chainId = Number(readString('VITE_GENLAYER_CHAIN_ID', '4221'))

export const env = {
  contractAddress: contractAddress as `0x${string}`,
  network,
  chainId: Number.isFinite(chainId) ? chainId : 4221,
  /** False until a real address is configured; every screen checks this first. */
  isConfigured: /^0x[0-9a-fA-F]{40}$/.test(contractAddress) && contractAddress !== ZERO_ADDRESS,
} as const

export type Env = typeof env
