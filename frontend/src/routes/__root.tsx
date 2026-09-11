import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { Wordmark } from '~/components/brand'
import { TxDialog } from '~/components/tx-dialog'
import { NetworkChip, WalletButton } from '~/components/wallet-button'
import { useActivityCount } from '~/lib/chain/queries'
import { WalletProvider, useWallet } from '~/lib/wallet/WalletProvider'
import appCss from '~/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Fluff — 30-minute token dominance on GenLayer' },
      {
        name: 'description',
        content:
          'Pick the token that prints the strongest return in one 30-minute GMT+1 window. Permissionless, 2-of-3 price sources, zero fee.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

const NAV_LINKS = [
  { to: '/markets', label: 'Markets' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/create', label: 'Create' },
  { to: '/how-it-works', label: 'How it works' },
] as const

function ActivityPip(): ReactNode {
  const wallet = useWallet()
  const { data } = useActivityCount(wallet.address)
  if (!wallet.address || !data) return null
  return (
    <Link
      to="/portfolio"
      className="tnum hidden rounded-full bg-ink-high px-2.5 py-1 text-xs text-cream-dim transition-colors hover:text-cream sm:inline-flex"
      title="Your recorded activity"
    >
      {data} {data === 1 ? 'action' : 'actions'}
    </Link>
  )
}

function SiteHeader(): ReactNode {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="shrink-0">
          <Wordmark />
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-full px-3 py-1.5 text-sm text-cream-dim transition-colors hover:text-cream"
              activeProps={{ className: 'text-cream bg-ink-high' }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ActivityPip />
          <NetworkChip />
          <WalletButton />
        </div>
      </div>

      {/* The same links, kept reachable on a phone without a drawer. */}
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-cream-dim"
            activeProps={{ className: 'text-cream bg-ink-high' }}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

function SiteFooter(): ReactNode {
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-cream-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Fluff · permissionless 30-minute token dominance on GenLayer.</p>
        <p>
          Zero protocol fee. Settlement reads CoinGecko, Bitget and Binance independently.
        </p>
      </div>
    </footer>
  )
}

function RootComponent(): ReactNode {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The adapter already retries transient read failures with backoff.
            retry: false,
            refetchOnWindowFocus: true,
            staleTime: 10_000,
          },
        },
      }),
  )

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-ink text-cream antialiased">
        <QueryClientProvider client={queryClient}>
          <WalletProvider>
            <div className="flex min-h-screen flex-col">
              <SiteHeader />
              <main className="flex-1">
                <Outlet />
              </main>
              <SiteFooter />
            </div>
            <TxDialog />
          </WalletProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
