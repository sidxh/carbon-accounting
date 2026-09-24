from datetime import date

import pytest

from app.models import ActivityLine, EnergyType, Unit
from app.reconcile_tools import (
    apportion_to_fiscal_year,
    dedupe_overlaps,
    exclude_lines,
    find_gaps,
    normalize_units,
    prepare,
    resolve_gap,
    resolve_hours,
)

FY = (date(2025, 1, 1), date(2025, 12, 31))


def L(id_, et, qty, unit, ps, pe, *, site="s1", doc="d", conf=1.0):
    return ActivityLine(id=id_, supplier_id="sup", source_doc_id=doc, site_id=site, energy_type=et,
                        quantity=qty, unit=unit, period_start=ps, period_end=pe, confidence=conf)


def test_normalize_converts_mwh_and_lpg_litres_and_flags_hours():
    lines = [
        L("a", EnergyType.ELECTRICITY, 2.5, Unit.MWH, date(2025, 1, 1), date(2025, 1, 31)),
        L("b", EnergyType.LPG, 200, Unit.LITRE, date(2025, 2, 1), date(2025, 2, 28)),
        L("c", EnergyType.DIESEL, 40, Unit.HOUR, date(2025, 3, 1), date(2025, 3, 1)),
    ]
    out, issues = normalize_units(lines)
    a, b, c = out
    assert (a.quantity, a.unit) == (2500, Unit.KWH)
    assert b.unit == Unit.KG and b.quantity == pytest.approx(102)
    assert "converted from 200" in b.notes
    assert c.unit == Unit.HOUR
    assert len(issues) == 1 and issues[0].kind == "unit_hours" and issues[0].line_ids == ["c"]


def test_dedupe_drops_same_bill_read_twice_and_keeps_lineage():
    a = L("a", EnergyType.ELECTRICITY, 42_569, Unit.KWH, date(2025, 3, 5), date(2025, 4, 4), doc="bill")
    b = L("b", EnergyType.ELECTRICITY, 42_569, Unit.KWH, date(2025, 3, 5), date(2025, 4, 4), doc="photo")
    other = L("c", EnergyType.ELECTRICITY, 41_000, Unit.KWH, date(2025, 4, 5), date(2025, 5, 4))
    kept, issues = dedupe_overlaps([b, a, other])
    assert [k.id for k in kept] == ["a", "c"]  # earliest doc id kept deterministically
    assert "also in document photo" in kept[0].notes
    assert issues[0].kind == "duplicate" and issues[0].resolved


def test_dedupe_does_not_merge_adjacent_months_with_similar_usage():
    a = L("a", EnergyType.ELECTRICITY, 40_000, Unit.KWH, date(2025, 1, 5), date(2025, 2, 4))
    b = L("b", EnergyType.ELECTRICITY, 40_100, Unit.KWH, date(2025, 2, 5), date(2025, 3, 4))
    kept, issues = dedupe_overlaps([a, b])
    assert len(kept) == 2 and not issues


def test_apportion_prorates_straddling_bill_and_drops_outside():
    dec = L("d", EnergyType.ELECTRICITY, 31_000, Unit.KWH, date(2025, 12, 5), date(2026, 1, 4))
    old = L("o", EnergyType.ELECTRICITY, 9_999, Unit.KWH, date(2024, 11, 1), date(2024, 11, 30))
    inside = L("i", EnergyType.DIESEL, 1000, Unit.LITRE, date(2025, 6, 1), date(2025, 6, 1))
    out, dropped = apportion_to_fiscal_year([dec, old, inside], *FY)
    assert dropped == ["o"]
    d = next(l for l in out if l.id == "d")
    assert d.quantity == pytest.approx(31_000 * 27 / 31)  # 5–31 Dec = 27 of 31 days
    assert d.period_end == date(2025, 12, 31) and d.tier == "primary"
    assert "27/31 days" in d.notes


def test_find_gaps_reports_missing_months_for_periodic_types_only():
    lpg = [L(f"g{m}", EnergyType.LPG, 500, Unit.KG, date(2025, m, 1), date(2025, m, 28)) for m in (1, 2, 3, 4, 5, 6, 10, 11, 12)]
    diesel = [L("dz", EnergyType.DIESEL, 2000, Unit.LITRE, date(2025, 3, 10), date(2025, 3, 10))]
    issues = find_gaps(lpg + diesel, *FY)
    assert len(issues) == 1
    assert issues[0].energy_type == EnergyType.LPG
    assert issues[0].months == ["2025-07", "2025-08", "2025-09"]


