import { useMemo, type ReactNode } from 'react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis } from 'recharts'

import { Badge } from '~/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '~/components/ui/card'
import type { SourceEvidence, TokenSymbol } from '~/lib/chain/types'
import { formatReturnUnits } from '~/lib/market/payout'
import { tokenStyle } from '~/lib/tokens'

const SOURCE_NAMES: Record<string, string> = {
  COINGECKO: 'CoinGecko',
  BITGET: 'Bitget',
  BINANCE: 'Binance',
}

/**
 * Relative return per token, drawn from stored evidence.
 *
 * Informational only. The bars are a picture of what the contract already decided, so
 * they cannot influence settlement even in principle.
 */
export function ReturnPreviewChart({
  evidence,
  winner,
}: {
  evidence: SourceEvidence[]
  winner: TokenSymbol | null
}): ReactNode {
  const data = useMemo(() => {
    const valid = evidence.filter((row) => row.rows.length > 0)
    if (valid.length === 0) return []
    // Show one source rather than blending them: Fluff never averages across venues.
    const [primary] = valid
    if (!primary) return []
    return primary.rows.map((row) => ({
      token: row.token,
      percent: row.returnUnits / 1_000_000,
      label: formatReturnUnits(row.returnUnits),
    }))
  }, [evidence])

  const sourceId = evidence.find((row) => row.rows.length > 0)?.source
  const sourceName = sourceId ? SOURCE_NAMES[sourceId] : undefined

  if (data.length === 0) return null

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>Relative return</CardTitle>
          <p className="mt-1 text-xs text-cream-faint">
            {sourceName ? `As read by ${sourceName}` : ''}
          </p>
        </div>
        <Badge tone="outline">Preview only — not used for settlement</Badge>
      </CardHeader>
      <CardBody>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
              <XAxis
                dataKey="token"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#9b968c', fontSize: 12 }}
              />
              <Bar dataKey="percent" radius={[6, 6, 6, 6]} maxBarSize={56}>
                <LabelList dataKey="label" position="top" fill="#f2ede4" fontSize={12} />
                {data.map((entry) => (
                  <Cell
                    key={entry.token}
                    fill={tokenStyle(entry.token).hex}
                    fillOpacity={winner && winner !== entry.token ? 0.35 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  )
}
