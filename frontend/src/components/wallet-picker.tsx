import type { ReactNode } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { CHAIN_LABEL } from '~/lib/chain/network'
import { useWallet } from '~/lib/wallet/WalletProvider'

/**
 * Shown only when more than one wallet announced itself. With a single wallet the
 * connect button goes straight to it, so this never appears.
 */
export function WalletPicker(): ReactNode {
  const wallet = useWallet()

  return (
    <Dialog open={wallet.picking} onOpenChange={(open) => (open ? null : wallet.cancelPicking())}>
      <DialogContent>
        <DialogTitle>Choose a wallet</DialogTitle>
        <DialogDescription>
          More than one wallet is installed. Fluff will ask the one you pick to switch to
          the {CHAIN_LABEL} network.
        </DialogDescription>

        <ul className="mt-5 space-y-2">
          {wallet.wallets.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => void wallet.choose(option)}
                className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-left transition-colors hover:border-apricot"
              >
                {option.icon ? (
                  <img src={option.icon} alt="" className="h-7 w-7 rounded-lg" />
                ) : (
                  <span className="h-7 w-7 rounded-lg bg-ink-high" />
                )}
                <span className="text-sm text-cream">{option.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
