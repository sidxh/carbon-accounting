"""Render the golden bill set.

    agent/.venv/bin/python data/golden/render.py            # ~50 documents
    agent/.venv/bin/python data/golden/render.py --limit 5  # quick check

Writes `rendered/<name>.png` (and a PDF for a subset) plus `labels.json`, the
ground truth the extraction eval scores against. Everything is seeded so the
set is reproducible and the eval is comparable run to run.

Three suppliers, three languages:
  * Minh Phát Mechanical, Đồng Nai, Vietnam — FY Jan–Dec 2025. EVN monthly
    bills whose periods straddle month ends, diesel deliveries, LPG monthly
    with Q3 missing (the gap the reconciler must ask about), two refrigerant
    top-ups, one duplicate bill, two "photographed" variants.
  * Takahashi Seimitsu, Aichi, Japan — Apr–Sep 2025 electricity, diesel, LPG.
  * Riverside Fabrication, Adelaide, Australia — quarterly electricity, diesel.
"""

from __future__ import annotations

import argparse
import base64
import calendar
import hashlib
import json
import os
import random
from datetime import date, timedelta
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE / "templates"
OUT = HERE / "rendered"
AGENT = HERE.parents[1] / "agent"

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(AGENT / ".playwright"))

env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html"]))
rng = random.Random(20260924)


def wobble(text) -> Markup:
    """Hand-written look: every character a little off the line, tilted and a different size, the same way every run."""
    out = []
    for i, ch in enumerate(str(text)):
        if ch == " ":
            out.append(" ")
            continue
        h = hashlib.md5(f"{text}|{i}".encode()).digest()
        out.append(f'<span style="display:inline-block;transform:translateY({(h[1] / 255 - .5) * 3.4:.1f}px) '
                   f'rotate({(h[0] / 255 - .5) * 8:.1f}deg) scale({0.93 + h[2] / 255 * 0.14:.2f})">{escape(ch)}</span>')
    return Markup("".join(out))


env.filters["wobble"] = wobble
# The handwriting font (Yomogi, SIL OFL) is embedded in the slips as base64 so renders need no network or file access.
env.globals["hand_font_b64"] = base64.b64encode((TEMPLATES / "fonts" / "Yomogi-Regular.ttf").read_bytes()).decode()


# --- helpers ----------------------------------------------------------------

def month_end(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


VI_DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]


def vi_words(n: int) -> str:
    """Rough Vietnamese amount-in-words, good enough for a bill footer."""
    if n == 0:
        return "không đồng"
    units = ["", " nghìn", " triệu", " tỷ"]
    parts = []
    i = 0
    while n > 0 and i < len(units):
        chunk = n % 1000
        if chunk:
            h, t, u = chunk // 100, (chunk // 10) % 10, chunk % 10
            s = []
            if h or parts:
                s.append(f"{VI_DIGITS[h]} trăm")
            if t > 1:
                s.append(f"{VI_DIGITS[t]} mươi" + (f" {VI_DIGITS[u]}" if u else ""))
            elif t == 1:
                s.append("mười" + (f" {VI_DIGITS[u]}" if u else ""))
            elif u:
                s.append(("lẻ " if (h or parts) else "") + VI_DIGITS[u])
            parts.append(" ".join(s) + units[i])
        n //= 1000
        i += 1
    words = " ".join(reversed(parts))
    if words.startswith("không trăm "):
        words = words[len("không trăm "):]
    return (words + " đồng chẵn").capitalize()


def photo_style(r: random.Random | None = None) -> dict:
    r = r or rng
    return {
        "rotate": round(r.uniform(-1.6, 1.6), 2),
        "skew": round(r.uniform(-0.8, 0.8), 2),
        "contrast": round(r.uniform(0.9, 1.08), 2),
        "brightness": round(r.uniform(0.94, 1.04), 2),
        "sepia": round(r.uniform(0.05, 0.22), 2),
    }


# --- scenario: Vietnam -----------------------------------------------------

VN = dict(
    customer="CÔNG TY TNHH CƠ KHÍ MINH PHÁT",
    customer_tax="3602453310",
    address="Lô A3, KCN Nhơn Trạch 3, xã Hiệp Phước, huyện Nhơn Trạch, tỉnh Đồng Nai",
    site_hint="Nhơn Trạch",
)


