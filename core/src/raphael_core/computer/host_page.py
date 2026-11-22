"""Page operations in a member-owned Chrome tab. Chrome's UI and the owner's tabs stay outside this surface."""

import asyncio
import secrets
from types import SimpleNamespace

from . import safety
from .host_browser import BrowserError


PRIVATE_FORM = """() => {
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility === "visible";
    if ([...document.querySelectorAll("iframe[title], iframe[src]")].some(el =>
        visible(el) && /captcha|turnstile|recaptcha/i.test(el.title + " " + el.getAttribute("src")))) return "captcha";
    if ([...document.querySelectorAll('input[autocomplete="one-time-code"]')].some(visible)) return "two_factor";
    if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return "sign_in";
    return "";
}"""

ELEMENT_ACTION = """function(action, text, replace, identity, matchLabel) {
    if (!this.isConnected || !this.getClientRects().length) return "browser_ref_changed";
    const label = this.getAttribute("aria-label") || this.labels?.[0]?.textContent ||
        this.innerText || this.getAttribute("title") || this.getAttribute("placeholder") || "";
    if (label.trim() !== identity) return "browser_ref_changed";
    if (this.closest('[disabled], [aria-disabled="true"], [inert]')) return "browser_element_disabled";
    if (action === "click") {
        if (this.matches('input[type="file"]') || this.control?.matches('input[type="file"]'))
            return "browser_field_refused";
        this.click();
    } else if (action === "select") {
        if (!this.matches("select") || this.multiple) return "browser_field_refused";
        const option = [...this.options].find(option => !option.closest('[disabled]') &&
            (matchLabel ? option.label === text : option.value === text));
        if (!option) return "browser_option_missing";
        this.selectedIndex = option.index;
        this.dispatchEvent(new Event("input", {bubbles: true}));
        this.dispatchEvent(new Event("change", {bubbles: true}));
    } else {
        if (!this.matches("input, textarea") || this.readOnly ||
            this.matches('input[type="password"], input[type="file"], input[autocomplete="one-time-code"]'))
            return "browser_field_refused";
        const start = replace ? 0 : this.selectionStart ?? this.value.length;
        const end = replace ? this.value.length : this.selectionEnd ?? this.value.length;
        if (!this.dispatchEvent(new InputEvent("beforeinput", {data: text, inputType: "insertText", bubbles: true, cancelable: true})))
            return "browser_field_refused";
        const setter = Object.getOwnPropertyDescriptor(this.matches("input") ?
            HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value").set;
        setter.call(this, this.value.slice(0, start) + text + this.value.slice(end));
        if (this.selectionStart !== null) this.setSelectionRange(start + text.length, start + text.length);
        this.dispatchEvent(new InputEvent("input", {data: text, inputType: "insertText", bubbles: true}));
    }
    return "";
}"""


async def evaluate(browser, tab, expression, *, await_promise=False):
    """Evaluate a fixed expression in an isolated world on the current main frame."""
    tree = await browser.command(tab, "Page.getFrameTree")
    frame = tree["frameTree"]["frame"]
    browser.checked_url(frame["url"])
    context = (await browser.command(tab, "Page.createIsolatedWorld",
                                     {"frameId": frame["id"], "worldName": "Raphael"}))["executionContextId"]
    result = await browser.command(tab, "Runtime.evaluate", {"expression": expression,
                                   "contextId": context, "returnByValue": True,
                                   **({"awaitPromise": True} if await_promise else {})})
    if "exceptionDetails" in result:
        raise BrowserError("browser_page_changed")
    return result["result"].get("value"), context


async def private_form(browser, tab):
    reason, _ = await evaluate(browser, tab, f"({PRIVATE_FORM})()")
    return reason


async def navigate(browser, tab, url):
    tab.refs.clear()
    try:
        async with asyncio.timeout(12):
            result = await browser.command(tab, "Page.navigate", {"url": browser.checked_url(url)})
            if result.get("errorText", "").startswith("net::ERR_SSL_CLIENT_AUTH_"):
                raise BrowserError("browser_certificate_needed")
            if result.get("errorText") and not result.get("isDownload"):
                raise BrowserError("browser_navigation_failed")
            if result.get("isDownload"):
                return False
            # Ready after commit, before inspecting the new document. Sites may leave network requests open.
            while url != "about:blank":
                tree = await browser.command(tab, "Page.getFrameTree")
                frame = tree["frameTree"]["frame"]
                if frame.get("loaderId") == result.get("loaderId") or not result.get("loaderId"):
                    break
                await asyncio.sleep(0.08)
    except TimeoutError:
        raise BrowserError("browser_navigation_waiting") from None
    return True


