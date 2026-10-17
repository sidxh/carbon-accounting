"""Browser check of the misprinted Japanese bill and the EU VSME card.

Uploads the electricity bills of the Japanese sample pack, including the November bill whose total carries a
stray digit (684,650 printed, 68,465 by the meter readings). Then it follows the Questions chat and checks that:

  - the question names the figure the readings give, and the chat offers it as a quick reply;
  - choosing that reply (the owner still presses Send) corrects the bill, shown in the inventory;
  - on the questionnaire page the EU VSME card stays compact after the download, and the downloaded file opens
    on General Information with our cells coloured.

    .venv/bin/python -m scripts.e2e_misprint
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import warnings
from pathlib import Path

from .e2e_common import WEB, chat_bubbles, fill_setup, fresh_email, new_request, sign_in, upload

ROOT = Path(__file__).resolve().parents[2]
AGENT = ROOT / "agent"
GOLDEN = ROOT / "data" / "golden"
SHOTS = AGENT / ".local_storage" / "e2e"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(AGENT / ".playwright"))
OTHER = "The equipment was off in those months."
SEE = re.compile("See the inventory|Xem bảng kiểm kê|インベントリを見る")


def main() -> int:
    from openpyxl import load_workbook
    from playwright.sync_api import sync_playwright

    labels = json.loads((GOLDEN / "labels_pack.json").read_text(encoding="utf-8"))
    files = [str(GOLDEN / "rendered" / l["files"]["png"]) for l in labels if l["name"].startswith("jpx_elec_")]
    SHOTS.mkdir(parents=True, exist_ok=True)
    ok = True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1, locale="en-US", accept_downloads=True)
        page = ctx.new_page()
        sign_in(page, fresh_email())
        if "/setup" not in page.url:
            page.goto(f"{WEB}/setup")
        fill_setup(page, "Takahashi Precision", "Kariya plant", country="JP")
        rid = new_request(page, "Aiko Corp", due="2026-01-31", share="20")
        read, failed = upload(page, files)
        print(f"read {read}, failed {failed}")

        page.get_by_role("link", name=re.compile("Continue to questions|Tiếp tục đến câu hỏi|確認へ進む")).first.click()
        page.wait_for_url(re.compile(r"/reconcile"))
        page.get_by_role("button", name=re.compile("Check my bills|Kiểm tra hóa đơn|請求書を確認")).first.click()
        page.wait_for_selector("input.input", timeout=90000)

        asked: list[str] = []
        chip_used = False
        deadline = time.time() + 300
        while time.time() < deadline:
            if page.get_by_role("link", name=SEE).count():
                break
            enabled = page.locator("input.input:not([disabled])")
            if enabled.count():
                last = (chat_bubbles(page) or [""])[-1]
                if last and last not in asked:
                    asked.append(last)
                    print("  Q:", last[:200].replace("\n", " "))
                    chip = page.get_by_role("group", name="Quick replies").get_by_role("button", name=re.compile(r"^Use 68,465 kWh"))
                    if chip.count():
                        chip.click()
                        filled = enabled.input_value()
                        print("  chip fills the box:", filled)
                        ok &= filled.startswith("Use 68,465 kWh") and page.get_by_role("link", name=SEE).count() == 0
                        page.screenshot(path=str(SHOTS / "m1-chips.png"))
                        chip_used = True
                    else:
                        enabled.fill(OTHER)
                    page.get_by_role("button", name=re.compile("^Send$|^Gửi$|^送信$")).click()
                    time.sleep(1.5)
                    continue
            time.sleep(1.0)
        names_figure = any("68,465" in q for q in asked)
        print("question names the readings figure:", names_figure, "| quick reply used:", chip_used)
        ok &= names_figure and chip_used

        page.get_by_role("link", name=SEE).click()
        page.wait_for_url(re.compile(r"/inventory"))
        page.wait_for_selector("table", timeout=60000)
        body = page.locator("table").inner_text()
        corrected = "68,465" in body and "684,650" not in body
        print("inventory shows 68,465 kWh and not 684,650:", corrected)
        ok &= corrected

        # --- the EU VSME card ---------------------------------------------------------------
        page.goto(f"{WEB}/r/{rid}/questionnaire")
        btn = page.get_by_role("button", name=re.compile("Download the filled template"))
        btn.wait_for(timeout=30000)
        cards = page.locator("ul.grid > li")
        before = [cards.nth(i).bounding_box()["height"] for i in range(cards.count())]
        with page.expect_download(timeout=60000) as dl:
            btn.click()
        path = SHOTS / "vsme-from-browser.xlsx"
        dl.value.save_as(str(path))
        page.get_by_text(re.compile(r"\d+ cells filled")).wait_for(timeout=10000)
        left = page.get_by_role("button", name=re.compile(r"\d+ left for you"))
        left.wait_for()
        after = [cards.nth(i).bounding_box()["height"] for i in range(cards.count())]
        vsme_h, others = after[-1], after[:-1]
        compact = vsme_h < 380 and all(abs(a - b) < 2 for a, b in zip(before[:-1], others))
        print(f"card heights before {before} after {after}; others not stretched: {compact}")
        ok &= compact
        left.click()
        page.get_by_text(re.compile("Basis for preparation")).first.wait_for()
        page.screenshot(path=str(SHOTS / "m2-vsme-card.png"), full_page=True)
        ok &= left.get_attribute("aria-expanded") == "true"
        browser.close()

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = load_workbook(io.BytesIO(path.read_bytes()))
    opens_right = wb.active.title == "General Information" and wb["General Information"]["D3"].fill.fill_type == "solid"
    print("template opens on General Information, D3 coloured:", opens_right)
    ok &= opens_right
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
