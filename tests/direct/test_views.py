"""Read surface: configuration, listings, pagination bounds and portfolio queries."""

import pytest
from conftest import CATEGORY, GEN, RETRY_WINDOW, WINDOW, WINS_SOL, Chain


def test_config_reports_the_whole_rulebook(chain: Chain):
    config = chain.call("get_config")
    assert config["protocol"] == "Fluff"
    assert config["protocol_fee_bps"] == 0
    assert config["creator_fee_bps"] == 0
    assert config["settlement_fee_bps"] == 0
    assert config["min_bet"] == GEN
    assert config["window_seconds"] == 1800
    assert config["timezone"] == "GMT+1"
    assert config["timezone_offset_seconds"] == 3600
    assert config["sources"] == ["GATE", "BITGET", "BINANCE"]
    assert config["consensus_threshold"] == 2
    assert config["consensus_rule"] == "2-of-3"
    assert config["settlement_retry_window_seconds"] == RETRY_WINDOW
    assert config["candle_interval"] == "30m"
    assert config["categories"] == [CATEGORY]
    assert config["assets"] == ["ZEC", "BNB", "SOL"]
    assert config["asset_names"] == {"ZEC": "Zcash", "BNB": "BNB", "SOL": "Solana"}
    assert config["price_scale"] == 10**18
    assert config["return_scale"] == 10**6
    assert config["gen_decimals"] == 18
    assert config["page_limit"] == 50
    assert config["market_count"] == 0


def test_categories_are_locked_to_one(chain: Chain):
    categories = chain.call("categories")
    assert len(categories) == 1
    assert categories[0]["id"] == CATEGORY
    assert categories[0]["label"] == "Crypto Majors"
    assert categories[0]["assets"] == ["ZEC", "BNB", "SOL"]


def test_category_assets_carry_display_names(chain: Chain):
    assets = chain.call("category_assets", CATEGORY)
    assert assets == [
        {"symbol": "ZEC", "name": "Zcash"},
        {"symbol": "BNB", "name": "BNB"},
        {"symbol": "SOL", "name": "Solana"},
    ]


def test_category_assets_rejects_anything_else(chain: Chain):
    with pytest.raises(Exception, match="unknown category"):
        chain.call("category_assets", "MEME_COINS")


def test_markets_are_listed_newest_first(chain: Chain, start: int):
    ids = [chain.create(start + index * WINDOW) for index in range(4)]
    listing = chain.call("get_markets", 0, 10)
    assert [row["id"] for row in listing] == list(reversed(ids))


def test_market_listing_honours_offset_and_limit(chain: Chain, start: int):
    ids = [chain.create(start + index * WINDOW) for index in range(5)]
    page = chain.call("get_markets", 1, 2)
    assert [row["id"] for row in page] == [ids[3], ids[2]]


def test_market_listing_clamps_the_page_size(chain: Chain, start: int):
    for index in range(55):
        chain.create(start + index * WINDOW)
    assert len(chain.call("get_markets", 0, 1000)) == 50
    assert len(chain.call("get_markets", 50, 1000)) == 5


def test_open_markets_exclude_resolved_ones(chain: Chain, start: int):
    first = chain.create(start)
    second = chain.create(start + WINDOW)
    assert [row["id"] for row in chain.call("get_open_markets", 0, 10)] == [first, second]

    chain.script_all(start, WINS_SOL)
    chain.at(start + WINDOW)
    chain.settle(first)

    assert [row["id"] for row in chain.call("get_open_markets", 0, 10)] == [second]


def test_open_markets_paginate(chain: Chain, start: int):
    ids = [chain.create(start + index * WINDOW) for index in range(4)]
    page = chain.call("get_open_markets", 2, 10)
    assert [row["id"] for row in page] == ids[2:]


def test_user_positions_list_every_market_a_wallet_touched(chain: Chain, start: int):
    first = chain.create(start)
    second = chain.create(start + WINDOW)
    chain.create(start + 2 * WINDOW)
    chain.bet(first, "SOL", GEN, sender=chain.bob)
    chain.bet(second, "ZEC", 2 * GEN, sender=chain.bob)

    positions = chain.call("get_user_positions", chain.bob, 0, 10)
    assert [row["market_id"] for row in positions] == [first, second]
    assert [row["asset"] for row in positions] == ["SOL", "ZEC"]
    assert [row["amount"] for row in positions] == [GEN, 2 * GEN]


def test_user_positions_are_empty_for_an_unknown_wallet(chain: Chain, start: int):
    chain.create(start)
    assert chain.call("get_user_positions", chain.erin, 0, 10) == []


def test_claimable_markets_separate_claims_from_refunds(chain: Chain, start: int):
    winner_market = chain.create(start)
    chain.bet(winner_market, "SOL", 2 * GEN, sender=chain.bob)
    chain.bet(winner_market, "ZEC", 2 * GEN, sender=chain.cara)

    refund_market = chain.create(start + WINDOW)
    chain.bet(refund_market, "ZEC", 3 * GEN, sender=chain.bob)

    chain.script_all(start, WINS_SOL)
    chain.at(start + WINDOW)
    chain.settle(winner_market)
    chain.at(start + 2 * WINDOW + RETRY_WINDOW)
    chain.settle(refund_market)

    claimable = chain.call("get_claimable_markets", chain.bob, 0, 10)
    assert [(row["market_id"], row["action"]) for row in claimable] == [
        (winner_market, "CLAIM"),
        (refund_market, "REFUND"),
    ]

    # A loser on the settled market only sees nothing there.
    assert chain.call("get_claimable_markets", chain.cara, 0, 10) == []


def test_claimable_markets_drop_out_once_pulled(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "SOL", 2 * GEN, sender=chain.bob)
    chain.bet(market_id, "ZEC", 2 * GEN, sender=chain.cara)
    chain.script_all(start, WINS_SOL)
    chain.at(start + WINDOW)
    chain.settle(market_id)

    assert len(chain.call("get_claimable_markets", chain.bob, 0, 10)) == 1
    chain.call("claim", market_id, sender=chain.bob)
    assert chain.call("get_claimable_markets", chain.bob, 0, 10) == []


def test_activity_is_newest_first_and_paginates(chain: Chain, start: int):
    market_id = chain.create(start, sender=chain.bob)
    chain.bet(market_id, "SOL", GEN, sender=chain.bob)
    chain.bet(market_id, "SOL", GEN, sender=chain.bob)

    assert chain.call("get_user_activity_count", chain.bob) == 3
    feed = chain.call("get_user_activity", chain.bob, 0, 10)
    assert [row["kind"] for row in feed] == ["BET_TOPPED_UP", "BET_PLACED", "MARKET_CREATED"]

    page = chain.call("get_user_activity", chain.bob, 1, 1)
    assert [row["kind"] for row in page] == ["BET_PLACED"]


def test_activity_is_empty_for_a_quiet_wallet(chain: Chain):
    assert chain.call("get_user_activity", chain.erin, 0, 10) == []
    assert chain.call("get_user_activity_count", chain.erin) == 0


def test_source_evidence_is_listed_before_any_settlement(chain: Chain, start: int):
    market_id = chain.create(start)
    rows = chain.call("get_source_evidence", market_id)
    assert [row["source"] for row in rows] == ["GATE", "BITGET", "BINANCE"]
    assert all(row["document"] == "" and row["has_evidence"] is False for row in rows)


def test_market_view_reports_the_settlement_deadline(chain: Chain, start: int):
    market_id = chain.create(start)
    market = chain.market(market_id)
    assert market["settlement_deadline"] == start + WINDOW + RETRY_WINDOW
    assert market["now"] == chain.now
