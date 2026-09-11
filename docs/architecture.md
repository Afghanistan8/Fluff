# Fluff — architecture

Fluff is a permissionless 30-minute token dominance market on GenLayer.

A market asks one question: **which of ZEC, BNB or SOL prints the strongest percentage
return during one exact 30-minute GMT+1 window?** Anyone may open a future window, anyone
may stake native GEN on an outcome before the window begins, and anyone may trigger
settlement once it has ended. There is no operator in the loop.

---

## 1. Components

| Layer | What it is | Where |
| --- | --- | --- |
| Intelligent Contract | Single Python contract on GenVM. Sole source of truth for windows, stakes, evidence, winners and payouts. | `contracts/Fluff.py` |
| Direct tests | pytest suite driving the contract through a local GenVM stand-in. | `tests/direct/` |
| Integration tests | `gltest` suite against a live GenLayer node. | `tests/integration/` |
| Web client | TanStack Start + React 19 read/write client. Renders state, never produces it. | `frontend/` |

The client can compute nothing that affects money. It renders on-chain state, formats
GMT+1 windows, and submits four kinds of transaction: create, bet, settle, claim/refund.
Prices, winners and payout amounts are read back from the contract.

---

## 2. Network

| Item | Value |
| --- | --- |
| Chain | GenLayer Studio Network |
| Chain ID | 61999 |
| RPC | `https://studio.genlayer.com/api` |
| Native token | GEN |
| Base units | 1 GEN = 10^18 |
| Runtime | GenVM v0.2.16, Python Intelligent Contract |

The contract header pins the GenVM runner to an exact hash. GenVM refuses the floating
`:latest` and `:test` tags outside debug mode: a tagged contract is accepted by
consensus and then fails at load as `invalid_contract`, with no contract created.

---

## 3. The locked category

Fluff ships exactly one category and it cannot be changed by anyone, including the
deployer. There is no admin key, no pause switch, no upgrade hook and no override path.

| Field | Value |
| --- | --- |
| Category id | `CRYPTO_MAJORS` |
| Category label | `Crypto Majors` |
| Assets | `ZEC` (Zcash), `BNB` (BNB), `SOL` (Solana) |

Assets are compile-time constants. `create_market` rejects any other category string.

---

## 4. Time model

Fluff runs on a **fixed GMT+1 clock, year round**. It is UTC+1 with no daylight-saving
shift, so it is deliberately not `Europe/Paris` and deliberately not UTC.

A window is exactly 1800 seconds. A start timestamp `T` is valid when:

```
T is strictly in the future at creation time
(T + 3600) % 1800 == 0          # T lands on :00 or :30 on the GMT+1 wall clock
```

The offset is a whole number of half hours, so the alignment test also holds against the
UTC clock. The contract still writes the offset explicitly, because the rule is about the
GMT+1 wall clock and should keep reading that way.

Market end is `T + 1800`.

### Contract time source

Every protocol decision reads the deterministic transaction datetime that GenVM hands to
the contract, parsed to epoch seconds. A browser clock is never trusted for anything
except cosmetic countdowns.

### Phases

On-chain the state machine has three values only: `OPEN`, `SETTLED`, `INCONCLUSIVE`.
Everything else is a derived phase, computed from timestamps by both the contract views
and the client:

| Phase | Condition | Betting |
| --- | --- | --- |
| `UPCOMING` | `now < start`, state `OPEN` | open |
| `LIVE` | `start <= now < end`, state `OPEN` | closed |
| `PENDING_SETTLEMENT` | `now >= end`, state `OPEN` | closed |
| `SETTLED` | state `SETTLED` | closed |
| `INCONCLUSIVE` | state `INCONCLUSIVE` | closed |

Betting closes the instant the window begins. There is no grace period.

---

## 5. Market lifecycle

```
create_market(category, market_start)
        |
        |  now < start .......... UPCOMING   place_bet() accepted
        |  start <= now < end ... LIVE       place_bet() rejected
        |  now >= end ........... PENDING    settle_market() accepted
        v
settle_market(market_id)
        |
        +-- 2-of-3 agreement, winner has stake .......... SETTLED      -> claim()
        +-- 2-of-3 agreement, winner has zero stake ..... INCONCLUSIVE -> claim_refund()
        +-- no agreement, before the retry deadline ..... stays OPEN, retry later
        +-- no agreement, after the retry deadline ...... INCONCLUSIVE -> claim_refund()
```

The retry deadline is `end + 10800` (three hours). A settle call at or after that deadline
on a still-open market forces `INCONCLUSIVE` immediately and performs no web requests at
all, so a market can never hang forever waiting on an unreachable venue.

---

## 6. Storage layout

