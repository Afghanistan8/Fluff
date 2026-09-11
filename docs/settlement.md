# Fluff — settlement

This document is the specification the contract implements. If the code and this file ever
disagree, the code is wrong.

Settlement answers one question for one window: **which of ZEC, BNB and SOL delivered the
strongest percentage return between `start` and `end`?**

Three independent sources each answer it alone. Two matching answers settle the market.
Prices are never combined, averaged or cross-checked between sources.

---

## 1. Window

```
start = market_start                    # aligned to :00 or :30 on the GMT+1 wall clock
end   = market_start + 1800
```

Every request covers exactly `[start, end)`. Milliseconds where a venue needs them:

```
start_ms = start * 1000
end_ms   = end * 1000
```

Range-bounded APIs receive `end_ms - 1` as their upper bound so the candle that opens at
`end` can never be returned.

`settle_market` may be called at or after `end`. Before that it reverts.

---

## 2. Sources

Sources vote in this fixed order. The order matters only for how evidence is stored and
displayed, never for the outcome.

| Vote order | Source id | Venue | Reference series |
| --- | --- | --- | --- |
| 1 | `GATE` | Gate | Spot USDT candle, 30m |
| 2 | `BITGET` | Bitget | USDT-M futures index candle, 30m |
| 3 | `BINANCE` | Binance | Spot USDT kline, 30m |

A source that cannot produce a valid completed candle for **all three** tokens casts no
vote. A source is never partially counted.

### 2.1 Locked URL templates

These are the only endpoints Fluff contacts. Validators do not choose alternates, and
there is no HTML scraping fallback anywhere in the design.

**Gate** — one request per token:

```
https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair={ASSET}_USDT&interval=30m&from={start}&to={end_minus_1}
```

`{ASSET}` is `ZEC`, `BNB` or `SOL`. Timestamps here are **seconds**, not milliseconds.

Gate replaced CoinGecko. CoinGecko could not vote in practice: its free tier
rate-limits the burst of three calls settlement makes from one IP. A single call
returns 200; three in a row return **429**. Measured from inside a GenLayer validator,
not from a developer laptop, which is why it looked healthy in local testing.

**Bitget** — one request per token:

```
https://api.bitget.com/api/v3/market/candles?category=USDT-FUTURES&symbol={ASSET}USDT&interval=30m&type=INDEX&startTime={start_ms}&endTime={end_ms_minus_1}&limit=1
```

`{ASSET}` is `ZEC`, `BNB` or `SOL`, giving `ZECUSDT`, `BNBUSDT`, `SOLUSDT`.

**Binance** — one request per token:

```
https://data-api.binance.vision/api/v3/klines?symbol={ASSET}USDT&interval=30m&startTime={start_ms}&endTime={end_ms_minus_1}&limit=1
```

`{ASSET}USDT` is `ZECUSDT`, `BNBUSDT`, `SOLUSDT`.

The host is **not** `api.binance.com`. That host answers **HTTP 451** from GenLayer
validator IPs, "Service unavailable from a restricted location", so Binance could never
vote. `data-api.binance.vision` is Binance's public market-data host, serves the
identical kline payload and is not geo-fenced.

### 2.1.1 What the validators can actually reach

Endpoint health differs between a developer machine and a GenLayer validator, and only
the validator's view matters. Measured from inside one, with a probe contract:

| Endpoint | From a laptop | From a validator |
| --- | --- | --- |
| `api.coingecko.com` market_chart, single call | 200 | 200 |
| `api.coingecko.com` market_chart, burst of three | 200 | **429** |
| `api.binance.com` klines | 200 | **451**, geo-blocked |
| `data-api.binance.vision` klines | 200 | 200 |
| `api.gateio.ws` candlesticks, burst of three | 200 | 200 |
| `api.bitget.com` index candles | 200 | 200 |

Settlement makes three calls per source in one block, so the burst column is the one
that decides whether a source can vote.

### 2.1.2 Verify before trusting a settlement

`scripts/check_sources.py` hits all nine live URLs over the last completed window and
prints the status, open, close and the winner each source would vote for:

```bash
python scripts/check_sources.py
```

Recorded run, window `1789156800`–`1789158600` (20:00–20:30 UTC):

| Source | ZEC | BNB | SOL | Status | Vote |
| --- | --- | --- | --- | --- | --- |
| Gate | +0.1217% | +0.1517% | +0.4901% | 200 | SOL |
| Bitget | +0.0834% | +0.1519% | +0.4737% | 200 | SOL |
| Binance | +0.0825% | +0.1421% | +0.4705% | 200 | SOL |

