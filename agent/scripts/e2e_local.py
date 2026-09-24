"""Browser end-to-end test of the whole supplier journey on the local stack.

Prereqs (three terminals): scripts/dev.sh emulators, scripts/dev.sh agent, scripts/dev.sh web.

    .venv/bin/python -m scripts.e2e_local
    .venv/bin/python -m scripts.e2e_local --docs 8      # fewer uploads
    .venv/bin/python -m scripts.e2e_local --headed      # watch it

Signs in with a phone number through the Auth emulator (the code is read
back from the emulator's REST API), sets up the Minh Phát profile, uploads
the golden Vietnamese bills, answers the reconciler, checks the inventory and
lineage, corrects one quantity, fills the CDP template and downloads both
outputs. Screenshots land in .local_storage/e2e/.
"""

from __future__ import annotations

import argparse
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
AUTH_EMU = "http://127.0.0.1:9099"
PROJECT = "fir-testing-f96b1"
PHONE = "+84901234567"


def emulator_code(phone: str) -> str:
    """The Auth emulator exposes generated SMS codes for exactly this purpose."""
    url = f"{AUTH_EMU}/emulator/v1/projects/{PROJECT}/verificationCodes"
    data = json.loads(urllib.request.urlopen(url).read())
    codes = [c for c in data.get("verificationCodes", []) if c.get("phoneNumber") == phone]
    if not codes:
        raise RuntimeError(f"no verification code for {phone}: {data}")
    return codes[-1]["code"]


