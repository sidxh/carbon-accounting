"""Shared Playwright helpers for the browser end-to-end scripts."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request

# Local by default. E2E_WEB_URL / E2E_AGENT_URL point the scripts at another stack. Signing in to the
# deployed Firebase Auth cannot be automated: reCAPTCHA shows image challenges to headless browsers and
# rejects the test-only bypass, so the deployed stack is checked by a manual run plus the Cloud Run logs
# (see TESTING.md). E2E_OTP / E2E_PHONES (fixed-code test numbers) only help for a headed, human-assisted run.
WEB = os.environ.get("E2E_WEB_URL", "http://localhost:3000").rstrip("/")
AGENT_URL = os.environ.get("E2E_AGENT_URL", "http://localhost:8000").rstrip("/")
AUTH_EMU = "http://127.0.0.1:9099"
PROJECT = "fir-testing-f96b1"


def pick_phone(index: int, fresh: str) -> str:
    """The index-th configured test number when E2E_PHONES is set, else a fresh local one."""
    pool = [p.strip() for p in os.environ.get("E2E_PHONES", "").split(",") if p.strip()]
    if not pool:
        return fresh
    if index >= len(pool):
        raise SystemExit(f"E2E_PHONES has {len(pool)} number(s); this script needs at least {index + 1}")
    return pool[index]


def emulator_code(phone: str) -> str:
    """The Auth emulator exposes generated SMS codes; a deployed stack uses a fixed test-number code."""
    if os.environ.get("E2E_OTP"):
        return os.environ["E2E_OTP"]
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
        page.locator("p[role=alert]").wait_for(timeout=15000)
    type_code(page, emulator_code(phone))
    page.wait_for_url(re.compile(r"/(setup|home)"), timeout=30000)
    # A fresh user is bounced from /home to /setup once the profile 404s.
    try:
        page.wait_for_url(re.compile(r"/setup"), timeout=6000)
    except Exception:
        pass


def fill_setup(page, name: str, site: str, language: str = "vi", country: str = "VN", address: str | None = None) -> None:
    page.wait_for_selector("form.card")
    page.locator("form.card input").first.fill(name)
    selects = page.locator("form.card select")
    selects.nth(0).select_option(country)
    selects.nth(1).select_option(language)
    dates = page.locator("form.card input[type=date]")
    dates.nth(0).fill("2025-01-01")
    dates.nth(1).fill("2025-12-31")
    page.locator("form.card input[placeholder]").nth(0).fill(site)
    if address:
        page.locator("form.card input[placeholder]").nth(2).fill(address)
    page.get_by_role("button", name=re.compile("Save|Lưu|保存")).click()
    page.wait_for_url(re.compile(r"/home"), timeout=20000)


def new_request(page, customer: str, *, due: str | None = None, share: str | None = None, new_year: tuple[str, str] | None = None) -> str:
    """Open the New request dialog from Home, submit it, and return the request id from the URL."""
    page.goto(f"{WEB}/home")
    page.get_by_role("button", name=re.compile("New request|Yêu cầu mới|新しい依頼")).first.click()
    page.get_by_role("dialog").wait_for()
    page.locator("#nr-name").fill(customer)
    if new_year:
        page.locator("#nr-period").select_option("__new")
        page.locator("#nr-start").fill(new_year[0])
        page.locator("#nr-end").fill(new_year[1])
    if due:
        page.locator("#nr-due").fill(due)
    if share:
        page.locator("#nr-share").fill(share)
    page.get_by_role("dialog").get_by_role("button", name=re.compile("Create request|Tạo yêu cầu|依頼を作成")).click()
    page.wait_for_url(re.compile(r"/r/(req_[a-f0-9]+)/documents"), timeout=20000)
    return re.search(r"/r/(req_[a-f0-9]+)/", page.url).group(1)


def locked_steps(page) -> list[str]:
    return [" ".join(t.split()) for t in page.locator("nav[aria-label] [aria-disabled=true]").all_inner_texts()]


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