def vn_documents() -> list[dict]:
    docs: list[dict] = []
    # EVN monthly, periods 05/MM -> 04/MM+1 so they straddle month ends.
    old_n, old_p, old_l = 812_440, 233_115, 140_902
    for m in range(1, 13):
        ps = date(2025, m, 5)
        pe = add_months(ps, 1) - timedelta(days=1)
        kn = rng.randint(24_000, 31_000)
        kp = rng.randint(7_500, 10_500)
        kl = rng.randint(6_000, 9_000)
        prices = (1_869, 3_414, 1_209)
        sub = kn * prices[0] + kp * prices[1] + kl * prices[2]
        vat = round(sub * 0.08)
        ctx = dict(
            lang="vi", province="Đồng Nai", district="Nhơn Trạch", invoice_no=f"00{4_000_000 + m * 1_331:07d}",
            period_no=1, period_start=ps, period_end=pe, issue_date=pe + timedelta(days=2),
            customer=VN["customer"], address=VN["address"], customer_code="PB04010" + f"{58_211 + m:06d}",
            meter_no=f"3P{2_211_400 + m}", old_normal=old_n, new_normal=old_n + kn, kwh_normal=kn,
            old_peak=old_p, new_peak=old_p + kp, kwh_peak=kp, old_low=old_l, new_low=old_l + kl, kwh_low=kl,
            kwh_total=kn + kp + kl, price_normal=prices[0], price_peak=prices[1], price_low=prices[2],
            subtotal=sub, vat=vat, total=sub + vat, amount_words=vi_words(sub + vat),
        )
        old_n, old_p, old_l = old_n + kn, old_p + kp, old_l + kl
        docs.append(dict(
            name=f"vn_evn_2025-{m:02d}", template="vi_evn_electricity.html", ctx=ctx, lang="vi",
            doc_type="electricity_bill", vendor="EVN SPC", customer=VN["customer"], site_hint=VN["site_hint"],
            lines=[dict(energy_type="electricity", quantity=kn + kp + kl, unit="kWh",
                        period_start=ps.isoformat(), period_end=pe.isoformat(), gas=None)],
            amount=sub + vat, currency="VND", pdf=(m in (1, 7)),
        ))
    # Duplicate of March, as a photo.
    march = next(d for d in docs if d["name"] == "vn_evn_2025-03")
    docs.append({**march, "name": "vn_evn_2025-03_photo_dup", "photo": photo_style(),
                 "duplicate_of": "vn_evn_2025-03", "pdf": False})

    # Diesel deliveries.
    for i, m in enumerate((1, 3, 5, 7, 9, 11)):
        dd = date(2025, m, rng.randint(6, 24))
        litres = rng.randrange(2_000, 4_200, 50)
        price = rng.choice((19_650, 20_100, 20_480, 19_920))
        delivery = 850_000 if i % 2 == 0 else 0
        sub = litres * price + delivery
        vat = round(sub * 0.10)
        ctx = dict(
            lang="vi", vendor="CÔNG TY XĂNG DẦU ĐỒNG NAI", vendor_address="65 Nguyễn Ái Quốc, TP. Biên Hòa, Đồng Nai",
            vendor_tax="3600254117", series="1C25TXD", invoice_no=f"{1_180 + i * 37:08d}", issue_date=dd,
            customer=VN["customer"], customer_tax=VN["customer_tax"], address=VN["address"],
            litres=litres, price=price, with_delivery=bool(delivery), delivery=delivery, subtotal=sub, vat=vat,
            total=sub + vat, amount_words=vi_words(sub + vat), buyer_sign="N.V. Minh", seller_sign="Trần Q. Hùng",
            delivery_date=dd, truck=f"60C-{rng.randint(100, 999)}.{rng.randint(10, 99)}", lookup_code=f"K{rng.randint(10**7, 10**8-1)}",
        )
        docs.append(dict(
            name=f"vn_diesel_2025-{m:02d}", template="vi_diesel_receipt.html", ctx=ctx, lang="vi",
            doc_type="fuel_invoice", vendor=ctx["vendor"], customer=VN["customer"], site_hint=VN["site_hint"],
            lines=[dict(energy_type="diesel", quantity=litres, unit="L",
                        period_start=dd.isoformat(), period_end=dd.isoformat(), gas=None)],
            amount=sub + vat, currency="VND", pdf=(i == 0), photo=(photo_style() if i == 3 else None),
        ))

    # LPG monthly with Q3 missing.
    for i, m in enumerate((1, 2, 3, 4, 5, 6, 10, 11, 12)):
        cyl = rng.randint(10, 20)
        kg = cyl * 45
        price = rng.choice((24_800, 25_300, 23_900))
        sub = kg * price
        vat = round(sub * 0.10)
        dd = date(2025, m, rng.randint(2, 9))
        ctx = dict(
            lang="vi", vendor="CÔNG TY CP GAS PETROLIMEX SÀI GÒN", vendor_address="138 Trần Hưng Đạo, Q.1, TP.HCM",
            vendor_tax="0301409430", series="1C25TGP", invoice_no=f"{9_021 + i * 53:08d}", issue_date=dd,
            customer=VN["customer"], customer_tax=VN["customer_tax"], address=VN["address"],
            cyl_kg=45, cylinders=cyl, kg=kg, price=price, subtotal=sub, vat=vat, total=sub + vat,
            period_start=date(2025, m, 1), buyer_sign="N.V. Minh", seller_sign="Lê Thị Hòa", lookup_code=f"G{rng.randint(10**7, 10**8-1)}",
        )
        docs.append(dict(
            name=f"vn_lpg_2025-{m:02d}", template="vi_lpg_invoice.html", ctx=ctx, lang="vi",
            doc_type="fuel_invoice", vendor=ctx["vendor"], customer=VN["customer"], site_hint=VN["site_hint"],
            lines=[dict(energy_type="lpg", quantity=kg, unit="kg",
                        period_start=date(2025, m, 1).isoformat(), period_end=month_end(date(2025, m, 1)).isoformat(), gas=None)],
            amount=sub + vat, currency="VND", pdf=False, photo=(photo_style() if i == 5 else None),
        ))

    # Refrigerant top-ups.
    for i, (m, gas, kg, equip) in enumerate(((4, "R-410A", 3.5, "Điều hòa trung tâm VRV xưởng 1 (Daikin 40HP)"),
                                            (9, "R-22", 6.0, "Chiller làm mát dầu máy CNC (Carrier 30HXC)"))):
        sd = date(2025, m, rng.randint(8, 26))
        labour = 1_500_000
        gas_price = 620_000 if gas == "R-410A" else 380_000
        total = int(labour + kg * gas_price)
        ctx = dict(
            lang="vi", vendor="ĐIỆN LẠNH HOÀNG PHÁT", vendor_phone="0903 771 224", slip_no=f"BT-{2025}{m:02d}-{rng.randint(10, 99)}",
            service_date=sd, customer=VN["customer"], address=VN["address"], equipment=equip, gas=gas, kg=kg,
            labour=labour, gas_price=gas_price, total=total, pressure=rng.randint(118, 142),
            note="rò nhẹ tại van dịch vụ, đã xiết lại", tech_sign="Hoàng V. Phát", buyer_sign="N.V. Minh",
        )
        docs.append(dict(
            name=f"vn_refrigerant_2025-{m:02d}", template="vi_refrigerant_slip.html", ctx=ctx, lang="vi",
            doc_type="refrigerant_service", vendor=ctx["vendor"], customer=VN["customer"], site_hint=VN["site_hint"],
            lines=[dict(energy_type="refrigerant", quantity=kg, unit="kg",
                        period_start=sd.isoformat(), period_end=sd.isoformat(), gas=gas)],
            amount=total, currency="VND", pdf=(i == 0),
        ))
    return docs