def step(name: str, page, ok: bool = True) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)
    print(f"{'ok ' if ok else 'BAD'} {name}")
    if not ok:
        sys.exit(1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", type=int, default=30)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--answer", default="Có, lò vẫn chạy bình thường như các tháng khác.")
    args = ap.parse_args()

    from playwright.sync_api import expect, sync_playwright

    labels = [l for l in json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8")) if l["name"].startswith("vn_")]
    files = [str(GOLDEN / "rendered" / l["files"]["png"]) for l in labels][: args.docs]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed, slow_mo=80 if args.headed else 0)
        ctx = browser.new_context(viewport={"width": 430, "height": 900}, device_scale_factor=2, accept_downloads=True,
                                  locale="vi-VN")
        page = ctx.new_page()
        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        # 1. Sign in with phone via the emulator ------------------------------
        page.goto(f"{WEB}/sign-in")
        page.get_by_label(re.compile("Mobile number|Số điện thoại|携帯電話番号")).fill(PHONE)
        page.get_by_role("button", name=re.compile("Send code|Gửi mã|コードを送信")).click()
        page.get_by_label(re.compile("Verification code|Mã xác nhận|確認コード")).wait_for(timeout=15000)
        step("01-code-requested", page)
        code = emulator_code(PHONE)
        page.get_by_label(re.compile("Verification code|Mã xác nhận|確認コード")).fill(code)
        page.get_by_role("button", name=re.compile("Continue|Tiếp tục|続ける")).click()

        # 2. Setup (fresh user lands here) --------------------------------------
        page.wait_for_url(re.compile(r"/(setup|documents)"), timeout=20000)
        if "/setup" not in page.url:
            page.goto(f"{WEB}/setup")
        page.wait_for_selector("form.card")
        page.locator("form.card input").first.fill("Công ty TNHH Cơ khí Minh Phát")
        selects = page.locator("form.card select")
        selects.nth(0).select_option("VN")
        selects.nth(1).select_option("vi")
        dates = page.locator("form.card input[type=date]")
        dates.nth(0).fill("2025-01-01")
        dates.nth(1).fill("2025-12-31")
        site_inputs = page.locator("form.card input[placeholder]")
        site_inputs.nth(0).fill("Xưởng Nhơn Trạch")
        step("02-setup-filled", page)
        page.get_by_role("button", name=re.compile("Save|Lưu|保存")).click()
        page.wait_for_url(re.compile(r"/documents"), timeout=20000)
        step("03-documents-empty", page)

        # 3. Upload bills -------------------------------------------------------------
        page.locator("input[type=file]").first.set_input_files(files)
        deadline = time.time() + 600
        while time.time() < deadline:
            read = page.locator("span.pill-ok").count()
            failed = page.locator("span.pill-warn").count()
            if read + failed >= len(files) and not page.get_by_text(re.compile("Reading|Đang đọc|読み取り中")).count():
                break
            time.sleep(2)
        read = page.locator("span.pill-ok").count()
        print(f"    {read}/{len(files)} documents read")
        step("04-documents-read", page, ok=read >= len(files) - 1)

        # 4. Reconcile -------------------------------------------------------------------
        page.get_by_role("link", name=re.compile("Continue to questions|Tiếp tục đến câu hỏi|確認へ進む")).click()
        page.wait_for_url(re.compile(r"/reconcile"))
        page.get_by_role("button", name=re.compile("Check my bills|Kiểm tra hóa đơn|請求書を確認")).click()
        page.locator("div.card div").first.wait_for(timeout=60000)
        page.wait_for_selector("input.input", timeout=60000)
        first_q = page.locator("div.card > div").first.inner_text()
        print(f"    Q: {first_q[:110]}")
        step("05-reconcile-question", page, ok=len(first_q) > 10)
        turns = 0
        while page.locator("input.input").count() and turns < 4:
            page.locator("input.input").fill(args.answer)
            page.get_by_role("button", name=re.compile("^Send$|^Gửi$|^送信$")).click()
            page.wait_for_timeout(1500)
            page.wait_for_function("() => !document.querySelector('form button[disabled]')", timeout=90000)
            turns += 1
        page.get_by_role("link", name=re.compile("See the inventory|Xem bảng kiểm kê|インベントリを見る")).wait_for(timeout=90000)
        step("06-reconcile-done", page)

        # 5. Inventory -----------------------------------------------------------------------
        page.get_by_role("link", name=re.compile("See the inventory|Xem bảng kiểm kê|インベントリを見る")).click()
        page.wait_for_url(re.compile(r"/inventory"))
        page.wait_for_selector("table", timeout=60000)
        headline = page.locator("div.card .text-2xl").all_inner_texts()
        print(f"    headline: {[h.split(chr(10))[0] for h in headline]}")
        rows = page.locator("tbody tr").count()
        step("07-inventory", page, ok=rows > 20)

        # expand the first refrigerant row and read its lineage
        refr = page.locator("tbody tr", has_text=re.compile("refrigerant", re.I)).first
        refr.click()
        page.get_by_text(re.compile("Where this number comes from|Con số này từ đâu ra|この数値の根拠")).wait_for()
        lineage = page.locator("tbody tr.bg-\\[\\#fafaf8\\]").first.inner_text()
        print(f"    lineage: {' '.join(lineage.split())[:140]}")
        step("08-inventory-lineage", page, ok="GWP" in lineage or "gwp" in lineage)

        # inline correction: change the refrigerant quantity and confirm recompute
        before = page.locator("div.card .text-2xl").first.inner_text()
        page.get_by_role("button", name=re.compile("Correct quantity|Sửa số lượng|数量を修正")).click()
        qty = page.locator("tbody input.input").first
        qty.fill("4")
        page.get_by_role("button", name=re.compile("^Save$|^Lưu$|^保存$")).click()
        page.wait_for_timeout(2500)
        after = page.locator("div.card .text-2xl").first.inner_text()
        print(f"    scope1 before={before.split()[0]} after={after.split()[0]}")
        step("09-inventory-corrected", page, ok=before != after)

        # 6. Questionnaire -----------------------------------------------------------------------
        page.get_by_role("link", name=re.compile("Fill the questionnaire|Điền bảng câu hỏi|質問票に記入")).click()
        page.wait_for_url(re.compile(r"/questionnaire"))
        page.locator("input.input").first.fill("20")
        page.locator("input[type=file]").set_input_files(str(ROOT / "data" / "templates" / "cdp_sme_questionnaire.xlsx"))
        page.get_by_role("button", name=re.compile("Download filled|Tải bảng câu hỏi|記入済み質問票")).wait_for(timeout=120000)
        answered = page.locator("div.card.divide-y > div").count()
        flagged = page.locator("span.pill-warn").count()
        print(f"    answers rendered: {answered}, flagged: {flagged}")
        step("10-questionnaire-filled", page, ok=answered >= 15)

        with page.expect_download() as dl:
            page.get_by_role("button", name=re.compile("Download filled|Tải bảng câu hỏi|記入済み質問票")).click()
        xlsx = SHOTS / "downloaded-questionnaire.xlsx"
        dl.value.save_as(str(xlsx))
        print(f"    downloaded {xlsx.name} ({xlsx.stat().st_size:,} bytes)")

        with page.expect_download(timeout=120000) as dl2:
            page.get_by_role("button", name=re.compile("Download methodology|Tải bản ghi phương pháp|算定方法書")).click()
        pdf = SHOTS / "downloaded-methodology.pdf"
        dl2.value.save_as(str(pdf))
        print(f"    downloaded {pdf.name} ({pdf.stat().st_size:,} bytes)")
        step("11-downloads", page, ok=xlsx.stat().st_size > 5000 and pdf.stat().st_size > 5000)

        # 7. Language switch renders Vietnamese UI ----------------------------------------------
        page.locator("select[aria-label=Language]").select_option("vi")
        page.wait_for_timeout(1500)
        step("12-vietnamese-ui", page, ok=page.get_by_text("Bảng câu hỏi của khách hàng").count() > 0)

        real_errors = [e for e in console_errors if "favicon" not in e and "hydrat" not in e.lower()]
        print(f"\nconsole errors: {len(real_errors)}")
        for e in real_errors[:8]:
            print("   ", e[:160])
        browser.close()
    print(f"\nscreenshots in {SHOTS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
