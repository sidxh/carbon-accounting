"""Browser check of "Show me where" and the self-checks on an existing supplier.

Run scripts.e2e_local first (it leaves a supplier with a computed inventory), then:

    .venv/bin/python -m scripts.e2e_provenance --email you@example.com
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from .e2e_common import WEB, fresh_email, sign_in

AGENT = Path(__file__).resolve().parents[1]
SHOTS = AGENT / ".local_storage" / "e2e"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(AGENT / ".playwright"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", default=fresh_email())
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 430, "height": 900}, device_scale_factor=2, locale="en-US")
        page = ctx.new_page()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        sign_in(page, args.email)
        page.goto(f"{WEB}/home")
        page.get_by_role("link", name=re.compile("Continue|Tiếp tục|続ける")).first.click()
        page.wait_for_url(re.compile(r"/r/(req_[a-f0-9]+)/"), timeout=20000)
        rid = re.search(r"/r/(req_[a-f0-9]+)/", page.url).group(1)

        # Inventory row -> viewer
        page.goto(f"{WEB}/r/{rid}/inventory")
        page.wait_for_selector("table", timeout=60000)
        row = page.locator("tbody tr:has(button[aria-expanded])", has_text=re.compile("electricity", re.I)).first
        row.get_by_role("button").first.click()
        page.get_by_role("button", name=re.compile("Show me where")).first.wait_for(timeout=10000)
        page.screenshot(path=str(SHOTS / "p1-inventory-row.png"), full_page=True)
        page.get_by_role("button", name=re.compile("Show me where")).first.click()
        dlg = page.get_by_role("dialog")
        dlg.wait_for()
        img = dlg.locator("img").first
        img.wait_for(timeout=15000)
        page.wait_for_timeout(1200)
        spot = dlg.locator("[data-spotlight]")
        n_spot = spot.count()
        page.screenshot(path=str(SHOTS / "p2-viewer.png"))
        print(f"spotlight elements: {n_spot}; image natural width: {img.evaluate('e => e.naturalWidth')}")
        ok = n_spot >= 1 and img.evaluate("e => e.naturalWidth") > 100
        page.keyboard.press("Escape")

        # Questionnaire -> several bills
        page.goto(f"{WEB}/r/{rid}/questionnaire")
        expand = page.get_by_role("button", name=re.compile("Expand all"))
        expand.wait_for(timeout=30000)
        expand.click()
        btn = page.get_by_role("button", name=re.compile("Show the bills behind this")).first
        btn.wait_for(timeout=30000)
        btn.click()
        dlg = page.get_by_role("dialog")
        dlg.wait_for()
        dlg.locator("img").first.wait_for(timeout=15000)
        page.wait_for_timeout(1200)
        page.screenshot(path=str(SHOTS / "p3-questionnaire-viewer.png"))
        print("questionnaire viewer ok")
        real = [e for e in errors if "favicon" not in e and "404" not in e]
        print("console errors:", real[:5])
        browser.close()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