# --- scenario: Japan ----------------------------------------------------------

JP = dict(customer="株式会社 高橋精密", address="愛知県刈谷市一里山町東吹戸 12-3", site_hint="刈谷")


def jp_documents() -> list[dict]:
    docs: list[dict] = []
    od, on = 1_204_110, 388_020
    for m in range(4, 10):
        ps = date(2025, m, 1)
        pe = month_end(ps)
        kd = rng.randint(41_000, 56_000)
        kn = rng.randint(13_000, 19_000)
        energy = round(kd * 17.8 + kn * 12.4)
        basic, fuel_adj, levy = 286_000, round((kd + kn) * -1.2), round((kd + kn) * 3.49)
        total = round((basic + energy + fuel_adj + levy) * 1.10)
        ctx = dict(
            lang="ja", vendor="中部電力ミライズ株式会社", vendor_address="名古屋市東区東新町1番地", vendor_phone="0120-985-232",
            customer_code=f"23-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}", issue_date=pe + timedelta(days=3),
            period_start=ps, period_end=pe, days=(pe - ps).days + 1, customer=JP["customer"], address=JP["address"],
            old_day=od, new_day=od + kd, kwh_day=kd, old_night=on, new_night=on + kn, kwh_night=kn, kwh_total=kd + kn,
            basic=basic, energy_charge=energy, fuel_adj=fuel_adj, renewable_levy=levy, total=total, due_date=pe + timedelta(days=30),
        )
        od, on = od + kd, on + kn
        docs.append(dict(
            name=f"jp_elec_2025-{m:02d}", template="ja_electricity.html", ctx=ctx, lang="ja",
            doc_type="electricity_bill", vendor=ctx["vendor"], customer=JP["customer"], site_hint=JP["site_hint"],
            lines=[dict(energy_type="electricity", quantity=kd + kn, unit="kWh",
                        period_start=ps.isoformat(), period_end=pe.isoformat(), gas=None)],
            amount=total, currency="JPY", pdf=(m == 4),
        ))
    for i, m in enumerate((4, 6, 8)):
        dd = date(2025, m, rng.randint(5, 25))
        litres = rng.randrange(1_500, 3_000, 100)
        price = rng.choice((148.5, 151.0, 146.0))
        sub = int(litres * price)
        vat = round(sub * 0.10)
        ctx = dict(
            lang="ja", vendor="東海石油販売株式会社", vendor_address="愛知県豊田市若宮町 4-1", vendor_tax=f"T{rng.randint(10**12, 10**13-1)}",
            invoice_no=f"N25-{rng.randint(10000, 99999)}", delivery_date=dd, customer=JP["customer"], address=JP["address"],
            litres=litres, price=price, subtotal=sub, vat=vat, total=sub + vat, tank_before=rng.randint(400, 900),
            tank_after=rng.randint(2_400, 3_800), buyer_sign="高橋", seller_sign="佐藤",
        )
        docs.append(dict(
            name=f"jp_diesel_2025-{m:02d}", template="ja_diesel_delivery.html", ctx=ctx, lang="ja",
            doc_type="fuel_invoice", vendor=ctx["vendor"], customer=JP["customer"], site_hint=JP["site_hint"],
            lines=[dict(energy_type="diesel", quantity=litres, unit="L", period_start=dd.isoformat(), period_end=dd.isoformat(), gas=None)],
            amount=sub + vat, currency="JPY", pdf=False,
        ))
    for m in (5, 8):
        ps = date(2025, m, 1)
        pe = month_end(ps)
        kg = rng.randint(380, 720)
        price = 312
        basic = 22_000
        vat = round((kg * price + basic) * 0.10)
        ctx = dict(
            lang="ja", vendor="愛知プロパン株式会社", vendor_address="愛知県安城市三河安城町 2-8", invoice_no=f"LP-{rng.randint(100000, 999999)}",
            issue_date=pe + timedelta(days=5), period_start=ps, period_end=pe, customer=JP["customer"], address=JP["address"],
            cyl_kg=50, kg=kg, price=price, basic=basic, vat=vat, total=kg * price + basic + vat,
        )
        docs.append(dict(
            name=f"jp_lpg_2025-{m:02d}", template="ja_lpg_invoice.html", ctx=ctx, lang="ja",
            doc_type="fuel_invoice", vendor=ctx["vendor"], customer=JP["customer"], site_hint=JP["site_hint"],
            lines=[dict(energy_type="lpg", quantity=kg, unit="kg", period_start=ps.isoformat(), period_end=pe.isoformat(), gas=None)],
            amount=kg * price + basic + vat, currency="JPY", pdf=False,
        ))
    return docs


