"""Edge-case browser tests on the local stack. Run after e2e_local.

    .venv/bin/python -m scripts.e2e_edge

Covers: wrong OTP; a non-bill image and a PDF upload; an ambiguous answer to
the reconciler (must ask again, not record); re-running the check after
everything is resolved; persistence across sign-out; and the error card when
the agent is down (simulated by pointing at a dead port via route interception).
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AGENT = ROOT / "agent"
GOLDEN = ROOT / "data" / "golden"
SHOTS = AGENT / ".local_storage" / "e2e"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(AGENT / ".playwright"))
WEB = "http://localhost:3000"
AUTH = "http://127.0.0.1:9099/emulator/v1/projects/fir-testing-f96b1/verificationCodes"
# A fresh supplier every run, so the suite is repeatable against a live emulator.
PHONE2 = "+8498" + str(int(time.time()))[-7:]


def code(phone):
    d = json.loads(urllib.request.urlopen(AUTH).read())
    return [c for c in d["verificationCodes"] if c["phoneNumber"] == phone][-1]["code"]


def ok(name, cond, page=None):
    if page:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"edge-{name}.png"), full_page=True)
    print(f"{'ok ' if cond else 'BAD'} {name}")
    if not cond:
        sys.exit(1)


def sign_in(page, phone):
    page.goto(f"{WEB}/sign-in")
    page.get_by_label(re.compile("Mobile number")).fill(phone)
    page.get_by_role("button", name=re.compile("Send code")).click()
    page.get_by_label(re.compile("Verification code")).wait_for()
    page.get_by_label(re.compile("Verification code")).fill(code(phone))
    page.get_by_role("button", name=re.compile("Continue")).click()
    page.wait_for_url(re.compile(r"/(setup|documents)"), timeout=20000)


def main() -> int:
    from PIL import Image, ImageDraw
    from playwright.sync_api import sync_playwright

    labels = json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8"))
    lpg_h1 = [str(GOLDEN / "rendered" / l["files"]["png"]) for l in labels if l["name"].startswith("vn_lpg_2025-0") and int(l["name"][-2:]) <= 6]
    pdf_doc = next(str(GOLDEN / "rendered" / l["files"]["pdf"]) for l in labels if "pdf" in l["files"] and l["name"].startswith("vn_evn"))

    # A photo that is not a bill.
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
        page.goto(f"{WEB}/sign-in")
        page.get_by_label(re.compile("Mobile number")).fill(PHONE2)
        page.get_by_role("button", name=re.compile("Send code")).click()
        page.get_by_label(re.compile("Verification code")).wait_for()
        page.get_by_label(re.compile("Verification code")).fill("000000")
        page.get_by_role("button", name=re.compile("Continue")).click()
        page.get_by_role("alert").wait_for(timeout=15000)
        ok("wrong-otp-shows-error", page.get_by_label(re.compile("Verification code")).count() == 1, page)

        # correct code now
        page.get_by_label(re.compile("Verification code")).fill(code(PHONE2))
        page.get_by_role("button", name=re.compile("Continue")).click()
        page.wait_for_url(re.compile(r"/setup"), timeout=20000)

        # 2. Second supplier, LPG Jan–Jun only -> gap Jul–Dec -----------------------
        page.wait_for_selector("form.card")
        page.locator("form.card input").first.fill("Xí nghiệp Gas Thử Nghiệm")
        page.locator("form.card select").nth(0).select_option("VN")
        page.locator("form.card select").nth(1).select_option("vi")
        page.locator("form.card input[type=date]").nth(0).fill("2025-01-01")
        page.locator("form.card input[type=date]").nth(1).fill("2025-12-31")
        page.locator("form.card input[placeholder]").nth(0).fill("Xưởng 2")
        page.get_by_role("button", name=re.compile("Save")).click()
        page.wait_for_url(re.compile(r"/documents"))

        # non-bill image + a PDF + six LPG invoices
        page.locator("input[type=file]").first.set_input_files([str(noise), pdf_doc] + lpg_h1)
        deadline = time.time() + 300
        while time.time() < deadline:
            done = page.locator("span.pill-ok").count() + page.locator("span.pill-warn").count()
            if done >= 8 and not page.get_by_text(re.compile("Reading")).count():
                break
            time.sleep(2)
        cards = page.locator("li.card")
        texts = cards.all_inner_texts()
        noise_card = next((t for t in texts if "not-a-bill" in t), "")
        pdf_card = next((t for t in texts if ".pdf" in t), "")
        print(f"    non-bill card: {' '.join(noise_card.split())[:120]}")
        print(f"    pdf card: {' '.join(pdf_card.split())[:120]}")
        ok("non-bill-image-yields-no-lines", "kWh" not in noise_card and "kg" not in noise_card and "L ·" not in noise_card, page)
        ok("pdf-upload-extracted", "kWh" in pdf_card)

        # 3. Ambiguous answer -> agent asks again, records nothing -------------------
        page.get_by_role("link", name=re.compile("Continue to questions")).click()
        page.get_by_role("button", name=re.compile("Check my bills")).click()
        page.wait_for_selector("input.input", timeout=60000)
        q1 = page.locator("div.card > div").first.inner_text()
        print(f"    Q1: {q1[:100]}")
        bubbles_before = page.locator("div.card > div").count()
        page.locator("input.input").fill("Tôi không chắc, để tôi hỏi lại kế toán.")
        page.get_by_role("button", name=re.compile("^Send$")).click()
        # Wait for the agent's reply bubble (input is disabled while busy and
        # again when empty, so the input state alone is not a signal).
        page.wait_for_function(
            "n => document.querySelectorAll('div.card > div').length >= n && !document.querySelector('input.input[disabled]')",
            arg=bubbles_before + 2,
            timeout=90000,
        )
        still_asking = page.locator("input.input").count() == 1
        last = page.locator("div.card > div").last.inner_text()
        print(f"    agent: {last[:110]}")
        ok("ambiguous-answer-keeps-asking", still_asking, page)

        # now answer clearly: zero consumption
        page.locator("input.input").fill("Không, từ tháng 7 đến hết năm xưởng ngừng dùng gas, chuyển sang điện.")
        page.get_by_role("button", name=re.compile("^Send$")).click()
        # The single electricity PDF leaves an electricity gap too; the agent
        # should ask about it next. Answer any follow-ups as "same as other months".
        # Plain polling: answer each new agent question once, until the flow
        # finishes. Turns can take 30 s+ while the rate limiter paces calls.
        answered: set[str] = set()
        deadline = time.time() + 300
        while time.time() < deadline:
            if page.get_by_role("link", name=re.compile("See the inventory")).count():
                break
            enabled = page.locator("input.input:not([disabled])")
            if enabled.count():
                bubbles = [t for t in page.locator("div.card > div").all_inner_texts() if t.strip() and t.strip() != "…"]
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

        # 4. Re-run the check: nothing left to ask -> done immediately -----------------
        page.get_by_role("button", name=re.compile("Check my bills")).click()
        page.get_by_role("link", name=re.compile("See the inventory")).wait_for(timeout=60000)
        ok("rerun-check-is-clean", page.locator("input.input").count() == 0, page)

        # inventory: zero-lines exist as estimated with 0 kg
        page.goto(f"{WEB}/inventory")
        page.wait_for_selector("table", timeout=60000)
        est = page.locator("tbody tr", has_text=re.compile("estimated")).count()
        zero_rows = page.locator("tbody tr", has_text=re.compile(r"\b0 kg")).count()
        print(f"    estimated rows: {est} (of which zero-LPG: {zero_rows})")
        # 6 zero LPG months + 11 extrapolated electricity months
        ok("gaps-recorded-as-estimated", est == 17 and zero_rows == 6, page)

        # 5. Persistence: sign out, sign in, inventory still there ---------------------------
        page.get_by_role("button", name=re.compile("Sign out")).click()
        page.wait_for_url(re.compile(r"/sign-in"))
        sign_in(page, PHONE2)
        page.goto(f"{WEB}/inventory")
        page.wait_for_selector("table", timeout=60000)
        ok("data-persists-across-sign-out", page.locator("tbody tr").count() >= 12, page)

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
