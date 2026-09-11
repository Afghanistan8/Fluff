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
FLUFF_INTEGRATION=1 gltest tests/integration/ --network studionet
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
VITE_FLUFF_CONTRACT_ADDRESS=0x13d318C4CDb688614DBCe3a6D49976624B4AB7B9
VITE_GENLAYER_NETWORK=studionet
VITE_GENLAYER_CHAIN_ID=61999
```

Only the contract address is load-bearing. `src/lib/chain/network.ts` is authoritative
for the network, so a stale value in the environment cannot put the client on the wrong
chain.

Until a real address is set, every screen says so plainly rather than showing invented
data.

### Deploying to Vercel

The client has no server side. Every read is an RPC call from the browser and every
write is signed by the visitor's wallet, so it builds to a static bundle with nothing
to run or keep warm.

1. Import the repository, and set **Root Directory** to `frontend`.
2. Add `VITE_FLUFF_CONTRACT_ADDRESS` under Environment Variables, for the Production
   environment. It is read when the bundle is built, not when a visitor loads the page.
3. Deploy. `frontend/vercel.json` already sets the build command, the output directory
   and the single-page rewrite, so nothing else needs configuring.

If the footer reads "No contract address in this build", the variable was missing when
Vercel built, and a redeploy is needed after adding it.

To check the production bundle locally before pushing:

```bash
cd frontend && bun run build && bun run start
```

---

## Deployment

Everything needed to run or redeploy Fluff, in one table.

| | |
| --- | --- |
| Contract | `0x13d318C4CDb688614DBCe3a6D49976624B4AB7B9` |
| Chain | GenLayer Studio Network |
| Chain ID | 61999 (`0xf22f`) |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://explorer-studio.genlayer.com` |
| Faucet | `https://studio.genlayer.com`, use its faucet button for your address |
| Native token | GEN, 1 GEN = 10^18 base units |
| Vercel root directory | `frontend` |
| Vercel build env | `VITE_FLUFF_CONTRACT_ADDRESS` must be set **at build time** |

Vite inlines `VITE_*` when the bundle is built, so changing the address needs a
redeploy, not a restart. The site footer prints the chain and the short contract
address, linked to the explorer, so a build with a missing variable is visible on the
page rather than looking like an empty market list.

To deploy your own:

```bash
genlayer config set network=studionet && genlayer deploy --contract contracts/Fluff.py
```

### Pin the runner, never tag it

The first line of `contracts/Fluff.py` names the GenVM runner, and it must be an exact
hash:

```
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

GenVM refuses the floating `:latest` and `:test` tags outside debug mode. A tagged
contract still reaches consensus and is still reported `ACCEPTED`, then fails at load
with `invalid_contract` and no contract is created. The node log is the only place that
says why:

```
:test/ :latest runner used in non-debug mode, this is not allowed
```

The hash above is the runner GenVM v0.2.16 ships, which is what the Studio network
runs. `gltest` caches runners under
`~/.cache/gltest-direct/extracted/<version>/py-genlayer/<hash>`, which is where it
comes from.

### Check before you spend

The SDK surface also moved between GenVM releases: 0.2 nests the API under
`genlayer.gl` and exports `allow_storage`, 0.3 lifts it to the package root as `allow`.
`contracts/Fluff.py` resolves both, so it loads either way.

Both failure modes look identical from a testnet RPC, which reports only an opaque
code. The Studio endpoint will compile a contract for free and return the real
traceback, which is what this checks:

```bash
pytest tests/direct/test_live_compile.py -q
```

Run it before any deploy. It costs nothing and needs no funds.

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
