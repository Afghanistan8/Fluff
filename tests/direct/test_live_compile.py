"""Compile the contract on a real GenLayer node.

The local suite runs against the SDK generation `gltest` pins, which is older than the
one the live networks execute. That gap is exactly how an API rename slips through: the
contract imported cleanly here while the chain rejected it as `invalid_contract`.

This test closes the gap. It asks a node to load the contract with its own GenVM and
return the ABI, which costs nothing and needs no funds. Network access is required, so
it skips when the node cannot be reached.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

import pytest
from conftest import CONTRACT

# The studio sandbox exposes schema extraction and returns real Python tracebacks,
# which the testnet RPCs do not.
NODE_URL = os.environ.get("FLUFF_COMPILE_NODE", "https://studio-dev.genlayer.com/api")
TIMEOUT_SECONDS = 180

EXPECTED_METHODS = {
    "categories",
    "category_assets",
    "claim",
    "claim_refund",
    "create_market",
    "get_betting_state",
    "get_claimable_markets",
    "get_config",
    "get_market",
    "get_market_by_category_start",
    "get_markets",
    "get_open_markets",
    "get_source_evidence",
    "get_user_activity",
    "get_user_activity_count",
    "get_user_position",
    "get_user_positions",
    "place_bet",
    "settle_market",
}


def _request(method: str, params: list) -> dict:
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    request = urllib.request.Request(
        NODE_URL,
        data=payload.encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            # The studio endpoint rejects requests without a browser-ish agent.
            "User-Agent": "Mozilla/5.0 (compatible; fluff-tests)",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read())


def _readable_error(message: str) -> str:
    """Pull the GenVM traceback out of the node's stringified error tuple."""
    match = re.search(r"'stderr': '(.*?)', 'genvm_log'", message, re.S) or re.search(
        r"'stderr': '(.*?)'\}", message, re.S
    )
    if not match:
        return message[:1500]
    try:
        return match.group(1).encode().decode("unicode_escape").strip() or message[:1500]
    except UnicodeDecodeError:
        return match.group(1)[:1500]


@pytest.fixture(scope="module")
def live_schema() -> dict:
    code = CONTRACT.read_text(encoding="utf-8")
    try:
        result = _request("gen_getContractSchemaForCode", [code])
    except (urllib.error.URLError, TimeoutError, OSError) as failure:
        pytest.skip(f"no GenLayer node reachable at {NODE_URL}: {failure}")
    if "error" in result:
        pytest.fail(
            "the live GenVM rejected the contract:\n\n"
            + _readable_error(str(result["error"].get("message", result["error"])))
        )
    return result.get("result") or {}


def test_contract_loads_on_the_live_genvm(live_schema: dict):
    assert live_schema, "the node returned an empty schema"


def test_live_schema_exposes_every_public_method(live_schema: dict):
    assert set(live_schema.get("methods", {})) == EXPECTED_METHODS


def test_live_schema_marks_place_bet_payable(live_schema: dict):
    place_bet = live_schema.get("methods", {}).get("place_bet", {})
    assert place_bet.get("payable") is True


def test_live_schema_marks_reads_readonly(live_schema: dict):
    methods = live_schema.get("methods", {})
    for name in ("get_config", "get_market", "get_user_position"):
        assert methods.get(name, {}).get("readonly") is True, name
    for name in ("create_market", "place_bet", "settle_market", "claim", "claim_refund"):
        assert methods.get(name, {}).get("readonly") is False, name
