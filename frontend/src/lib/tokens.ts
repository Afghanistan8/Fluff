/** Per-token presentation. Three equal, earthy hues: no token looks favoured. */

import type { TokenSymbol } from '~/lib/chain/types'

export interface TokenStyle {
  symbol: TokenSymbol
  name: string
  /** Tailwind text colour class. */
  text: string
  /** Tailwind background class for share bars and dots. */
  fill: string
  /** Tailwind border colour for the selected state. */
  border: string
  /** Tailwind background for a selected card. */
  wash: string
  hex: string
}

export const TOKEN_STYLES: Record<TokenSymbol, TokenStyle> = {
  ZEC: {
    symbol: 'ZEC',
    name: 'Zcash',
    text: 'text-zec',
    fill: 'bg-zec',
    border: 'border-zec',
    wash: 'bg-zec/10',
    hex: '#7e9aa6',
  },
  BNB: {
    symbol: 'BNB',
    name: 'BNB',
    text: 'text-bnb',
    fill: 'bg-bnb',
    border: 'border-bnb',
    wash: 'bg-bnb/10',
    hex: '#b08968',
  },
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    text: 'text-sol',
    fill: 'bg-sol',
    border: 'border-sol',
    wash: 'bg-sol/10',
    hex: '#6f8f6a',
  },
}

export function tokenStyle(symbol: TokenSymbol): TokenStyle {
  return TOKEN_STYLES[symbol]
}
