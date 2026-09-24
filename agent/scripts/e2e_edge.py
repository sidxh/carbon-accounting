"""Edge-case browser tests on the local stack. Run after e2e_local.

    .venv/bin/python -m scripts.e2e_edge

Covers: wrong OTP; a non-bill image and a PDF upload; an ambiguous answer to
the reconciler (must ask again, not record); re-running the check after
everything is resolved; persistence across sign-out; and the error card when
the agent is down (simulated by pointing at a dead port via route interception).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from .e2e_common import WEB, chat_bubbles, fill_setup, sign_in, upload

ROOT = Path(__file__).resolve().parents[2]
AGENT = ROOT / "agent"
GOLDEN = ROOT / "data" / "golden"
SHOTS = AGENT / ".local_storage" / "e2e"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(AGENT / ".playwright"))
# A fresh supplier every run, so the suite is repeatable against a live emulator.
PHONE2 = "+8498" + str(int(time.time()))[-7:]


def ok(name, cond, page=None):
    if page:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"edge-{name}.png"), full_page=True)
    print(f"{'ok ' if cond else 'BAD'} {name}")
    if not cond:
        sys.exit(1)


def main() -> int:
    from PIL import Image, ImageDraw
    from playwright.sync_api import sync_playwright

    labels = json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8"))
    lpg_h1 = [str(GOLDEN / "rendered" / l["files"]["png"]) for l in labels if l["name"].startswith("vn_lpg_2025-0") and int(l["name"][-2:]) <= 6]
    pdf_doc = next(str(GOLDEN / "rendered" / l["files"]["pdf"]) for l in labels if "pdf" in l["files"] and l["name"].startswith("vn_evn"))

    noise = AGENT / ".local_storage" / "not-a-bill.png"
    im = Image.new("RGB", (900, 700), (200, 190, 170))
    d = ImageDraw.Draw(im)
    for i in range(0, 900, 40):
        d.line([(i, 0), (900 - i, 700)], fill=(120, 110, 100), width=3)
    d.text((300, 330), "Lunch menu — Phở bò 65.000đ", fill=(30, 30, 30))
    im.save(noise)

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 430, "height": 900})
        page = ctx.new_page()

        # 1. Wrong OTP shows an error and stays on the code step -----------------
        sign_in(page, PHONE2, wrong_first=True)
        ok("wrong-otp-then-correct", "/setup" in page.url, page)

        # 2. Second supplier, LPG Jan–Jun only -> gap Jul–Dec -----------------------
        fill_setup(page, "Xí nghiệp Gas Thử Nghiệm", "Xưởng 2")
        read, failed = upload(page, [str(noise), pdf_doc] + lpg_h1)
        cards = page.locator("li.card").all_inner_texts()
        noise_card = next((t for t in cards if "not-a-bill" in t), "")
        pdf_card = next((t for t in cards if ".pdf" in t), "")
        print(f"    non-bill card: {' '.join(noise_card.split())[:120]}")
        print(f"    pdf card: {' '.join(pdf_card.split())[:120]}")
        ok("non-bill-image-yields-no-lines", "kWh" not in noise_card and "L ·" not in noise_card, page)
        ok("pdf-upload-extracted", "kWh" in pdf_card)
        ok("non-bill-offers-retry", page.locator("li.card", has_text="not-a-bill").get_by_role("button", name=re.compile("Read again")).count() == 1)

        # 3. Ambiguous answer -> agent asks again, records nothing -------------------
        page.get_by_role("link", name=re.compile("Continue to questions")).click()
        page.get_by_role("button", name=re.compile("Check my bills")).first.click()
        page.wait_for_selector("input.input", timeout=60000)
        q1 = chat_bubbles(page)[-1]
        print(f"    Q1: {q1[:100]}")
        n_before = len(chat_bubbles(page))
        page.locator("input.input").fill("Tôi không chắc, để tôi hỏi lại kế toán.")
        page.get_by_role("button", name=re.compile("^Send$")).click()
        page.wait_for_function(
            "n => document.querySelectorAll('[role=log] > div').length >= n && !document.querySelector('input.input[disabled]')",
            arg=n_before + 2,
            timeout=90000,
        )
        still_asking = page.locator("input.input").count() == 1
        print(f"    agent: {chat_bubbles(page)[-1][:110]}")
        ok("ambiguous-answer-keeps-asking", still_asking, page)

        page.locator("input.input").fill("Không, từ tháng 7 đến hết năm xưởng ngừng dùng gas, chuyển sang điện.")
        page.get_by_role("button", name=re.compile("^Send$")).click()
        answered: set[str] = set()
        deadline = time.time() + 300
        while time.time() < deadline:
            if page.get_by_role("link", name=re.compile("See the inventory")).count():
                break
            enabled = page.locator("input.input:not([disabled])")
            if enabled.count():
                bubbles = chat_bubbles(page)
                last = bubbles[-1] if bubbles else ""
                if last and last not in answered:
                    answered.add(last)
                    print(f"    follow-up: {last[:100]}")
                    enabled.fill("Có, dùng bình thường như các tháng khác.")
                    page.get_by_role("button", name=re.compile("^Send$")).click()
                    time.sleep(1.5)
                    continue
            time.sleep(1.0)
        page.get_by_role("link", name=re.compile("See the inventory")).wait_for(timeout=120000)
        ok("clear-answer-finishes", True, page)
        resolved = page.get_by_text(re.compile("^Resolved$")).count()
        ok("open-items-tick-off", resolved >= 1)

        # 4. Re-run the check: nothing left to ask -> done immediately -----------------
        page.get_by_role("button", name=re.compile("Check my bills")).first.click()
        page.get_by_role("link", name=re.compile("See the inventory")).wait_for(timeout=60000)
        ok("rerun-check-is-clean", page.locator("input.input").count() == 0, page)

        page.goto(f"{WEB}/inventory")
        page.wait_for_selector("table", timeout=60000)
        est = page.locator("tbody tr:has(button[aria-expanded])", has_text=re.compile("estimated")).count()
        # The six estimated LPG rows are the zero months; the eleven estimated electricity rows are extrapolated.
        zero_rows = page.locator("tbody tr:has(button[aria-expanded])", has_text=re.compile("estimated")).filter(has_text=re.compile("LPG|Lpg")).count()
        print(f"    estimated rows: {est} (of which zero-LPG: {zero_rows})")
        ok("gaps-recorded-as-estimated", est == 17 and zero_rows == 6, page)

        # 5. Persistence: sign out, sign in, inventory still there ---------------------------
        page.locator("header button[aria-haspopup=menu]").click()
        page.get_by_role("menuitem", name=re.compile("Sign out")).click()
        page.wait_for_timeout(300)
        page.wait_for_url(re.compile(r"/sign-in"))
        sign_in(page, PHONE2)
        page.goto(f"{WEB}/inventory")
        page.wait_for_selector("table", timeout=60000)
        ok("data-persists-across-sign-out", page.locator("tbody tr:has(button[aria-expanded])").count() >= 12, page)

        # 6. Agent unreachable -> error card with retry, not an endless spinner --------------
        page.route(re.compile(r"http://localhost:8000/.*"), lambda route: route.abort())
        page.goto(f"{WEB}/documents")
        page.get_by_role("button", name=re.compile("Try again")).wait_for(timeout=20000)
        ok("agent-down-shows-error-card", True, page)
        page.unroute(re.compile(r"http://localhost:8000/.*"))
        page.get_by_role("button", name=re.compile("Try again")).click()
        page.wait_for_selector("li.card", timeout=20000)
        ok("retry-recovers", True)

        b.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
