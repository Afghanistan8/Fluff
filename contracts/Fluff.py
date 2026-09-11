# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
Fluff — a permissionless 30-minute token dominance market on GenLayer.

One question per market: which of ZEC, BNB or SOL prints the strongest percentage
return across one exact 30-minute window on the GMT+1 wall clock.

Anyone opens a future window. Betting closes when the window begins. Anyone triggers
settlement once it ends. Three independent reference sources each pick a winner from
their own candles; two matching picks settle the market. Winners split the whole pool
pari-mutuel with no fee of any kind. Without consensus every stake is refundable.

The runner above is pinned to an exact hash on purpose. GenVM refuses the floating
`:latest` and `:test` tags outside debug mode, so a tagged contract is accepted by
consensus and then rejected at load as `invalid_contract`. The hash must match the
GenVM the target network ships; see README, "Which SDK a network runs".

Specification: docs/settlement.md
"""

import datetime
import json
import typing
from dataclasses import dataclass

import genlayer as _genlayer
from genlayer import Address, u8, u32, u256

# The SDK relocated its surface between releases: 0.2 nests everything under
# `genlayer.gl` and exports `allow_storage`, 0.3 lifts the API to the package root
# and renames it `allow`. Resolving both here keeps one source file that deploys on
# the live network and still runs under the pinned local test runner.
gl = getattr(_genlayer, "gl", _genlayer)

try:
    from genlayer.storage import TreeMap, allow
except ImportError:  # SDK 0.2 layout
    from genlayer import TreeMap, allow_storage as allow

_ContractBase = getattr(gl, "Contract", None) or gl.contract.Contract

# --------------------------------------------------------------------------------------
# Protocol constants
# --------------------------------------------------------------------------------------

PROTOCOL_NAME = "Fluff"
PROTOCOL_VERSION = "1.0.0"

WINDOW_SECONDS = 1800
# Fixed GMT+1 all year. Not Europe/Paris, which shifts with daylight saving, and not UTC.
TIMEZONE_LABEL = "GMT+1"
TIMEZONE_OFFSET_SECONDS = 3600
SETTLEMENT_RETRY_WINDOW_SECONDS = 10800

GEN_DECIMALS = 18
GEN_SCALE = 10**18
MIN_BET = 10**18

PRICE_SCALE = 10**18
PRICE_DECIMALS = 18
RETURN_SCALE = 10**6

PAGE_LIMIT = 50
MAX_RESPONSE_BYTES = 262144
MAX_EXPONENT = 30
PROTOCOL_FEE_BPS = 0

CATEGORY_ID = "CRYPTO_MAJORS"
CATEGORY_LABEL = "Crypto Majors"
ASSETS = ("ZEC", "BNB", "SOL")
ASSET_NAMES = {"ZEC": "Zcash", "BNB": "BNB", "SOL": "Solana"}
# Canonical ordering for evidence rows, so two validators serialise them identically.
ASSETS_CANONICAL = ("BNB", "SOL", "ZEC")

SOURCE_GATE = "GATE"
SOURCE_BITGET = "BITGET"
SOURCE_BINANCE = "BINANCE"
SOURCES = (SOURCE_GATE, SOURCE_BITGET, SOURCE_BINANCE)
CONSENSUS_THRESHOLD = 2
CANDLE_INTERVAL = "30m"

STATUS_VALID = "VALID"
STATUS_TIE = "TIE"
STATUS_UNAVAILABLE = "UNAVAILABLE"

STATE_OPEN = 0
STATE_SETTLED = 1
STATE_INCONCLUSIVE = 2
STATE_LABELS = {STATE_OPEN: "OPEN", STATE_SETTLED: "SETTLED", STATE_INCONCLUSIVE: "INCONCLUSIVE"}

PHASE_UPCOMING = "UPCOMING"
PHASE_LIVE = "LIVE"
PHASE_PENDING = "PENDING_SETTLEMENT"

ACTIVITY_KINDS = (
    "MARKET_CREATED",
    "BET_PLACED",
    "BET_TOPPED_UP",
    "MARKET_SETTLED",
    "PAYOUT_CLAIMED",
    "REFUND_CLAIMED",
)
ACT_MARKET_CREATED = 0
ACT_BET_PLACED = 1
ACT_BET_TOPPED_UP = 2
ACT_MARKET_SETTLED = 3
ACT_PAYOUT_CLAIMED = 4
ACT_REFUND_CLAIMED = 5

SETTLE_RESULT_SETTLED = "SETTLED"
SETTLE_RESULT_INCONCLUSIVE = "INCONCLUSIVE"
SETTLE_RESULT_RETRY = "NO_CONSENSUS_RETRY"

# Locked endpoints. Validators never pick alternates and nothing here falls back to HTML.
# CoinGecko used to be the first source. Its free tier rate-limits the burst of three
# calls settlement makes from one IP: a single call returns 200, three in a row return
# 429, so it never voted. Gate serves a public 30-minute spot candle per token with no
# key and answers the same burst, verified from inside a validator.
GATE_URL = (
    "https://api.gateio.ws/api/v4/spot/candlesticks"
    "?currency_pair={asset}_USDT&interval=30m&from={start}&to={end}"
)
BITGET_URL = (
    "https://api.bitget.com/api/v3/market/candles"
    "?category=USDT-FUTURES&symbol={asset}USDT&interval=30m&type=INDEX"
    "&startTime={start_ms}&endTime={end_ms}&limit=1"
)
BITGET_OK_CODE = "00000"
# api.binance.com answers HTTP 451 from GenLayer validator IPs ("Service unavailable
# from a restricted location"), so Binance could never vote. data-api.binance.vision is
# Binance's public market-data host, serves the identical kline payload, and is not
# geo-fenced. Same venue, same parser, a host that answers.
BINANCE_URL = (
    "https://data-api.binance.vision/api/v3/klines"
    "?symbol={asset}USDT&interval=30m&startTime={start_ms}&endTime={end_ms}&limit=1"
)


class FluffError(Exception):
    """Revert carrying a reason the client can show verbatim."""


class _SourceFailure(Exception):
    """One source could not produce usable evidence. `code` comes from a closed set."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise FluffError(message)


