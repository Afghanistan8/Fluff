import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { explorerTxUrl } from '~/lib/chain/client'
import { TX_PHASE_COPY } from '~/lib/wallet/tx'
import { useWallet } from '~/lib/wallet/WalletProvider'

/** The one dialog every write shares: submitted, confirming, confirmed or refused. */
export function TxDialog(): ReactNode {
  const wallet = useWallet()
  const { tx } = wallet
  const open = tx.phase !== 'idle'
  const pending = tx.phase === 'submitting' || tx.phase === 'confirming'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A pending transaction stays on screen: dismissing it would not stop it.
        if (!next && !pending) wallet.dismissTx()
      }}
    >
      <DialogContent>
        <div className="flex items-center gap-3">
          {pending ? (
            <span className="live-dot h-2.5 w-2.5 rounded-full bg-apricot" />
          ) : (
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                tx.phase === 'success' ? 'bg-good' : 'bg-alarm'
              }`}
            />
          )}
          <DialogTitle>{tx.label ?? 'Transaction'}</DialogTitle>
        </div>

        <DialogDescription>
          {tx.phase === 'failure' ? tx.error : TX_PHASE_COPY[tx.phase]}
        </DialogDescription>

        {tx.phase === 'confirming' ? (
          <p className="mt-3 text-xs text-cream-faint">
            Validators are reaching consensus. This usually takes a few seconds.
          </p>
        ) : null}

        {tx.hash ? (
          explorerTxUrl(tx.hash) ? (
            <a
              href={explorerTxUrl(tx.hash) ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="tnum mt-4 block truncate text-xs text-apricot hover:underline"
            >
              {tx.hash}
            </a>
          ) : (
            <p className="tnum mt-4 truncate text-xs text-cream-faint">{tx.hash}</p>
          )
        ) : null}

        {!pending ? (
          <div className="mt-6 flex justify-end">
            <Button variant="quiet" size="sm" onClick={wallet.dismissTx}>
              Close
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