def test_find_gaps_treats_straddling_electricity_bills_as_full_coverage():
    bills = []
    for m in range(1, 13):
        ps = date(2025, m, 5)
        pe = date(2025 + (m == 12), (m % 12) + 1, 4)
        bills.append(L(f"e{m}", EnergyType.ELECTRICITY, 40_000, Unit.KWH, ps, pe))
    out, _ = apportion_to_fiscal_year(bills, *FY)
    assert find_gaps(out, *FY) == []


def test_resolve_gap_extrapolates_and_records_assumption_on_estimated_lines():
    lpg = [L(f"g{m}", EnergyType.LPG, 600, Unit.KG, date(2025, m, 1), date(2025, m, 28)) for m in (1, 2, 3, 4, 5, 6, 10, 11, 12)]
    (issue,) = find_gaps(lpg, *FY)
    new, asm = resolve_gap(issue, lpg, supplier_id="sup", resolution="extrapolate_average",
                           question="Did the furnace run Jul–Sep?", answer="Yes, as usual.")
    assert len(new) == 3 and all(l.tier == "estimated" for l in new)
    assert all(l.assumption_ids == [asm.id] for l in new)
    assert set(asm.applied_to) == {l.id for l in new}
    # 600 kg over 28 days × 31 days in July
    july = next(l for l in new if l.period_start.month == 7)
    assert july.quantity == pytest.approx(600 / 28 * 31, rel=1e-3)
    assert issue.resolved


def test_resolve_gap_zero_records_no_consumption():
    lpg = [L("g1", EnergyType.LPG, 600, Unit.KG, date(2025, 1, 1), date(2025, 1, 31))]
    issue = find_gaps(lpg, *FY)[0]
    new, asm = resolve_gap(issue, lpg, supplier_id="sup", resolution="zero", question="q", answer="No, shut for maintenance")
    assert len(new) == 11 and all(l.quantity == 0 for l in new)
    assert "zero recorded" in asm.method


def test_resolve_hours_converts_runtime_to_litres_as_secondary():
    gen = L("h", EnergyType.DIESEL, 40, Unit.HOUR, date(2025, 3, 1), date(2025, 3, 31))
    _, issues = normalize_units([gen])
    out, asm = resolve_hours(issues[0], [gen], supplier_id="sup", litres_per_hour=12.5, question="q", answer="12.5 L/h")
    (l,) = out
    assert (l.quantity, l.unit, l.tier) == (500, Unit.LITRE, "secondary")
    assert asm.id in l.assumption_ids


def test_exclude_lines_removes_landlord_generator():
    a = L("a", EnergyType.DIESEL, 100, Unit.LITRE, date(2025, 1, 1), date(2025, 1, 1))
    b = L("b", EnergyType.DIESEL, 100, Unit.LITRE, date(2025, 2, 1), date(2025, 2, 1))
    out, asm = exclude_lines(["a"], [a, b], supplier_id="sup", question="Whose generator?", answer="Landlord's", reason="landlord-operated")
    assert [l.id for l in out] == ["b"] and asm.applied_to == ["a"]


def test_prepare_runs_the_whole_pipeline_and_flags_low_confidence():
    lines = [
        L("e1", EnergyType.ELECTRICITY, 40, Unit.MWH, date(2025, 1, 5), date(2025, 2, 4)),
        L("e1b", EnergyType.ELECTRICITY, 40_000, Unit.KWH, date(2025, 1, 5), date(2025, 2, 4), doc="dup"),
        L("lc", EnergyType.DIESEL, 1000, Unit.LITRE, date(2025, 5, 1), date(2025, 5, 1), conf=0.4),
    ]
    p = prepare(lines, *FY)
    kinds = sorted(i.kind for i in p.issues)
    assert "duplicate" in kinds and "gap" in kinds and "low_confidence" in kinds
    assert len([l for l in p.lines if l.energy_type == EnergyType.ELECTRICITY]) == 1
