"""Payouts and refunds: pari-mutuel maths, the dust sweep, and who may pull what."""

import pytest
from conftest import GEN, RETRY_WINDOW, WINDOW, WINS_SOL, Chain


def settled_on_sol(chain: Chain, start: int, stakes: dict) -> int:
    """Settle a market on SOL with the given `wallet -> (asset, amount)` stakes."""
    market_id = chain.create(start)
    for wallet, (asset, amount) in stakes.items():
        chain.bet(market_id, asset, amount, sender=wallet)
    chain.script_all(start, WINS_SOL)
    chain.at(start + WINDOW)
    assert chain.settle(market_id) == "SETTLED"
    return market_id


def inconclusive(chain: Chain, start: int, stakes: dict) -> int:
    """A market that ran out of settlement time with stake on it."""
    market_id = chain.create(start)
    for wallet, (asset, amount) in stakes.items():
        chain.bet(market_id, asset, amount, sender=wallet)
    chain.at(start + WINDOW + RETRY_WINDOW)
    assert chain.settle(market_id) == "INCONCLUSIVE"
    return market_id


# --------------------------------------------------------------------------------------
# Claims
# --------------------------------------------------------------------------------------


def test_a_sole_winner_takes_the_whole_pool(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain, start, {chain.bob: ("SOL", 4 * GEN), chain.cara: ("ZEC", 6 * GEN)}
    )
    chain.call("claim", market_id, sender=chain.bob)

    assert chain.paid_to(chain.bob) == 10 * GEN
    assert chain.position(market_id, chain.bob)["claimed"] is True


def test_winners_split_in_proportion_to_stake(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain,
        start,
        {
            chain.bob: ("SOL", 2 * GEN),
            chain.cara: ("SOL", 6 * GEN),
            chain.dan: ("ZEC", 8 * GEN),
        },
    )
    chain.call("claim", market_id, sender=chain.bob)
    chain.call("claim", market_id, sender=chain.cara)

    # Pool 16, winning pool 8, so each winner doubles.
    assert chain.paid_to(chain.bob) == 4 * GEN
    assert chain.paid_to(chain.cara) == 12 * GEN
    assert chain.total_paid == 16 * GEN


def test_the_last_claimant_sweeps_the_rounding_dust(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain,
        start,
        {
            chain.bob: ("SOL", 1 * GEN),
            chain.cara: ("SOL", 2 * GEN),
            chain.dan: ("ZEC", 7 * GEN),
        },
    )
    total = 10 * GEN
    chain.call("claim", market_id, sender=chain.bob)
    chain.call("claim", market_id, sender=chain.cara)

    # Floor division for the first winner out, remainder for the last.
    assert chain.paid_to(chain.bob) == (1 * GEN) * total // (3 * GEN)
    assert chain.paid_to(chain.cara) == total - chain.paid_to(chain.bob)
    # Nothing is skimmed and nothing is stranded.
    assert chain.total_paid == total


def test_claim_order_does_not_change_the_total_distributed(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain,
        start,
        {
            chain.bob: ("SOL", 1 * GEN),
            chain.cara: ("SOL", 2 * GEN),
            chain.dan: ("ZEC", 7 * GEN),
        },
    )
    chain.call("claim", market_id, sender=chain.cara)
    chain.call("claim", market_id, sender=chain.bob)

    assert chain.total_paid == 10 * GEN
    assert chain.paid_to(chain.cara) == (2 * GEN) * (10 * GEN) // (3 * GEN)


def test_three_winners_with_an_awkward_split_still_distribute_exactly(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain,
        start,
        {
            chain.bob: ("SOL", 1 * GEN),
            chain.cara: ("SOL", 1 * GEN),
            chain.dan: ("SOL", 1 * GEN),
            chain.erin: ("ZEC", 1 * GEN),
        },
    )
    for wallet in (chain.bob, chain.cara, chain.dan):
        chain.call("claim", market_id, sender=wallet)

    assert chain.total_paid == 4 * GEN
    assert chain.market(market_id)["paid_out"] == 4 * GEN


def test_the_claimable_view_matches_what_is_paid(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain,
        start,
        {
            chain.bob: ("SOL", 1 * GEN),
            chain.cara: ("SOL", 2 * GEN),
            chain.dan: ("ZEC", 7 * GEN),
        },
    )
    quoted = chain.position(market_id, chain.bob)["claimable"]
    chain.call("claim", market_id, sender=chain.bob)
    assert chain.paid_to(chain.bob) == quoted

    quoted_last = chain.position(market_id, chain.cara)["claimable"]
    chain.call("claim", market_id, sender=chain.cara)
    assert chain.paid_to(chain.cara) == quoted_last


def test_a_loser_cannot_claim(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain, start, {chain.bob: ("SOL", 4 * GEN), chain.cara: ("ZEC", 6 * GEN)}
    )
    with pytest.raises(Exception, match="did not back the winner"):
        chain.call("claim", market_id, sender=chain.cara)


def test_a_wallet_cannot_claim_twice(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain, start, {chain.bob: ("SOL", 4 * GEN), chain.cara: ("ZEC", 6 * GEN)}
    )
    chain.call("claim", market_id, sender=chain.bob)
    with pytest.raises(Exception, match="already claimed"):
        chain.call("claim", market_id, sender=chain.bob)
    assert chain.paid_to(chain.bob) == 10 * GEN


