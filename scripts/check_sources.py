#!/usr/bin/env python3
"""Hit the three locked settlement endpoints and report what they actually return.

Note: this runs from wherever you run it. A GenLayer validator sees a different
internet. api.binance.com answers 451 from validator IPs and CoinGecko rate-limits the
burst, neither of which reproduces on a laptop. See docs/settlement.md.

Run this before trusting a settlement. It uses the last fully completed 30-minute
window, the same bounds the contract uses, and prints the HTTP status, the parsed
open/close and the winner each source would vote for.

    python scripts/check_sources.py

Exit code is 0 when at least two sources produced a usable candle set for all three
tokens, which is what the contract needs to settle.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

WINDOW_SECONDS = 1800
TOKENS = ("ZEC", "BNB", "SOL")
HEADERS = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (fluff source check)"}
TIMEOUT = 45


def fetch(url: str) -> tuple[int | None, object]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=TIMEOUT) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as error:
        return error.code, None
    except Exception as error:  # noqa: BLE001 - the point is to report whatever broke
        return None, f"{type(error).__name__}: {error}"


def pct(open_price: float, close_price: float) -> float:
    return (close_price - open_price) * 100 / open_price


def gate(token: str, start: int, end: int) -> tuple[int | None, tuple[float, float] | None, str]:
    """Gate orders its fields [ts, quote_volume, close, high, low, open, ...]."""
    url = (
        "https://api.gateio.ws/api/v4/spot/candlesticks"
        f"?currency_pair={token}_USDT&interval=30m&from={start}&to={end - 1}"
    )
    status, body = fetch(url)
    if status != 200 or not isinstance(body, list):
        return status, None, "http"
    if len(body) != 1:
        return status, None, "count"
    row = body[0]
    if int(row[0]) != start:
        return status, None, "timestamp"
    return status, (float(row[5]), float(row[2])), ""


def bitget(token: str, start: int, end: int) -> tuple[int | None, tuple[float, float] | None, str]:
    url = (
        "https://api.bitget.com/api/v3/market/candles?category=USDT-FUTURES"
        f"&symbol={token}USDT&interval=30m&type=INDEX"
        f"&startTime={start * 1000}&endTime={end * 1000 - 1}&limit=1"
    )
    status, body = fetch(url)
    if status != 200 or not isinstance(body, dict):
        return status, None, "http"
    if body.get("code") != "00000":
        return status, None, "code"
    rows = body.get("data") or []
    if len(rows) != 1:
        return status, None, "count"
    return status, (float(rows[0][1]), float(rows[0][4])), ""


def binance(token: str, start: int, end: int) -> tuple[int | None, tuple[float, float] | None, str]:
    url = (
        "https://data-api.binance.vision/api/v3/klines"
        f"?symbol={token}USDT&interval=30m&startTime={start * 1000}&endTime={end * 1000 - 1}&limit=1"
    )
    status, body = fetch(url)
    if status != 200 or not isinstance(body, list):
        return status, None, "http"
    if len(body) != 1:
        return status, None, "count"
    return status, (float(body[0][1]), float(body[0][4])), ""


SOURCES = {"GATE": gate, "BITGET": bitget, "BINANCE": binance}


def main() -> int:
    now = int(time.time())
    end = now - (now % WINDOW_SECONDS)
    start = end - WINDOW_SECONDS
    span = f"{time.strftime('%H:%M', time.gmtime(start))}-{time.strftime('%H:%M UTC', time.gmtime(end))}"
    print(f"window {start} -> {end}  ({span})\n")

    votes: dict[str, str] = {}
    for name, reader in SOURCES.items():
        returns: dict[str, float] = {}
        failed = ""
        statuses = set()
        for token in TOKENS:
            status, candle, reason = reader(token, start, end)
            statuses.add(status)
            if candle is None:
                failed = reason or "http"
                print(f"  {name:10} {token:4} HTTP {status}  UNAVAILABLE ({failed})")
                continue
            returns[token] = pct(*candle)
            print(f"  {name:10} {token:4} HTTP {status}  open={candle[0]:<12.4f} close={candle[1]:<12.4f} {returns[token]:+.4f}%")

        if len(returns) != len(TOKENS):
            votes[name] = "UNAVAILABLE"
        else:
            best = max(returns.values())
            leaders = [t for t, v in returns.items() if v == best]
            votes[name] = leaders[0] if len(leaders) == 1 else "TIE"
        print(f"  {name:10} -> {votes[name]}\n")

    tally: dict[str, int] = {}
    for vote in votes.values():
        if vote not in ("UNAVAILABLE", "TIE"):
            tally[vote] = tally.get(vote, 0) + 1
    winner = next((token for token, count in tally.items() if count >= 2), None)

    print("votes:", votes)
    print("consensus:", f"{winner} ({tally.get(winner, 0)}/3)" if winner else "none, market would be INCONCLUSIVE")
    return 0 if winner else 1


if __name__ == "__main__":
    sys.exit(main())
