"""Settlement: evidence, the 2-of-3 vote, and every way a window can fail to resolve."""

import json

import pytest
from conftest import (
    ALL_NEGATIVE,
    GEN,
    RETRY_WINDOW,
    TOP_TIE,
    WINDOW,
    WINS_BNB,
    WINS_SOL,
    WINS_SOL_OTHER_LEVEL,
    WINS_ZEC,
    Broken,
    Chain,
    Raw,
    binance_body,
)

SCALE = 10**18


def after_window(chain: Chain, start: int) -> Chain:
    return chain.at(start + WINDOW)


def open_market(chain: Chain, start: int, stakes=(("SOL", 5), ("ZEC", 5), ("BNB", 5))) -> int:
    """A market with stake on every token, so no outcome is zero-backed."""
    market_id = chain.create(start)
    wallets = [chain.bob, chain.cara, chain.dan]
    for wallet, (asset, size) in zip(wallets, stakes):
        chain.bet(market_id, asset, size * GEN, sender=wallet)
    return market_id


# --------------------------------------------------------------------------------------
# Timing
# --------------------------------------------------------------------------------------


def test_cannot_settle_before_the_window_ends(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.at(start + WINDOW - 1)
    with pytest.raises(Exception, match="has not ended"):
        chain.settle(market_id)


def test_can_settle_the_instant_the_window_ends(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)
    assert chain.settle(market_id) == "SETTLED"


def test_cannot_settle_twice(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)
    chain.settle(market_id)
    with pytest.raises(Exception, match="already resolved"):
        chain.settle(market_id)


# --------------------------------------------------------------------------------------
# Consensus matrix
# --------------------------------------------------------------------------------------


def test_three_agreeing_sources_settle(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)

    assert chain.settle(market_id) == "SETTLED"
    market = chain.market(market_id)
    assert market["state"] == "SETTLED"
    assert market["winner"] == "SOL"
    assert market["consensus_winner"] == "SOL"
    assert market["consensus_votes"] == 3
    assert market["settler"] == chain.alice


def test_two_agreeing_sources_settle_when_the_third_is_unavailable(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": WINS_SOL, "BITGET": WINS_SOL, "BINANCE": Broken()})
    after_window(chain, start)

    assert chain.settle(market_id) == "SETTLED"
    market = chain.market(market_id)
    assert market["winner"] == "SOL"
    assert market["consensus_votes"] == 2
    assert chain.evidence(market_id)["BINANCE"]["vote"] == ""


def test_two_agreeing_sources_settle_when_the_third_disagrees(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": WINS_SOL, "BITGET": WINS_SOL, "BINANCE": WINS_BNB})
    after_window(chain, start)

    assert chain.settle(market_id) == "SETTLED"
    market = chain.market(market_id)
    assert market["winner"] == "SOL"
    assert market["consensus_votes"] == 2
    assert chain.evidence(market_id)["BINANCE"]["vote"] == "BNB"


def test_a_single_valid_vote_is_not_enough(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": WINS_SOL, "BITGET": Broken(), "BINANCE": Broken()})
    after_window(chain, start)

    assert chain.settle(market_id) == "NO_CONSENSUS_RETRY"
    market = chain.market(market_id)
    assert market["state"] == "OPEN"
    assert market["winner"] == ""
    assert market["settle_attempts"] == 1


def test_three_different_winners_reach_no_consensus(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": WINS_SOL, "BITGET": WINS_BNB, "BINANCE": WINS_ZEC})
    after_window(chain, start)

    assert chain.settle(market_id) == "NO_CONSENSUS_RETRY"
    assert chain.market(market_id)["state"] == "OPEN"
    votes = {source: row["vote"] for source, row in chain.evidence(market_id).items()}
    assert votes == {"GATE": "SOL", "BITGET": "BNB", "BINANCE": "ZEC"}


def test_every_source_unavailable_reaches_no_consensus(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {source: Broken() for source in ("GATE", "BITGET", "BINANCE")})
    after_window(chain, start)

    assert chain.settle(market_id) == "NO_CONSENSUS_RETRY"
    assert chain.market(market_id)["state"] == "OPEN"


def test_a_tied_source_casts_no_vote(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": TOP_TIE, "BITGET": WINS_SOL, "BINANCE": WINS_SOL})
    after_window(chain, start)

    assert chain.settle(market_id) == "SETTLED"
    gate = json.loads(chain.evidence(market_id)["GATE"]["document"])
    assert gate["status"] == "TIE"
    assert gate["winner"] == ""
    assert chain.market(market_id)["consensus_votes"] == 2


def test_two_ties_and_one_vote_reach_no_consensus(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": TOP_TIE, "BITGET": TOP_TIE, "BINANCE": WINS_SOL})
    after_window(chain, start)

    assert chain.settle(market_id) == "NO_CONSENSUS_RETRY"


def test_least_negative_token_wins_when_everything_falls(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script_all(start, ALL_NEGATIVE)
    after_window(chain, start)

    assert chain.settle(market_id) == "SETTLED"
    assert chain.market(market_id)["winner"] == "BNB"
    rows = {
        row["asset"]: row["return_units"]
        for row in json.loads(chain.evidence(market_id)["BINANCE"]["document"])["rows"]
    }
    assert rows == {"ZEC": -2_000_000, "BNB": -1_000_000, "SOL": -3_000_000}


def test_a_failed_attempt_can_be_retried(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": Broken(), "BITGET": Broken(), "BINANCE": Broken()})
    after_window(chain, start)
    assert chain.settle(market_id) == "NO_CONSENSUS_RETRY"

    # A later attempt, now that the venues answer, settles the same market.
    chain.vm.clear_mocks()
    chain.script_all(start, WINS_ZEC)
    chain.at(start + WINDOW + 600)
    assert chain.settle(market_id, sender=chain.cara) == "SETTLED"

    market = chain.market(market_id)
    assert market["winner"] == "ZEC"
    assert market["settle_attempts"] == 2
    assert market["settler"] == chain.cara


# --------------------------------------------------------------------------------------
# Deadline
# --------------------------------------------------------------------------------------


def test_past_the_deadline_the_market_forces_inconclusive_without_fetching(chain: Chain, start: int):
    market_id = open_market(chain, start)
    # No venue is scripted. An attempted request would raise, so a clean pass proves
    # the deadline path contacts nobody.
    chain.at(start + WINDOW + RETRY_WINDOW)

    assert chain.settle(market_id) == "INCONCLUSIVE"
    market = chain.market(market_id)
    assert market["state"] == "INCONCLUSIVE"
    assert market["winner"] == ""
    assert market["consensus_winner"] == ""
    assert all(row["has_evidence"] is False for row in chain.call("get_source_evidence", market_id))


def test_just_before_the_deadline_the_sources_are_still_read(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script_all(start, WINS_SOL)
    chain.at(start + WINDOW + RETRY_WINDOW - 1)

    assert chain.settle(market_id) == "SETTLED"
    assert chain.market(market_id)["winner"] == "SOL"


def test_betting_state_reports_the_deadline(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.at(start + WINDOW + RETRY_WINDOW)
    state = chain.call("get_betting_state", market_id)
    assert state["past_deadline"] is True
    assert state["settlement_deadline"] == start + WINDOW + RETRY_WINDOW


# --------------------------------------------------------------------------------------
# Zero-backed winner
# --------------------------------------------------------------------------------------


def test_a_winner_nobody_backed_makes_the_market_inconclusive(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "ZEC", 4 * GEN, sender=chain.bob)
    chain.bet(market_id, "BNB", 6 * GEN, sender=chain.cara)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)

    assert chain.settle(market_id) == "INCONCLUSIVE"
    market = chain.market(market_id)
    assert market["state"] == "INCONCLUSIVE"
    assert market["winner"] == ""
    # The price winner stays on record even though it pays nobody.
    assert market["consensus_winner"] == "SOL"
    assert market["consensus_votes"] == 3

    assert chain.position(market_id, chain.bob)["refundable"] == 4 * GEN
    assert chain.position(market_id, chain.cara)["refundable"] == 6 * GEN


def test_a_market_with_no_bets_still_settles(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)

    assert chain.settle(market_id) == "SETTLED"
    market = chain.market(market_id)
    assert market["state"] == "SETTLED"
    assert market["winner"] == "SOL"
    assert market["total_pool"] == 0


# --------------------------------------------------------------------------------------
# Evidence
# --------------------------------------------------------------------------------------


def test_evidence_is_stored_for_every_source(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)
    chain.settle(market_id)

    rows = chain.call("get_source_evidence", market_id)
    assert [row["source"] for row in rows] == ["GATE", "BITGET", "BINANCE"]
    for row in rows:
        document = json.loads(row["document"])
        assert document["category"] == "CRYPTO_MAJORS"
        assert document["window_start"] == start
        assert document["window_end"] == start + WINDOW
        assert document["interval"] == "30m"
        assert document["status"] == "VALID"
        assert document["winner"] == "SOL"
        # Canonical ordering keeps the document byte-identical across validators.
        assert [entry["asset"] for entry in document["rows"]] == ["BNB", "SOL", "ZEC"]


def test_prices_are_integers_scaled_by_the_price_scale(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)
    chain.settle(market_id)

    rows = {
        entry["asset"]: entry
        for entry in json.loads(chain.evidence(market_id)["BITGET"]["document"])["rows"]
    }
    assert rows["SOL"]["open"] == str(100 * SCALE)
    assert rows["SOL"]["close"] == str(102 * SCALE)
    assert rows["BNB"]["close"] == str(1005 * SCALE // 10)
    assert rows["SOL"]["return_units"] == 2_000_000
    assert rows["BNB"]["return_units"] == 500_000
    assert rows["ZEC"]["return_units"] == -1_000_000


def test_sources_are_read_independently_and_never_averaged(chain: Chain, start: int):
    market_id = open_market(chain, start)
    # Same ordering, prices two and a half times apart. If anything were blended the
    # stored opens could not stay this far apart.
    chain.script(
        start,
        {
            "GATE": WINS_SOL,
            "BITGET": WINS_SOL_OTHER_LEVEL,
            "BINANCE": WINS_SOL_OTHER_LEVEL,
        },
    )
    after_window(chain, start)
    chain.settle(market_id)

    evidence = chain.evidence(market_id)
    opens = {}
    for source in ("GATE", "BITGET"):
        document = json.loads(evidence[source]["document"])
        opens[source] = {row["asset"]: row["open"] for row in document["rows"]}
    assert opens["GATE"]["SOL"] == str(100 * SCALE)
    assert opens["BITGET"]["SOL"] == str(250 * SCALE)
    # Identical returns despite different price levels, so both vote the same way.
    assert chain.market(market_id)["winner"] == "SOL"


@pytest.mark.parametrize(
    "body,reason",
    [
        ("not json at all", "json"),
        ('{"unexpected": true}', "shape"),
        ("[]", "count"),
        ("[[1,2,3,4,5],[6,7,8,9,10]]", "count"),
    ],
)
def test_malformed_binance_responses_are_recorded_with_a_reason(
    chain: Chain, start: int, body: str, reason: str
):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": WINS_SOL, "BITGET": WINS_SOL, "BINANCE": Raw(body)})
    after_window(chain, start)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["BINANCE"]["document"])
    assert document["status"] == "UNAVAILABLE"
    assert document["reason"] == reason
    assert document["rows"] == []


def test_a_candle_from_the_wrong_minute_is_rejected(chain: Chain, start: int):
    market_id = open_market(chain, start)
    wrong = binance_body(start + 60, "100", "102")
    chain.script(start, {"GATE": WINS_SOL, "BITGET": WINS_SOL, "BINANCE": Raw(wrong)})
    after_window(chain, start)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["BINANCE"]["document"])
    assert document["reason"] == "timestamp"


def test_a_bitget_business_error_is_rejected(chain: Chain, start: int):
    market_id = open_market(chain, start)
    error = json.dumps({"code": "40034", "msg": "param error", "data": []})
    chain.script(start, {"GATE": WINS_SOL, "BITGET": Raw(error), "BINANCE": WINS_SOL})
    after_window(chain, start)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["BITGET"]["document"])
    assert document["reason"] == "code"


def test_a_non_positive_price_is_rejected(chain: Chain, start: int):
    market_id = open_market(chain, start)
    zero_open = binance_body(start, "0", "102")
    chain.script(start, {"GATE": WINS_SOL, "BITGET": WINS_SOL, "BINANCE": Raw(zero_open)})
    after_window(chain, start)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["BINANCE"]["document"])
    assert document["reason"] == "price"


def test_an_http_error_is_recorded_as_http(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script(start, {"GATE": WINS_SOL, "BITGET": WINS_SOL, "BINANCE": Broken(429)})
    after_window(chain, start)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["BINANCE"]["document"])
    assert document["status"] == "UNAVAILABLE"
    assert document["reason"] == "http"


def test_gate_samples_outside_the_window_are_ignored(chain: Chain, start: int):
    """The scripted body carries a sample at `end` priced 1.0; using it would flip ZEC."""
    market_id = open_market(chain, start)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)
    chain.settle(market_id)

    document = json.loads(chain.evidence(market_id)["GATE"]["document"])
    rows = {row["asset"]: row for row in document["rows"]}
    assert rows["ZEC"]["close"] == str(99 * SCALE)
    assert document["winner"] == "SOL"


def test_settlement_is_recorded_in_the_settlers_activity(chain: Chain, start: int):
    market_id = open_market(chain, start)
    chain.script_all(start, WINS_SOL)
    after_window(chain, start)
    chain.settle(market_id, sender=chain.erin)

    feed = chain.call("get_user_activity", chain.erin, 0, 10)
    assert feed[0]["kind"] == "MARKET_SETTLED"
    assert feed[0]["market_id"] == market_id
    assert feed[0]["asset"] == "SOL"