Consensus SOL, 3 of 3. The venues disagree on the exact prices, which is the point of
never averaging them, and still agree on the ordering.

### 2.2 Transport rules

Applied identically to all nine requests:

| Rule | Value |
| --- | --- |
| Method | `GET` |
| Accept header | `application/json` |
| Accepted status | `200` only |
| Max response body | 262,144 bytes |
| JSON parsing | `parse_float=str`, `parse_int=str` — numbers keep their exact source text |
| Interval | `30m`, requested explicitly where the API supports it |
| Candle count | exactly 1 where the API supports `limit` |

Anything outside these rules makes the source `UNAVAILABLE`. There is no retry inside a
single settle call.

---

## 3. Parsers

### 3.1 Gate

Response shape, one row:

```json
[["1789156800", "381222.86", "1176.34", "1193.99", "1174", "1174.91", "322.34", "true"]]
```

Gate orders its fields its own way:
`[timestamp_seconds, quote_volume, close, high, low, open, base_volume, closed]`.

Rules:

1. The response must be a list containing exactly one row.
2. The row must have at least six fields.
3. Field 0 is the candle open time **in seconds** and must equal `start` exactly.
4. Field 5 is **open**, field 2 is **close**. Reading them in the usual order would
   swap them and invert every return.
5. Field 7, when present, must be `"true"`: a still-forming candle must not settle a
   window.
6. Reject any non-positive price.

### 3.2 Bitget

Response shape:

```json
{ "code": "00000", "msg": "success", "data": [["1757577600000", "231.4", "232.0", "230.9", "231.8", "..."]] }
```

Rules:

1. `code` must be `00000`.
2. `data` must contain exactly one row.
3. The row must have at least five fields.
4. Field 0 is the candle open time in ms and must equal `start_ms` exactly.
5. Field 1 is **open**, field 4 is **close**.
6. Reject any non-positive price.

### 3.3 Binance

Response shape:

```json
[[1757577600000, "231.40", "232.00", "230.90", "231.80", "...", 1757579399999]]
```

Rules:

1. The response must be a list containing exactly one row.
2. The row must have at least five fields.
3. Field 0 is the kline open time in ms and must equal `start_ms` exactly.
4. Field 1 is **open**, field 4 is **close**.
5. Reject any non-positive price.

### 3.4 Failure vocabulary

When a source fails, evidence records one code from this closed set. The set is closed so
that two honest validators describe the same failure with the same word.

| Code | Meaning |
| --- | --- |
| `http` | non-200 status, or transport failure |
| `size` | body exceeded the 262,144-byte cap |
| `json` | body was not valid JSON |
| `shape` | JSON did not match the documented shape |
| `code` | venue returned a business error code |
| `count` | wrong number of candles |
| `timestamp` | candle open time did not match the window |
| `price` | price missing, non-numeric or non-positive |
| `window` | no sample fell inside `[start, end)` |

---

## 4. Numbers

No floating-point arithmetic occurs at any point in settlement.

| Constant | Value | Meaning |
| --- | --- | --- |
| `PRICE_SCALE` | 10^18 | prices are integers scaled by this |
| `RETURN_SCALE` | 10^6 | returns carry six decimals of percent |

### 4.1 Decimal text to scaled integer

Venue numbers arrive as their original text (`"231.40"`, `231.44`, `1.2e2`). Conversion is
pure integer work: split sign, mantissa and exponent, concatenate the integer and
fractional digits, then shift by `18 - len(fraction) + exponent`. A negative shift rounds
half away from zero. Exponents beyond +/-30 are rejected as `price`.

### 4.2 Return

```
return_units = round_half_away_from_zero((close - open) * 100 * RETURN_SCALE / open)
```

Computed as integers, with `open > 0` guaranteed by the parsers:

```
numerator   = (close - open) * 100 * RETURN_SCALE
denominator = open
positive:  (2 * numerator + denominator) // (2 * denominator)
negative: -((2 * -numerator + denominator) // (2 * denominator))
```

`return_units = 1_250_000` means +1.25%. `-3_000_000` means -3.00%.

Because open and close are both scaled by `PRICE_SCALE`, the scale cancels and the result
is independent of the price magnitude.

---

## 5. Per-source verdict

Each source produces exactly one of three statuses.

