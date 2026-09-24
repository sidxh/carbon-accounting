"""Shared Playwright helpers for the browser end-to-end scripts."""

from __future__ import annotations

import json
import re
import time
import urllib.request

WEB = "http://localhost:3000"
AUTH_EMU = "http://127.0.0.1:9099"
PROJECT = "fir-testing-f96b1"


def emulator_code(phone: str) -> str:
    """The Auth emulator exposes generated SMS codes for exactly this purpose."""
    url = f"{AUTH_EMU}/emulator/v1/projects/{PROJECT}/verificationCodes"
    data = json.loads(urllib.request.urlopen(url).read())
    codes = [c for c in data.get("verificationCodes", []) if c.get("phoneNumber") == phone]
    if not codes:
        raise RuntimeError(f"no verification code for {phone}: {data}")
    return codes[-1]["code"]


def type_code(page, code: str) -> None:
    """Six single-digit boxes: focus the first and type; the last digit submits."""
    box = page.locator("input[autocomplete=one-time-code]")
    box.wait_for(timeout=15000)
    box.click()
    page.keyboard.type(code, delay=30)


def sign_in(page, phone: str, wrong_first: bool = False) -> None:
    page.goto(f"{WEB}/sign-in")
    page.get_by_label(re.compile("Mobile number|Số điện thoại|携帯電話番号")).fill(phone)
    page.get_by_role("button", name=re.compile("Send code|Gửi mã|コードを送信")).click()
    # The code exists only once the emulator has accepted the request; the OTP boxes
    # appear at the same moment, so wait for them before asking for it.
    page.locator("input[autocomplete=one-time-code]").wait_for(timeout=15000)
    if wrong_first:
        type_code(page, "000000")
        page.get_by_role("alert").wait_for(timeout=15000)
    type_code(page, emulator_code(phone))
    page.wait_for_url(re.compile(r"/(setup|documents)"), timeout=30000)
    # A fresh user is bounced from /documents to /setup once the profile 404s.
    try:
        page.wait_for_url(re.compile(r"/setup"), timeout=6000)
    except Exception:
        pass


def fill_setup(page, name: str, site: str, language: str = "vi") -> None:
    page.wait_for_selector("form.card")
    page.locator("form.card input").first.fill(name)
    selects = page.locator("form.card select")
    selects.nth(0).select_option("VN")
    selects.nth(1).select_option(language)
    dates = page.locator("form.card input[type=date]")
    dates.nth(0).fill("2025-01-01")
    dates.nth(1).fill("2025-12-31")
    page.locator("form.card input[placeholder]").nth(0).fill(site)
    page.get_by_role("button", name=re.compile("Save|Lưu|保存")).click()
    page.wait_for_url(re.compile(r"/documents"), timeout=20000)


def upload(page, files: list[str], timeout: int = 600) -> tuple[int, int]:
    """Stage files, press Upload, wait until every card has settled. Returns (read, failed)."""
    before = page.locator("li.card").count()
    page.locator("input[type=file]").first.set_input_files(files)
    page.get_by_role("button", name=re.compile(r"Upload \d+|Tải lên \d+|\d+件をアップロード")).click()
    deadline = time.time() + timeout
    while time.time() < deadline:
        cards = page.locator("li.card").count()
        if cards >= before + len(files) and not page.get_by_text(re.compile("Reading…|Đang đọc…|読み取り中")).count():
            break
        time.sleep(2)
    return page.locator("li.card span.pill-primary").count(), page.locator("li.card span.pill-danger").count()


def chat_bubbles(page) -> list[str]:
    return [t for t in page.locator("[role=log] > div").all_inner_texts() if t.strip() and t.strip() != "…"]


def open_account_menu(page) -> None:
    page.get_by_role("button", expanded=False).filter(has=page.locator("span.font-mono")).first.click()