# --- sample pack: Japan, one varied fiscal year -------------------------------------
# The set evaluators download from the Bills page. Unlike the golden set above it is built to *show range*: printed
# bills, a PDF, phone photos, a scan lying on its side, a fax, hand-written slips, a bill with a misprinted total, a
# month with no bill, and a duplicate. It has its own random generator so adding to it never moves the golden set,
# and its own labels file (labels_pack.json) so the 90% accuracy gate on the golden set is not held to it.

JPP = dict(customer="株式会社 高橋精密", address="愛知県刈谷市一里山町東吹戸 12-3", site_hint="刈谷")


def reiwa(d: date) -> str:
    return f"令和{d.year - 2018}年{d.month}月{d.day}日"


def jdate(d: date) -> str:
    return f"{d.year}年{d.month}月{d.day}日"


def jp_pack_documents() -> list[dict]:
    r = random.Random(20251016)
    docs: list[dict] = []

    def base(name, template, ctx, doc_type, vendor, lines, amount, note, **extra):
        docs.append(dict(name=f"jpx_{name}", template=template, ctx=ctx, lang="ja", doc_type=doc_type, vendor=vendor,
                         customer=JPP["customer"], site_hint=JPP["site_hint"], lines=lines, amount=amount, currency="JPY",
                         pack_note=note, **extra))

    def line(et, qty, unit, ps, pe, gas=None):
        return [dict(energy_type=et, quantity=qty, unit=unit, period_start=ps.isoformat(), period_end=pe.isoformat(), gas=gas)]

    # Electricity, April 2025 to March 2026. January is never issued, but its readings still happen, so
    # February's "previous reading" is January's end: the gap is real, not a skipped counter.
    od, on = 1_204_110, 388_020
    months = [(2025, m) for m in range(4, 13)] + [(2026, m) for m in (1, 2, 3)]
    for y, m in months:
        ps, pe = date(y, m, 1), month_end(date(y, m, 1))
        kd, kn = r.randint(41_000, 56_000), r.randint(13_000, 19_000)
        energy = round(kd * 17.8 + kn * 12.4)
        basic, fuel_adj, levy = 286_000, round((kd + kn) * -1.2), round((kd + kn) * 3.49)
        total = round((basic + energy + fuel_adj + levy) * 1.10)
        ctx = dict(
            lang="ja", vendor="中部電力ミライズ株式会社", vendor_address="名古屋市東区東新町1番地", vendor_phone="0120-985-232",
            customer_code="23-4417-0852", issue_date=pe + timedelta(days=3), period_start=ps, period_end=pe,
            days=(pe - ps).days + 1, customer=JPP["customer"], address=JPP["address"], old_day=od, new_day=od + kd, kwh_day=kd,
            old_night=on, new_night=on + kn, kwh_night=kn, kwh_total=kd + kn, basic=basic, energy_charge=energy,
            fuel_adj=fuel_adj, renewable_levy=levy, total=total, due_date=pe + timedelta(days=30),
        )
        od, on = od + kd, on + kn
        if (y, m) == (2026, 1):
            continue
        tag = f"{y}-{m:02d}"
        kw = dict(pdf=False)
        note = "printed bill, two meter registers (day and night); the reading check passes"
        if tag == "2025-07":
            kw, note = dict(pdf=True, ship="pdf"), "PDF, not an image; read the same way"
        elif tag == "2025-09":
            kw, note = dict(pdf=False, photo=photo_style(r), post="phone"), "phone photo taken at an angle, JPEG, slightly soft"
        elif tag == "2025-11":
            bad = int(f"{kd + kn}0")
            ctx = {**ctx, "kwh_total": bad}
            kw, note = dict(pdf=False, expect_checks={"index": "fail", "price": "fail"}), \
                "misprinted total (a stray digit): the meter readings and the amount disagree, so the check flags it for review"
            docs_total = bad
            base(f"elec_{tag}_misprint", "ja_electricity.html", ctx, "electricity_bill", ctx["vendor"], line("electricity", docs_total, "kWh", ps, pe), total, note, **kw)
            continue
        elif tag == "2026-02":
            note = "printed bill that follows the missing January: the reconciler asks about the gap"
        base(f"elec_{tag}", "ja_electricity.html", ctx, "electricity_bill", ctx["vendor"], line("electricity", kd + kn, "kWh", ps, pe), total, note, **kw)
        if tag == "2025-06":
            base(f"elec_{tag}_photo_dup", "ja_electricity.html", ctx, "electricity_bill", ctx["vendor"], line("electricity", kd + kn, "kWh", ps, pe), total,
                 "the same June bill photographed again: found as a duplicate and counted once",
                 pdf=False, photo=photo_style(r), post="phone", duplicate_of="jpx_elec_2025-06")

    # City gas, every two months, in cubic metres.
    idx = 48_210
    for i, (ps, pe) in enumerate(((date(2025, 4, 1), date(2025, 5, 31)), (date(2025, 6, 1), date(2025, 7, 31)), (date(2025, 8, 1), date(2025, 9, 30)),
                                  (date(2025, 10, 1), date(2025, 11, 30)), (date(2025, 12, 1), date(2026, 1, 31)), (date(2026, 2, 1), date(2026, 3, 31)))):
        m3 = r.randint(700, 1_300) if 1 <= i <= 2 else r.randint(1_500, 2_700)
        unit_price, basic = 118, 38_500
        energy = m3 * unit_price
        adj = round(m3 * -1.9)
        vat = round((basic + energy + adj) * 0.10)
        ctx = dict(vendor="東邦ガス株式会社", vendor_address="名古屋市熱田区桜田町19-18", vendor_phone="0120-0-14133", customer_code="710-33-2951",
                   issue_date=pe + timedelta(days=4), period_start=ps, period_end=pe, days=(pe - ps).days + 1, customer=JPP["customer"],
                   address=JPP["address"], old_idx=idx, new_idx=idx + m3, m3=m3, basic=basic, unit_price=unit_price, energy_charge=energy,
                   adj=adj, vat=vat, total=basic + energy + adj + vat, due_date=pe + timedelta(days=30))
        idx += m3
        note = "city gas in m3 (not kWh), covering two months"
        kw = dict(pdf=False)
        if i == 3:
            kw, note = dict(pdf=True, ship="pdf"), "PDF, two-month city gas bill"
        base(f"citygas_{ps.year}-{ps.month:02d}_{pe.month:02d}", "ja_citygas.html", ctx, "gas_bill", ctx["vendor"], line("natural_gas", m3, "m3", ps, pe),
             ctx["total"], note, **kw)

    def diesel_printed(tag, dd, **kw):
        litres = r.randrange(1_500, 3_000, 100)
        price = r.choice((148.5, 151.0, 146.0))
        sub = int(litres * price)
        vat = round(sub * 0.10)
        ctx = dict(lang="ja", vendor="東海石油販売株式会社", vendor_address="愛知県豊田市若宮町 4-1", vendor_tax=f"T{r.randint(10**12, 10**13 - 1)}",
                   invoice_no=f"N25-{r.randint(10000, 99999)}", delivery_date=dd, customer=JPP["customer"], address=JPP["address"], litres=litres,
                   price=price, subtotal=sub, vat=vat, total=sub + vat, tank_before=r.randint(400, 900), tank_after=r.randint(2_400, 3_800),
                   buyer_sign="高橋", seller_sign="佐藤")
        return ctx, litres, sub + vat

    def hand(name, et, unit, dd, qty, qty_text, amount, vendor, vendor_sub, title, item, price_hand, note_hand, sign, seal, era, note, *,
             color="#b3261e", ink="#14308a", paper="#fbf7e6", gas=None, doc_type="fuel_invoice", **kw):
        ctx = dict(vendor=vendor, vendor_sub=vendor_sub, form_no=f"{r.randint(1000, 9999)}", form_note="控（お客様用）", title=title,
                   date_text=reiwa(dd) if era else jdate(dd), customer_hand="高橋精密(株)", item_hand=item, qty_hand=qty_text, unit_printed=unit,
                   price_hand=price_hand, amount_hand=f"{amount:,}", note_hand=note_hand, sign_hand=sign, seal=seal, footer="ご利用ありがとうございました。",
                   form_color=color, ink=ink, paper=paper)
        base(name, "ja_handwritten_slip.html", ctx, doc_type, vendor, line(et, qty, unit, dd, dd, gas), amount, note, pdf=False, **kw)

    # Diesel: printed, hand-written, a scan lying on its side, a hand-written slip photographed.
    ctx, litres, amount = diesel_printed("", date(2025, 5, 14))
    base("diesel_2025-05", "ja_diesel_delivery.html", ctx, "fuel_invoice", ctx["vendor"], line("diesel", litres, "L", date(2025, 5, 14), date(2025, 5, 14)), amount,
         "printed delivery note", pdf=False)
    ctx, litres, amount = diesel_printed("", date(2025, 7, 9))
    base("diesel_2025-07", "ja_diesel_delivery.html", ctx, "fuel_invoice", ctx["vendor"], line("diesel", litres, "L", date(2025, 7, 9), date(2025, 7, 9)), amount,
         "printed delivery note", pdf=False)
    hand("diesel_2025-08_handwritten", "diesel", "L", date(2025, 8, 21), 2400, "2,400", 357_000, "東海石油販売", "愛知県豊田市若宮町 4-1 · 0565-31-0218",
         "軽 油 納 品 書", "軽油 (ローリー)", "148.5", "タンク満タン", "佐藤", "東海", False,
         "hand-written delivery slip on a pre-printed form, Gregorian date")
    ctx, litres, amount = diesel_printed("", date(2025, 11, 18))
    base("diesel_2025-11_scan_rotated", "ja_diesel_delivery.html", ctx, "fuel_invoice", ctx["vendor"], line("diesel", litres, "L", date(2025, 11, 18), date(2025, 11, 18)), amount,
         "a flatbed scan fed in sideways: the page is rotated 90 degrees and grey", pdf=False, post="scan90", no_box=True)
    hand("diesel_2026-02_handwritten_photo", "diesel", "L", date(2026, 2, 12), 1800, "1,800", 273_000, "東海石油販売", "愛知県豊田市若宮町 4-1 · 0565-31-0218",
         "軽 油 納 品 書", "軽油 (ローリー)", "151", "寒冷地 添加済", "佐藤", "東海", True,
         "hand-written slip with a Reiwa-era date (令和8年), then photographed", photo=photo_style(r), post="phone", ink="#222831")

    # Petrol for the company cars, hand-written.
    hand("petrol_2025-09_handwritten", "petrol", "L", date(2025, 9, 26), 410, "410", 68_470, "刈谷南給油所", "刈谷市小山町 3-7 · 0566-21-4410",
         "給 油 伝 票", "レギュラーガソリン (社用車)", "167", "月末まとめ", "高橋", "給油", False,
         "company-car petrol, hand-written account slip", color="#1a6b3a", ink="#1b1b1b", paper="#f4f8ee")

    # LPG: printed, a fax, a PDF.
    for tag, (ps, pe), kw, note in (
        ("2025-06", (date(2025, 6, 1), date(2025, 6, 30)), dict(pdf=False), "printed LPG invoice, cylinders reported as kg"),
        ("2025-10", (date(2025, 10, 1), date(2025, 10, 31)), dict(pdf=False, post="fax"), "received by fax: black and white, low resolution, with streaks"),
        ("2026-01", (date(2026, 1, 1), date(2026, 1, 31)), dict(pdf=True, ship="pdf"), "PDF LPG invoice"),
    ):
        kg = r.randint(380, 720)
        price, basic = 312, 22_000
        vat = round((kg * price + basic) * 0.10)
        ctx = dict(lang="ja", vendor="愛知プロパン株式会社", vendor_address="愛知県安城市三河安城町 2-8", invoice_no=f"LP-{r.randint(100000, 999999)}",
                   issue_date=pe + timedelta(days=5), period_start=ps, period_end=pe, customer=JPP["customer"], address=JPP["address"], cyl_kg=50, kg=kg,
                   price=price, basic=basic, vat=vat, total=kg * price + basic + vat)
        base(f"lpg_{tag}", "ja_lpg_invoice.html", ctx, "fuel_invoice", ctx["vendor"], line("lpg", kg, "kg", ps, pe), ctx["total"], note, **kw)

    # Kerosene for the boiler, from a local shop: two hand-written sales slips, the second photographed.
    hand("kerosene_2025-12_handwritten", "kerosene", "L", date(2025, 12, 8), 360, "360", 41_400, "鈴木燃料店", "刈谷市天王町 1-22 · 0566-23-0190",
         "灯 油 売 上 票", "灯油 (18L缶配達)", "115", "18L × 20缶", "鈴木", "鈴木", False,
         "hand-written kerosene slip: the quantity is cans, the litres are in the note", color="#2b5aa8", ink="#7a1f1f", paper="#f6f3ea")
    hand("kerosene_2026-02_handwritten_photo", "kerosene", "L", date(2026, 2, 3), 540, "540", 62_100, "鈴木燃料店", "刈谷市天王町 1-22 · 0566-23-0190",
         "灯 油 売 上 票", "灯油 (18L缶配達)", "115", "18L × 30缶", "鈴木", "鈴木", True,
         "hand-written kerosene slip photographed on a desk", color="#2b5aa8", ink="#7a1f1f", paper="#f6f3ea", photo=photo_style(r), post="phone")

    # Refrigerant top-ups: a printed certificate, and a hand-written work slip.
    sd = date(2025, 7, 17)
    ctx = dict(vendor="アイシー冷熱サービス株式会社", vendor_address="愛知県刈谷市桜町 2-15", reg_no="愛知県 第 1-0482 号", cert_no=f"RC-{r.randint(10000, 99999)}",
               service_date=sd, customer=JPP["customer"], address=JPP["address"], equipment="業務用パッケージエアコン（天吊形）", model="PKZ-P140KLR",
               gas="R-410A", kg=4.2, pressure="0.62", reason="経年による微小漏えい、補充", tech="森田", total=58_300)
    base("refrigerant_2025-07", "ja_refrigerant.html", ctx, "refrigerant_service", ctx["vendor"], line("refrigerant", 4.2, "kg", sd, sd, "R-410A"), 58_300,
         "refrigerant fill certificate (フロン類充塡証明書): the kg charged and the blend, R-410A", pdf=False)
    hand("refrigerant_2026-01_handwritten", "refrigerant", "kg", date(2026, 1, 22), 3.5, "3.5", 33_600, "山田冷機サービス", "刈谷市御幸町 4-6 · 0566-25-8812",
         "冷 媒 補 充 作 業 票", "R-32 業務用エアコン 補充", "4,800", "フレア部 締直し", "山田", "山田", True,
         "hand-written work slip: refrigerant R-32, 3.5 kg, Reiwa-era date", color="#1a6b3a", ink="#14308a", gas="R-32", doc_type="refrigerant_service")
    return docs


