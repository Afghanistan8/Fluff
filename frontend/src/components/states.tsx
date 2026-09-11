/** Every screen's empty, loading, error and disconnected states in one place. */

import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { Card, CardBody } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import { CHAIN_ID, CHAIN_LABEL, FAUCET_URL, RPC_URL } from '~/lib/chain/network'
import { env } from '~/lib/env'
import { useWallet } from '~/lib/wallet/WalletProvider'
import { cn } from '~/lib/utils'

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string
  body: string
  action?: ReactNode
  className?: string
}): ReactNode {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardBody className="flex flex-col items-center gap-3 py-14 text-center">
        <p className="text-base text-cream">{title}</p>
        <p className="max-w-sm text-sm leading-relaxed text-cream-dim">{body}</p>
        {action}
      </CardBody>
    </Card>
  )
}

/**
 * A failed read names what was queried.
 *
 * A wrong or empty contract address, a node that is down and a schema mismatch all
 * surface here, and they are indistinguishable without the address and endpoint, so
 * both are shown rather than a bare apology.
 */
export function ErrorState({
  title = 'That read did not come back',
  error,
  onRetry,
}: {
  title?: string
  error: unknown
  onRetry?: () => void
}): ReactNode {
  const message = error instanceof Error ? error.message : 'The node did not answer.'
  return (
    <Card className="border-alarm/40">
      <CardBody className="flex flex-col items-start gap-3 py-10">
        <p className="text-base text-cream">{title}</p>
        <p className="text-sm leading-relaxed text-cream-dim">{message}</p>
        <dl className="mt-1 space-y-1 text-xs text-cream-faint">
          <div className="flex gap-2">
            <dt>Contract</dt>
            <dd className="tnum text-cream-dim">{env.contractAddress}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Network</dt>
            <dd className="text-cream-dim">
              {CHAIN_LABEL} ({CHAIN_ID}) · {RPC_URL}
            </dd>
          </div>
        </dl>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </CardBody>
    </Card>
  )
}

/** Where a visitor gets test GEN, shown anywhere a write is about to be needed. */
export function FaucetHint({ className }: { className?: string }): ReactNode {
  return (
    <p className={cn('text-xs leading-relaxed text-cream-faint', className)}>
      Need GEN?{' '}
      <a
        href={FAUCET_URL}
        target="_blank"
        rel="noreferrer"
        className="text-apricot hover:underline"
      >
        Get test GEN from the Studio faucet
      </a>
      . Open the Studio, use its faucet button for your address, then come back and
      refresh.
    </p>
  )
}

export function CardSkeletonGrid({ count = 3 }: { count?: number }): ReactNode {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index}>
          <CardBody className="space-y-4 py-6">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-2 w-full" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
            <Skeleton className="h-8 w-1/3" />
          </CardBody>
        </Card>
      ))}
    </div>
  )
}

export function RowSkeleton({ count = 3 }: { count?: number }): ReactNode {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full" />
      ))}
    </div>
  )
}

/** Shown when the build has no contract address, which makes every read impossible. */
export function NotConfiguredState(): ReactNode {
  return (
    <Card className="border-alarm/40">
      <CardBody className="space-y-3 py-10">
        <p className="text-base text-cream">Fluff is not pointed at a contract yet</p>
        <p className="max-w-xl text-sm leading-relaxed text-cream-dim">
          Set the deployed address in the environment and reload. Until then nothing can be
          read from the chain, so nothing is shown rather than something invented.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-line bg-ink p-4 text-xs text-cream-dim">
          VITE_FLUFF_CONTRACT_ADDRESS=0x…
        </pre>
      </CardBody>
    </Card>
  )
}

export function ConnectPrompt({ body }: { body: string }): ReactNode {
  const wallet = useWallet()
  return (
    <EmptyState
      title={wallet.hasWallet ? 'Connect a wallet' : 'No wallet detected'}
      body={
        wallet.hasWallet
          ? body
          : 'Fluff needs a browser wallet on the GenLayer Studio network to read your positions and sign transactions.'
      }
      action={
        wallet.hasWallet ? (
          <div className="flex flex-col items-center gap-3">
            <Button onClick={() => void wallet.connect()} disabled={wallet.connecting}>
              {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
            </Button>
            <FaucetHint className="max-w-sm text-center" />
          </div>
        ) : (
          <Button variant="outline" asChild>
            <a href="https://docs.genlayer.com" target="_blank" rel="noreferrer">
              How to get set up
            </a>
          </Button>
        )
      }
    />
  )
}

/**
 * The state ladder every data screen sits behind: missing config first, then wallet, then loading,
 * then error, then empty. Screens describe their states rather than reimplementing them.
 */
export function ScreenState({
  requiresWallet = false,
  isLoading,
  error,
  onRetry,
  loadingFallback,
  connectBody = 'Connect to see what you are holding.',
  children,
}: {
  requiresWallet?: boolean
  isLoading: boolean
  error: unknown
  onRetry?: () => void
  loadingFallback: ReactNode
  connectBody?: string
  children: ReactNode
}): ReactNode {
  const wallet = useWallet()
  if (!env.isConfigured) return <NotConfiguredState />
  if (requiresWallet && !wallet.address) return <ConnectPrompt body={connectBody} />
  if (isLoading) return <>{loadingFallback}</>
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  return <>{children}</>
}

export function BrowseMarketsButton(): ReactNode {
  return (
    <Button variant="outline" asChild>
      <Link to="/markets">Browse markets</Link>
    </Button>
  )
}
