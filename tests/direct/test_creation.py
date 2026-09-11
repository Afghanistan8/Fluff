"""Market creation: who may create, which windows are valid, and uniqueness."""

import pytest
from conftest import CATEGORY, WINDOW, Chain, aligned_start


def test_creates_a_market_with_the_expected_window(chain: Chain, start: int):
    market_id = chain.create(start)
    assert market_id == 1

    market = chain.market(market_id)
    assert market["category"] == CATEGORY
    assert market["assets"] == ["ZEC", "BNB", "SOL"]
    assert market["market_start"] == start
    assert market["market_end"] == start + WINDOW
    assert market["market_end"] - market["market_start"] == 1800
    assert market["state"] == "OPEN"
    assert market["phase"] == "UPCOMING"
    assert market["betting_open"] is True
    assert market["timezone"] == "GMT+1"
    assert market["total_pool"] == 0
    assert market["pools"] == {"ZEC": 0, "BNB": 0, "SOL": 0}


def test_anyone_may_create(chain: Chain, start: int):
    market_id = chain.create(start, sender=chain.bob)
    assert chain.market(market_id)["creator"] == chain.bob


def test_ids_increment(chain: Chain, start: int):
    first = chain.create(start)
    second = chain.create(start + WINDOW)
    assert (first, second) == (1, 2)


def test_rejects_a_start_in_the_past(chain: Chain):
    past = aligned_start(chain.now) - 4 * WINDOW
    with pytest.raises(Exception, match="future"):
        chain.create(past)


def test_rejects_a_start_equal_to_now(chain: Chain):
    # `now` is itself half-hour aligned in the fixture, so this isolates the future check.
    with pytest.raises(Exception, match="future"):
        chain.create(chain.now)


@pytest.mark.parametrize("offset", [1, 60, 900, 899, 1799])
def test_rejects_unaligned_starts(chain: Chain, start: int, offset: int):
    with pytest.raises(Exception, match="00 or :30"):
        chain.create(start + offset)


def test_accepts_both_half_hour_boundaries(chain: Chain, start: int):
    chain.create(start)
    chain.create(start + WINDOW)
    chain.create(start + 2 * WINDOW)


def test_rejects_a_duplicate_window(chain: Chain, start: int):
    chain.create(start)
    with pytest.raises(Exception, match="already exists"):
        chain.create(start, sender=chain.bob)


def test_rejects_an_unknown_category(chain: Chain, start: int):
    with pytest.raises(Exception, match="unknown category"):
        chain.create(start, category="BIG_CAPS")


def test_market_lookup_by_category_and_start(chain: Chain, start: int):
    before = chain.call("get_market_by_category_start", CATEGORY, start)
    assert before["exists"] is False
    assert before["aligned"] is True

    market_id = chain.create(start)

    after = chain.call("get_market_by_category_start", CATEGORY, start)
    assert after["exists"] is True
    assert after["market_id"] == market_id


def test_lookup_reports_misaligned_slots(chain: Chain, start: int):
    probe = chain.call("get_market_by_category_start", CATEGORY, start + 300)
    assert probe["exists"] is False
    assert probe["aligned"] is False


def test_creation_is_recorded_in_activity(chain: Chain, start: int):
    chain.create(start, sender=chain.alice)
    feed = chain.call("get_user_activity", chain.alice, 0, 10)
    assert feed[0]["kind"] == "MARKET_CREATED"
    assert feed[0]["market_id"] == 1
    assert chain.call("get_user_activity_count", chain.alice) == 1


def test_unknown_market_reverts(chain: Chain):
    with pytest.raises(Exception, match="unknown market"):
        chain.market(99)