# --- scenario: Australia ---------------------------------------------------------

AU = dict(customer="Riverside Fabrication Pty Ltd", address="14 Cormack Rd, Wingfield SA 5013", site_hint="Wingfield")


def au_documents() -> list[dict]:
    docs: list[dict] = []
    op, oo = 552_310, 201_884
    for q, (ps, pe) in enumerate(((date(2024, 7, 1), date(2024, 9, 30)), (date(2024, 10, 1), date(2024, 12, 31)),
                                  (date(2025, 1, 1), date(2025, 3, 31)), (date(2025, 4, 1), date(2025, 6, 30)))):
        kp = rng.randint(58_000, 71_000)
        ko = rng.randint(22_000, 30_000)
        pp, po = 0.3142, 0.1988
        supply = ((pe - ps).days + 1) * 4.85
        sub = kp * pp + ko * po + supply
        gst = sub * 0.10
        ctx = dict(
            lang="en", vendor="SA Power Retail", vendor_short="SAP", vendor_address="GPO Box 2010, Adelaide SA 5001",
            customer_code=f"2001{rng.randint(100000, 999999)}", invoice_no=f"INV-{rng.randint(10**7, 10**8-1)}",
            issue_date=pe + timedelta(days=6), customer=AU["customer"], address=AU["address"], period_start=ps, period_end=pe,
            meter_no=f"2001{rng.randint(1000000, 9999999)}", old_peak=op, new_peak=op + kp, kwh_peak=kp, old_off=oo, new_off=oo + ko,
            kwh_off=ko, kwh_total=kp + ko, price_peak=pp, price_off=po, currency="AUD", days=(pe - ps).days + 1, supply=supply,
            gst=gst, total=sub + gst, due_date=pe + timedelta(days=30),
        )
        op, oo = op + kp, oo + ko
        docs.append(dict(
            name=f"au_elec_FY25-Q{q+1}", template="en_electricity.html", ctx=ctx, lang="en",
            doc_type="electricity_bill", vendor=ctx["vendor"], customer=AU["customer"], site_hint=AU["site_hint"],
            lines=[dict(energy_type="electricity", quantity=kp + ko, unit="kWh", period_start=ps.isoformat(), period_end=pe.isoformat(), gas=None)],
            amount=round(sub + gst, 2), currency="AUD", pdf=(q == 0),
        ))
    for i, dd in enumerate((date(2024, 8, 14), date(2024, 12, 3), date(2025, 4, 22))):
        litres = rng.randrange(3_000, 6_000, 100)
        price = rng.choice((1.842, 1.795, 1.911))
        sub = litres * price
        vat = sub * 0.10
        ctx = dict(
            lang="en", vendor="Southern Fuel Distributors", vendor_address="Lot 9 Port Wakefield Rd, Gepps Cross SA", vendor_tax="51 824 753 556",
            invoice_no=f"SFD{rng.randint(100000, 999999)}", issue_date=dd, delivery_date=dd, customer=AU["customer"], address=AU["address"],
            truck=f"S{rng.randint(100, 999)}BFD", litres=litres, price=price, subtotal=sub, vat=vat, total=sub + vat, currency="AUD",
        )
        docs.append(dict(
            name=f"au_diesel_{dd.isoformat()}", template="en_diesel_invoice.html", ctx=ctx, lang="en",
            doc_type="fuel_invoice", vendor=ctx["vendor"], customer=AU["customer"], site_hint=AU["site_hint"],
            lines=[dict(energy_type="diesel", quantity=litres, unit="L", period_start=dd.isoformat(), period_end=dd.isoformat(), gas=None)],
            amount=round(sub + vat, 2), currency="AUD", pdf=False,
        ))
    return docs


