import type { ReactNode } from 'react'

import { Badge } from '~/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import type { SourceEvidence } from '~/lib/chain/types'
import { formatReturnUnits, formatScaledPrice } from '~/lib/market/payout'
import { tokenStyle } from '~/lib/tokens'
import { cn } from '~/lib/utils'

const SOURCE_NAMES = {
  COINGECKO: 'CoinGecko',
  BITGET: 'Bitget',
  BINANCE: 'Binance',
} as const

const SOURCE_SERIES = {
  COINGECKO: 'USD market chart range',
  BITGET: 'USDT-M index candle, 30m',
  BINANCE: 'Spot USDT kline, 30m',
} as const

const FAILURE_COPY: Record<string, string> = {
  http: 'The endpoint did not answer with 200.',
  size: 'The response was larger than the size cap.',
  json: 'The response was not valid JSON.',
  shape: 'The response did not match the documented shape.',
  code: 'The venue returned a business error code.',
  count: 'The venue returned the wrong number of candles.',
  timestamp: 'The candle did not open on this window.',
  price: 'A price was missing, non-numeric or not positive.',
  window: 'No price sample fell inside the window.',
}

function SourceCard({ evidence }: { evidence: SourceEvidence }): ReactNode {
  const { source, status, vote, reason, rows } = evidence

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{SOURCE_NAMES[source]}</CardTitle>
          <p className="mt-1 text-xs text-cream-faint">{SOURCE_SERIES[source]}</p>
        </div>
        {status === 'VALID' && vote ? (
          <Badge tone="good">Votes {vote}</Badge>
        ) : status === 'TIE' ? (
          <Badge tone="outline">Tied · no vote</Badge>
        ) : status === 'UNAVAILABLE' ? (
          <Badge tone="alarm">No vote</Badge>
        ) : (
          <Badge tone="neutral">Not read yet</Badge>
        )}
      </CardHeader>

      <CardBody className="flex-1">
        {rows.length > 0 ? (
          <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[16rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-cream-faint">
                <th className="pb-2 font-normal">Token</th>
                <th className="pb-2 text-right font-normal">Open</th>
                <th className="pb-2 text-right font-normal">Close</th>
                <th className="pb-2 text-right font-normal">Return</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const leads = vote === row.token
                return (
                  <tr key={row.token} className="border-t border-line">
                    <td className="py-2">
                      <span className={cn('inline-flex items-center gap-1.5', tokenStyle(row.token).text)}>
                        <span className={cn('h-2 w-2 rounded-full', tokenStyle(row.token).fill)} />
                        {row.token}
                      </span>
                    </td>
                    <td className="tnum py-2 pl-2 text-right text-xs text-cream-dim">
                      {formatScaledPrice(row.open)}
                    </td>
                    <td className="tnum py-2 pl-2 text-right text-xs text-cream-dim">
                      {formatScaledPrice(row.close)}
                    </td>
                    <td
                      className={cn(
                        'tnum py-2 pl-2 text-right text-xs',
                        leads ? 'text-apricot' : row.returnUnits >= 0 ? 'text-cream' : 'text-cream-dim',
                      )}
                    >
                      {formatReturnUnits(row.returnUnits)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-cream-dim">
            {status === 'UNAVAILABLE'
              ? (FAILURE_COPY[reason] ?? 'This source could not produce a complete candle set.')
              : 'Nothing has been read from this source yet.'}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

export function EvidencePanel({
  evidence,
  isLoading,
  winner,
  consensusVotes,
}: {
  evidence: SourceEvidence[] | undefined
  isLoading: boolean
  winner: string | null
  consensusVotes: number
}): ReactNode {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg text-cream">Evidence</h2>
        <p className="text-sm text-cream-dim">
          Three sources, read independently. Prices are never averaged across them.
        </p>
      </div>

      {winner ? (
        <p className="text-sm text-cream-dim">
          {consensusVotes} of 3 sources put{' '}
          <span className="text-cream">{winner}</span> ahead, which is what settled this window.
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {(evidence ?? []).map((row) => (
            <SourceCard key={row.source} evidence={row} />
          ))}
        </div>
      )}
    </section>
  )
}
