"""Gate as a settlement source.

Gate replaced CoinGecko, which could not vote in practice. CoinGecko's free tier
rate-limits the burst of three calls settlement makes from one IP: a single call
returns 200, three in a row return 429. Verified from inside a GenLayer validator.

Gate also orders its candle fields unusually, so the parser is pinned here: a reader
that assumed open-high-low-close would silently swap open and close and invert every
return.
"""

import json

import pytest
from conftest import GEN, WINDOW, WINS_SOL, Broken, Chain, Raw, gate_body


def open_market(chain: Chain, start: int) -> int:
    market_id = chain.create(start)
    chain.bet(market_id, "SOL", 5 * GEN, sender=chain.bob)
    chain.bet(market_id, "ZEC", 5 * GEN, sender=chain.cara)
    chain.bet(market_id, "BNB", 5 * GEN, sender=chain.dan)
    return market_id


def test_contract_reads_gate_and_not_coingecko():
    """CoinGecko must not come back: it cannot vote from a validator."""
    from conftest import ROOT

    source = (ROOT / "contracts" / "Fluff.py").read_text(encoding="utf-8")
    # The URL is split across lines, so the whole file is searched for its pieces.
    assert "api.gateio.ws/api/v4/spot/candlesticks" in source
    assert "currency_pair={asset}_USDT&interval=30m" in source
    # The comment explaining why CoinGecko was dropped names it, so the check is on
    # the endpoint, not the word.
    assert "api.coingecko.com" not in source


def test_binance_uses_the_host_that_is_not_geo_blocked():
    """api.binance.com answers 451 from validator IPs; the data host does not."""
    from conftest import ROOT

    source = (ROOT / "contracts" / "Fluff.py").read_text(encoding="utf-8")
    binance = [line for line in source.splitlines() if "binance" in line and "http" in line]
    assert any("data-api.binance.vision" in line for line in binance)
    assert not any('"https://api.binance.com' in line for line in binance)


@pytest.mark.parametrize("status", [401, 429, 451])
def test_a_blocked_source_is_recorded_as_unavailable(chain: Chain, start: int, status: int):
    """The three statuses actually seen from validators: 401, 429 and 451."""
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": Broken(status), "BITGET": WINS_SOL, "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["GATE"]["document"])
    assert document["status"] == "UNAVAILABLE"
    assert document["reason"] == "http"
    assert document["rows"] == []
    # The other two still agree, which is the point of requiring two rather than three.
    assert chain.market(market_id)["winner"] == "SOL"
    assert chain.market(market_id)["consensus_votes"] == 2


def test_a_gate_candle_produces_a_winner(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": WINS_SOL, "BITGET": Broken(), "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["GATE"]["document"])
    assert document["status"] == "VALID"
    assert document["winner"] == "SOL"
    rows = {row["asset"]: row["return_units"] for row in document["rows"]}
    assert rows == {"SOL": 2_000_000, "BNB": 500_000, "ZEC": -1_000_000}


def test_gate_field_order_is_read_correctly(chain: Chain, start: int):
    """Open is field 5 and close is field 2, not the usual order."""
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": WINS_SOL, "BITGET": WINS_SOL, "BINANCE": Broken()})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    rows = {
        row["asset"]: row
        for row in json.loads(chain.evidence(market_id)["GATE"]["document"])["rows"]
    }
    # Reading them the other way round would report -1.96% instead of +2.00%.
    assert rows["SOL"]["open"] == str(100 * 10**18)
    assert rows["SOL"]["close"] == str(102 * 10**18)
    assert rows["SOL"]["return_units"] == 2_000_000


def test_a_candle_from_another_window_is_rejected(chain: Chain, start: int):
    """Gate stamps in seconds, so a wrong window must fail on the timestamp."""
    market_id = open_market(chain, start)
    stale = gate_body(start - WINDOW, "100", "102")
    chain.script(start, {"GATE": Raw(stale), "BITGET": WINS_SOL, "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["GATE"]["document"])
    assert document["status"] == "UNAVAILABLE"
    assert document["reason"] == "timestamp"


def test_an_unfinished_candle_is_rejected(chain: Chain, start: int):
    """Gate marks a still-forming candle, which must not settle a window."""
    market_id = open_market(chain, start)
    partial = json.dumps([[str(start), "1000.0", "102", "102", "100", "100", "10.0", "false"]])
    chain.script(start, {"GATE": Raw(partial), "BITGET": WINS_SOL, "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["GATE"]["document"])
    assert document["status"] == "UNAVAILABLE"
    assert document["reason"] == "count"


def test_two_live_venues_still_settle_without_gate(chain: Chain, start: int):
    """One dead source must not block payout: that is why it is two of three."""
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": Broken(429), "BITGET": WINS_SOL, "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)

    assert chain.settle(market_id) == "SETTLED"
    assert chain.market(market_id)["winner"] == "SOL"