def chk_documents(vn: list[dict]) -> list[dict]:
    """Bills for the self-check tests. Prefixed `chk_` so the end-to-end flows,
    which upload every `vn_` bill, never see them.

    `chk_evn_2025-06_typo` is June's EVN bill with a stray digit in the printed
    total (28,512 becomes 285,120) while the meter indexes and the amount still
    describe 28,512 kWh. Ground truth is what is *printed*; `expect_checks`
    says what the deterministic checks must make of it.
    """
    june = next(d for d in vn if d["name"] == "vn_evn_2025-06")
    real = june["lines"][0]["quantity"]
    bad = int(f"{real}0")
    return [{
        **june, "name": "chk_evn_2025-06_typo", "pdf": False, "photo": None,
        "ctx": {**june["ctx"], "kwh_total": bad},
        "lines": [{**june["lines"][0], "quantity": bad}],
        "expect_checks": {"index": "fail", "price": "fail"},
    }]


# --- render ---------------------------------------------------------------------

def quantity_box(page) -> list[int] | None:
    """Where the text of the element marked `data-gt="quantity"` sits on the screenshot, as
    [ymin, xmin, ymax, xmax] on a 0..1000 scale, the format the extractor uses."""
    r = page.evaluate("""() => {
        const el = document.querySelector('[data-gt="quantity"]');
        if (!el) return null;
        // The text itself, not the table cell around it: a right-aligned figure in a wide cell
        // would otherwise be a box three times wider than anything a reader would point at.
        const range = document.createRange();
        range.selectNodeContents(el);
        const b = range.getBoundingClientRect();
        const d = document.documentElement;
        return {x0: b.left + scrollX, y0: b.top + scrollY, x1: b.right + scrollX, y1: b.bottom + scrollY,
                w: Math.max(innerWidth, d.scrollWidth), h: Math.max(innerHeight, d.scrollHeight)};
    }""")
    if not r:
        return None
    return [round(r["y0"] / r["h"] * 1000), round(r["x0"] / r["w"] * 1000),
            round(r["y1"] / r["h"] * 1000), round(r["x1"] / r["w"] * 1000)]


