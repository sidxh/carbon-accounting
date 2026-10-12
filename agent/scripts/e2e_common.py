"""Shared Playwright helpers for the browser end-to-end scripts."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request

# Local by default. To drive a deployed stack, set E2E_WEB_URL and E2E_AGENT_URL, plus
# E2E_OTP (the fixed code of a Firebase "phone number for testing") and E2E_PHONES
# (a comma-separated list of those test numbers, one per supplier the script creates).
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
    if os.environ.get("E2E_OTP"):
        # Deployed Auth shows a reCAPTCHA image challenge to headless browsers. Test numbers
        # may skip it, via a switch the web app reads from window (see web/src/lib/firebase.ts).
        page.add_init_script("window.__E2E_NO_RECAPTCHA = true")
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
    """Walk the four setup steps: company, reporting year, sites, then save from the optional step."""
    cont = re.compile("^Continue|^Tiếp tục|^次へ")
    page.wait_for_selector("#name")
    page.locator("#name").fill(name)
    page.locator("#country").select_option(country)
    page.locator(f"#language-{language}").check(force=True)
    page.get_by_role("button", name=cont).click()
    page.locator("#fyStart").fill("2025-01-01")
    page.locator("#fyEnd").fill("2025-12-31")
    page.get_by_role("button", name=cont).click()
    page.locator("#site-name-0").fill(site)
    if address:
        page.locator("#site-address-0").fill(address)
    page.get_by_role("button", name=cont).click()
    page.locator("#revenue").wait_for()
    page.get_by_role("button", name=re.compile("^Save and continue|^Lưu và tiếp tục|^保存して次へ")).click()
    page.wait_for_url(re.compile(r"/home"), timeout=20000)


def new_request(page, customer: str, *, due: str | None = None, share: str | None = None, new_year: tuple[str, str] | None = None) -> str:
    """Walk Home's request flow (inline when there are no requests, else opened with New request), open the new request from its card, and return its id."""
    cont = re.compile("^Continue|^Tiếp tục|^次へ")
    page.goto(f"{WEB}/home")
    page.locator("main h1").first.wait_for(timeout=20000)  # Home has loaded (skeleton gone)
    if not page.locator("#nr-name").count():
        page.get_by_role("button", name=re.compile("New request|Yêu cầu mới|新しい依頼")).first.click()
    page.locator("#nr-name").fill(customer)
    page.get_by_role("button", name=cont).click()
    if new_year:
        page.locator("#nr-period-new").click()
        page.locator("#nr-start").fill(new_year[0])
        page.locator("#nr-end").fill(new_year[1])
    page.get_by_role("button", name=cont).click()
    page.locator("#nr-due").wait_for()
    if due:
        page.locator("#nr-due").fill(due)
    if share:
        page.locator("#nr-share").fill(share)
    page.get_by_role("button", name=re.compile("Create request|Tạo yêu cầu|依頼を作成")).click()
    # Home stays put and lists the new customer; open it with its Start button.
    card = page.locator("li", has_text=customer).filter(has=page.locator("a[href*='/r/req_']")).first
    card.wait_for(timeout=20000)
    card.locator("a[href*='/r/req_']").first.click()
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
