"""Shared Playwright helpers for the browser end-to-end scripts."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request

# Local by default. E2E_WEB_URL / E2E_AGENT_URL point the scripts at another stack. The sign-in link
# is read from the Auth emulator, so a deployed stack (real email) cannot be signed in unattended: it is
# checked by a manual run plus the Cloud Run logs (see TESTING.md).
WEB = os.environ.get("E2E_WEB_URL", "http://localhost:3000").rstrip("/")
AGENT_URL = os.environ.get("E2E_AGENT_URL", "http://localhost:8000").rstrip("/")
AUTH_EMU = "http://127.0.0.1:9099"
PROJECT = "fir-testing-f96b1"


def fresh_email() -> str:
    """A new local supplier: the emulator accepts any address."""
    return f"e2e{int(time.time())}@example.com"


def emulator_link(email: str) -> str:
    """The newest sign-in link the Auth emulator generated for this address."""
    url = f"{AUTH_EMU}/emulator/v1/projects/{PROJECT}/oobCodes"
    for _ in range(20):
        data = json.loads(urllib.request.urlopen(url).read())
        links = [c["oobLink"] for c in data.get("oobCodes", []) if c.get("email") == email and c.get("requestType") == "EMAIL_SIGNIN"]
        if links:
            return links[-1]
        time.sleep(0.5)
    raise RuntimeError(f"no sign-in link for {email}")


def sign_in(page, email: str) -> None:
    page.goto(f"{WEB}/sign-in")
    page.get_by_label(re.compile("Work email|Email công việc|仕事用メールアドレス")).fill(email)
    page.get_by_role("button", name=re.compile("Email me a link|Gửi liên kết cho tôi|リンクをメールで送る")).click()
    # The link exists once the emulator has accepted the request, which is when the inbox step shows.
    page.get_by_text(re.compile("Check your inbox|Kiểm tra hộp thư|受信トレイを確認")).wait_for(timeout=15000)
    page.goto(emulator_link(email))   # same browser: the page finds the saved address and signs in
    page.wait_for_url(re.compile(r"/(setup|home)"), timeout=30000)
    # A fresh user is bounced from /home to /setup once the profile 404s.
    try:
        page.wait_for_url(re.compile(r"/setup"), timeout=6000)
    except Exception:
        pass


def fill_setup(page, name: str, site: str, country: str = "VN") -> None:
    page.wait_for_selector("form.card")
    page.locator("form.card input").first.fill(name)
    selects = page.locator("form.card select")
    selects.nth(0).select_option(country)
    dates = page.locator("form.card input[type=date]")
    dates.nth(0).fill("2025-01-01")
    dates.nth(1).fill("2025-12-31")
    page.locator("form.card input[placeholder]").nth(0).fill(site)
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
    # Creating a request keeps you on Home with the new card ringed. Read its id from the card, then open it.
    card = page.locator("[data-request-id][data-highlighted=true]")
    card.wait_for(timeout=20000)
    assert "/home" in page.url, f"expected to stay on Home, got {page.url}"
    rid = card.get_attribute("data-request-id")
    card.get_by_role("link", name=re.compile("Start|Continue|Bắt đầu|Tiếp tục|開始|続ける")).click()
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
