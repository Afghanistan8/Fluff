/** Injected wallet detection and Bradbury network switching. */

import { CHAIN_ID, CHAIN_ID_HEX, CHAIN_LABEL } from '~/lib/chain/client'

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

interface ProviderWindow extends Window {
  ethereum?: Eip1193Provider
}

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null
  const injected = (window as ProviderWindow).ethereum
  return injected && typeof injected.request === 'function' ? injected : null
}

export async function requestAccounts(provider: Eip1193Provider): Promise<`0x${string}`[]> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  return normaliseAccounts(accounts)
}

export async function readAccounts(provider: Eip1193Provider): Promise<`0x${string}`[]> {
  const accounts = await provider.request({ method: 'eth_accounts' })
  return normaliseAccounts(accounts)
}

function normaliseAccounts(value: unknown): `0x${string}`[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    typeof entry === 'string' && entry.startsWith('0x') ? [entry as `0x${string}`] : [],
  )
}

export async function readChainId(provider: Eip1193Provider): Promise<number | null> {
  const raw = await provider.request({ method: 'eth_chainId' })
  if (typeof raw === 'string') return Number.parseInt(raw, 16)
  if (typeof raw === 'number') return raw
  return null
}

const BRADBURY_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: `GenLayer ${CHAIN_LABEL} Testnet`,
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: ['https://rpc-bradbury.genlayer.com'],
  blockExplorerUrls: ['https://explorer-bradbury.genlayer.com'],
}

/** Switch to Bradbury, adding it to the wallet first if it is not there yet. */
export async function ensureBradbury(provider: Eip1193Provider): Promise<void> {
  const current = await readChainId(provider)
  if (current === CHAIN_ID) return
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }],
    })
  } catch (error) {
    // 4902 is the wallet saying it has never heard of this chain.
    const code = (error as { code?: number }).code
    if (code !== 4902) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [BRADBURY_PARAMS] })
  }
}

export async function readBalance(
  provider: Eip1193Provider,
  address: `0x${string}`,
): Promise<bigint> {
  const raw = await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] })
  if (typeof raw === 'string') return BigInt(raw)
  if (typeof raw === 'bigint') return raw
  return 0n
}