def ax_value(node, key):
    return node.get(key, {}).get("value", "")


async def snapshot(browser, tab, arguments):
    tab.refs.clear()
    reason = await private_form(browser, tab)
    if reason:
        return {"target_id": tab.id, "tab_id": tab.id, "owner_needed": reason}, []
    text, _ = await evaluate(browser, tab, "({url: location.href, title: document.title.slice(0, 300), "
                             "text: (document.body?.innerText || '').slice(0, 12000)})")
    nodes = (await browser.command(tab, "Accessibility.getFullAXTree", {"depth": 16}))["nodes"]
    prefix = secrets.token_hex(4)
    refs = []
    query = arguments.get("query", "").casefold()
    for node in nodes:
        role, label = ax_value(node, "role"), ax_value(node, "name")
        if node["ignored"] or role in ("none", "generic", "InlineTextBox"):
            continue
        if query and query not in f"{role} {label}".casefold():
            continue
        row = {"role": role, "name": str(label)[:400], "frame": "main", "actions": []}
        if backend := node.get("backendDOMNodeId"):
            ref = f"p{prefix}:{len(refs)}"
            row["ref"] = ref
            row["actions"] = (["type", "click"] if role in ("textbox", "searchbox", "spinbutton")
                              else ["select", "click"] if role == "combobox"
                              else ["click"] if role in ("button", "link", "tab", "checkbox", "radio", "menuitem",
                                                        "option", "switch") else [])
            if row["actions"]:
                tab.refs[ref] = (backend, row)
        refs.append(row)
        if len(refs) >= 200:
            break
    blocks = []
    if arguments.get("include_screenshot"):
        screenshot = await browser.command(tab, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
        blocks.append({"type": "image", "mimeType": "image/png", "data": screenshot["data"]})
    if reason := await private_form(browser, tab):
        tab.refs.clear()
        return {"target_id": tab.id, "tab_id": tab.id, "owner_needed": reason}, []
    return {"target_id": tab.id, "tab_id": tab.id, "page": text, "refs": refs,
            "snapshot": {"complete": False, "continuation": None}}, blocks


async def act(browser, tab, name, arguments, approver):
    action = {"browser_click": "click", "browser_type": "type", "browser_select": "select"}[name]
    entry = tab.refs.get(arguments.get("ref"))
    if entry is None or action not in entry[1]["actions"]:
        raise BrowserError("browser_current_ref_required")
    if arguments.get("delivery_mode") == "foreground" or arguments.get("mode") == "keystrokes":
        raise BrowserError("browser_background_only")
    if arguments.get("input_route") == "trusted":
        raise BrowserError("browser_dom_input_required")
    backend, row = entry
    match_label = "label" in arguments
    text = arguments.get("label", arguments.get("value", "")) if action == "select" else arguments.get("text", "")
    verdict = safety.judge(action="click" if action == "select" else action,
                           declared_final=False, name=row["name"], role=row["role"], text=text)
    if verdict == safety.REFUSE:
        raise BrowserError("browser_action_refused")
    if verdict == safety.HANDOFF:
        return {"owner_needed": safety.handoff_reason(SimpleNamespace(name=row["name"]))}
    if verdict == safety.CONFIRM and approver != "user":
        raise BrowserError("browser_owner_approval_required")
    if reason := await private_form(browser, tab):
        return {"owner_needed": reason}
    _, context = await evaluate(browser, tab, "true")
    element = await browser.command(tab, "DOM.resolveNode", {"backendNodeId": backend, "executionContextId": context})
    object_id = element["object"]["objectId"]
    tab.refs.clear()
    try:
        result = await browser.command(tab, "Runtime.callFunctionOn", {
            "objectId": object_id, "functionDeclaration": ELEMENT_ACTION, "returnByValue": True, "userGesture": action == "click",
            "arguments": [{"value": value} for value in
                          (action, text, arguments.get("replace", False), row["name"], match_label)],
        })
    finally:
        await browser.command(tab, "Runtime.releaseObject", {"objectId": object_id})
    if "exceptionDetails" in result:
        raise BrowserError("browser_page_changed")
    if error := result["result"].get("value"):
        raise BrowserError(error)
    return {"status": "delivered", "target_id": tab.id, "tab_id": tab.id}
