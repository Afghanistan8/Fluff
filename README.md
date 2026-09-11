# Fluff

**A permissionless 30-minute token dominance market on GenLayer.**

Pick which of three tokens will deliver the strongest percentage return across one exact
half hour on the GMT+1 clock, and stake native GEN on your answer.

Anyone can open a future window. Betting closes automatically when the thirty minutes
begin. Anyone can trigger settlement once they end. Fluff then reads independent reference
candles from CoinGecko, Bitget and Binance. Each source picks its own winner from its own
data, and two matching answers settle the market. Prices are never averaged across
sources. Winners split the entire pool pari-mutuel at a **0% protocol fee**. If the sources
cannot agree, the market is inconclusive and every bettor reclaims their exact stake.

These are crypto tokens over a short window, not equities.

---

## The market

| | |
| --- | --- |
| Category | `CRYPTO_MAJORS` — Crypto Majors |
| Tokens | **ZEC** (Zcash) · **BNB** (BNB) · **SOL** (Solana) |
| Window | Exactly 1800 seconds |
| Timezone | GMT+1, fixed all year |
| Minimum bet | 1 GEN |
| Protocol / creator / settlement fee | 0% |
| Sources | CoinGecko, Bitget, Binance |
| Consensus | 2 of 3 matching winners |
| Settlement retry window | 3 hours after the window ends |

The category and its three tokens are compile-time constants. There is no owner, no pause
switch, no upgrade hook and no override function, so nobody can add, remove or replace a
token, or change a result after the fact.

---

## GMT+1 alignment

Fluff runs on a **fixed UTC+1 offset, year round**. That is deliberately not `Europe/Paris`,
which shifts an hour twice a year and would relabel windows that had already settled.

A start timestamp `T` is valid when:

```
T is strictly in the future at creation time
(T + 3600) % 1800 == 0
```

The second line puts `T` on :00 or :30 of the GMT+1 wall clock. Because the offset is a
whole number of half hours, the same test holds against UTC; the contract still writes the
offset out because the rule is about the GMT+1 clock.

The window runs `[T, T + 1800)`. Betting is open while `now < T` and closed from `T`
onwards. Settlement may be called from `T + 1800`.

On-chain state is only ever `OPEN`, `SETTLED` or `INCONCLUSIVE`. The phases the interface
shows — `UPCOMING`, `LIVE`, `PENDING_SETTLEMENT` — are derived from the clock by
[`phase.ts`](frontend/src/lib/market/phase.ts) and by the contract's own views, never
invented by the browser.

---

## Settlement

Each source is read inside its own strict-equality equivalence block and returns one
canonical JSON document. Validators compare that document and nothing else.

**CoinGecko**, per token:

```
https://api.coingecko.com/api/v3/coins/{id}/market_chart/range?vs_currency=usd&from={start}&to={end}
```

`{id}` is `zcash`, `binancecoin` or `solana`. Open is the first sample at or after `start`;
close is the last sample strictly before `end`.

**Bitget**, per token:

```
https://api.bitget.com/api/v3/market/candles?category=USDT-FUTURES&symbol={ASSET}USDT&interval=30m&type=INDEX&startTime={start_ms}&endTime={end_ms-1}&limit=1
```

**Binance**, per token:

```
https://api.binance.com/api/v3/klines?symbol={ASSET}USDT&interval=30m&startTime={start_ms}&endTime={end_ms-1}&limit=1
```

Responses must be HTTP 200, under 65,536 bytes, valid JSON, and must carry exactly one
completed candle opening on the window. Numbers are parsed with `parse_float=str` so they
keep their exact source text, and converted to integers scaled by `10^18`. No floating
point is used anywhere in settlement.

```
return_units = round_half_away_from_zero((close - open) * 100 * 10^6 / open)
```

Per source: the highest return wins, all-negative means the least negative wins, an exact
tie for top means the source casts no vote, and any unusable evidence means the source
casts no vote. Two matching valid winners settle the market.

If nobody staked on the winning token, the result is recorded for audit, the market is
marked inconclusive, and every stake becomes refundable. If a settle call arrives after
`end + 10800` with the market still open, it is forced inconclusive without contacting any
venue.

Full specification: [docs/settlement.md](docs/settlement.md). System design:
[docs/architecture.md](docs/architecture.md).

---

## Payouts

Pari-mutuel, zero fee:

```
payout = winning_stake * total_pool // winning_outcome_pool
```

Integer floor division for ordinary claims. The last winning claimant receives everything
still unclaimed, rounding dust included, so the pool distributes to the base unit and
nothing is stranded in the contract.

Refunds return the exact accumulated stake. Claims and refunds are both pull-based, can
only be pulled by the wallet that owns the position, and never expire.

One outcome per wallet per market. Adding to the same outcome accumulates; switching is
rejected. There is no AMM, no order book, no leverage, no cash-out and no cancellation.

---

## Repository

