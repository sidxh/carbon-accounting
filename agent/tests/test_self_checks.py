"""Bills that check themselves: index arithmetic, price band, seasonal outlier,
and what happens to a failed check (a question, then `confirmed`). Offline."""

import json
from datetime import date
from pathlib import Path

from app.checks import check_index, check_price, confirm_failed_checks, normalise_currency, with_check
from app.models import ActivityLine, EnergyType, LineCheck, MeterRegister, Unit
from app.reconcile_tools import check_issues, prepare, seasonal_outliers

FY = (date(2025, 1, 1), date(2025, 12, 31))
R = MeterRegister


def reg(prev, cur, mult=1.0, cons=None):
    return R(label="r", previous=prev, current=cur, multiplier=mult, consumption=cons)


def month_line(i, qty, **kw):
    ps = date(2025, i, 1)
    pe = date(2025, i, 28)
    return ActivityLine(id=f"e{i}", supplier_id="s", source_doc_id=f"d{i}", site_id="main", energy_type=EnergyType.ELECTRICITY,
                        quantity=qty, unit=Unit.KWH, period_start=ps, period_end=pe, **kw)


# --- index ---------------------------------------------------------------------------

def test_index_passes_when_readings_times_multiplier_give_the_quantity():
    c = check_index([reg(1000, 1500), reg(200, 300, mult=10)], 1500, "kWh")   # 500 + 1000
    assert c and c.status == "pass"


def test_index_fails_on_a_misread_quantity():
    c = check_index([reg(951264, 978892), reg(280263, 289970), reg(181129, 188493)], 446990, "kWh")
    assert c and c.status == "fail" and "44,699" in c.detail and "446,990" in c.detail


def test_index_forgives_rounding_up_to_half_a_percent():
    assert check_index([reg(0, 10000)], 10040, "kWh").status == "pass"
    assert check_index([reg(0, 10000)], 10100, "kWh").status == "fail"


def test_index_is_silent_without_readings_or_on_rollover():
    assert check_index([], 100) is None
    assert check_index([R(label="x", consumption=100)], 100) is None
    assert check_index([reg(99_990, 20)], 100) is None


def test_index_one_misread_digit_is_not_a_misread_quantity():
    # Printed per-register consumption adds up to the total; only one raw reading is off.
    c = check_index([reg(1000, 2000, cons=1000), reg(500, 1500, cons=1000)], 2000)  # fine
    assert c.status == "pass"
    c = check_index([reg(1000, 2000, cons=1000), reg(356402, 471343, cons=14941)], 15941)
    assert c.status == "pass" and "consistent" in c.detail


# --- price ---------------------------------------------------------------------------

def test_price_inside_and_outside_the_band():
    ok = check_price(97_084_063, "VND", 42_569, "kWh", "electricity", "VN")
    assert ok and ok.status == "pass" and "2,281" in ok.detail
    bad = check_price(101_173_866, "VND", 446_990, "kWh", "electricity", "VN")
    assert bad and bad.status == "fail" and "1,200–4,500" in bad.detail


def test_price_is_silent_when_it_cannot_judge():
    assert check_price(None, "VND", 100, "kWh", "electricity", "VN") is None
    assert check_price(1000, "VND", 100, "kWh", "refrigerant", "VN") is None      # no band for refrigerant
    assert check_price(1000, "VND", 100, "kWh", "electricity", "ZZ") is None      # unknown country
    assert check_price(1000, "USD", 100, "kWh", "electricity", "VN") is None      # currency does not match
    assert check_price(1000, "VND", 100, "m3", "electricity", "VN") is None       # unit does not match


def test_currency_symbols_are_read_as_iso_codes():
    assert normalise_currency("đ", "VN") == "VND" and normalise_currency("₫", None) == "VND"
    assert normalise_currency("¥", "JP") == "JPY"
    assert normalise_currency("$", "AU") == "AUD" and normalise_currency("$", "VN") is None
    assert normalise_currency(None, "VN") is None


def test_every_price_band_has_a_sane_range():
    from app.checks import _bands
    assert len(_bands()) >= 8
    for b in _bands():
        assert 0 < b.low < b.high and b.currency and b.unit


# --- season --------------------------------------------------------------------------

def test_a_month_ten_times_its_own_pattern_is_flagged_and_normal_ones_pass():
    lines = [month_line(i, 10_000 + 300 * i) for i in range(1, 8)] + [month_line(8, 120_000)]
    out = {l.id: l for l in seasonal_outliers(lines)}
    assert out["e8"].checks[0].id == "season" and out["e8"].checks[0].status == "fail"
    assert all(out[f"e{i}"].checks[0].status == "pass" for i in range(1, 8))


