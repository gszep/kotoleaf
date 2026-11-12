"""Rendered mobile checks against a synthetic local Worker; task-owned context."""
import os
import sys
from pathlib import Path

sys.path.insert(0, os.environ.get("BROWSER_TOOLS", "/Users/gszep/Documents/repos/agents-md/tools"))
from browser_session import owned_page

base = sys.argv[1]
with owned_page(viewport={"width": 390, "height": 844}) as page:
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/review?demo=1")
    page.get_by_role("heading", name="Text-only import").wait_for()
    assert page.locator("body").evaluate("e => e.scrollWidth <= window.innerWidth")
    page.get_by_role("button", name="Accept this window").click()
    page.get_by_role("heading", name="Cleaned transcript · accepted").wait_for()
    page.get_by_role("button", name="Undo decision").click()
    page.get_by_role("heading", name="Cleaned transcript · draft").wait_for()
    page.locator('a[href="#source-1"]').first.click()
    assert page.locator("#source-1").is_visible()
    page.goto(base + "/review")
    page.locator("#token").fill("synthetic-review-token")
    page.get_by_role("button", name="Open private space").click()
    page.locator("#workspace").wait_for(state="visible")
    page.get_by_text("Review pasted transcript · no audio upload", exact=True).click()
    page.locator("#import-text").fill("We might invite Mira. To the workshop but have not agreed to Friday.\n\n稟議はまだです。")
    page.get_by_role("button", name="Keep original & create review").click()
    page.get_by_role("heading", name="Text-only import").wait_for()
    page.get_by_role("button", name="Refine next window").click()
    page.get_by_role("heading", name="Cleaned transcript · draft").wait_for()
    page.get_by_role("button", name="Accept this window").click()
    page.get_by_role("heading", name="Cleaned transcript · accepted").wait_for()
    page.reload()
    page.locator("#token").fill("synthetic-review-token")
    page.get_by_role("button", name="Open private space").click()
    page.get_by_role("heading", name="Cleaned transcript · accepted").wait_for()
    page.get_by_role("button", name="Undo decision").click()
    page.get_by_role("heading", name="Cleaned transcript · draft").wait_for()
    with page.expect_download() as receipt:
        page.get_by_role("button", name="Download original + review receipt").click()
    assert receipt.value.suggested_filename.endswith(".json")
    assert page.locator("body").evaluate("e => e.scrollWidth <= window.innerWidth")
    assert page.evaluate("localStorage.length === 0 && sessionStorage.length === 0")
    page.get_by_role("button", name="Lock & clear screen").click()
    assert page.locator("#result").inner_text() == ""
    assert not errors, errors
print("390x844 review browser: private import/refine/accept/reload/undo/export/lock passed; no JS errors or overflow")
