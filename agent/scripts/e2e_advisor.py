"""Browser check of the reduction advisor on two suppliers.

* A Kariya (JP) supplier: Google has roof imagery there, so the Solar API path
  runs and the page says the figure was measured.
* A Nhon Trach (VN) supplier: Google has none, so the page asks for a roof area,
  estimates from PVGIS irradiance, and the questionnaire gets a drafted
  "reduction activities" answer.

Needs the stack running (emulators, agent, web) and GOOGLE_MAPS_API_KEY in .env.
If the Geocoding API is not enabled for that key, the address lookup fails with a
clear message and this script pins the site by coordinates instead, so the rest
of the flow is still exercised (it prints a warning).

    .venv/bin/python -m scripts.e2e_advisor
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

from .e2e_common import AGENT_URL, WEB, fill_setup, new_request, pick_phone, sign_in, upload

ROOT = Path(__file__).resolve().parents[2]
AGENT = ROOT / "agent"
GOLDEN = ROOT / "data" / "golden"
SHOTS = AGENT / ".local_storage" / "e2e"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(AGENT / ".playwright"))
COMPUTE = re.compile("Calculate|Compute|Tính|計算")
FIND = re.compile("Find on map|Look up again|Tìm trên bản đồ|Tra cứu lại|地図で探す|もう一度調べる")


def pin(token: str, site_id: str, body: dict) -> None:
    req = urllib.request.Request(f"{AGENT_URL}/suppliers/{token[1]}/sites/{site_id}/locate", method="POST",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Authorization": f"Bearer {token[0]}"})
    urllib.request.urlopen(req).read()


def profile(token: tuple[str, str]) -> dict:
    req = urllib.request.Request(f"{AGENT_URL}/suppliers/{token[1]}", headers={"Authorization": f"Bearer {token[0]}"})
    return json.loads(urllib.request.urlopen(req).read())


def run_supplier(p, *, label: str, phone: str, country: str, language: str, site: str, address: str, coords: tuple[float, float], files: list[str]):
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 430, "height": 900}, device_scale_factor=2, locale="en-US")
    page = ctx.new_page()
    seen: dict[str, str] = {}
    page.on("request", lambda r: seen.update(auth=r.headers.get("authorization", "").removeprefix("Bearer ")) if r.url.startswith(AGENT_URL) and r.headers.get("authorization") else None)
    sign_in(page, phone)
    if "/setup" not in page.url:
        page.goto(f"{WEB}/setup")
    fill_setup(page, f"E2E {label} Co", site, language=language, country=country, address=address)
    rid = new_request(page, "Aiko Corp", due="2026-01-31", share="20")
    read, failed = upload(page, files)
    print(f"[{label}] bills read {read}, failed {failed}")

    page.goto(f"{WEB}/r/{rid}/inventory")
    page.get_by_role("button", name=COMPUTE).first.click()
    page.wait_for_selector("table", timeout=60000)
    assert page.get_by_role("link", name=re.compile("Where you could cut emissions|Bạn có thể giảm|排出量を減らせる")).count(), "inventory card to the advisor is missing"

    page.get_by_role("link", name=re.compile("Where you could cut emissions")).click()
    page.wait_for_url(re.compile(r"/reduce"))
    page.get_by_role("button", name=FIND).wait_for(timeout=30000)
    page.get_by_role("button", name=FIND).click()
    page.wait_for_timeout(2500)
    token = (seen.get("auth", ""), "")
    prof_uid = None
    if not page.get_by_text("Matched:").count():
        print(f"[{label}] WARNING: address lookup failed (Geocoding API not enabled for the key?). Pinning by coordinates instead.")
        # The page's own token, so no credentials are read from disk.
        import base64
        payload = json.loads(base64.urlsafe_b64decode(token[0].split(".")[1] + "=="))
        prof_uid = payload.get("user_id") or payload.get("sub") or payload.get("uid")
        token = (token[0], prof_uid)
        site_id = profile(token)["sites"][0]["id"]
        pin(token, site_id, {"lat": coords[0], "lng": coords[1]})
        page.reload()
    page.wait_for_timeout(1500)
    return browser, page, rid, token


def main() -> int:
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(parents=True, exist_ok=True)
    labels = json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8"))
    jp = [str(GOLDEN / "rendered" / l["files"]["png"]) for l in labels if l["name"].startswith("jp_")]
    vn = [str(GOLDEN / "rendered" / l["files"]["png"]) for l in labels if l["name"].startswith("vn_")]
    ok = True
    suffix = str(int(time.time()))[-6:]

    with sync_playwright() as p:
        # --- JP: the Solar API path ------------------------------------------------------
        browser, page, rid, _ = run_supplier(p, label="JP", phone=pick_phone(0, f"+8190{suffix}01"), country="JP", language="ja", site="刈谷工場",
                                              address="Kariya, Aichi, Japan", coords=(34.9886, 137.0022), files=jp)
        page.get_by_text(re.compile("Solar could cover about")).wait_for(timeout=30000)
        measured = page.get_by_text(re.compile("Measured from Google roof imagery")).count() > 0
        print("[JP] solar headline shown; measured from Google imagery:", measured)
        page.screenshot(path=str(SHOTS / "a1-jp-solar.png"), full_page=True)
        before = page.get_by_text(re.compile(r"Saves about")).inner_text()
        page.get_by_label(re.compile("LED lighting retrofit")).check()
        page.wait_for_timeout(700)
        after = page.get_by_text(re.compile(r"Saves about")).inner_text()
        print(f"[JP] scenario: '{before}' -> '{after}'")
        ok &= measured and before != after
        page.screenshot(path=str(SHOTS / "a2-jp-scenario.png"), full_page=True)
        browser.close()

        # --- VN: irradiance fallback + drafted answer ------------------------------------------
        browser, page, rid, _ = run_supplier(p, label="VN", phone=pick_phone(1, f"+8493{suffix}02"), country="VN", language="vi", site="Xưởng Nhơn Trạch",
                                              address="Khu công nghiệp Nhơn Trạch, Đồng Nai", coords=(10.7388, 106.9009), files=vn)
        page.get_by_text(re.compile("Google has no roof imagery")).wait_for(timeout=30000)
        print("[VN] asks for a roof area (no Google roof data here)")
        page.get_by_label(re.compile("Roof area")).fill("1500")
        page.get_by_role("button", name=re.compile("^Estimate$")).click()
        page.get_by_text(re.compile("Solar could cover about")).wait_for(timeout=30000)
        est = page.get_by_text(re.compile("Estimate from sunshine data")).count() > 0
        payback = page.get_by_text(re.compile("pay back in about")).count() > 0
        lpg = page.get_by_text(re.compile("Would add about")).count() > 0
        print(f"[VN] estimate badge {est}; payback shown {payback}; LPG-to-electric flagged as worse on this grid {lpg}")
        page.screenshot(path=str(SHOTS / "a3-vn-fallback.png"), full_page=True)
        ok &= est and payback and lpg

        page.goto(f"{WEB}/r/{rid}/questionnaire")
        page.locator("input#share").fill("20")
        page.locator("input[type=file]").set_input_files(str(ROOT / "data" / "templates" / "cdp_sme_questionnaire.xlsx"))
        page.get_by_role("button", name=re.compile("Download filled|Tải bảng câu hỏi|記入済み質問票")).wait_for(timeout=120000)
        drafted = page.get_by_text(re.compile("DRAFT, please confirm")).count() > 0
        print("[VN] questionnaire has the drafted reduction-activities answer:", drafted)
        page.screenshot(path=str(SHOTS / "a4-vn-questionnaire.png"), full_page=True)
        ok &= drafted
        browser.close()
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