def post_process(png: Path, kind: str) -> Path:
    """Make a clean render look like how the file really arrives. Returns the file the pack should use."""
    from PIL import Image, ImageFilter, ImageOps

    im = Image.open(png)
    if kind == "scan90":
        im = ImageOps.autocontrast(im.convert("L")).rotate(90, expand=True)
        noise = Image.effect_noise(im.size, 14).point(lambda v: v)
        im = Image.blend(im, noise, 0.06)
        im.save(png)
        return png
    if kind == "fax":
        im = ImageOps.autocontrast(im.convert("L"))
        w, h = im.size
        im = im.resize((int(w * 0.8), int(h * 0.8)), Image.BILINEAR).point(lambda v: 255 if v > 165 else 0).convert("L")
        px = im.load()
        for y in range(0, im.size[1], 97):          # the dark streaks a fax line leaves
            for x in range(im.size[0]):
                px[x, y] = min(px[x, y], 90)
        im.save(png)
        return png
    if kind == "phone":
        rgb = im.convert("RGB").rotate(-1.6, expand=True, fillcolor=(70, 66, 60)).filter(ImageFilter.GaussianBlur(0.8))
        vignette = Image.radial_gradient("L").resize(rgb.size).point(lambda v: 255 - int(v * 0.35))
        rgb = Image.composite(rgb, Image.new("RGB", rgb.size, (30, 28, 26)), vignette)
        jpg = png.with_suffix(".jpg")
        rgb.save(jpg, quality=68)
        png.unlink()
        return jpg
    return png