# --------------------------------------------------------------------------------------
# Time
# --------------------------------------------------------------------------------------


def _message_raw() -> typing.Any:
    """The raw message dict, under either SDK layout."""
    raw = getattr(gl, "message_raw", None)
    return gl.message.raw if raw is None else raw


def _pay(recipient: Address, amount: int) -> None:
    """Send native GEN, under either SDK layout.

    Applied on `accepted` rather than the `finalized` default. A transfer queued for
    finalization did not reach the wallet within twenty minutes on this network, while
    the contract had already marked the claim used, which leaves a claimant with
    nothing to re-pull. The state change and the transfer belong to the same
    transaction, so if it is rolled back both go together.
    """
    get_at = getattr(gl, "get_contract_at", None)
    if get_at is None:
        get_at = gl.contract.get_at
    get_at(recipient).emit_transfer(value=amount, on="accepted")


def _now() -> int:
    """Epoch seconds from the deterministic transaction datetime GenVM supplies."""
    stamp = _message_raw()["datetime"]
    if isinstance(stamp, str):
        text = stamp.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        stamp = datetime.datetime.fromisoformat(text)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=datetime.timezone.utc)
    return int(stamp.timestamp())


def _is_aligned(market_start: int) -> bool:
    """True when the start lands on :00 or :30 of the GMT+1 wall clock.

    The offset is a whole number of half hours, so this also holds against UTC. The
    offset stays written out because the rule is about the GMT+1 clock.
    """
    return (market_start + TIMEZONE_OFFSET_SECONDS) % WINDOW_SECONDS == 0


# --------------------------------------------------------------------------------------
# Integer maths. No floating point touches settlement at any point.
# --------------------------------------------------------------------------------------


