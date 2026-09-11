"""CoinGecko as a settlement source.

The contract used to read `/market_chart/range`, which now answers 401 without a paid
key. That made CoinGecko cast no vote on every settle, so a single disagreement between
the other two venues left every market inconclusive. These tests pin both halves: an
unauthorised source is recorded as unavailable rather than silently ignored, and the
public `market_chart` payload still produces a winner.
"""

import json

import pytest
from conftest import GEN, WINDOW, WINS_SOL, Broken, Chain, Raw, coingecko_body


def open_market(chain: Chain, start: int) -> int:
    market_id = chain.create(start)
    chain.bet(market_id, "SOL", 5 * GEN, sender=chain.bob)
    chain.bet(market_id, "ZEC", 5 * GEN, sender=chain.cara)
    chain.bet(market_id, "BNB", 5 * GEN, sender=chain.dan)
    return market_id


def test_contract_uses_the_public_market_chart_path():
    """The paid range path must not come back by accident."""
    from conftest import ROOT

    source = (ROOT / "contracts" / "Fluff.py").read_text(encoding="utf-8")
    # Read the constant itself, so a comment mentioning the old path does not count.
    url_lines = [line for line in source.splitlines() if line.startswith("COINGECKO_URL")]
    assert len(url_lines) == 1, url_lines
    url = url_lines[0]
    assert "market_chart?vs_currency=usd&days=1" in url
    assert "/range" not in url


@pytest.mark.parametrize("status", [401, 429])
def test_an_unauthorised_coingecko_is_recorded_as_unavailable(chain: Chain, start: int, status: int):
    market_id = open_market(chain, start)
    chain.script(start, {"COINGECKO": Broken(status), "BITGET": WINS_SOL, "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["COINGECKO"]["document"])
    assert document["status"] == "UNAVAILABLE"
    assert document["reason"] == "http"
    assert document["rows"] == []
    # The other two still agree, which is the point of requiring two rather than three.
    assert chain.market(market_id)["winner"] == "SOL"
    assert chain.market(market_id)["consensus_votes"] == 2


def test_a_days_one_payload_produces_a_winner(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"COINGECKO": WINS_SOL, "BITGET": Broken(), "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["COINGECKO"]["document"])
    assert document["status"] == "VALID"
    assert document["winner"] == "SOL"
    rows = {row["asset"]: row["return_units"] for row in document["rows"]}
    assert rows == {"SOL": 2_000_000, "BNB": 500_000, "ZEC": -1_000_000}


def test_samples_outside_the_window_are_ignored(chain: Chain, start: int):
    """The day-long payload carries decoys before, on and after the window bounds."""
    market_id = open_market(chain, start)
    chain.script(start, {"COINGECKO": WINS_SOL, "BITGET": WINS_SOL, "BINANCE": Broken()})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    rows = {
        row["asset"]: row
        for row in json.loads(chain.evidence(market_id)["COINGECKO"]["document"])["rows"]
    }
    # Open is the first sample at or after start, close the last strictly before end.
    assert rows["SOL"]["open"] == str(100 * 10**18)
    assert rows["SOL"]["close"] == str(102 * 10**18)


def test_a_window_with_no_coingecko_samples_is_unavailable(chain: Chain, start: int):
    """A window outside the day the payload covers must not be guessed at."""
    market_id = open_market(chain, start)
    stale = coingecko_body(start - 3 * 86_400, "100", "102")
    chain.script(start, {"COINGECKO": Raw(stale), "BITGET": WINS_SOL, "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["COINGECKO"]["document"])
    assert document["status"] == "UNAVAILABLE"
    assert document["reason"] == "window"


def test_two_live_venues_still_settle_without_coingecko(chain: Chain, start: int):
    """The failure mode that prompted this: one dead source must not block payout."""
    market_id = open_market(chain, start)
    chain.script(start, {"COINGECKO": Broken(401), "BITGET": WINS_SOL, "BINANCE": WINS_SOL})
    chain.at(start + WINDOW)

    assert chain.settle(market_id) == "SETTLED"
    market = chain.market(market_id)
    assert market["state"] == "SETTLED"
    assert market["winner"] == "SOL"