def render(docs: list[dict], limit: int | None) -> list[dict]:
    from playwright.sync_api import sync_playwright

    OUT.mkdir(parents=True, exist_ok=True)
    labels: list[dict] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 900, "height": 1200}, device_scale_factor=1.5)
        for d in docs[:limit] if limit else docs:
            html = env.get_template(d["template"]).render(**d["ctx"], photo=d.get("photo"))
            page.set_content(html, wait_until="load")
            page.evaluate("document.fonts.ready")
            png = OUT / f"{d['name']}.png"
            page.screenshot(path=str(png), full_page=True)
            box = None if d.get("no_box") else quantity_box(page)
            if d.get("post"):
                png = post_process(png, d["post"])
            # "png" is the key the evals read for the image, whatever its format (a phone photo is a .jpg).
            files = {"png": png.name}
            if d.get("pdf"):
                pdf = OUT / f"{d['name']}.pdf"
                page.pdf(path=str(pdf), format="A4", print_background=True)
                files["pdf"] = pdf.name
            labels.append({
                "name": d["name"], "files": files, "template": d["template"], "lang": d["lang"],
                "doc_type": d["doc_type"], "vendor": d["vendor"], "customer": d["customer"], "site_hint": d["site_hint"],
                "lines": [{**d["lines"][0], "box": box}, *d["lines"][1:]], "amount": d["amount"], "currency": d["currency"],
                **({"expect_checks": d["expect_checks"]} if d.get("expect_checks") else {}),
                **({"note": d["pack_note"], "ship": d.get("ship", "png")} if d.get("pack_note") else {}),
                "duplicate_of": d.get("duplicate_of"), "photo": bool(d.get("photo")) or d.get("post") == "phone",
            })
            print(f"rendered {d['name']}")
        browser.close()
    return labels


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--only", choices=("golden", "pack"), default=None, help="render just the golden set or just the Japanese sample pack")
    args = ap.parse_args()
    if args.only != "pack":
        vn = vn_documents()
        labels = render(vn + jp_documents() + au_documents() + chk_documents(vn), args.limit)
        (HERE / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n{len(labels)} golden documents, labels.json written")
    if args.only != "golden":
        labels = render(jp_pack_documents(), args.limit)
        (HERE / "labels_pack.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n{len(labels)} sample-pack documents, labels_pack.json written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