The contract holds no dynamic arrays. Every collection is a typed `TreeMap`, which keeps
reads bounded and iteration ordered by key.

| Field | Type | Purpose |
| --- | --- | --- |
| `markets` | `TreeMap[u256, Market]` | market id to market record |
| `open_ids` | `TreeMap[u256, u8]` | id set of markets still in state `OPEN` |
| `start_index` | `TreeMap[str, u256]` | `"CATEGORY|start"` to id + 1, enforces one market per window |
| `positions` | `TreeMap[u256, TreeMap[Address, Position]]` | stake per wallet per market |
| `wallet_markets` | `TreeMap[Address, TreeMap[u256, u8]]` | id set per wallet, for portfolio reads |
| `activity` | `TreeMap[Address, TreeMap[u256, ActivityRecord]]` | append-only per-wallet feed |
| `activity_count` | `TreeMap[Address, u256]` | next activity sequence per wallet |
| `next_market_id` | `u256` | monotonic id counter, starts at 1 |
| `market_count` | `u256` | total markets created |

`Market` carries its own nested maps: `pools` (asset to staked base units), `backers`
(asset to wallet count) and `evidence` (source to canonical JSON blob).

All list-returning views take `(offset, limit)` and clamp `limit` to 50.

---

## 7. Money rules

* Stake asset is native GEN, sent as transaction value on `place_bet`.
* Minimum bet is 1 GEN. No maximum.
* One outcome per wallet per market. Adding to the same outcome is allowed and
  accumulates. Switching outcomes is rejected.
* Protocol fee, creator fee and settlement fee are all zero. Nothing is skimmed.
* Payouts are pari-mutuel: `payout = stake * total_pool // winning_pool`.
* Integer floor division everywhere. The last winning claimant sweeps the remainder,
  so the pool distributes exactly with no residue stranded in the contract.
* Refunds return the exact accumulated stake and are only reachable in `INCONCLUSIVE`.
* Claims and refunds are pull-based, never expire, and can only be pulled by the wallet
  that owns the position.

There is no AMM, no order book, no leverage, no cash-out, no side-switching and no
cancellation. A stake is a commitment until the window resolves.

---

## 8. Determinism rules

1. No floating point anywhere in settlement. Venue responses are parsed with
   `json.loads(..., parse_float=str, parse_int=str)` so numbers arrive as their original
   text and are converted to integers exactly.
2. Prices are normalised to `PRICE_SCALE = 10^18`. Returns use
   `RETURN_SCALE = 10^6`, six decimals of percent.
3. Each source votes on its own evidence. Prices are never averaged across venues.
4. Each web fetch happens inside a strict-equality equivalence block, and the block
   returns one bounded canonical JSON document. Validators compare that document, and
   nothing else.
5. Failure reasons are drawn from a small fixed vocabulary so two honest validators
   describe the same failure with the same string.

Settlement detail lives in [settlement.md](./settlement.md).

---

## 9. Contract surface

Reads: `get_config`, `categories`, `category_assets`, `get_market`, `get_markets`,
`get_open_markets`, `get_betting_state`, `get_user_position`, `get_user_positions`,
`get_claimable_markets`, `get_market_by_category_start`, `get_source_evidence`,
`get_user_activity_count`, `get_user_activity`.

Writes: `create_market`, `place_bet` (payable), `settle_market`, `claim`, `claim_refund`.

Activity kinds: `MARKET_CREATED`, `BET_PLACED`, `BET_TOPPED_UP`, `MARKET_SETTLED`,
`PAYOUT_CLAIMED`, `REFUND_CLAIMED`.

---

## 10. Client architecture

```
frontend/src/
  routes/            file-based TanStack routes
  lib/chain/         genlayer-js client, contract adapter, typed calls
  lib/market/        phase derivation, GMT+1 formatting, payout preview maths
  lib/wallet/        injected wallet detect, network add/switch, tx lifecycle
  components/        presentation, shadcn primitives underneath
```

`lib/market/phase.ts` is the only place that turns `(now, start, end, state)` into a
phase, and it is unit tested. Everything downstream reads that one function so the UI
cannot drift from the contract's own view of time.

Writes go through a single transaction runner that reports
`submitted -> confirming -> success | failure`, surfaces the contract's revert reason
verbatim, and refetches market, position and activity only after confirmation. Nothing is
shown as done before the chain says it is done.

---

## 11. Environment

```
VITE_FLUFF_CONTRACT_ADDRESS   deployed Fluff address
VITE_GENLAYER_NETWORK         studionet
VITE_GENLAYER_CHAIN_ID        61999
```

Only the contract address is load-bearing. `src/lib/chain/network.ts` is authoritative
for the network itself, so a stale value in the environment cannot put the client on
the wrong chain.
