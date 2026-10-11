"""Browser end-to-end test of the whole supplier journey on the local stack.

Prereqs (three terminals): scripts/dev.sh emulators, scripts/dev.sh agent, scripts/dev.sh web.

    .venv/bin/python -m scripts.e2e_local
    .venv/bin/python -m scripts.e2e_local --headed      # watch it
    .venv/bin/python -m scripts.e2e_local --email you@example.com

Signs in with an email link through the Auth emulator, sets up the Minh Phát
profile, stages the golden Vietnamese bills (removing one before upload),
uploads them, deletes one and re-uploads it, answers the reconciler, checks the
inventory and lineage, corrects one quantity, fills the CDP template and
downloads both outputs. Screenshots land in .local_storage/e2e/.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

from .e2e_common import WEB, fresh_email, chat_bubbles, fill_setup, locked_steps, new_request, sign_in, upload

ROOT = Path(__file__).resolve().parents[2]
AGENT = ROOT / "agent"
GOLDEN = ROOT / "data" / "golden"
SHOTS = AGENT / ".local_storage" / "e2e"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(AGENT / ".playwright"))


def step(name: str, page, ok: bool = True) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)
    print(f"{'ok ' if ok else 'BAD'} {name}")
    if not ok:
        sys.exit(1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--email", default=fresh_email(), help="default: a fresh supplier")
    ap.add_argument("--answer", default="Có, lò vẫn chạy bình thường như các tháng khác.")
    ap.add_argument("--resume", action="store_true", help="sign in to an existing supplier with a computed inventory and run from the inventory step")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    labels = [l for l in json.loads((GOLDEN / "labels.json").read_text(encoding="utf-8")) if l["name"].startswith("vn_")]
    files = [str(GOLDEN / "rendered" / l["files"]["png"]) for l in labels]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed, slow_mo=80 if args.headed else 0)
        ctx = browser.new_context(viewport={"width": 430, "height": 900}, device_scale_factor=2, accept_downloads=True, locale="vi-VN")
        page = ctx.new_page()
        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        # 1. Sign in --------------------------------------------------------------
        sign_in(page, args.email)
        step("01-signed-in", page)

        if args.resume:
            # First request on the dashboard, straight to its inventory.
            page.goto(f"{WEB}/home")
            page.get_by_role("link", name=re.compile("Continue|Tiếp tục|続ける")).first.click()
            page.wait_for_url(re.compile(r"/r/(req_[a-f0-9]+)/"), timeout=20000)
            rid = re.search(r"/r/(req_[a-f0-9]+)/", page.url).group(1)
            page.goto(f"{WEB}/r/{rid}/inventory")
            page.wait_for_selector("table", timeout=60000)
            return _from_inventory(page, step, SHOTS, console_errors, browser, args, rid)

        # 2. Setup, then the first request from the dashboard -------------------------
        if "/setup" not in page.url:
            page.goto(f"{WEB}/setup")
        fill_setup(page, "Công ty TNHH Cơ khí Minh Phát", "Xưởng Nhơn Trạch")
        page.get_by_role("button", name=re.compile("New request|Yêu cầu mới|新しい依頼")).first.wait_for(timeout=20000)
        page.wait_for_timeout(600)
        step("02-home-empty", page, ok=page.get_by_text(re.compile("Add your first request|Thêm yêu cầu đầu tiên|最初の依頼を追加")).count() > 0)
        rid = new_request(page, "Aiko Corp", due="2026-01-31", share="20")
        page.wait_for_timeout(800)
        locked = locked_steps(page)
        print(f"    request {rid}, locked: {locked}")
        step("02b-request-created-gated", page, ok=len(locked) == 3)

        # 3. Stage, remove one, upload the rest -----------------------------------------
        page.locator("input[type=file]").first.set_input_files(files)
        page.get_by_role("button", name=re.compile(r"Upload \d+|Tải lên \d+|\d+件をアップロード")).wait_for()
        page.get_by_role("button", name=re.compile("Remove .* from the list|Bỏ .* khỏi danh sách|一覧から外す")).first.click()
        staged = page.locator("ul.divide-y li").count()
        step("03-staged-minus-one", page, ok=staged == len(files) - 1)
        page.get_by_role("button", name=re.compile(r"Upload \d+|Tải lên \d+|\d+件をアップロード")).click()
        deadline = time.time() + 600
        while time.time() < deadline:
            if page.locator("li.card").count() >= staged and not page.get_by_text(re.compile("Reading…|Đang đọc…|読み取り中")).count():
                break
            time.sleep(2)
        read = page.locator("li.card span.pill-primary").count()
        print(f"    {read}/{staged} documents read")
        step("04-documents-read", page, ok=read >= staged - 1)

        # 4. Delete one uploaded bill, then upload the one we removed at staging --------------
        n_before = page.locator("li.card").count()
        page.get_by_role("button", name=re.compile("^Remove$|^Xóa$|^削除$")).first.click()
        dlg = page.locator("[role=alertdialog],[role=dialog]")
        dlg.wait_for()
        dlg.get_by_role("button", name=re.compile("^Remove$|^Xóa$|^削除$")).click()
        page.wait_for_function("n => document.querySelectorAll('li.card').length === n - 1", arg=n_before, timeout=20000)
        step("05-document-removed", page)
        read2, _ = upload(page, [files[0]])
        print(f"    after re-upload: {page.locator('li.card').count()} cards")
        step("06-document-readded", page, ok=page.locator("li.card").count() == n_before)
        coverage_ok = page.locator(".coverage").count() >= 2  # electricity and LPG strips
        step("07-summary-coverage", page, ok=coverage_ok)

        # Bills in: Questions unlocks, the rest stays locked.
        page.wait_for_function("() => document.querySelectorAll('nav[aria-label] [aria-disabled=true]').length === 2", timeout=15000)
        print(f"    after bills, locked: {locked_steps(page)}")

        # 5. Reconcile ---------------------------------------------------------------------
        page.get_by_role("link", name=re.compile("Continue to questions|Tiếp tục đến câu hỏi|確認へ進む")).click()
        page.wait_for_url(re.compile(r"/reconcile"))
        page.get_by_text(re.compile("What we found|Những gì chúng tôi tìm thấy|確認結果")).wait_for(timeout=30000)
        step("08-questions-summary", page, ok=page.locator(".coverage").count() >= 2)
        page.get_by_role("button", name=re.compile("Check my bills|Kiểm tra hóa đơn|請求書を確認")).first.click()
        page.wait_for_selector("input.input", timeout=90000)
        first_q = chat_bubbles(page)[-1]
        print(f"    Q: {first_q[:110]}")
        step("09-reconcile-question", page, ok=len(first_q) > 10)
        # Answer each new agent question once until the flow finishes. A turn can
        # take 30 s+ while the rate limiter paces calls, so poll rather than wait
        # on a single condition.
        answered: set[str] = set()
        deadline = time.time() + 300
        while time.time() < deadline:
            if page.get_by_role("link", name=re.compile("See the inventory|Xem bảng kiểm kê|インベントリを見る")).count():
                break
            enabled = page.locator("input.input:not([disabled])")
            if enabled.count():
                last = (chat_bubbles(page) or [""])[-1]
                if last and last not in answered:
                    answered.add(last)
                    if len(answered) > 1:
                        print(f"    follow-up: {last[:100]}")
                    enabled.fill(args.answer)
                    page.get_by_role("button", name=re.compile("^Send$|^Gửi$|^送信$")).click()
                    time.sleep(1.5)
                    continue
            time.sleep(1.0)
        page.get_by_role("link", name=re.compile("See the inventory|Xem bảng kiểm kê|インベントリを見る")).wait_for(timeout=120000)
        page.wait_for_function("() => document.querySelectorAll('nav[aria-label] [aria-disabled=true]').length === 0", timeout=30000)
        print(f"    after questions, locked: {locked_steps(page)}")
        step("10-reconcile-done", page)

        # 6. Inventory ------------------------------------------------------------------------
        page.get_by_role("link", name=re.compile("See the inventory|Xem bảng kiểm kê|インベントリを見る")).click()
        page.wait_for_url(re.compile(r"/inventory"))
        page.wait_for_selector("table", timeout=60000)
        return _from_inventory(page, step, SHOTS, console_errors, browser, args, rid)


def _from_inventory(page, step, SHOTS, console_errors, browser, args, rid) -> int:
    if True:
        headline = [el.get_attribute("data-value") for el in page.locator("[data-stat]").all()]
        print(f"    headline: {headline}")
        rows = page.locator("tbody tr:has(button[aria-expanded])").count()
        step("11-inventory", page, ok=rows > 20)

        refr = page.locator("tbody tr:has(button[aria-expanded])", has_text=re.compile("refrigerant", re.I)).first
        refr.get_by_role("button").click()
        page.get_by_text(re.compile("Emission factor|Hệ số phát thải|排出係数")).first.wait_for()
        lineage = page.locator("tr[id^=calc-] , tr:has([id^=calc-])").first.inner_text()
        print(f"    lineage: {' '.join(lineage.split())[:140]}")
        step("12-inventory-lineage", page, ok="GWP" in lineage or "gwp" in lineage)

        before = page.locator("[data-stat]").first.get_attribute("data-value")
        page.get_by_role("button", name=re.compile("Correct quantity|Sửa số lượng|数量を修正")).click()
        qty = page.locator("tbody input.input").first
        qty.fill(str(float(qty.input_value()) + 0.5))  # always a change, even on a re-run
        page.locator("tbody").get_by_role("button", name=re.compile("^Save$|^Lưu$|^保存$")).click()
        page.locator("[role=alertdialog],[role=dialog]").get_by_role("button", name=re.compile("^Save$|^Lưu$|^保存$")).click()
        page.wait_for_timeout(2500)
        page.wait_for_function("v => document.querySelector('[data-stat]').getAttribute('data-value') !== v", arg=before, timeout=15000)
        after = page.locator("[data-stat]").first.get_attribute("data-value")
        print(f"    scope1 before={before} after={after}")
        step("13-inventory-corrected", page, ok=before != after)

        # 7. Questionnaire --------------------------------------------------------------------
        page.get_by_role("link", name=re.compile("Fill the questionnaire|Điền bảng câu hỏi|質問票に記入")).first.click()
        page.wait_for_url(re.compile(r"/questionnaire"))
        page.locator("input#share").fill("20")
        page.locator("input[type=file]").set_input_files(str(ROOT / "data" / "templates" / "cdp_sme_questionnaire.xlsx"))
        page.get_by_role("button", name=re.compile("Download filled|Tải bảng câu hỏi|記入済み質問票")).wait_for(timeout=120000)
        answered = page.locator("ul.card > li").count()
        flagged = page.locator("ul.card span.pill-attention").count()
        print(f"    answers rendered: {answered}, flagged: {flagged}")
        step("14-questionnaire-filled", page, ok=answered >= 15)

        with page.expect_download() as dl:
            page.get_by_role("button", name=re.compile("Download filled|Tải bảng câu hỏi|記入済み質問票")).click()
        xlsx = SHOTS / "downloaded-questionnaire.xlsx"
        dl.value.save_as(str(xlsx))
        with page.expect_download(timeout=120000) as dl2:
            page.get_by_role("button", name=re.compile("Download methodology|Tải bản ghi phương pháp|算定方法書")).click()
        pdf = SHOTS / "downloaded-methodology.pdf"
        dl2.value.save_as(str(pdf))
        print(f"    downloaded {xlsx.stat().st_size:,} B xlsx, {pdf.stat().st_size:,} B pdf")
        step("15-downloads", page, ok=xlsx.stat().st_size > 5000 and pdf.stat().st_size > 5000)

        # 7b. Home shows the request as filled, with the year's totals underneath ------------
        page.goto(f"{WEB}/home")
        page.get_by_text(re.compile("^Filled$|^Đã điền$|^記入済み$")).first.wait_for(timeout=20000)
        step("15b-home-filled", page, ok=page.get_by_text(re.compile("Scope 1|Phạm vi 1|スコープ1")).count() > 0)
        page.goto(f"{WEB}/r/{rid}/questionnaire")
        page.get_by_role("button", name=re.compile("Download filled|Tải bảng câu hỏi|記入済み質問票")).wait_for(timeout=30000)

        # 8. Language switch (account menu) ------------------------------------------------------
        page.get_by_role("button", name=re.compile("Signed in|Đang đăng nhập|サインイン中"), exact=False).count()
        page.locator("header button[aria-haspopup=menu]").click()
        page.get_by_role("menuitemradio", name="Tiếng Việt").click()
        page.wait_for_timeout(1500)
        step("16-vietnamese-ui", page, ok=page.get_by_text("Bảng câu hỏi của khách hàng").count() > 0)

        real_errors = [e for e in console_errors if "favicon" not in e and "hydrat" not in e.lower() and "501" not in e and "404" not in e]
        print(f"\nconsole errors: {len(real_errors)}")
        for e in real_errors[:8]:
            print("   ", e[:160])
        browser.close()
    print(f"\nscreenshots in {SHOTS.relative_to(ROOT)} · supplier {args.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
