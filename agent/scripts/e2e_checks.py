"""Browser check of the bills-that-check-themselves flow.

Uploads the Vietnamese golden bills with the June electricity bill swapped for
the planted misread (44,699 kWh printed as 446,990), then follows the Questions
chat and checks that the misread bill is the one the agent asks about, that the
supplier's correction lands, and that the inventory shows it as checked.

    .venv/bin/python -m scripts.e2e_checks
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from .e2e_common import WEB, chat_bubbles, fill_setup, new_request, sign_in, upload

ROOT = Path(__file__).resolve().parents[2]
AGENT = ROOT / "agent"
GOLDEN = ROOT / "data" / "golden"
SHOTS = AGENT / ".local_storage" / "e2e"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(AGENT / ".playwright"))
ANSWER = "Số đúng của tháng 6 là 44.699 kWh, xin lỗi anh. Các tháng khác lò chạy bình thường."


def main() -> int:
    from playwright.sync_api import sync_playwright

    labels = json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8"))
    keep = [l for l in labels if l["name"].startswith("vn_") and l["name"] != "vn_evn_2025-06"] + [l for l in labels if l["name"] == "chk_evn_2025-06_typo"]
    files = [str(GOLDEN / "rendered" / l["files"]["png"]) for l in keep]
    SHOTS.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 430, "height": 900}, device_scale_factor=2, locale="en-US")
        page = ctx.new_page()
        sign_in(page, "+8493" + str(int(time.time()))[-7:])
        if "/setup" not in page.url:
            page.goto(f"{WEB}/setup")
        fill_setup(page, "Công ty TNHH Cơ khí Minh Phát", "Xưởng Nhơn Trạch")
        rid = new_request(page, "Aiko Corp", due="2026-01-31", share="20")
        read, failed = upload(page, files)
        print(f"read {read}, failed {failed}")

        page.get_by_role("link", name=re.compile("Continue to questions|Tiếp tục đến câu hỏi|確認へ進む")).click()
        page.wait_for_url(re.compile(r"/reconcile"))
        page.get_by_text(re.compile("What we found|Những gì chúng tôi tìm thấy|確認結果")).wait_for(timeout=30000)
        page.get_by_role("button", name=re.compile("Check my bills|Kiểm tra hóa đơn|請求書を確認")).first.click()
        page.wait_for_selector("input.input", timeout=90000)

        asked: list[str] = []
        deadline = time.time() + 300
        while time.time() < deadline:
            if page.get_by_role("link", name=re.compile("See the inventory|Xem bảng kiểm kê|インベントリを見る")).count():
                break
            enabled = page.locator("input.input:not([disabled])")
            if enabled.count():
                last = (chat_bubbles(page) or [""])[-1]
                if last and last not in asked:
                    asked.append(last)
                    print("  Q:", last[:140].replace("\n", " "))
                    enabled.fill(ANSWER)
                    page.get_by_role("button", name=re.compile("^Send$|^Gửi$|^送信$")).click()
                    time.sleep(1.5)
                    continue
            time.sleep(1.0)
        page.screenshot(path=str(SHOTS / "c1-questions.png"), full_page=True)
        mentions_june = any(re.search(r"tháng 6|6/2025|446|44[.,]?699|công tơ|chỉ số", q, re.I) for q in asked)
        print("asked about the misread bill:", mentions_june)

        page.get_by_role("link", name=re.compile("See the inventory|Xem bảng kiểm kê|インベントリを見る")).click()
        page.wait_for_url(re.compile(r"/inventory"))
        page.wait_for_selector("table", timeout=60000)
        row = page.locator("tbody tr:has(button[aria-expanded])", has_text=re.compile("electricity", re.I)).filter(has_text=re.compile(r"44,699|44\.699")).first
        found = row.count() > 0
        print("inventory shows the corrected 44,699 kWh:", found)
        if found:
            row.get_by_role("button").first.click()
            page.wait_for_timeout(600)
            page.screenshot(path=str(SHOTS / "c2-inventory-checked.png"), full_page=True)
            print("pills:", [t.strip() for t in page.locator("ul.flex li.pill").all_inner_texts()][:6])
        browser.close()
    return 0 if mentions_june and found else 1


if __name__ == "__main__":
    sys.exit(main())