```
contracts/Fluff.py        the Intelligent Contract, the only source of truth
frontend/                 TanStack Start + React 19 client
tests/direct/             pytest suite, runs the contract natively against the SDK
tests/integration/        gltest suite, runs against a live GenLayer node
docs/architecture.md      system design
docs/settlement.md        the settlement specification
gltest.config.yaml        network and path configuration
requirements.txt          contract toolchain
```

---

## Running it

### Contract

```bash
pip install -r requirements.txt
```

```bash
genvm-lint check contracts/Fluff.py
```

```bash
pytest tests/direct/ -q
```

The direct suite needs no node. It runs `contracts/Fluff.py` natively against the real
GenLayer SDK through `gltest.direct`, with real storage encoding, real calldata and real
equivalence blocks; only the clock, the sender, the transaction value, native transfers and
the three venue endpoints are simulated. The SDK is downloaded automatically on the first
run.

Integration tests need a node and a funded account:

```bash
FLUFF_INTEGRATION=1 gltest tests/integration/ --network testnet_bradbury
```

### Frontend

```bash
cd frontend && bun install && bun run dev
```

```bash
cd frontend && bun run typecheck && bun run test
```

`npm` works identically if you prefer it.

### Environment

Copy `frontend/.env.example` to `frontend/.env` and fill in the deployed address:

```
VITE_FLUFF_CONTRACT_ADDRESS=0x…
VITE_GENLAYER_NETWORK=bradbury
VITE_GENLAYER_CHAIN_ID=4221
```

`VITE_GENLAYER_NETWORK` accepts `bradbury` or `studionet` and selects the RPC endpoint
and the chain id together. The chain id variable is informational.

Until a real address is set, every screen says so plainly rather than showing invented
data.

---

## Deployment

Fluff is live on the GenLayer Studio dev network:

```
0x230039c2B8aB8d421f7b0B4ccA10b260403CD49E
```

## Networks

Fluff behaves identically on every GenLayer network. The client picks one at build
time, so moving a deployment is one environment variable plus the new address.

| | Bradbury | Studio | Studio dev |
| --- | --- | --- | --- |
| `VITE_GENLAYER_NETWORK` | `bradbury` | `studionet` | `studiodev` |
| Chain ID | 4221 | 61999 | 61997 |
| RPC | `rpc-bradbury.genlayer.com` | `studio.genlayer.com/api` | `studio-dev.genlayer.com/api` |
| Explorer | yes | none | yes |

Native token is GEN on all three, 1 GEN = 10^18 base units.

### Which SDK a network runs

This matters more than it looks. The contract is executed by the GenVM the network
ships, and that SDK's surface changed between the 0.2 and 0.3 releases: 0.2 nests the
API under `genlayer.gl` and exports `allow_storage`, while 0.3 lifts it to the package
root and renames it `allow`. A contract written for the wrong one is rejected at load
time as `invalid_contract`, which the testnet RPCs report as an opaque code with no
traceback.

`contracts/Fluff.py` resolves both at import, so one file works either way. The studio
endpoints return real Python tracebacks and will compile a contract for free, which is
what `tests/direct/test_live_compile.py` uses to catch this class of drift:

```bash
pytest tests/direct/test_live_compile.py -q
```

To deploy with the GenLayer CLI, unlock the deployer account once and point the CLI at
the network you want:

```bash
genlayer config set network=testnet-bradbury   # or studionet
genlayer deploy --contract contracts/Fluff.py
```

`genlayer config set` does not validate the name, so a typo silently produces an
unusable network. Confirm with `genlayer account show` before deploying.

To deploy through `gltest` instead, add a funded key under
`networks.testnet_bradbury.accounts` in `gltest.config.yaml` and keep it out of version
control.

### Line endings

GenVM reads the contract's first line as a runner spec. A CRLF file ends that line with a
stray carriage return, so the contract must stay LF on every platform. `.gitattributes`
pins this; do not let an editor rewrite `contracts/Fluff.py` to CRLF.

---

## Contract surface

**Reads** — `get_config`, `categories`, `category_assets`, `get_market`, `get_markets`,
`get_open_markets`, `get_betting_state`, `get_user_position`, `get_user_positions`,
`get_claimable_markets`, `get_market_by_category_start`, `get_source_evidence`,
`get_user_activity_count`, `get_user_activity`.

**Writes** — `create_market`, `place_bet` (payable), `settle_market`, `claim`,
`claim_refund`.

Every list view takes `(offset, limit)` and clamps `limit` to 50. Storage is TreeMap-only,
with no dynamic arrays, so reads stay bounded.

---

## Design notes

The contract is the only thing that decides anything that touches money. The client never
supplies a settlement price, a winner or a payout amount; it reads them back. The payout
figure shown before a bet is labelled a preview, computed with the contract's own floor
division so it can never quote more than the chain would pay. The relative-return chart is
labelled preview only and is drawn from evidence the contract has already stored.
