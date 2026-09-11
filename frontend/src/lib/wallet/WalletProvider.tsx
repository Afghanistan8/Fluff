/** Wallet context: connection, network, balance, and the one write path. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { CHAIN_ID, createWalletClient, type FluffClient } from '~/lib/chain/client'
import type { WriteCall } from '~/lib/chain/contract'
import { env } from '~/lib/env'
import {
  ensureNetwork,
  readAccounts,
  readBalance,
  readChainId,
  requestAccounts,
  requestWalletAnnouncements,
  subscribeToWallets,
  type Eip1193Provider,
  type WalletOption,
} from '~/lib/wallet/provider'
import { IDLE_TX, runTransaction, readableError, type TxState } from '~/lib/wallet/tx'

export interface WalletContextValue {
  /** False when no wallet is present at all. */
  hasWallet: boolean
  /** Every wallet the browser announced, in announcement order. */
  wallets: WalletOption[]
  /** The wallet currently connected, when one is. */
  activeWallet: WalletOption | null
  /** Open when more than one wallet is installed and the user must choose. */
  picking: boolean
  choose: (wallet: WalletOption) => Promise<void>
  cancelPicking: () => void
  address: `0x${string}` | null
  chainId: number | null
  onCorrectNetwork: boolean
  balance: bigint
  connecting: boolean
  error: string | null
  tx: TxState
  connect: () => Promise<void>
  disconnect: () => void
  switchNetwork: () => Promise<void>
  refreshBalance: () => Promise<void>
  send: (call: WriteCall, label: string, options?: SendOptions) => Promise<void>
  dismissTx: () => void
}

export interface SendOptions {
  /**
   * How long to wait for the receipt. `settle_market` reads nine live venue URLs
   * inside equivalence blocks before consensus even starts, so the default two
   * minutes reported a false failure while the transaction was still running.
   */
  waitSeconds?: number
  /** Asks the chain whether the effect landed, used when the receipt never arrives. */
  verify?: () => Promise<boolean>
  /** Shown once the write succeeds. */
  successNote?: string
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext)
  if (!value) throw new Error('useWallet must be used inside <WalletProvider>')
  return value
}

/** Ordinary writes settle quickly; `settle_market` is given far longer at the call site. */
const DEFAULT_WAIT_SECONDS = 180

