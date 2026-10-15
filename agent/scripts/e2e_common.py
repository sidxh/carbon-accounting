"""Shared Playwright helpers for the browser end-to-end scripts."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

# Local by default. E2E_WEB_URL / E2E_AGENT_URL point the scripts at another stack. Locally the script
# creates its user in the Auth emulator; against a deployed stack it signs in with an existing evaluator
# account, so pass --email (where the script has it) or set E2E_EMAIL, and set E2E_PASSWORD.
WEB = os.environ.get("E2E_WEB_URL", "http://localhost:3000").rstrip("/")
AGENT_URL = os.environ.get("E2E_AGENT_URL", "http://localhost:8000").rstrip("/")
AUTH_EMU = "http://127.0.0.1:9099"
PROJECT = "fir-testing-f96b1"
PASSWORD = os.environ.get("E2E_PASSWORD", "e2e-password-1")
LOCAL = (urlparse(WEB).hostname or "") in ("localhost", "127.0.0.1")


def fresh_email() -> str:
    """The supplier the script signs in as: a new local one, or E2E_EMAIL on a deployed stack."""
    if os.environ.get("E2E_EMAIL"):
        return os.environ["E2E_EMAIL"]
    return f"e2e{int(time.time())}@example.com"


def create_user(email: str, password: str = PASSWORD) -> None:
    """Create the user in the Auth emulator. Safe to repeat: an existing address is left alone."""
    url = f"{AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key"
    body = json.dumps({"email": email, "password": password, "returnSecureToken": False}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req).read()
    except urllib.error.HTTPError as err:
        if b"EMAIL_EXISTS" not in err.read():
            raise


def sign_in(page, email: str, password: str = PASSWORD) -> None:
    if LOCAL:
        create_user(email, password)
    page.goto(f"{WEB}/sign-in")
    page.get_by_label(re.compile("^Email$|^Email công việc$|^メールアドレス$")).fill(email)
    page.get_by_label(re.compile("^Password$|^Mật khẩu$|^パスワード$")).fill(password)
    page.get_by_role("button", name=re.compile(r"^Sign in$|^Đăng nhập$|^サインイン$")).click()
    page.wait_for_url(re.compile(r"/(setup|home)"), timeout=30000)
    # A fresh user is bounced from /home to /setup once the profile 404s.
    try:
        page.wait_for_url(re.compile(r"/setup"), timeout=6000)
    except Exception:
        pass


def fill_setup(page, name: str, site: str, country: str = "VN") -> None:
    """Walk the four setup steps: company, reporting year, sites, then save from the optional step."""
    cont = re.compile("^Continue|^Tiếp tục|^次へ")
    page.wait_for_selector("#name")
    page.locator("#name").fill(name)
    page.locator("#country").select_option(country)
    page.get_by_role("button", name=cont).click()
    page.locator("#fyStart").fill("2025-01-01")
    page.locator("#fyEnd").fill("2025-12-31")
    page.get_by_role("button", name=cont).click()
    page.locator("#site-name-0").fill(site)
    page.get_by_role("button", name=cont).click()
    page.locator("#revenue").wait_for()
    page.get_by_role("button", name=re.compile("^Save and continue|^Lưu và tiếp tục|^保存して次へ")).click()
    page.wait_for_url(re.compile(r"/home"), timeout=20000)


def new_request(page, customer: str, *, due: str | None = None, share: str | None = None, new_year: tuple[str, str] | None = None) -> str:
    """Fill Home's one-form request (inline when there are no requests, else in the New request dialog), then open the new request from its ringed card and return its id."""
    page.goto(f"{WEB}/home")
    page.locator("main h1").first.wait_for(timeout=20000)  # Home has loaded (skeleton gone)
    if not page.locator("#nr-name").count():
        page.get_by_role("button", name=re.compile("New request|Yêu cầu mới|新しい依頼")).first.click()
        page.get_by_role("dialog").wait_for()
    page.locator("#nr-name").fill(customer)
    if new_year:
        page.locator("#nr-period-new").click()
        page.locator("#nr-start").fill(new_year[0])
        page.locator("#nr-end").fill(new_year[1])
    if due:
        page.locator("#nr-due").fill(due)
    if share:
        page.locator("#nr-share").fill(share)
    page.get_by_role("button", name=re.compile("Create request|Tạo yêu cầu|依頼を作成")).click()
    # Creating a request keeps you on Home with the new card ringed. Read its id from the card, then open it.
    card = page.locator("[data-request-id][data-highlighted=true]")
    card.wait_for(timeout=20000)
    assert "/home" in page.url, f"expected to stay on Home, got {page.url}"
    rid = card.get_attribute("data-request-id")
    card.get_by_role("link", name=re.compile("Start|Continue|Open|Bắt đầu|Tiếp tục|Mở|開始|続ける|開く")).first.click()
    page.wait_for_url(re.compile(rf"/r/{rid}/documents"), timeout=20000)
    return rid


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
