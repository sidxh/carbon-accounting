"""The question banks are data we answer for, so they are held to what they claim: official numbers, real sources."""

import re
from typing import get_args

from app.agents.filler import Field_
from app.questionnaires import PACK_FACTS, all_banks, get_bank

KNOWN_FIELDS = (set(get_args(Field_)) | PACK_FACTS) - {"not_a_question"}


def test_four_banks_exist_with_a_source_and_a_version():
    banks = all_banks()
    assert set(banks) == {"cdp_sme", "vsme_b3", "higg_fem_energy", "ecovadis_carbon"}
    for b in banks.values():
        assert b.version.strip() and b.sources, b.id
        assert all(s.url.startswith("https://") and s.title for s in b.sources), b.id
        assert b.delivery in ("portal", "excel")


def test_refs_are_unique_and_every_field_is_one_we_can_compute():
    for b in all_banks().values():
        assert len(set(b.refs)) == len(b.refs), b.id
        for q in b.questions:
            assert q.text.strip() and q.ref.strip()
            assert q.field is None or q.field in KNOWN_FIELDS, (b.id, q.ref, q.field)
            for c in q.columns:
                assert c.field is None or c.field in KNOWN_FIELDS, (b.id, q.ref, c.field)


def test_cdp_numbers_are_the_official_ones_not_the_invented_ones():
    b = get_bank("cdp_sme")
    # numbers our first synthetic sheet made up
    for wrong in ("20.5a", "20.5b", "20.12a", "20.12b", "20.15.3"):
        assert b.question(wrong) is None
    # 20.6 is revenue by country, methodology is 20.2
    assert "revenue" in b.question("20.6").text and b.question("20.6").field is None
    assert "standard, protocol, or methodology" in b.question("20.2").text and b.question("20.2").field == "methodology"
    # 20.5 is one question with a column per approach
    cols = [c.field for c in b.question("20.5").columns]
    assert cols[:2] == ["scope2_location_tco2e", "scope2_market_tco2e"]
    assert b.question("20.12").text.startswith("Allocate your emissions to your customers")
    assert b.question("20.15.2").field == "electricity_mwh"
    for ref in ("20.4", "20.7", "20.8", "20.9", "20.16", "20.17"):
        assert b.question(ref) is not None, ref


def test_a_question_nobody_can_derive_from_bills_has_no_field():
    cdp = get_bank("cdp_sme")
    for ref in ("20.1", "20.3", "20.6", "20.13", "20.14"):
        assert cdp.question(ref).field is None
    higg = get_bank("higg_fem_energy")
    for ref in ("Q2", "Q3", "Q4", "Q7"):
        assert higg.question(ref).field is None


def test_ecovadis_never_claims_question_numbers_or_quotations():
    b = get_bank("ecovadis_carbon")
    assert b.wording == "metric_name"
    for q in b.questions:
        assert q.wording in ("metric_name", "topic")
        assert not re.match(r"^\d+(\.\d+)*$", q.ref)
    # the two Scope 2 metrics EcoVadis names since May 2026
    texts = {q.text for q in b.questions}
    assert "Total gross location-based Scope 2 GHG emissions" in texts
    assert "Total gross market-based Scope 2 GHG emissions" in texts


def test_higg_questions_carry_the_published_ref_ids():
    b = get_bank("higg_fem_energy")
    assert b.question("Q1").ref_id == "ensourcefacility"
    assert b.question("Q3").ref_id == "ensourcepurcheac"
    assert b.question("Q20").ref_id == "enscope3ghg"


def test_vsme_entries_name_the_template_range_they_fill():
    b = get_bank("vsme_b3")
    assert b.template_file.endswith("VSME-Digital-Template-1.3.0.xlsx")
    ranges = {q.named_range for q in b.questions}
    assert {"TotalEnergyConsumption", "GrossScope1GreenhouseGasEmissions", "Turnover", "NumberOfEmployees"} <= ranges