| Status | Condition | Votes? |
| --- | --- | --- |
| `VALID` | all three tokens parsed, one strictly highest return | yes, for that token |
| `TIE` | all three tokens parsed, top return shared by two or more | no |
| `UNAVAILABLE` | any token failed to parse | no |

The highest `return_units` wins. If every return is negative, the least negative wins —
this falls out of the comparison and needs no special case. A tie for top is never broken,
not by source order, not by volume, not by alphabet.

### 5.1 Evidence document

Each source's block returns one canonical JSON document. This is the only thing validators
compare, and it is stored verbatim on the market.

```json
{
  "source": "BINANCE",
  "category": "CRYPTO_MAJORS",
  "window_start": 1757577600,
  "window_end": 1757579400,
  "interval": "30m",
  "status": "VALID",
  "winner": "SOL",
  "reason": "",
  "rows": [
    {"asset": "BNB", "open": "612340000000000000000", "close": "613100000000000000000", "return_units": 124108},
    {"asset": "SOL", "open": "231400000000000000000", "close": "232900000000000000000", "return_units": 648228},
    {"asset": "ZEC", "open": "48200000000000000000", "close": "48150000000000000000", "return_units": -103734}
  ]
}
```

Rules that keep it comparable:

* Keys sorted, no whitespace, `rows` sorted by asset symbol.
* Prices are decimal strings of `PRICE_SCALE` integers, never floats.
* `rows` is empty when the status is `UNAVAILABLE`.
* No timestamps of the fetch, no latency, no headers, no request ids — nothing that
  differs between two validators doing the same honest work.

---

## 6. Consensus

Count the `VALID` votes by winning token.

| Situation | Outcome |
| --- | --- |
| 3 sources agree | `SETTLED` on that token |
| 2 sources agree, third differs, ties or is unavailable | `SETTLED` on that token |
| exactly 1 valid vote | no consensus |
| 3 valid votes, all different | no consensus |
| all sources tied or unavailable | no consensus |

With three sources at most one token can reach two votes, so the rule needs no
tie-breaking between candidate winners.

### 6.1 No consensus

The market stays `OPEN`. The attempt counter increases, the evidence from the attempt is
stored so anyone can inspect why it failed, and anyone may call `settle_market` again.

Once `now >= end + 10800` the next `settle_market` call forces `INCONCLUSIVE` without
contacting any venue. All stakes become refundable.

### 6.2 Zero-backed winner

If consensus names a token that nobody staked on, while the market does hold stake:

* the consensus winner is recorded on the market for audit,
* the state becomes `INCONCLUSIVE`,
* every stake becomes refundable at its exact original amount.

Nobody backed the truth, so nobody is paid, and no wallet loses anything.

If the market holds no stake at all, a valid consensus still records `SETTLED`. There are
no liabilities and the result is worth keeping.

---

## 7. Payouts

Pari-mutuel, zero fee.

```
payout = winning_stake * total_pool // winning_pool
```

`total_pool` is every unit staked on the market, winners and losers together.
`winning_pool` is the total staked on the winning token.

Floor division leaves dust. Fluff tracks how many winning wallets exist and how much has
been paid, and hands the **last** successful claimant everything still unclaimed:

```
if claims_done + 1 == winner_backers:
    payout = total_pool - paid_out
```

The pool therefore distributes to the base unit. Nothing is stranded and nothing is
skimmed.

Refunds in `INCONCLUSIVE` return the exact accumulated stake, so the arithmetic is a
straight read of the stored position.

Both paths are pull-based, single-use per wallet per market, and never expire.

---

## 8. Worked example

Window `1757577600` to `1757579400`, which is Thu 11 Sep 2026 09:00–09:30 GMT+1.

Pools: ZEC 40 GEN, BNB 10 GEN, SOL 50 GEN. Total 100 GEN.

| Source | ZEC | BNB | SOL | Status | Vote |
| --- | --- | --- | --- | --- | --- |
| CoinGecko | -0.103734% | +0.124108% | +0.648228% | `VALID` | SOL |
| Bitget | -0.099000% | +0.130000% | +0.651000% | `VALID` | SOL |
| Binance | — | — | — | `UNAVAILABLE` | none |

Two matching votes, SOL has stake, so the market settles on SOL.

A wallet holding 5 GEN of the SOL pool claims `5 * 100 // 50 = 10` GEN. The final SOL
backer to claim receives whatever remains of the 100 GEN, dust included.
