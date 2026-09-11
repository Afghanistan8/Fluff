"""Deployment constraints that are easy to break by accident."""

from conftest import CONTRACT

GENVM_MAX_CONTRACT_BYTES = 52_224


def test_contract_fits_inside_the_genvm_size_limit():
    size = CONTRACT.stat().st_size
    assert size <= GENVM_MAX_CONTRACT_BYTES, (
        f"contract is {size} bytes, limit is {GENVM_MAX_CONTRACT_BYTES}"
    )


def test_contract_declares_its_runner():
    header = CONTRACT.read_text(encoding="utf-8").splitlines()[0]
    assert '"Depends"' in header
    assert "py-genlayer" in header


def test_contract_holds_no_dynamic_arrays():
    """Storage is TreeMap-only by design, so reads stay bounded."""
    source = CONTRACT.read_text(encoding="utf-8")
    assert "DynArray" not in source


def test_contract_has_no_owner_or_pause_controls():
    source = CONTRACT.read_text(encoding="utf-8").lower()
    for forbidden in ("owner", "pause", "upgrade", "onlyadmin", "admin_"):
        assert forbidden not in source, f"found an authority hook: {forbidden}"
