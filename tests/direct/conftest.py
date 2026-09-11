"""Direct-test wiring.

These tests run `contracts/Fluff.py` natively against the real GenLayer SDK through
`gltest.direct`: real storage encoding, real calldata, real equivalence blocks. Only the
outside world is simulated — the clock, the sender, the transaction value, native
transfers and the three venue endpoints.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
from pathlib import Path

import pytest
from gltest.direct import VMContext, create_address, deploy_contract

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "Fluff.py"

# gltest's mocked VM only works with the SDK generation it was built against, so the
# suite is pinned there rather than left on "latest", which resolves differently
# depending on what happens to be in the local cache. The contract is compatible with
# the newer SDK the live network runs; test_live_compile.py checks that against a node.
SDK_VERSION = os.environ.get("FLUFF_SDK_VERSION", "v0.2.16")

WINDOW = 1800
RETRY_WINDOW = 10800
GEN = 10**18
CATEGORY = "CRYPTO_MAJORS"
ASSETS = ("ZEC", "BNB", "SOL")
SOURCES = ("GATE", "BITGET", "BINANCE")
HOSTS = {
    "GATE": "api.gateio.ws",
    "BITGET": "api.bitget.com",
    "BINANCE": "data-api.binance.vision",
}

# Thu 01 Jan 2026 00:00:00 UTC — itself an exact half-hour boundary.
BASE_TIME = 1_767_225_600


def iso(epoch_seconds: int) -> str:
    return datetime.datetime.fromtimestamp(epoch_seconds, datetime.timezone.utc).isoformat()


def aligned_start(after: int) -> int:
    """First GMT+1 half-hour boundary strictly after `after`."""
    candidate = after - (after % WINDOW) + WINDOW
    while candidate <= after:
        candidate += WINDOW
    return candidate


# --------------------------------------------------------------------------------------
# Venue response bodies
# --------------------------------------------------------------------------------------


def gate_body(start: int, open_price: str, close_price: str) -> str:
    """Gate orders its fields its own way and stamps in seconds, not milliseconds.

    `[timestamp, quote_volume, close, high, low, open, base_volume, closed]`, so a
    parser that assumed the usual open-high-low-close order would read this backwards.
    """
    row = [str(start), "1000.0", close_price, close_price, open_price, open_price, "10.0", "true"]
    return json.dumps([row])


def bitget_body(start: int, open_price: str, close_price: str) -> str:
    return json.dumps(
        {
            "code": "00000",
            "msg": "success",
            "data": [[str(start * 1000), open_price, "0", "0", close_price, "10"]],
        }
    )


def binance_body(start: int, open_price: str, close_price: str) -> str:
    return json.dumps(
        [[start * 1000, open_price, "0", "0", close_price, "10", (start + WINDOW) * 1000 - 1]]
    )


BODY_BUILDERS = {
    "GATE": gate_body,
    "BITGET": bitget_body,
    "BINANCE": binance_body,
}


def url_fragment(source: str, asset: str) -> str:
    if source == "GATE":
        return f"api.gateio.ws/api/v4/spot/candlesticks?currency_pair={asset}_USDT"
    if source == "BITGET":
        return f"api.bitget.com/api/v3/market/candles?category=USDT-FUTURES&symbol={asset}USDT"
    return f"data-api.binance.vision/api/v3/klines?symbol={asset}USDT"


class Broken:
    """A source that answers every request with an HTTP failure."""

    def __init__(self, status: int = 503, body: str = "upstream unavailable"):
        self.status = status
        self.body = body


class Raw:
    """A source that answers every request with a literal body."""

    def __init__(self, body: str, status: int = 200):
        self.status = status
        self.body = body


# Price sets used across the settlement tests. Returns are exact by construction.
WINS_SOL = {"ZEC": ("100", "99"), "BNB": ("100", "100.5"), "SOL": ("100", "102")}
WINS_BNB = {"ZEC": ("100", "99"), "BNB": ("100", "103"), "SOL": ("100", "102")}
WINS_ZEC = {"ZEC": ("100", "105"), "BNB": ("100", "103"), "SOL": ("100", "102")}
# Different price levels, same ordering: proves sources are read independently.
WINS_SOL_OTHER_LEVEL = {"ZEC": ("250", "247.5"), "BNB": ("250", "251.25"), "SOL": ("250", "255")}
ALL_NEGATIVE = {"ZEC": ("100", "98"), "BNB": ("100", "99"), "SOL": ("100", "97")}
TOP_TIE = {"ZEC": ("100", "102"), "BNB": ("100", "102"), "SOL": ("100", "99")}


class Chain:
    """Drives the contract the way a transaction would."""

    def __init__(self, vm: VMContext, now: int = BASE_TIME):
        self.vm = vm
        self.transfers: list[tuple[object, int]] = []
        self._install_transfer_recorder()
        self.at(now)
        self.contract = deploy_contract(CONTRACT, vm, sdk_version=SDK_VERSION)
        # Built after the deploy: the SDK is loaded per test, so an address made
        # earlier would belong to a different `Address` class than the contract sees.
        self.alice = create_address("alice")
        self.bob = create_address("bob")
        self.cara = create_address("cara")
        self.dan = create_address("dan")
        self.erin = create_address("erin")
        self.vm.sender = self.alice

    def _install_transfer_recorder(self) -> None:
        transfers = self.transfers

        def hook(_vm, request):
            # `emit_transfer` posts a bare message; the direct VM has no consensus layer
            # to deliver it, so the test records it instead.
            if isinstance(request, dict) and "PostMessage" in request:
                message = request["PostMessage"]
                transfers.append((message["address"], int(message["value"])))
                return {"ok": None}
            return None

        self.vm._gl_call_hook = hook

    # clock ------------------------------------------------------------------
    def at(self, timestamp: int) -> "Chain":
        self.now = timestamp
        stamp = iso(timestamp)
        self.vm.warp(stamp)
        # `warp` refreshes the sender and the value on the cached message but leaves the
        # datetime behind, and the datetime is the contract's whole notion of time.
        loaded = sys.modules.get("genlayer.gl")
        raw = getattr(loaded, "message_raw", None) if loaded is not None else None
        if isinstance(raw, dict):
            raw["datetime"] = stamp
        return self

    def advance(self, seconds: int) -> "Chain":
        return self.at(self.now + seconds)

    # calls ------------------------------------------------------------------
    def call(self, method: str, *args, sender=None, value: int = 0):
        self.vm.sender = self.alice if sender is None else sender
        self.vm.value = value
        try:
            return getattr(self.contract, method)(*args)
        finally:
            self.vm.value = 0

    def create(self, start: int, sender=None, category: str = CATEGORY) -> int:
        return self.call("create_market", category, start, sender=sender)

    def bet(self, market_id: int, asset: str, amount: int, sender=None) -> None:
        return self.call("place_bet", market_id, asset, sender=sender, value=amount)

    def settle(self, market_id: int, sender=None) -> str:
        return self.call("settle_market", market_id, sender=sender)

    def market(self, market_id: int) -> dict:
        return self.call("get_market", market_id)

    def position(self, market_id: int, wallet) -> dict:
        return self.call("get_user_position", market_id, wallet)

    def evidence(self, market_id: int) -> dict:
        return {row["source"]: row for row in self.call("get_source_evidence", market_id)}

    # venue scripting --------------------------------------------------------
    def script(self, start: int, plan: dict) -> None:
        """Point each source at a price set, a broken endpoint or a literal body.

        Mocks match in registration order, so a source is described exactly once.
        """
        for source in SOURCES:
            spec = plan.get(source)
            if spec is None:
                continue
            if isinstance(spec, Broken):
                self.vm.mock_web(re.escape(HOSTS[source]), {"status": spec.status, "body": spec.body})
                continue
            if isinstance(spec, Raw):
                self.vm.mock_web(re.escape(HOSTS[source]), {"status": spec.status, "body": spec.body})
                continue
            for asset, (open_price, close_price) in spec.items():
                self.vm.mock_web(
                    re.escape(url_fragment(source, asset)),
                    {"status": 200, "body": BODY_BUILDERS[source](start, open_price, close_price)},
                )

    def script_all(self, start: int, prices: dict) -> None:
        self.script(start, {source: prices for source in SOURCES})

    # transfers --------------------------------------------------------------
    def paid_to(self, wallet) -> int:
        return sum(amount for target, amount in self.transfers if target == wallet)

    @property
    def total_paid(self) -> int:
        return sum(amount for _target, amount in self.transfers)


@pytest.fixture
def chain():
    vm = VMContext()
    with vm.activate():
        yield Chain(vm)


@pytest.fixture
def start(chain: Chain) -> int:
    return aligned_start(chain.now + WINDOW)


@pytest.fixture
def settled_window(chain: Chain, start: int):
    """A market whose window has ended, with all three sources reporting SOL ahead."""
    market_id = chain.create(start)
    return market_id, start
