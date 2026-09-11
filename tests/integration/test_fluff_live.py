"""Integration tests: Fluff deployed on a real GenLayer node.

These need a running node and a funded account, so they are skipped unless
`FLUFF_INTEGRATION=1` is set. Run them with:

    FLUFF_INTEGRATION=1 gltest tests/integration/ --network studionet

Settlement is deliberately not forced here. It reads three live venues over a real
half-hour window, so a window has to pass before `settle_market` can succeed. What these
tests do cover is that the deployed ABI, the time rules and the staking path all behave
the same on chain as they do in the direct suite.
"""

import os
import time

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

WINDOW = 1800
GEN = 10**18
CATEGORY = "CRYPTO_MAJORS"

pytestmark = pytest.mark.skipif(
    os.environ.get("FLUFF_INTEGRATION") != "1",
    reason="set FLUFF_INTEGRATION=1 to run against a live GenLayer node",
)


def next_aligned_start(lead_seconds: int = 900) -> int:
    """A GMT+1 half-hour boundary far enough ahead to bet into."""
    target = int(time.time()) + lead_seconds
    return target - (target % WINDOW) + WINDOW


@pytest.fixture(scope="module")
def fluff():
    factory = get_contract_factory("Fluff")
    return factory.deploy(args=[])


def test_config_matches_the_specification(fluff):
    config = fluff.get_config(args=[]).call()
    assert config["protocol"] == "Fluff"
    assert config["protocol_fee_bps"] == 0
    assert config["window_seconds"] == WINDOW
    assert config["timezone"] == "GMT+1"
    assert config["consensus_rule"] == "2-of-3"
    assert config["sources"] == ["COINGECKO", "BITGET", "BINANCE"]
    assert config["assets"] == ["ZEC", "BNB", "SOL"]


def test_create_market_and_bet(fluff):
    start = next_aligned_start()

    created = fluff.create_market(args=[CATEGORY, start]).transact()
    assert tx_execution_succeeded(created)

    lookup = fluff.get_market_by_category_start(args=[CATEGORY, start]).call()
    assert lookup["exists"] is True
    market_id = lookup["market_id"]

    market = fluff.get_market(args=[market_id]).call()
    assert market["market_end"] - market["market_start"] == WINDOW
    assert market["state"] == "OPEN"
    assert market["phase"] == "UPCOMING"

    placed = fluff.place_bet(args=[market_id, "SOL"], value=GEN).transact()
    assert tx_execution_succeeded(placed)

    after = fluff.get_market(args=[market_id]).call()
    assert after["pools"]["SOL"] == GEN
    assert after["total_pool"] == GEN


def test_duplicate_window_is_rejected(fluff):
    start = next_aligned_start(lead_seconds=WINDOW + 900)
    assert tx_execution_succeeded(fluff.create_market(args=[CATEGORY, start]).transact())
    repeat = fluff.create_market(args=[CATEGORY, start]).transact()
    assert not tx_execution_succeeded(repeat)


def test_unaligned_window_is_rejected(fluff):
    start = next_aligned_start() + 60
    result = fluff.create_market(args=[CATEGORY, start]).transact()
    assert not tx_execution_succeeded(result)


def test_settling_an_unfinished_window_is_rejected(fluff):
    start = next_aligned_start(lead_seconds=2 * WINDOW + 900)
    fluff.create_market(args=[CATEGORY, start]).transact()
    market_id = fluff.get_market_by_category_start(args=[CATEGORY, start]).call()["market_id"]
    result = fluff.settle_market(args=[market_id]).transact()
    assert not tx_execution_succeeded(result)
