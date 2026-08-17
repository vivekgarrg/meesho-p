#!/usr/bin/env python3
"""
Meesho label downloader — a personal, run-it-yourself tool.

You type your Meesho username/password each time you run this; nothing is
ever stored on disk. It opens a REAL, VISIBLE browser window and drives it —
it is not a background/unattended script, and it is not meant to be
scheduled. Run it by hand whenever you want that account's labels.

Because I (the assistant that wrote this) can't log into your Meesho account
to see the real, authenticated pages, several steps below are best-effort:
they try a few common selectors, and if none of them match within a few
seconds, the script PAUSES and asks you to do that one step by hand in the
already-open window, then press Enter to let it continue. That means the
script degrades gracefully — worst case, you're doing what you always do
manually, just with the file-saving and organizing automated — instead of
silently failing.

If a step's automatic selector needs fixing, tell me exactly which step
paused and what you saw, and I'll tighten that one selector.

Setup (one-time):
    pip install playwright
    playwright install chromium

Usage:
    python meesho_label_downloader.py [--account-name "Supplier A"]

Labels are saved to ./meesho_labels/<YYYY-MM-DD>/<account_name>_<time>.pdf
next to this script. A screenshot is saved alongside on any step that fails,
so you can see exactly where it got stuck.
"""

import argparse
import getpass
import sys
from datetime import datetime
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
except ImportError:
    print(
        "Playwright isn't installed. Run:\n"
        "    pip install playwright\n"
        "    playwright install chromium\n"
        "then try again."
    )
    sys.exit(1)

LOGIN_URL = "https://supplier.meesho.com/"
STEP_TIMEOUT_MS = 8_000  # how long an automatic selector gets before we hand off to you

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = SCRIPT_DIR / "meesho_labels"


def pause_for_manual_step(page, instruction):
    """Hand off to the human at the keyboard for one step, then continue."""
    print(f"\n>>> {instruction}")
    input("    Press Enter here once you've done that in the browser window... ")


def save_screenshot(page, label):
    out_dir = OUTPUT_ROOT / datetime.now().strftime("%Y-%m-%d")
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"error_{label}_{datetime.now().strftime('%H%M%S')}.png"
    try:
        page.screenshot(path=str(path), full_page=True)
        print(f"    (saved a screenshot of what the page looked like: {path})")
    except Exception:
        pass


def try_click_any(page, texts, timeout_ms=STEP_TIMEOUT_MS):
    """Try clicking the first visible element matching any of these texts
    (case-insensitive, partial match). Returns True if something was clicked."""
    for text in texts:
        try:
            locator = page.get_by_text(text, exact=False).first
            locator.wait_for(state="visible", timeout=timeout_ms)
            locator.click()
            return True
        except PlaywrightTimeoutError:
            continue
    return False


def try_fill_any(page, selectors, value, timeout_ms=STEP_TIMEOUT_MS):
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            locator.wait_for(state="visible", timeout=timeout_ms)
            locator.fill(value)
            return True
        except PlaywrightTimeoutError:
            continue
    return False


def log_in(page, username, password):
    print("Opening Meesho supplier login...")
    page.goto(LOGIN_URL, wait_until="domcontentloaded")

    # Best-effort: common field patterns for a phone/email + password login.
    filled_user = try_fill_any(
        page,
        ['input[type="text"]', 'input[type="email"]', 'input[type="tel"]',
         'input[name*="phone" i]', 'input[name*="email" i]', 'input[placeholder*="phone" i]'],
        username,
    )
    if not filled_user:
        pause_for_manual_step(page, "I couldn't find the username/phone field automatically — please type it in yourself.")

    filled_pass = try_fill_any(page, ['input[type="password"]'], password)
    if not filled_pass:
        pause_for_manual_step(page, "I couldn't find the password field automatically — please type it in yourself.")

    clicked = try_click_any(page, ["Login", "Log in", "Sign in", "Continue", "Submit"])
    if not clicked:
        pause_for_manual_step(page, "Please click the login button yourself.")

    # Meesho may show an OTP screen here. Since you're watching the window,
    # just handle it there — the script simply waits for you to confirm
    # you're past it rather than guessing at OTP field selectors.
    print("\nIf Meesho is asking for an OTP or any extra verification, complete it in the window now.")
    input("Press Enter once you're fully logged in and looking at your Meesho dashboard... ")


def go_to_labels(page):
    navigated = try_click_any(page, ["Labels", "Print Labels", "Orders", "Ready to Ship", "Manage Orders"])
    if not navigated:
        pause_for_manual_step(
            page,
            "Please navigate to the page where you'd normally download/print your shipping labels.",
        )
    else:
        page.wait_for_load_state("domcontentloaded")
        input("Press Enter once you're on the page listing the labels/orders you want to download... ")


def download_labels(page, account_name):
    out_dir = OUTPUT_ROOT / datetime.now().strftime("%Y-%m-%d")
    out_dir.mkdir(parents=True, exist_ok=True)

    print("\nLooking for a download/print-labels button...")
    download = None
    try:
        with page.expect_download(timeout=STEP_TIMEOUT_MS) as download_info:
            clicked = try_click_any(page, ["Download Labels", "Print Labels", "Download", "Print", "Export"])
            if not clicked:
                raise PlaywrightTimeoutError("no matching button found")
        download = download_info.value
    except PlaywrightTimeoutError:
        print("Couldn't trigger the download automatically.")
        try:
            # The listener is armed as soon as this `with` block starts, so it
            # catches the download no matter when — during the pause, or right
            # after — you actually click it manually inside the callback below.
            with page.expect_download(timeout=120_000) as download_info:
                pause_for_manual_step(
                    page,
                    "Please click whatever button downloads the labels yourself — "
                    "I'll catch the file as soon as your browser starts downloading it.",
                )
            download = download_info.value
        except PlaywrightTimeoutError:
            print("Still didn't see a download start. Saving a screenshot so we can figure out why.")
            save_screenshot(page, "no_download_detected")
            return None

    suggested = download.suggested_filename or "labels.pdf"
    ext = Path(suggested).suffix or ".pdf"
    safe_account = "".join(c if (c.isalnum() or c in "-_") else "_" for c in account_name) or "account"
    dest = out_dir / f"{safe_account}_{datetime.now().strftime('%H%M%S')}{ext}"
    download.save_as(str(dest))
    print(f"\nSaved: {dest}")
    return dest


def main():
    parser = argparse.ArgumentParser(description="Download today's Meesho shipping labels for one account.")
    parser.add_argument("--account-name", default=None, help="A short name for this account, used in the saved filename.")
    args = parser.parse_args()

    account_name = args.account_name or input("Account name (just for the filename, e.g. 'Account 1'): ").strip() or "account"
    username = input("Meesho username / phone: ").strip()
    password = getpass.getpass("Meesho password (hidden, not stored anywhere): ")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(accept_downloads=True)
        try:
            log_in(page, username, password)
            go_to_labels(page)
            result = download_labels(page, account_name)
            if result:
                print("\nDone.")
            else:
                print("\nDidn't manage to download a file this run — see the screenshot above for what went wrong.")
        except Exception as exc:
            print(f"\nSomething went wrong: {exc}")
            save_screenshot(page, "unexpected_error")
        finally:
            # Best-effort hygiene: drop the in-memory references to the
            # credentials now that we're done with them.
            password = None
            username = None
            browser.close()


if __name__ == "__main__":
    main()