export function WalletProvider({ children }: { children: ReactNode }): ReactNode {
  const [wallets, setWallets] = useState<WalletOption[]>([])
  const [activeWallet, setActiveWallet] = useState<WalletOption | null>(null)
  const [picking, setPicking] = useState(false)
  const [provider, setProvider] = useState<Eip1193Provider | null>(null)
  const [address, setAddress] = useState<`0x${string}` | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState<bigint>(0n)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tx, setTx] = useState<TxState>(IDLE_TX)

  // Discovery runs after mount so the server render and the first client render agree.
  // The ref mirrors the list so `connect` can read it straight after a re-announcement,
  // without waiting for a state update to land.
  const walletsRef = useRef<WalletOption[]>([])
  useEffect(
    () =>
      subscribeToWallets((found) => {
        walletsRef.current = found
        setWallets(found)
      }),
    [],
  )

  // Bind to a wallet: listen for its account and chain changes, and adopt any session
  // it already has so a reload does not look like a disconnect.
  useEffect(() => {
    if (!provider) return
    let cancelled = false

    void (async () => {
      const [accounts, currentChain] = await Promise.all([
        readAccounts(provider).catch(() => []),
        readChainId(provider).catch(() => null),
      ])
      if (cancelled) return
      setAddress(accounts[0] ?? null)
      setChainId(currentChain)
    })()

    const onAccountsChanged = (...args: unknown[]): void => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : []
      const next = accounts[0]
      setAddress(next && next.startsWith('0x') ? (next as `0x${string}`) : null)
    }
    const onChainChanged = (...args: unknown[]): void => {
      const raw = args[0]
      setChainId(typeof raw === 'string' ? Number.parseInt(raw, 16) : null)
    }

    provider.on?.('accountsChanged', onAccountsChanged)
    provider.on?.('chainChanged', onChainChanged)
    return () => {
      cancelled = true
      provider.removeListener?.('accountsChanged', onAccountsChanged)
      provider.removeListener?.('chainChanged', onChainChanged)
    }
  }, [provider])

  const refreshBalance = useCallback(async () => {
    // A balance read on the wrong chain returns that chain's GEN, which would be a
    // misleading number to show, so it is not read at all until the network is right.
    if (!provider || !address || chainId !== CHAIN_ID) {
      setBalance(0n)
      return
    }
    try {
      setBalance(await readBalance(provider, address))
    } catch {
      setBalance(0n)
    }
  }, [provider, address, chainId])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  /** Bind to one wallet, ask for its accounts, then put it on the right network. */
  const choose = useCallback(async (wallet: WalletOption) => {
    setConnecting(true)
    setError(null)
    setPicking(false)
    try {
      const accounts = await requestAccounts(wallet.provider)
      setActiveWallet(wallet)
      setProvider(wallet.provider)
      setAddress(accounts[0] ?? null)
      await ensureNetwork(wallet.provider)
      setChainId(await readChainId(wallet.provider))
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setConnecting(false)
    }
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    // A wallet enabled after page load has not announced itself yet, so ask again
    // before deciding there is nothing installed.
    if (walletsRef.current.length === 0) {
      setConnecting(true)
      requestWalletAnnouncements()
      await new Promise((resolve) => setTimeout(resolve, 400))
      setConnecting(false)
    }

    const found = walletsRef.current
    if (found.length === 0) {
      setError('No wallet responded. Enable one for this site, then try again.')
      return
    }
    // One wallet needs no question; several do.
    if (found.length === 1) {
      await choose(found[0] as WalletOption)
      return
    }
    setPicking(true)
  }, [choose])

  const cancelPicking = useCallback(() => setPicking(false), [])

  const disconnect = useCallback(() => {
    // Wallets have no revoke call, so this just forgets the session locally.
    setAddress(null)
    setActiveWallet(null)
    setProvider(null)
    setChainId(null)
    setBalance(0n)
    setError(null)
  }, [])

  const switchNetwork = useCallback(async () => {
    if (!provider) return
    setError(null)
    try {
      await ensureNetwork(provider)
      setChainId(await readChainId(provider))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [provider])

  // Ask once per wrong network rather than on every render, so a declined switch does
  // not turn into a loop of wallet prompts.
  const promptedFor = useRef<number | null>(null)
  useEffect(() => {
    if (!provider || !address || chainId === null || chainId === CHAIN_ID) return
    if (promptedFor.current === chainId) return
    promptedFor.current = chainId
    void switchNetwork()
  }, [provider, address, chainId, switchNetwork])

  const client = useMemo<FluffClient | null>(() => {
    if (!provider || !address) return null
    return createWalletClient(provider, address)
  }, [provider, address])

  const send = useCallback(
    async (call: WriteCall, label: string, options: SendOptions = {}) => {
      if (!client || !address) throw new Error('Connect a wallet first.')
      if (!env.isConfigured) throw new Error('No Fluff contract address is configured.')
      if (chainId !== CHAIN_ID) await switchNetwork()

      await runTransaction({
        label,
        onPhase: setTx,
        submit: async () => {
          const hash = await client.writeContract({
            address: env.contractAddress,
            functionName: call.functionName,
            args: call.args,
            value: call.value,
          })
          return String(hash)
        },
        verify: options.verify,
        successNote: options.successNote,
        confirm: (hash) => {
          const intervalMs = 3000
          const waitSeconds = options.waitSeconds ?? DEFAULT_WAIT_SECONDS
          return client.waitForTransactionReceipt({
            hash: hash as `0x${string}` & { length: 66 },
            status: 'ACCEPTED' as never,
            retries: Math.ceil((waitSeconds * 1000) / intervalMs),
            interval: intervalMs,
          })
        },
      })
      await refreshBalance()
    },
    [client, address, chainId, switchNetwork, refreshBalance],
  )

  const dismissTx = useCallback(() => setTx(IDLE_TX), [])

  const value = useMemo<WalletContextValue>(
    () => ({
      hasWallet: wallets.length > 0,
      wallets,
      activeWallet,
      picking,
      choose,
      cancelPicking,
      address,
      chainId,
      onCorrectNetwork: chainId === CHAIN_ID,
      balance,
      connecting,
      error,
      tx,
      connect,
      disconnect,
      switchNetwork,
      refreshBalance,
      send,
      dismissTx,
    }),
    [
      wallets,
      activeWallet,
      picking,
      choose,
      cancelPicking,
      address,
      chainId,
      balance,
      connecting,
      error,
      tx,
      connect,
      disconnect,
      switchNetwork,
      refreshBalance,
      send,
      dismissTx,
    ],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
