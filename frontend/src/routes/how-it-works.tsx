import { Link, createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { Card, CardBody } from '~/components/ui/card'

export const Route = createFileRoute('/how-it-works')({ component: HowItWorksPage })

const STEPS = [
  {
    title: 'Pick a 30-minute GMT+1 window',
    body: 'Every market covers one exact half hour on a fixed UTC+1 clock, the same all year. Anyone can open a window that has not been opened yet.',
  },
  {
    title: 'Stake GEN on ZEC, BNB or SOL',
    body: 'One token per wallet per window, minimum one GEN. You can add to your side later, but you cannot switch sides, cancel or cash out.',
  },
  {
    title: 'The window runs, bets are locked',
    body: 'Betting closes the instant the window begins. For thirty minutes nothing can change.',
  },
  {
    title: 'Three sources each pick a winner',
    body: 'CoinGecko, Bitget and Binance are read independently. Each one reads its own completed 30-minute candle for all three tokens and names its own leader.',
  },
  {
    title: 'Two matching winners pay the pool',
    body: 'Two sources agreeing settles the market. Everyone who backed that token splits the entire pool in proportion to their stake, at a zero fee.',
  },
  {
    title: 'No consensus, reclaim your stake',
    body: 'If the sources never agree, nobody wins and nobody loses. Every wallet takes back exactly what it put in.',
  },
]

const FAQ = [
  {
    question: 'What happens if two tokens tie for the top?',
    answer:
      'That source casts no vote at all. A tie is never broken by source order, by volume or by alphabet, because any of those would be an arbitrary rule deciding real money. If the other two sources agree, the market still settles.',
  },
  {
    question: 'What if a venue is down or returns a bad candle?',
    answer:
      'That source is marked unavailable and casts no vote, with the reason recorded on chain. Two remaining sources that agree still settle the window, which is the point of requiring two rather than three.',
  },
  {
    question: 'What if the winning token has no backers?',
    answer:
      'The result is kept on record for audit, but the market is marked inconclusive and every stake becomes refundable. Nobody backed the truth, so nobody is paid, and nobody loses anything either.',
  },
  {
    question: 'Is the fee really zero?',
    answer:
      'Yes. There is no protocol fee, no creator fee and no settlement fee. The pool is distributed to the base unit: the last winner to claim receives the rounding dust, so nothing is stranded in the contract.',
  },
  {
    question: 'Why are prices never averaged across venues?',
    answer:
      'An average is a new number that no venue actually published, and it hides disagreement instead of exposing it. Fluff makes each source answer alone and then looks for agreement, so a single broken or manipulated feed cannot quietly move a blended price.',
  },
  {
    question: 'Why GMT+1 rather than UTC or a local zone?',
    answer:
      'A fixed offset keeps every window labelled the same way forever. A named zone like Europe/Paris shifts an hour twice a year, which would relabel windows that had already settled.',
  },
  {
    question: 'Why thirty minutes?',
    answer:
      'It is long enough that a completed reference candle exists at every venue, and short enough that a market opens, resolves and pays out inside one sitting.',
  },
  {
    question: 'Who can settle a market, and what do they earn?',
    answer:
      'Anyone, and nothing. Settlement pays no reward, so there is no incentive to race. If an attempt fails to reach agreement, anyone can retry for three hours, after which the window is forced inconclusive and all stakes become refundable.',
  },
  {
    question: 'Can anyone pause, change or upgrade Fluff?',
    answer:
      'No. The contract has no owner, no pause switch, no upgrade hook and no override. The three tokens and the one category are fixed in the code.',
  },
]

function HowItWorksPage(): ReactNode {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-cream">How Fluff works</h1>
        <p className="mt-3 text-base leading-relaxed text-cream-dim">
          One question per market: which of three tokens prints the strongest percentage return
          across one exact half hour. Everything below is enforced by the contract, not by us.
        </p>
      </header>

      <ol className="mt-10 space-y-4">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Card>
              <CardBody className="flex gap-4 py-5">
                <span className="tnum mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-apricot-wash text-sm text-apricot">
                  {index + 1}
                </span>
                <div>
                  <p className="text-base text-cream">{step.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-cream-dim">{step.body}</p>
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>

      <section className="mt-14">
        <h2 className="text-xl text-cream">The numbers</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {[
                ['Window length', '30 minutes, exactly 1800 seconds'],
                ['Timezone', 'GMT+1, fixed all year'],
                ['Tokens', 'ZEC, BNB, SOL'],
                ['Minimum bet', '1 GEN'],
                ['Protocol fee', '0%'],
                ['Sources', 'CoinGecko, Bitget, Binance'],
                ['Consensus', '2 of 3 matching winners'],
                ['Settlement retry window', '3 hours after the window ends'],
                ['Payout', 'Pari-mutuel, proportional to stake'],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td className="py-3 pr-6 text-cream-dim">{label}</td>
                  <td className="py-3 text-cream">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-xl text-cream">Questions people actually ask</h2>
        <div className="mt-4 space-y-3">
          {FAQ.map((item) => (
            <details
              key={item.question}
              className="group rounded-puff border border-line bg-ink-raised px-5 py-4"
            >
              <summary className="cursor-pointer list-none text-sm text-cream marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {item.question}
                  <span className="text-cream-faint transition-transform group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-cream-dim">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/markets">See open windows</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/create">Open one yourself</Link>
        </Button>
      </div>
    </div>
  )
}
