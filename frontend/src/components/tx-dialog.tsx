import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { explorerTxUrl } from '~/lib/chain/client'
import { TX_PHASE_COPY } from '~/lib/wallet/tx'
import { useWallet } from '~/lib/wallet/WalletProvider'

/**
 * The one dialog every write shares.
 *
 * A slow confirmation is reported as still running, not as a failure. Settlement reads
 * three venues for three tokens before consensus starts, so it routinely outlives a
 * receipt wait, and calling that a failure told people their transaction had died when
 * it had not.
 */
export function TxDialog(): ReactNode {
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const { tx } = wallet
  const open = tx.phase !== 'idle'
  const pending = tx.phase === 'submitting' || tx.phase === 'confirming'
  const timedOut = tx.phase === 'timeout'

  const dotClass =
    tx.phase === 'success' ? 'bg-good' : timedOut ? 'bg-apricot' : 'bg-alarm'

  const recheck = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['fluff'] })
    wallet.dismissTx()
  }

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
            <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
          )}
          <DialogTitle>{tx.label ?? 'Transaction'}</DialogTitle>
        </div>

        <DialogDescription>
          {tx.phase === 'failure' ? tx.error : TX_PHASE_COPY[tx.phase]}
        </DialogDescription>

        {tx.phase === 'confirming' ? (
          <p className="mt-3 text-xs leading-relaxed text-cream-faint">
            Settlement reads CoinGecko, Bitget and Binance for all three tokens before
            consensus begins, so it can take several minutes.
          </p>
        ) : null}

        {timedOut ? (
          <p className="mt-3 text-xs leading-relaxed text-cream-faint">
            It was submitted and has not been refused. Validators are still working, or the
            result has not reached this node yet. Check again in a moment, and follow the
            hash if you want to watch it.
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
          <div className="mt-6 flex justify-end gap-2">
            {timedOut ? (
              <Button size="sm" onClick={() => void recheck()}>
                Check this market again
              </Button>
            ) : null}
            <Button variant="quiet" size="sm" onClick={wallet.dismissTx}>
              Close
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
