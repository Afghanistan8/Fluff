/** Wallet context: connection, network, balance, and the one write path. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { CHAIN_ID, createWalletClient, type FluffClient } from '~/lib/chain/client'
import type { WriteCall } from '~/lib/chain/contract'
import { env } from '~/lib/env'
import {
  ensureNetwork,
  getInjectedProvider,
  readAccounts,
  readBalance,
  readChainId,
  requestAccounts,
  type Eip1193Provider,
} from '~/lib/wallet/provider'
import { IDLE_TX, runTransaction, readableError, type TxState } from '~/lib/wallet/tx'

export interface WalletContextValue {
  /** False when no injected wallet is present at all. */
  hasWallet: boolean
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
  send: (call: WriteCall, label: string) => Promise<void>
  dismissTx: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext)
  if (!value) throw new Error('useWallet must be used inside <WalletProvider>')
  return value
}

export function WalletProvider({ children }: { children: ReactNode }): ReactNode {
  const [provider, setProvider] = useState<Eip1193Provider | null>(null)
  const [address, setAddress] = useState<`0x${string}` | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState<bigint>(0n)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tx, setTx] = useState<TxState>(IDLE_TX)

  // Detection runs after mount so the server render and the first client render agree.
  useEffect(() => {
    const injected = getInjectedProvider()
    setProvider(injected)
    if (!injected) return

    let cancelled = false
    void (async () => {
      const [accounts, currentChain] = await Promise.all([
        readAccounts(injected).catch(() => []),
        readChainId(injected).catch(() => null),
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

    injected.on?.('accountsChanged', onAccountsChanged)
    injected.on?.('chainChanged', onChainChanged)
    return () => {
      cancelled = true
      injected.removeListener?.('accountsChanged', onAccountsChanged)
      injected.removeListener?.('chainChanged', onChainChanged)
    }
  }, [])

  const refreshBalance = useCallback(async () => {
    if (!provider || !address) {
      setBalance(0n)
      return
    }
    try {
      setBalance(await readBalance(provider, address))
    } catch {
      setBalance(0n)
    }
  }, [provider, address])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance, chainId])

  const connect = useCallback(async () => {
    const injected = provider ?? getInjectedProvider()
    if (!injected) {
      setError('No browser wallet detected. Install one to place a bet.')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const accounts = await requestAccounts(injected)
      setProvider(injected)
      setAddress(accounts[0] ?? null)
      await ensureNetwork(injected)
      setChainId(await readChainId(injected))
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setConnecting(false)
    }
  }, [provider])

  const disconnect = useCallback(() => {
    // Wallets have no revoke call, so this just forgets the session locally.
    setAddress(null)
    setBalance(0n)
    setError(null)
  }, [])

  const switchNetwork = useCallback(async () => {
    const injected = provider ?? getInjectedProvider()
    if (!injected) return
    setError(null)
    try {
      await ensureNetwork(injected)
      setChainId(await readChainId(injected))
    } catch (caught) {
      setError(readableError(caught))
    }
  }, [provider])

  const client = useMemo<FluffClient | null>(() => {
    if (!provider || !address) return null
    return createWalletClient(provider, address)
  }, [provider, address])

  const send = useCallback(
    async (call: WriteCall, label: string) => {
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
        confirm: (hash) =>
          client.waitForTransactionReceipt({
            hash: hash as `0x${string}` & { length: 66 },
            status: 'ACCEPTED' as never,
            retries: 60,
            interval: 2000,
          }),
      })
      await refreshBalance()
    },
    [client, address, chainId, switchNetwork, refreshBalance],
  )

  const dismissTx = useCallback(() => setTx(IDLE_TX), [])

  const value = useMemo<WalletContextValue>(
    () => ({
      hasWallet: provider !== null,
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
      provider,
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
