import type { ReactNode } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { CHAIN_LABEL, shortAddress } from '~/lib/chain/client'
import { formatGen } from '~/lib/market/payout'
import { useWallet } from '~/lib/wallet/WalletProvider'

export function NetworkChip(): ReactNode {
  const wallet = useWallet()
  if (wallet.address && !wallet.onCorrectNetwork) {
    return (
      <button
        type="button"
        onClick={() => void wallet.switchNetwork()}
        className="rounded-full bg-alarm/15 px-2.5 py-1 text-xs font-medium text-alarm"
      >
        Wrong network · switch
      </button>
    )
  }
  return <Badge tone="outline">{CHAIN_LABEL}</Badge>
}

export function WalletButton(): ReactNode {
  const wallet = useWallet()

  if (!wallet.address) {
    return (
      <Button size="sm" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
        {wallet.connecting ? 'Connecting…' : 'Connect'}
      </Button>
    )
  }

  return (
    <button
      type="button"
      onClick={wallet.disconnect}
      title="Disconnect"
      className="flex items-center gap-2 rounded-full border border-line-bright px-3 py-1.5 text-xs text-cream transition-colors hover:border-apricot"
    >
      <span className="tnum hidden text-cream-dim sm:inline">
        {formatGen(wallet.balance, 2)} GEN
      </span>
      <span className="tnum">{shortAddress(wallet.address)}</span>
    </button>
  )
}
