"""Betting: stake sizes, one outcome per wallet, and the moment betting closes."""

import pytest
from conftest import GEN, WINDOW, Chain


def test_accepts_a_bet_and_updates_the_pools(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "SOL", 5 * GEN, sender=chain.bob)

    market = chain.market(market_id)
    assert market["pools"]["SOL"] == 5 * GEN
    assert market["pools"]["ZEC"] == 0
    assert market["total_pool"] == 5 * GEN
    assert market["backers"]["SOL"] == 1
    assert market["bettor_count"] == 1

    position = chain.position(market_id, chain.bob)
    assert position["asset"] == "SOL"
    assert position["amount"] == 5 * GEN
    assert position["claimed"] is False


def test_rejects_a_bet_below_the_minimum(chain: Chain, start: int):
    market_id = chain.create(start)
    with pytest.raises(Exception, match="minimum bet"):
        chain.bet(market_id, "SOL", GEN - 1, sender=chain.bob)


def test_accepts_exactly_one_gen(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "ZEC", GEN, sender=chain.bob)
    assert chain.market(market_id)["total_pool"] == GEN


def test_rejects_a_zero_value_bet(chain: Chain, start: int):
    market_id = chain.create(start)
    with pytest.raises(Exception, match="minimum bet"):
        chain.bet(market_id, "ZEC", 0, sender=chain.bob)


def test_rejects_an_unknown_asset(chain: Chain, start: int):
    market_id = chain.create(start)
    with pytest.raises(Exception, match="unknown asset"):
        chain.bet(market_id, "BTC", GEN, sender=chain.bob)


def test_top_up_on_the_same_token_accumulates(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "BNB", 2 * GEN, sender=chain.bob)
    chain.bet(market_id, "BNB", 3 * GEN, sender=chain.bob)

    market = chain.market(market_id)
    assert market["pools"]["BNB"] == 5 * GEN
    assert market["total_pool"] == 5 * GEN
    # A top-up is the same wallet, so the backer count must not move.
    assert market["backers"]["BNB"] == 1
    assert market["bettor_count"] == 1
    assert chain.position(market_id, chain.bob)["amount"] == 5 * GEN


def test_rejects_switching_to_another_token(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "BNB", 2 * GEN, sender=chain.bob)
    with pytest.raises(Exception, match="already backs another token"):
        chain.bet(market_id, "SOL", 2 * GEN, sender=chain.bob)

    market = chain.market(market_id)
    assert market["pools"]["SOL"] == 0
    assert market["total_pool"] == 2 * GEN


def test_separate_wallets_are_counted_separately(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "SOL", 4 * GEN, sender=chain.bob)
    chain.bet(market_id, "SOL", 6 * GEN, sender=chain.cara)
    chain.bet(market_id, "ZEC", 1 * GEN, sender=chain.dan)

    market = chain.market(market_id)
    assert market["pools"] == {"SOL": 10 * GEN, "ZEC": GEN, "BNB": 0}
    assert market["backers"]["SOL"] == 2
    assert market["bettor_count"] == 3
    assert market["total_pool"] == 11 * GEN


def test_betting_closes_exactly_at_the_window_start(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.at(start - 1)
    chain.bet(market_id, "SOL", GEN, sender=chain.bob)

    chain.at(start)
    with pytest.raises(Exception, match="betting closed"):
        chain.bet(market_id, "SOL", GEN, sender=chain.cara)


def test_betting_is_closed_while_the_window_runs(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.at(start + WINDOW // 2)
    with pytest.raises(Exception, match="betting closed"):
        chain.bet(market_id, "SOL", GEN, sender=chain.bob)
    assert chain.market(market_id)["phase"] == "LIVE"


def test_betting_is_closed_after_the_window_ends(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.at(start + WINDOW + 60)
    with pytest.raises(Exception, match="betting closed"):
        chain.bet(market_id, "SOL", GEN, sender=chain.bob)
    assert chain.market(market_id)["phase"] == "PENDING_SETTLEMENT"


def test_betting_on_an_unknown_market_reverts(chain: Chain):
    with pytest.raises(Exception, match="unknown market"):
        chain.bet(7, "SOL", GEN, sender=chain.bob)


def test_betting_state_tracks_the_clock(chain: Chain, start: int):
    market_id = chain.create(start)

    upcoming = chain.call("get_betting_state", market_id)
    assert upcoming["phase"] == "UPCOMING"
    assert upcoming["betting_open"] is True
    assert upcoming["settleable"] is False
    assert upcoming["seconds_until_start"] == start - chain.now
    assert upcoming["min_bet"] == GEN

    chain.at(start + 10)
    live = chain.call("get_betting_state", market_id)
    assert live["phase"] == "LIVE"
    assert live["betting_open"] is False
    assert live["settleable"] is False
    assert live["seconds_until_start"] == 0

    chain.at(start + WINDOW)
    pending = chain.call("get_betting_state", market_id)
    assert pending["phase"] == "PENDING_SETTLEMENT"
    assert pending["settleable"] is True
    assert pending["past_deadline"] is False


def test_activity_separates_a_first_bet_from_a_top_up(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "SOL", GEN, sender=chain.bob)
    chain.bet(market_id, "SOL", GEN, sender=chain.bob)

    feed = chain.call("get_user_activity", chain.bob, 0, 10)
    assert [row["kind"] for row in feed] == ["BET_TOPPED_UP", "BET_PLACED"]
    assert feed[0]["asset"] == "SOL"
    assert feed[0]["amount"] == GEN
    assert chain.call("get_user_activity_count", chain.bob) == 2


def test_a_wallet_may_back_different_tokens_in_different_markets(chain: Chain, start: int):
    first = chain.create(start)
    second = chain.create(start + WINDOW)
    chain.bet(first, "SOL", GEN, sender=chain.bob)
    chain.bet(second, "ZEC", GEN, sender=chain.bob)

    assert chain.position(first, chain.bob)["asset"] == "SOL"
    assert chain.position(second, chain.bob)["asset"] == "ZEC"


def test_position_is_empty_for_a_wallet_that_never_bet(chain: Chain, start: int):
    market_id = chain.create(start)
    position = chain.position(market_id, chain.dan)
    assert position["asset"] == ""
    assert position["amount"] == 0
    assert position["claimable"] == 0
    assert position["refundable"] == 0
