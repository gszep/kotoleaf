"""Optional rendered mobile regression check with the host's existing Playwright.

Use --demo for a public deployed shell; otherwise this ONLY accepts localhost and
the fixed synthetic test credential. No microphone, real tokens or real audio.
"""
import argparse
import os
from pathlib import Path
import sys
from urllib.parse import urlparse

sys.path.insert(0, os.environ.get("BROWSER_TOOLS", str(Path.home() / "Documents/repos/agents-md/tools")))
from browser_session import owned_page
from playwright.sync_api import expect

parser = argparse.ArgumentParser()
parser.add_argument("url")
parser.add_argument("--demo", action="store_true")
parser.add_argument("--screenshot")
args = parser.parse_args()
if not args.demo and urlparse(args.url).hostname not in ("127.0.0.1", "localhost"):
    raise SystemExit("Real API tests are restricted to the local synthetic fixture.")

with owned_page(viewport={"width": 390, "height": 844}) as page:
    errors = []
    private_requests = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: private_requests.append(r.url) if "/learning" in urlparse(r.url).path else None)
    page.goto(args.url, wait_until="networkidle")
    if not args.demo:
        page.locator("#token").fill("local-other-token")
        page.get_by_role("button", name="Connect", exact=True).click()
    expect(page.locator("#workspace")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "mobile horizontal overflow"
    page.get_by_role("button", name="Fill a synthetic example").click()
    page.get_by_role("button", name="Confirm and remember").click()
    expect(page.locator("#cards article")).to_have_count(0)
    page.locator("#confirmed").check()

    if not args.demo:
        # The server commits, but the response is lost. The retained form and ID
        # must permit a safe retry instead of duplicate vocabulary.
        def lose_response(route):
            expect(page.locator("#term")).to_be_disabled()
            route.fetch()
            route.abort("failed")
        page.route("**/learning", lose_response, times=1)
        page.get_by_role("button", name="Confirm and remember").click()
        expect(page.locator("#status")).to_have_class("error")
        expect(page.locator("#term")).to_have_value("紅葉ラボ")

    page.get_by_role("button", name="Confirm and remember").click()
    expect(page.locator("#cards article")).to_have_count(1)
    expect(page.locator("#hints")).to_contain_text("紅葉ラボ")
    page.get_by_role("button", name="Reveal reading / meaning").click()
    expect(page.locator("#cards")).to_contain_text("こうようラボ")
    page.get_by_role("button", name="Known", exact=True).click()
    expect(page.locator("#cards")).to_contain_text("1 review(s) · Last: known")
    if args.screenshot:
        Path(args.screenshot).parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=args.screenshot, full_page=True)

    page.reload(wait_until="networkidle")
    if not args.demo:
        expect(page.locator("#token")).to_have_value("")
        expect(page.locator("#workspace")).to_be_hidden()
        page.locator("#token").fill("local-other-token")
        page.get_by_role("button", name="Connect", exact=True).click()
    expect(page.locator("#cards")).to_contain_text("1 review(s) · Last: known")
    page.get_by_role("button", name="Undo confirmation").click()
    expect(page.locator("#cards article")).to_have_count(0)
    expect(page.locator("#hints")).to_contain_text("No personal hints")
    page.reload(wait_until="networkidle")
    if not args.demo:
        page.locator("#token").fill("local-other-token")
        page.get_by_role("button", name="Connect", exact=True).click()
    expect(page.locator("#cards article")).to_have_count(0)
    page.locator("summary").click()
    expect(page.locator("#history")).to_contain_text("Undone")
    assert not errors, errors
    if args.demo:
        assert not private_requests, private_requests
    print("Mobile browser passed: explicit confirmation, hint, reveal, review, reload, undo, no overflow/JS errors" + ("; no private API calls" if args.demo else "; lost-response retry and reconnect"))
