/** Injected wallet detection and network switching. */

import {
  CHAIN_ID,
  CHAIN_ID_HEX,
  CHAIN_NAME,
  EXPLORER_URL,
  NATIVE_CURRENCY,
  RPC_URL,
} from '~/lib/chain/network'

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

interface ProviderWindow extends Window {
  ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] }
}

/** One wallet the browser is offering. */
export interface WalletOption {
  /** The wallet's reverse-DNS id, or a synthetic one for a legacy injection. */
  id: string
  name: string
  icon: string | null
  provider: Eip1193Provider
}

interface Eip6963Detail {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string }
  provider?: Eip1193Provider
}

function isProvider(value: unknown): value is Eip1193Provider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Eip1193Provider).request === 'function'
  )
}

/**
 * Discover wallets by EIP-6963 announcement.
 *
 * `window.ethereum` is a single slot, so with more than one wallet installed only the
 * one that won the race is reachable there, and disabling that one can leave the slot
 * empty even though other wallets are present. EIP-6963 asks every wallet to announce
 * itself instead, which is why detection here does not depend on that slot.
 *
 * Returns an unsubscribe function. Announcements can arrive after the first request,
 * so the listener stays attached rather than resolving once.
 */
export function subscribeToWallets(onChange: (wallets: WalletOption[]) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const found = new Map<string, WalletOption>()

  const publish = (): void => onChange([...found.values()])

  const onAnnounce = (event: Event): void => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail
    const provider = detail?.provider
    if (!isProvider(provider)) return
    const id = detail.info?.rdns || detail.info?.uuid
    if (!id || found.has(id)) return
    found.set(id, {
      id,
      name: detail.info?.name || 'Injected wallet',
      icon: detail.info?.icon ?? null,
      provider,
    })
    publish()
  }

  window.addEventListener('eip6963:announceProvider', onAnnounce)
  window.dispatchEvent(new Event('eip6963:requestProvider'))

  // Wallets that predate EIP-6963 only ever appear on `window.ethereum`, so they are
  // added alongside the announcements rather than instead of them.
  const legacy = legacyProviders()
  for (const [index, provider] of legacy.entries()) {
    const id = `injected-${index}`
    if (!found.has(id)) found.set(id, { id, name: 'Injected wallet', icon: null, provider })
  }
  publish()

  // Some wallets announce a tick late, so ask once more after the page settles.
  const retry = window.setTimeout(() => window.dispatchEvent(new Event('eip6963:requestProvider')), 400)

  return () => {
    window.clearTimeout(retry)
    window.removeEventListener('eip6963:announceProvider', onAnnounce)
  }
}

/** Ask every wallet to announce itself again. */
export function requestWalletAnnouncements(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

function legacyProviders(): Eip1193Provider[] {
  if (typeof window === 'undefined') return []
  const injected = (window as ProviderWindow).ethereum
  if (!injected) return []
  // Some extensions stack themselves under `.providers` when they share the slot.
  if (Array.isArray(injected.providers)) return injected.providers.filter(isProvider)
  return isProvider(injected) ? [injected] : []
}

/** Legacy single-slot lookup, kept as the last resort. */
export function getInjectedProvider(): Eip1193Provider | null {
  return legacyProviders()[0] ?? null
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

const NETWORK_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: CHAIN_NAME,
  nativeCurrency: NATIVE_CURRENCY,
  rpcUrls: [RPC_URL],
  ...(EXPLORER_URL ? { blockExplorerUrls: [EXPLORER_URL] } : {}),
}

/**
 * Does this error mean "I have never heard of that chain" rather than a real failure?
 *
 * 4902 is the specified code, but wallets are inconsistent: some return the generic
 * internal error instead, and some only say so in the message. Treating any of them as
 * "not added" is safe, because the next step is to add the chain and switch again.
 */
function isUnknownChain(error: unknown): boolean {
  const code = (error as { code?: number }).code
  if (code === 4902 || code === -32603) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /unrecognized chain|chain .*not (found|added|configured)|add .*chain/i.test(message)
}

export class WrongNetworkError extends Error {
  constructor(actual: number | null) {
    super(
      `Wallet is not on ${CHAIN_NAME} (${CHAIN_ID})` +
        (actual === null ? '.' : `, it is on chain ${actual}.`),
    )
    this.name = 'WrongNetworkError'
  }
}

/**
 * Put the wallet on the configured network, adding it first if it does not know it.
 * Throws `WrongNetworkError` if the wallet still reports a different chain afterwards,
 * rather than letting the app believe a switch that never happened.
 */
export async function ensureNetwork(provider: Eip1193Provider): Promise<void> {
  const current = await readChainId(provider)
  if (current === CHAIN_ID) return

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }],
    })
  } catch (error) {
    if (!isUnknownChain(error)) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [NETWORK_PARAMS] })
    // Adding does not always switch, so ask again and ignore a redundant-switch error.
    await provider
      .request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] })
      .catch(() => undefined)
  }

  const settled = await readChainId(provider)
  if (settled !== CHAIN_ID) throw new WrongNetworkError(settled)
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