def _div_round_half_away(numerator: int, denominator: int) -> int:
    """Divide with half-away-from-zero rounding. `denominator` must be positive."""
    if numerator >= 0:
        return (2 * numerator + denominator) // (2 * denominator)
    return -((2 * -numerator + denominator) // (2 * denominator))


def _decimal_to_scaled(text: str) -> int:
    """Exact decimal text to an integer scaled by PRICE_SCALE, without floats."""
    body = text.strip()
    if not body:
        raise _SourceFailure("price")
    negative = False
    if body[0] in "+-":
        negative = body[0] == "-"
        body = body[1:]
    exponent = 0
    for marker in ("e", "E"):
        if marker in body:
            body, exponent_text = body.split(marker, 1)
            exponent_text = exponent_text.strip()
            sign = 1
            if exponent_text[:1] in "+-":
                sign = -1 if exponent_text[0] == "-" else 1
                exponent_text = exponent_text[1:]
            if not exponent_text.isdigit():
                raise _SourceFailure("price")
            exponent = sign * int(exponent_text)
            if abs(exponent) > MAX_EXPONENT:
                raise _SourceFailure("price")
            break
    whole, _, fraction = body.partition(".")
    digits = whole + fraction
    if not digits.isdigit():
        raise _SourceFailure("price")
    shift = PRICE_DECIMALS - len(fraction) + exponent
    value = int(digits)
    if shift >= 0:
        value = value * 10**shift
    else:
        value = _div_round_half_away(value, 10**-shift)
    return -value if negative else value


def _return_units(open_price: int, close_price: int) -> int:
    """Percentage return scaled by RETURN_SCALE, six decimals of percent."""
    return _div_round_half_away((close_price - open_price) * 100 * RETURN_SCALE, open_price)


# --------------------------------------------------------------------------------------
# Evidence collection. Every fetch below runs inside a strict-equality block.
# --------------------------------------------------------------------------------------


def _to_int(raw: typing.Any) -> int:
    if not isinstance(raw, str):
        raise _SourceFailure("shape")
    text = raw.strip()
    if not text or not text.lstrip("-").isdigit():
        raise _SourceFailure("shape")
    return int(text)


def _to_price(raw: typing.Any) -> int:
    if not isinstance(raw, str):
        raise _SourceFailure("price")
    value = _decimal_to_scaled(raw)
    if value <= 0:
        raise _SourceFailure("price")
    return value


def _http_json(url: str) -> typing.Any:
    try:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
    except Exception:
        raise _SourceFailure("http")
    if response.status != 200:
        raise _SourceFailure("http")
    body = response.body or b""
    if len(body) > MAX_RESPONSE_BYTES:
        raise _SourceFailure("size")
    try:
        # parse_float/parse_int keep every number as its original text, so the decimal
        # parser can convert it exactly rather than through a float.
        return json.loads(body.decode("utf-8"), parse_float=str, parse_int=str)
    except _SourceFailure:
        raise
    except Exception:
        raise _SourceFailure("json")


def _single_row_candle(rows: typing.Any, start_ms: int) -> tuple[int, int]:
    """Open and close from a venue that returns one completed candle row."""
    if not isinstance(rows, list):
        raise _SourceFailure("shape")
    if len(rows) != 1:
        raise _SourceFailure("count")
    row = rows[0]
    if not isinstance(row, list) or len(row) < 5:
        raise _SourceFailure("shape")
    if _to_int(row[0]) != start_ms:
        raise _SourceFailure("timestamp")
    return _to_price(row[1]), _to_price(row[4])


def _gate_candle(asset: str, start: int, end: int) -> tuple[int, int]:
    """Gate returns one row per window, and orders its fields its own way.

    `[timestamp_seconds, quote_volume, close, high, low, open, base_volume, closed]`,
    so open is field 5 and close is field 2. The timestamp is seconds, not milliseconds.
    """
    payload = _http_json(GATE_URL.format(asset=asset, start=start, end=end - 1))
    if not isinstance(payload, list):
        raise _SourceFailure("shape")
    if len(payload) != 1:
        raise _SourceFailure("count")
    row = payload[0]
    if not isinstance(row, list) or len(row) < 6:
        raise _SourceFailure("shape")
    if _to_int(row[0]) != start:
        raise _SourceFailure("timestamp")
    # Field 7 marks a completed candle; a partial one must not settle a window.
    if len(row) >= 8 and row[7] != "true":
        raise _SourceFailure("count")
    return _to_price(row[5]), _to_price(row[2])


def _bitget_candle(asset: str, start: int, end: int) -> tuple[int, int]:
    payload = _http_json(
        BITGET_URL.format(asset=asset, start_ms=start * 1000, end_ms=end * 1000 - 1)
    )
    if not isinstance(payload, dict):
        raise _SourceFailure("shape")
    if payload.get("code") != BITGET_OK_CODE:
        raise _SourceFailure("code")
    return _single_row_candle(payload.get("data"), start * 1000)


def _binance_candle(asset: str, start: int, end: int) -> tuple[int, int]:
    payload = _http_json(
        BINANCE_URL.format(asset=asset, start_ms=start * 1000, end_ms=end * 1000 - 1)
    )
    return _single_row_candle(payload, start * 1000)


def _source_candle(source: str, asset: str, start: int, end: int) -> tuple[int, int]:
    if source == SOURCE_GATE:
        return _gate_candle(asset, start, end)
    if source == SOURCE_BITGET:
        return _bitget_candle(asset, start, end)
    return _binance_candle(asset, start, end)


def _evidence_document(
    source: str,
    start: int,
    end: int,
    status: str,
    winner: str,
    reason: str,
    rows: list,
) -> str:
    """Canonical JSON. This is the only value validators compare for a source."""
    return json.dumps(
        {
            "source": source,
            "category": CATEGORY_ID,
            "window_start": start,
            "window_end": end,
            "interval": CANDLE_INTERVAL,
            "status": status,
            "winner": winner,
            "reason": reason,
            "rows": rows,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _collect_source(source: str, start: int, end: int) -> str:
    """Read one source's own candles and let it pick its own winner.

    Returns evidence for every outcome including failure, so the block never throws and
    a single unreachable venue cannot roll back the settlement transaction.
    """
    rows: list = []
    try:
        for asset in ASSETS_CANONICAL:
            open_price, close_price = _source_candle(source, asset, start, end)
            rows.append(
                {
                    "asset": asset,
                    "open": str(open_price),
                    "close": str(close_price),
                    "return_units": _return_units(open_price, close_price),
                }
            )
    except _SourceFailure as failure:
        return _evidence_document(source, start, end, STATUS_UNAVAILABLE, "", failure.code, [])
    except Exception:
        return _evidence_document(source, start, end, STATUS_UNAVAILABLE, "", "shape", [])
    best = max(row["return_units"] for row in rows)
    leaders = [row["asset"] for row in rows if row["return_units"] == best]
    if len(leaders) != 1:
        return _evidence_document(source, start, end, STATUS_TIE, "", "", rows)
    return _evidence_document(source, start, end, STATUS_VALID, leaders[0], "", rows)


def _read_vote(document: str) -> str:
    """Winning asset a stored evidence document votes for, or empty for no vote."""
    try:
        parsed = json.loads(document)
    except Exception:
        return ""
    if parsed.get("status") != STATUS_VALID:
        return ""
    winner = parsed.get("winner")
    if isinstance(winner, str) and winner in ASSETS:
        return winner
    return ""


# --------------------------------------------------------------------------------------
# Storage records
# --------------------------------------------------------------------------------------


@allow
@dataclass
class Position:
    asset: str
    amount: u256
    claimed: bool
    refunded: bool


@allow
@dataclass
class ActivityRecord:
    kind: u8
    market_id: u256
    asset: str
    amount: u256
    at: u256


@allow
@dataclass
class Market:
    id: u256
    category: str
    market_start: u256
    market_end: u256
    creator: Address
    created_at: u256
    state: u8
    winner: str
    consensus_winner: str
    consensus_votes: u8
    total_pool: u256
    winner_pool: u256
    winner_backers: u256
    paid_out: u256
    claims_done: u256
    bettor_count: u256
    settled_at: u256
    settler: Address
    settle_attempts: u32
    last_attempt_at: u256
    pools: TreeMap[str, u256]
    backers: TreeMap[str, u256]
    evidence: TreeMap[str, str]


# --------------------------------------------------------------------------------------
# Contract
# --------------------------------------------------------------------------------------


class Fluff(_ContractBase):
    markets: TreeMap[u256, Market]
    open_ids: TreeMap[u256, u8]
    start_index: TreeMap[str, u256]
    positions: TreeMap[u256, TreeMap[Address, Position]]
    wallet_markets: TreeMap[Address, TreeMap[u256, u8]]
    activity: TreeMap[Address, TreeMap[u256, ActivityRecord]]
    activity_count: TreeMap[Address, u256]
    next_market_id: u256
    market_count: u256

    def __init__(self):
        self.next_market_id = 1
        self.market_count = 0

    # -- internal helpers ---------------------------------------------------------------

    def _market(self, market_id: u256) -> Market:
        market = self.markets.get(market_id)
        _require(market is not None, "unknown market")
        return market  # type: ignore[return-value]

    def _phase(self, market: Market, now: int) -> str:
        if market.state == STATE_SETTLED:
            return STATE_LABELS[STATE_SETTLED]
        if market.state == STATE_INCONCLUSIVE:
            return STATE_LABELS[STATE_INCONCLUSIVE]
        if now < market.market_start:
            return PHASE_UPCOMING
        if now < market.market_end:
            return PHASE_LIVE
        return PHASE_PENDING

    def _record(self, wallet: Address, kind: int, market_id: int, asset: str, amount: int, at: int) -> None:
        sequence = self.activity_count.get(wallet, 0)
        record = self.activity.get_or_insert_default(wallet).get_or_insert_default(sequence)
        record.kind = kind
        record.market_id = market_id
        record.asset = asset
        record.amount = amount
        record.at = at
        self.activity_count[wallet] = sequence + 1

    def _close(self, market: Market, state: int, winner: str, votes: int, now: int, settler: Address) -> None:
        market.state = state
        market.winner = winner
        market.consensus_votes = votes
        market.settled_at = now
        market.settler = settler
        if winner:
            market.winner_pool = market.pools.get(winner, 0)
            market.winner_backers = market.backers.get(winner, 0)
        if market.id in self.open_ids:
            del self.open_ids[market.id]

    def _market_view(self, market: Market, now: int) -> dict[str, typing.Any]:
        pools = {asset: int(market.pools.get(asset, 0)) for asset in ASSETS}
        backers = {asset: int(market.backers.get(asset, 0)) for asset in ASSETS}
        phase = self._phase(market, now)
        return {
            "id": int(market.id),
            "category": market.category,
            "category_label": CATEGORY_LABEL,
            "assets": list(ASSETS),
            "market_start": int(market.market_start),
            "market_end": int(market.market_end),
            "timezone": TIMEZONE_LABEL,
            "state": STATE_LABELS[int(market.state)],
            "phase": phase,
            "betting_open": phase == PHASE_UPCOMING,
            "winner": market.winner,
            "consensus_winner": market.consensus_winner,
            "consensus_votes": int(market.consensus_votes),
            "total_pool": int(market.total_pool),
            "pools": pools,
            "backers": backers,
            "bettor_count": int(market.bettor_count),
            "winner_pool": int(market.winner_pool),
            "winner_backers": int(market.winner_backers),
            "paid_out": int(market.paid_out),
            "claims_done": int(market.claims_done),
            "creator": market.creator,
            "created_at": int(market.created_at),
            "settled_at": int(market.settled_at),
            "settler": market.settler,
            "settle_attempts": int(market.settle_attempts),
            "last_attempt_at": int(market.last_attempt_at),
            "settlement_deadline": int(market.market_end) + SETTLEMENT_RETRY_WINDOW_SECONDS,
            "now": now,
        }

    def _position_view(self, market: Market, wallet: Address, now: int) -> dict[str, typing.Any]:
        position = self.positions.get_or_insert_default(market.id).get(wallet)
        asset = position.asset if position is not None else ""
        amount = int(position.amount) if position is not None else 0
        claimed = bool(position.claimed) if position is not None else False
        refunded = bool(position.refunded) if position is not None else False
        won = bool(market.state == STATE_SETTLED and asset and asset == market.winner)
        claimable = 0
        if won and not claimed and market.winner_pool > 0:
            if int(market.claims_done) + 1 == int(market.winner_backers):
                claimable = int(market.total_pool) - int(market.paid_out)
            else:
                claimable = amount * int(market.total_pool) // int(market.winner_pool)
        refundable = amount if (market.state == STATE_INCONCLUSIVE and not refunded) else 0
        return {
            "market_id": int(market.id),
            "wallet": wallet,
            "asset": asset,
            "amount": amount,
            "claimed": claimed,
            "refunded": refunded,
            "won": won,
            "claimable": claimable,
            "refundable": refundable,
            "phase": self._phase(market, now),
            "state": STATE_LABELS[int(market.state)],
            "market_start": int(market.market_start),
            "market_end": int(market.market_end),
            "winner": market.winner,
            "total_pool": int(market.total_pool),
            "winner_pool": int(market.winner_pool),
        }

    # -- reads --------------------------------------------------------------------------

    @gl.public.view
    def get_config(self) -> dict[str, typing.Any]:
        return {
            "protocol": PROTOCOL_NAME,
            "version": PROTOCOL_VERSION,
            "protocol_fee_bps": PROTOCOL_FEE_BPS,
            "creator_fee_bps": 0,
            "settlement_fee_bps": 0,
            "min_bet": MIN_BET,
            "window_seconds": WINDOW_SECONDS,
            "timezone": TIMEZONE_LABEL,
            "timezone_offset_seconds": TIMEZONE_OFFSET_SECONDS,
            "sources": list(SOURCES),
            "consensus_threshold": CONSENSUS_THRESHOLD,
            "consensus_rule": "2-of-3",
            "settlement_retry_window_seconds": SETTLEMENT_RETRY_WINDOW_SECONDS,
            "candle_interval": CANDLE_INTERVAL,
            "categories": [CATEGORY_ID],
            "category_label": CATEGORY_LABEL,
            "assets": list(ASSETS),
            "asset_names": dict(ASSET_NAMES),
            "price_scale": PRICE_SCALE,
            "return_scale": RETURN_SCALE,
            "gen_decimals": GEN_DECIMALS,
            "gen_scale": GEN_SCALE,
            "page_limit": PAGE_LIMIT,
            "market_count": int(self.market_count),
            "now": _now(),
        }

    @gl.public.view
    def categories(self) -> list[dict[str, typing.Any]]:
        return [{"id": CATEGORY_ID, "label": CATEGORY_LABEL, "assets": list(ASSETS)}]

    @gl.public.view
    def category_assets(self, category: str) -> list[dict[str, typing.Any]]:
        _require(category == CATEGORY_ID, "unknown category")
        return [{"symbol": asset, "name": ASSET_NAMES[asset]} for asset in ASSETS]

    @gl.public.view
    def get_market(self, market_id: u256) -> dict[str, typing.Any]:
        return self._market_view(self._market(market_id), _now())

    @gl.public.view
    def get_markets(self, offset: u256, limit: u256) -> list[dict[str, typing.Any]]:
        """Newest first. Ids are contiguous, so this needs no scan."""
        now = _now()
        total = int(self.market_count)
        taken = min(int(limit), PAGE_LIMIT)
        out: list[dict[str, typing.Any]] = []
        index = int(offset)
        while len(out) < taken and index < total:
            market = self.markets.get(total - index)
            if market is not None:
                out.append(self._market_view(market, now))
            index += 1
        return out

    @gl.public.view
    def get_open_markets(self, offset: u256, limit: u256) -> list[dict[str, typing.Any]]:
        """Markets still in state OPEN, ascending by id."""
        now = _now()
        taken = min(int(limit), PAGE_LIMIT)
        skip = int(offset)
        out: list[dict[str, typing.Any]] = []
        for market_id in self.open_ids:
            if skip > 0:
                skip -= 1
                continue
            if len(out) >= taken:
                break
            market = self.markets.get(market_id)
            if market is not None:
                out.append(self._market_view(market, now))
        return out

    @gl.public.view
    def get_betting_state(self, market_id: u256) -> dict[str, typing.Any]:
        market = self._market(market_id)
        now = _now()
        start = int(market.market_start)
        end = int(market.market_end)
        phase = self._phase(market, now)
        return {
            "market_id": int(market.id),
            "now": now,
            "market_start": start,
            "market_end": end,
            "phase": phase,
            "state": STATE_LABELS[int(market.state)],
            "betting_open": phase == PHASE_UPCOMING,
            "seconds_until_start": max(0, start - now),
            "seconds_until_end": max(0, end - now),
            "settleable": market.state == STATE_OPEN and now >= end,
            "settlement_deadline": end + SETTLEMENT_RETRY_WINDOW_SECONDS,
            "past_deadline": now >= end + SETTLEMENT_RETRY_WINDOW_SECONDS,
            "min_bet": MIN_BET,
        }

    @gl.public.view
    def get_user_position(self, market_id: u256, user: Address) -> dict[str, typing.Any]:
        return self._position_view(self._market(market_id), user, _now())

    @gl.public.view
    def get_user_positions(self, user: Address, offset: u256, limit: u256) -> list[dict[str, typing.Any]]:
        now = _now()
        taken = min(int(limit), PAGE_LIMIT)
        skip = int(offset)
        out: list[dict[str, typing.Any]] = []
        for market_id in self.wallet_markets.get_or_insert_default(user):
            if skip > 0:
                skip -= 1
                continue
            if len(out) >= taken:
                break
            market = self.markets.get(market_id)
            if market is not None:
                out.append(self._position_view(market, user, now))
        return out

    @gl.public.view
    def get_claimable_markets(self, user: Address, offset: u256, limit: u256) -> list[dict[str, typing.Any]]:
        now = _now()
        taken = min(int(limit), PAGE_LIMIT)
        skip = int(offset)
        out: list[dict[str, typing.Any]] = []
        for market_id in self.wallet_markets.get_or_insert_default(user):
            if len(out) >= taken:
                break
            market = self.markets.get(market_id)
            if market is None:
                continue
            view = self._position_view(market, user, now)
            if view["claimable"] <= 0 and view["refundable"] <= 0:
                continue
            if skip > 0:
                skip -= 1
                continue
            view["action"] = "CLAIM" if view["claimable"] > 0 else "REFUND"
            out.append(view)
        return out

    @gl.public.view
    def get_market_by_category_start(self, category: str, market_start: u256) -> dict[str, typing.Any]:
        stored = self.start_index.get(f"{category}|{int(market_start)}", 0)
        return {
            "exists": stored > 0,
            "market_id": int(stored) - 1 if stored > 0 else 0,
            "category": category,
            "market_start": int(market_start),
            "aligned": _is_aligned(int(market_start)),
        }

    @gl.public.view
    def get_source_evidence(self, market_id: u256) -> list[dict[str, typing.Any]]:
        market = self._market(market_id)
        out: list[dict[str, typing.Any]] = []
        for source in SOURCES:
            document = market.evidence.get(source, "")
            out.append(
                {
                    "source": source,
                    "document": document,
                    "vote": _read_vote(document) if document else "",
                    "has_evidence": bool(document),
                }
            )
        return out

    @gl.public.view
    def get_user_activity_count(self, user: Address) -> u256:
        return self.activity_count.get(user, 0)

    @gl.public.view
    def get_user_activity(self, user: Address, offset: u256, limit: u256) -> list[dict[str, typing.Any]]:
        """Newest first."""
        total = int(self.activity_count.get(user, 0))
        taken = min(int(limit), PAGE_LIMIT)
        feed = self.activity.get_or_insert_default(user)
        out: list[dict[str, typing.Any]] = []
        index = int(offset)
        while len(out) < taken and index < total:
            record = feed.get(total - 1 - index)
            if record is not None:
                out.append(
                    {
                        "kind": ACTIVITY_KINDS[int(record.kind)],
                        "market_id": int(record.market_id),
                        "asset": record.asset,
                        "amount": int(record.amount),
                        "at": int(record.at),
                    }
                )
            index += 1
        return out

    # -- writes -------------------------------------------------------------------------

    @gl.public.write
    def create_market(self, category: str, market_start: u256) -> u256:
        _require(category == CATEGORY_ID, "unknown category")
        now = _now()
        start = int(market_start)
        _require(start > now, "market_start must be in the future")
        _require(_is_aligned(start), "market_start must land on :00 or :30 GMT+1")
        key = f"{category}|{start}"
        _require(self.start_index.get(key, 0) == 0, "market already exists for this window")

        market_id = int(self.next_market_id)
        market = self.markets.get_or_insert_default(market_id)
        market.id = market_id
        market.category = category
        market.market_start = start
        market.market_end = start + WINDOW_SECONDS
        market.creator = gl.message.sender_address
        market.created_at = now
        market.state = STATE_OPEN
        market.winner = ""
        market.consensus_winner = ""
        for asset in ASSETS:
            market.pools[asset] = 0
            market.backers[asset] = 0

        self.start_index[key] = market_id + 1
        self.open_ids[market_id] = 1
        self.next_market_id = market_id + 1
        self.market_count = market_id
        self._record(gl.message.sender_address, ACT_MARKET_CREATED, market_id, "", 0, now)
        return market_id

    @gl.public.write.payable
    def place_bet(self, market_id: u256, asset: str) -> None:
        _require(asset in ASSETS, "unknown asset")
        market = self._market(market_id)
        _require(market.state == STATE_OPEN, "market is not open")
        now = _now()
        _require(now < int(market.market_start), "betting closed for this window")
        amount = int(gl.message.value)
        _require(amount >= MIN_BET, "minimum bet is 1 GEN")

        wallet = gl.message.sender_address
        book = self.positions.get_or_insert_default(int(market.id))
        existing = book.get(wallet)
        topping_up = existing is not None and int(existing.amount) > 0
        if topping_up:
            _require(existing.asset == asset, "wallet already backs another token")
        position = book.get_or_insert_default(wallet)
        if not topping_up:
            position.asset = asset
            position.amount = 0
            position.claimed = False
            position.refunded = False
            market.backers[asset] = market.backers.get(asset, 0) + 1
            market.bettor_count = int(market.bettor_count) + 1
            self.wallet_markets.get_or_insert_default(wallet)[int(market.id)] = 1

        position.amount = int(position.amount) + amount
        market.pools[asset] = market.pools.get(asset, 0) + amount
        market.total_pool = int(market.total_pool) + amount
        self._record(
            wallet,
            ACT_BET_TOPPED_UP if topping_up else ACT_BET_PLACED,
            int(market.id),
            asset,
            amount,
            now,
        )

    @gl.public.write
    def settle_market(self, market_id: u256) -> str:
        market = self._market(market_id)
        _require(market.state == STATE_OPEN, "market already resolved")
        now = _now()
        start = int(market.market_start)
        end = int(market.market_end)
        _require(now >= end, "window has not ended")

        settler = gl.message.sender_address
        market.settle_attempts = int(market.settle_attempts) + 1
        market.last_attempt_at = now

        # Past the retry deadline the market resolves without contacting any venue, so it
        # can never hang on an endpoint that stays unreachable.
        if now >= end + SETTLEMENT_RETRY_WINDOW_SECONDS:
            self._close(market, STATE_INCONCLUSIVE, "", 0, now, settler)
            self._record(settler, ACT_MARKET_SETTLED, int(market.id), "", 0, now)
            return SETTLE_RESULT_INCONCLUSIVE

        tally: dict[str, int] = {}
        for source in SOURCES:
            # Named rather than inline so the equivalence block is its own scope: it
            # reads the web and touches no storage, which is what validators re-run.
            def read_evidence(source=source, start=start, end=end) -> str:
                return _collect_source(source, start, end)

            document = gl.eq_principle.strict_eq(read_evidence)
            market.evidence[source] = document
            vote = _read_vote(document)
            if vote:
                tally[vote] = tally.get(vote, 0) + 1

        winner = ""
        votes = 0
        for asset, count in tally.items():
            if count >= CONSENSUS_THRESHOLD and count > votes:
                winner = asset
                votes = count

        if not winner:
            # Leave the market open so anyone can retry until the deadline.
            return SETTLE_RESULT_RETRY

        market.consensus_winner = winner
        if int(market.total_pool) > 0 and int(market.pools.get(winner, 0)) == 0:
            # Consensus is sound but nobody backed it. Keep it on record for audit and
            # make every stake refundable rather than paying an empty outcome.
            self._close(market, STATE_INCONCLUSIVE, "", votes, now, settler)
            self._record(settler, ACT_MARKET_SETTLED, int(market.id), winner, 0, now)
            return SETTLE_RESULT_INCONCLUSIVE

        self._close(market, STATE_SETTLED, winner, votes, now, settler)
        self._record(settler, ACT_MARKET_SETTLED, int(market.id), winner, 0, now)
        return SETTLE_RESULT_SETTLED

    @gl.public.write
    def claim(self, market_id: u256) -> None:
        market = self._market(market_id)
        _require(market.state == STATE_SETTLED, "market is not settled")
        wallet = gl.message.sender_address
        position = self.positions.get_or_insert_default(int(market.id)).get(wallet)
        _require(position is not None and int(position.amount) > 0, "no position in this market")
        _require(not position.claimed, "already claimed")
        _require(position.asset == market.winner, "position did not back the winner")

        winner_pool = int(market.winner_pool)
        _require(winner_pool > 0, "nothing to claim")
        position.claimed = True
        claims_done = int(market.claims_done) + 1
        market.claims_done = claims_done
        if claims_done == int(market.winner_backers):
            # Last winner out sweeps the rounding dust, so the pool distributes exactly.
            payout = int(market.total_pool) - int(market.paid_out)
        else:
            payout = int(position.amount) * int(market.total_pool) // winner_pool
        market.paid_out = int(market.paid_out) + payout
        self._record(wallet, ACT_PAYOUT_CLAIMED, int(market.id), position.asset, payout, _now())
        _pay(wallet, payout)

    @gl.public.write
    def claim_refund(self, market_id: u256) -> None:
        market = self._market(market_id)
        _require(market.state == STATE_INCONCLUSIVE, "market is not inconclusive")
        wallet = gl.message.sender_address
        position = self.positions.get_or_insert_default(int(market.id)).get(wallet)
        _require(position is not None and int(position.amount) > 0, "no position in this market")
        _require(not position.refunded, "already refunded")

        amount = int(position.amount)
        position.refunded = True
        market.paid_out = int(market.paid_out) + amount
        self._record(wallet, ACT_REFUND_CLAIMED, int(market.id), position.asset, amount, _now())
        _pay(wallet, amount)