def test_summer_peak_within_range_is_not_an_outlier():
    lines = [month_line(i, q) for i, q in enumerate([9_000, 9_500, 10_000, 12_000, 15_000, 19_000, 21_000, 20_000], 1)]
    assert all(c.status == "pass" for l in seasonal_outliers(lines) for c in l.checks)


def test_season_needs_a_pattern_and_ignores_estimates_and_short_periods():
    few = [month_line(i, 10_000) for i in range(1, 4)] + [month_line(5, 200_000)]
    assert all(not l.checks for l in seasonal_outliers(few))
    est = [month_line(i, 10_000) for i in range(1, 7)] + [month_line(7, 200_000, tier="estimated")]
    assert not next(l for l in seasonal_outliers(est) if l.id == "e7").checks


def test_season_is_idempotent_and_never_reopens_a_confirmed_check():
    lines = [month_line(i, 10_000) for i in range(1, 8)] + [month_line(8, 120_000)]
    once = seasonal_outliers(lines)
    twice = seasonal_outliers(once)
    assert [len(l.checks) for l in twice] == [1] * 8
    confirmed = [confirm_failed_checks(l) for l in once]
    assert next(l for l in seasonal_outliers(confirmed) if l.id == "e8").checks[0].status == "confirmed"


# --- issues --------------------------------------------------------------------------

def test_one_question_per_bad_bill_whatever_number_of_checks_it_fails():
    ln = month_line(3, 446_990)
    ln = with_check(ln, LineCheck(id="price", status="fail", detail="too cheap"))
    ln = with_check(ln, LineCheck(id="index", status="fail", detail="readings differ"))
    ln = with_check(ln, LineCheck(id="season", status="fail", detail="ten times"))
    (issue,) = check_issues([ln, month_line(4, 10_000)], set())
    assert issue.kind == "index_mismatch" and issue.line_ids == ["e3"]
    assert all(t in issue.detail for t in ("too cheap", "readings differ", "ten times"))
    assert check_issues([ln], {"e3"}) == []        # already asked about for legibility


def test_prepare_raises_the_questions_and_confirming_ends_them():
    lines = [month_line(i, 10_000) for i in range(1, 13)]
    lines[5] = with_check(lines[5], LineCheck(id="index", status="fail", detail="readings give 1,000"))
    kinds = [i.kind for i in prepare(lines, *FY).issues if not i.resolved]
    assert kinds == ["index_mismatch"]
    lines[5] = confirm_failed_checks(lines[5])
    assert not [i for i in prepare(lines, *FY).issues if i.kind == "index_mismatch"]


def test_a_planted_misread_in_a_whole_year_is_found_by_season_alone():
    lines = [month_line(i, 10_000 + 200 * i) for i in range(1, 13)]
    lines[5] = lines[5].model_copy(update={"quantity": 100_000})
    issues = [i for i in prepare(lines, *FY).issues if i.kind == "outlier"]
    assert [i.line_ids for i in issues] == [["e6"]]


# --- the planted golden bill ---------------------------------------------------------------

def test_golden_typo_bill_is_labelled_to_fail_index_and_price():
    labels = json.loads((Path(__file__).resolve().parents[2] / "data" / "golden" / "labels.json").read_text(encoding="utf-8"))
    typo = next(l for l in labels if l["name"] == "chk_evn_2025-06_typo")
    assert typo["expect_checks"] == {"index": "fail", "price": "fail"}
    assert typo["lines"][0]["quantity"] == 446990
    assert not any(l.get("expect_checks") for l in labels if l is not typo)


def test_editing_a_flagged_quantity_marks_its_failed_checks_confirmed(client):
    from tests.test_api import _auth, _seed_reconciled_period

    pid = _seed_reconciled_period(client)
    a1 = next(l for l in client.repo.list_activity_lines("sup-1", pid) if l.id == "a1")
    client.repo.update_activity_line("sup-1", pid, a1.model_copy(update={"checks": [LineCheck(id="index", status="fail", detail="x"), LineCheck(id="price", status="pass", detail="y")]}))
    r = client.patch(f"/suppliers/sup-1/periods/{pid}/activity-lines/a1", json={"quantity": 11000}, headers=_auth())
    assert r.status_code == 200
    got = next(l for l in client.repo.list_activity_lines("sup-1", pid) if l.id == "a1")
    assert {c.id: c.status for c in got.checks} == {"index": "confirmed", "price": "pass"}