def test_a_stranger_cannot_claim(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain, start, {chain.bob: ("SOL", 4 * GEN), chain.cara: ("ZEC", 6 * GEN)}
    )
    with pytest.raises(Exception, match="no position"):
        chain.call("claim", market_id, sender=chain.dan)
    # The winner's money is untouched.
    chain.call("claim", market_id, sender=chain.bob)
    assert chain.paid_to(chain.bob) == 10 * GEN


def test_cannot_claim_before_settlement(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "SOL", 2 * GEN, sender=chain.bob)
    with pytest.raises(Exception, match="not settled"):
        chain.call("claim", market_id, sender=chain.bob)


def test_cannot_claim_on_an_inconclusive_market(chain: Chain, start: int):
    market_id = inconclusive(chain, start, {chain.bob: ("SOL", 2 * GEN)})
    with pytest.raises(Exception, match="not settled"):
        chain.call("claim", market_id, sender=chain.bob)


def test_claiming_is_recorded_in_activity(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain, start, {chain.bob: ("SOL", 4 * GEN), chain.cara: ("ZEC", 6 * GEN)}
    )
    chain.call("claim", market_id, sender=chain.bob)
    feed = chain.call("get_user_activity", chain.bob, 0, 10)
    assert feed[0]["kind"] == "PAYOUT_CLAIMED"
    assert feed[0]["amount"] == 10 * GEN


# --------------------------------------------------------------------------------------
# Refunds
# --------------------------------------------------------------------------------------


def test_refunds_return_the_exact_stake(chain: Chain, start: int):
    market_id = inconclusive(
        chain, start, {chain.bob: ("SOL", 3 * GEN), chain.cara: ("ZEC", 7 * GEN)}
    )
    chain.call("claim_refund", market_id, sender=chain.bob)
    chain.call("claim_refund", market_id, sender=chain.cara)

    assert chain.paid_to(chain.bob) == 3 * GEN
    assert chain.paid_to(chain.cara) == 7 * GEN
    assert chain.total_paid == 10 * GEN


def test_a_topped_up_position_is_refunded_in_full(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "BNB", 2 * GEN, sender=chain.bob)
    chain.bet(market_id, "BNB", 5 * GEN, sender=chain.bob)
    chain.at(start + WINDOW + RETRY_WINDOW)
    chain.settle(market_id)

    chain.call("claim_refund", market_id, sender=chain.bob)
    assert chain.paid_to(chain.bob) == 7 * GEN


def test_a_wallet_cannot_refund_twice(chain: Chain, start: int):
    market_id = inconclusive(chain, start, {chain.bob: ("SOL", 3 * GEN)})
    chain.call("claim_refund", market_id, sender=chain.bob)
    with pytest.raises(Exception, match="already refunded"):
        chain.call("claim_refund", market_id, sender=chain.bob)
    assert chain.paid_to(chain.bob) == 3 * GEN


def test_cannot_refund_a_settled_market(chain: Chain, start: int):
    market_id = settled_on_sol(
        chain, start, {chain.bob: ("SOL", 4 * GEN), chain.cara: ("ZEC", 6 * GEN)}
    )
    with pytest.raises(Exception, match="not inconclusive"):
        chain.call("claim_refund", market_id, sender=chain.cara)


def test_cannot_refund_an_open_market(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "SOL", 2 * GEN, sender=chain.bob)
    with pytest.raises(Exception, match="not inconclusive"):
        chain.call("claim_refund", market_id, sender=chain.bob)


def test_a_stranger_cannot_refund(chain: Chain, start: int):
    market_id = inconclusive(chain, start, {chain.bob: ("SOL", 3 * GEN)})
    with pytest.raises(Exception, match="no position"):
        chain.call("claim_refund", market_id, sender=chain.dan)


def test_refunds_survive_a_zero_backed_winner(chain: Chain, start: int):
    market_id = chain.create(start)
    chain.bet(market_id, "ZEC", 4 * GEN, sender=chain.bob)
    chain.bet(market_id, "BNB", 6 * GEN, sender=chain.cara)
    chain.script_all(start, WINS_SOL)
    chain.at(start + WINDOW)
    assert chain.settle(market_id) == "INCONCLUSIVE"

    chain.call("claim_refund", market_id, sender=chain.bob)
    chain.call("claim_refund", market_id, sender=chain.cara)
    assert chain.total_paid == 10 * GEN


def test_refunding_is_recorded_in_activity(chain: Chain, start: int):
    market_id = inconclusive(chain, start, {chain.bob: ("SOL", 3 * GEN)})
    chain.call("claim_refund", market_id, sender=chain.bob)
    feed = chain.call("get_user_activity", chain.bob, 0, 10)
    assert feed[0]["kind"] == "REFUND_CLAIMED"
    assert feed[0]["amount"] == 3 * GEN


def test_payouts_are_applied_on_acceptance(chain: Chain, start: int):
    """The stage a transfer is applied at is a money decision, so it is pinned here.

    Both stages do deliver: a transfer queued for finalization was measured arriving
    on chain, it was only the balance view that lagged. `accepted` debits sooner, at
    the cost of applying before the transaction is final.
    """
    market_id = settled_on_sol(
        chain, start, {chain.bob: ("SOL", 4 * GEN), chain.cara: ("ZEC", 6 * GEN)}
    )
    chain.call("claim", market_id, sender=chain.bob)
    assert chain.transfer_modes == ["accepted"]


def test_refunds_use_the_same_stage_as_payouts(chain: Chain, start: int):
    market_id = inconclusive(chain, start, {chain.bob: ("SOL", 3 * GEN)})
    chain.call("claim_refund", market_id, sender=chain.bob)
    assert chain.transfer_modes == ["accepted"]
