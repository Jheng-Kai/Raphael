"""Semantic and viewport operations in a member-owned Chrome tab."""

import asyncio
import json
import secrets
from contextlib import suppress
from types import SimpleNamespace

from . import safety
from .host_browser import VIEWPORT, BrowserError


PRIVATE_FORM = """() => {
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility === "visible";
    if ([...document.querySelectorAll("iframe[title], iframe[src]")].some(el =>
        visible(el) && /captcha|turnstile|recaptcha/i.test(el.title + " " + el.getAttribute("src")))) return "captcha";
    if ([...document.querySelectorAll('input[autocomplete="one-time-code"]')].some(visible)) return "two_factor";
    if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return "sign_in";
    return "";
}"""

ELEMENT_ACTION = r"""function(action, text, replace, identity, matchLabel) {
    if (!this.isConnected || !this.getClientRects().length) return "browser_ref_changed";
    const labelledBy = this.getAttribute("aria-labelledby")?.split(/\s+/).map(
        id => this.ownerDocument.getElementById(id)?.textContent).filter(Boolean).join(" ");
    const label = labelledBy || this.getAttribute("aria-label") || this.labels?.[0]?.textContent ||
        this.innerText || (this.matches('input[type="submit"], input[type="button"]') ? this.value : "") ||
        this.getAttribute("title") || this.getAttribute("placeholder") || "";
    if (label.trim().replace(/\s+/g, " ") !== identity) return "browser_ref_changed";
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

# Hit-test or inspect focus in the page's own coordinate space. Keep an opaque
# frame or a native picker outside the member's input route.
INPUT_TARGET = r"""(point, checkSubmit) => {
    let doc = document, node, x = point?.[0], y = point?.[1];
    for (;;) {
        node = point ? doc.elementFromPoint(x, y) : doc.activeElement;
        while (node?.shadowRoot) {
            const inner = point ? node.shadowRoot.elementFromPoint(x, y) : node.shadowRoot.activeElement;
            if (!inner || inner === node) break;
            node = inner;
        }
        if (!node?.matches("iframe, frame")) break;
        if (!node.contentDocument) return {opaque: true};
        const rect = node.getBoundingClientRect();
        x -= rect.left + node.clientLeft;
        y -= rect.top + node.clientTop;
        doc = node.contentDocument;
    }
    const selector = 'button, a[href], input, textarea, select, summary, label, [role], [contenteditable]';
    const control = node?.closest(selector) || node;
    const el = control?.control || control;
    if (!el || el.matches("body, html")) return {};
    const label = element => {
        const refs = element.getAttribute("aria-labelledby")?.trim().split(/\s+/) || [];
        return refs.map(id => doc.getElementById(id)?.textContent).filter(Boolean).join(" ") ||
            element.getAttribute("aria-label") || element.labels?.[0]?.textContent ||
            element.getAttribute("placeholder") || element.getAttribute("title") ||
            element.getAttribute("alt") || (element.matches('input[type="submit"], input[type="button"]') ?
                element.value : element.textContent?.trim().slice(0, 400)) || "";
    };
    const autocomplete = el.autocomplete?.toLowerCase().split(/\s+/) || [];
    const reason = el.type === "password" ? "sign_in" : autocomplete.includes("one-time-code") ? "two_factor" :
        autocomplete.some(value => value.startsWith("cc-")) ? "payment" : "";
    const editable = !el.readOnly && (el.matches('textarea, input:not([type]), input[type="text"], input[type="search"],' +
        'input[type="email"], input[type="tel"], input[type="url"], input[type="number"]') || el.isContentEditable);
    const submit = checkSubmit && el.form && editable ?
        [...el.form.elements].find(item => item.type === "submit" && !item.disabled) : null;
    return {name: label(el), role: editable ? "Edit" : (el.getAttribute("role") || el.localName),
        editable, reason, file: el.type === "file", submitName: submit ? label(submit) : "",
        submits: Boolean(el.form && (el.type === "submit" || (checkSubmit && editable && el.localName === "input")))};
}"""

KEYS = {
    "backspace": ("Backspace", 8), "tab": ("Tab", 9), "enter": ("Enter", 13), "escape": ("Escape", 27),
    "space": ("Space", 32), "pageup": ("PageUp", 33), "pagedown": ("PageDown", 34),
    "end": ("End", 35), "home": ("Home", 36), "left": ("ArrowLeft", 37), "up": ("ArrowUp", 38),
    "right": ("ArrowRight", 39), "down": ("ArrowDown", 40), "insert": ("Insert", 45), "delete": ("Delete", 46),
    **{f"f{n}": (f"F{n}", 111 + n) for n in range(1, 13)},
}
MODIFIERS = {"alt": 1, "ctrl": 2, "control": 2, "shift": 8, "super": 4, "meta": 4, "cmd": 4, "option": 1}


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


def tab_ids(tab):
    return {"target_id": tab.id, "tab_id": tab.id}


async def screenshot_image(browser, tab):
    shot = await browser.command(tab, "Page.captureScreenshot", {"format": "png", "fromSurface": True})
    return {"type": "image", "mimeType": "image/png", "data": shot["data"]}


async def screenshot(browser, tab):
    if reason := await private_form(browser, tab):
        return {**tab_ids(tab), "owner_needed": reason}, []
    image = await screenshot_image(browser, tab)
    if reason := await private_form(browser, tab):
        return {**tab_ids(tab), "owner_needed": reason}, []
    width, height = VIEWPORT
    return {**tab_ids(tab), "screenshot_width": width, "screenshot_height": height}, [image]


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


async def snapshot(browser, tab, arguments, *, retry=None):
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
    matches = set()
    for node in nodes:
        role, label = ax_value(node, "role"), ax_value(node, "name")
        if node["ignored"] or role in ("none", "generic", "InlineTextBox"):
            continue
        backend = node.get("backendDOMNodeId")
        if retry == (role, label) and backend:
            matches.add(backend)
        if len(refs) >= 200:
            continue
        if query and query not in f"{role} {label}".casefold():
            continue
        row = {"role": role, "name": str(label)[:400], "frame": "main", "actions": []}
        if backend:
            ref = f"p{prefix}:{len(refs)}"
            row["ref"] = ref
            row["actions"] = (["type", "click"] if role in ("textbox", "searchbox", "spinbutton")
                              else ["select", "click"] if role == "combobox"
                              else ["click"] if role in ("button", "link", "tab", "checkbox", "radio", "menuitem",
                                                        "option", "switch") else [])
            if row["actions"]:
                tab.refs[ref] = (backend, row)
        refs.append(row)
    blocks = []
    if arguments.get("include_screenshot"):
        blocks.append(await screenshot_image(browser, tab))
    if reason := await private_form(browser, tab):
        tab.refs.clear()
        return {"target_id": tab.id, "tab_id": tab.id, "owner_needed": reason}, []
    if text.get("url") == tab.url and text.get("title"):
        browser._update_page(tab, title=text["title"])
    data = {**tab_ids(tab), "page": text, "refs": refs, "snapshot": {"complete": False, "continuation": None}}
    if retry is not None:
        data["retry_backend"] = next(iter(matches)) if len(matches) == 1 else None
    return data, blocks


async def ref_action(browser, tab, action, arguments, approver, entry):
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
    try:
        element = await browser.command(tab, "DOM.resolveNode", {"backendNodeId": backend, "executionContextId": context})
    except BrowserError as error:
        if str(error) != "chrome_command_failed":
            raise
        raise BrowserError("browser_ref_changed") from None
    if not (object_id := element["object"].get("objectId")):
        raise BrowserError("browser_ref_changed")
    try:
        result = await browser.command(tab, "Runtime.callFunctionOn", {
            "objectId": object_id, "functionDeclaration": ELEMENT_ACTION, "returnByValue": True, "userGesture": action == "click",
            "arguments": [{"value": value} for value in
                          (action, text, arguments.get("replace", False), row["name"], match_label)],
        })
    finally:
        with suppress(BrowserError):
            await browser.command(tab, "Runtime.releaseObject", {"objectId": object_id})
    if "exceptionDetails" in result:
        raise BrowserError("browser_page_changed")
    if error := result["result"].get("value"):
        raise BrowserError(error)
    tab.refs.clear()
    return {"status": "delivered", **tab_ids(tab)}


async def act(browser, tab, name, arguments, approver):
    action = {"browser_click": "click", "browser_type": "type", "browser_select": "select"}[name]
    entry = tab.refs.get(arguments.get("ref"))
    if entry is None or action not in entry[1]["actions"]:
        raise BrowserError("browser_current_ref_required")
    if arguments.get("delivery_mode") == "foreground" or arguments.get("mode") == "keystrokes":
        raise BrowserError("browser_background_only")
    if arguments.get("input_route") == "trusted":
        raise BrowserError("browser_dom_input_required")
    document = tab.document
    try:
        return await ref_action(browser, tab, action, arguments, approver, entry), []
    except BrowserError as error:
        if action != "click" or str(error) != "browser_ref_changed":
            raise
    row = entry[1]
    fresh, blocks = await snapshot(browser, tab, {}, retry=(row["role"], row["name"]))
    backend = fresh.pop("retry_backend", None)
    if backend is not None and tab.document == document:
        try:
            return await ref_action(browser, tab, action, arguments, approver, (backend, row)), []
        except BrowserError as error:
            if str(error) != "browser_ref_changed":
                raise
    return {**fresh, "status": "browser_ref_changed"}, blocks


def key_event(arguments):
    key = arguments["key"]
    mods = arguments.get("modifiers", [])
    if not mods and len(key) == 1 and key.isascii() and key.isprintable():
        code = "Key" + key.upper() if key.isalpha() else "Digit" + key if key.isdigit() else ""
        return (key,), {"key": key, "code": code, "text": key, "windowsVirtualKeyCode": ord(key.upper())}
    try:
        chord = safety.parse_chord("+".join([*mods, key]))
    except safety.KeysRefused:
        raise BrowserError("browser_action_refused") from None
    *modifiers, key = chord
    code, virtual = KEYS.get(key, ("Key" + key.upper() if key.isalpha() else "Digit" + key, ord(key[0].upper())))
    args = {"key": " " if key == "space" else code if key in KEYS else key, "code": code,
            "windowsVirtualKeyCode": virtual, "modifiers": sum(MODIFIERS[mod] for mod in modifiers)}
    if not modifiers and key == "space":
        args["text"] = " "
    if not modifiers and key == "enter":
        args["text"] = "\r"
    return chord, args


async def viewport_action(browser, tab, name, arguments, approver):
    point = None
    if name in {"click", "double_click", "scroll"}:
        width, height = VIEWPORT
        x, y = arguments.get("x"), arguments.get("y")
        if x is None or y is None or not (0 <= x < width and 0 <= y < height) or "ref" in arguments:
            raise BrowserError("browser_coordinates")
        point = (x, y)
    if arguments.get("delivery_mode") == "foreground":
        raise BrowserError("browser_background_only")
    if reason := await private_form(browser, tab):
        return {**tab_ids(tab), "owner_needed": reason}
    chord, keys = key_event(arguments) if name == "press_key" else (None, None)
    if name != "scroll":
        check_submit = chord is not None and chord[-1] == "enter"
        target, _ = await evaluate(browser, tab, f"({INPUT_TARGET})({json.dumps(point)}, {json.dumps(check_submit)})")
        if not isinstance(target, dict) or target.get("opaque") or target.get("file"):
            raise BrowserError("browser_action_refused")
        name_at_target = target.get("name", "")
        submit_name = target.get("submitName", "")
        if reason := target.get("reason"):
            return {**tab_ids(tab), "owner_needed": reason}
        if submit_name and safety.handoff_by_name(submit_name):
            return {**tab_ids(tab), "owner_needed": safety.handoff_reason(SimpleNamespace(name=submit_name))}
        action = "keys" if keys else "type" if name == "type_text" else "click"
        verdict = safety.judge(action=action, declared_final=target.get("submits", False), chord=chord,
                               text=arguments.get("text", ""), focused_name=name_at_target,
                               name=name_at_target if action == "click" else "", focused_role=target.get("role", ""),
                               focused_actions=("value",) if target.get("editable") else ())
        if verdict == safety.HANDOFF:
            return {**tab_ids(tab), "owner_needed": safety.handoff_reason(SimpleNamespace(name=name_at_target))}
        if verdict == safety.REFUSE or (action == "type" and not target.get("editable")):
            raise BrowserError("browser_action_refused")
        if verdict == safety.CONFIRM and approver != "user":
            raise BrowserError("browser_owner_approval_required")
    if name == "type_text":
        await browser.command(tab, "Input.insertText", {"text": arguments["text"]})
    elif keys is not None:
        await browser.command(tab, "Input.dispatchKeyEvent", {**keys, "type": "keyDown" if "text" in keys else "rawKeyDown"})
        await browser.command(tab, "Input.dispatchKeyEvent", {**keys, "type": "keyUp", "text": ""})
    elif name == "scroll":
        direction = arguments["direction"]
        horizontal = direction in ("left", "right")
        distance = (VIEWPORT[0 if horizontal else 1] if arguments.get("by") == "page" else 40) * arguments.get("amount", 3)
        if direction in ("left", "up"):
            distance = -distance
        await browser.command(tab, "Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y,
                              "deltaX": distance if horizontal else 0, "deltaY": 0 if horizontal else distance})
    else:
        button = arguments.get("button", "left")
        mods = {mod.casefold() for mod in arguments.get("modifier", [])}
        count = 2 if name == "double_click" else arguments.get("count", 1)
        if not mods <= MODIFIERS.keys() or not 1 <= count <= 3:
            raise BrowserError("browser_action_refused")
        params = {"x": x, "y": y, "button": button, "modifiers": sum({MODIFIERS[mod] for mod in mods})}
        buttons = {"left": 1, "right": 2, "middle": 4}[button]
        # Sent back to back and awaited together: on a page that re-renders under the pointer, a round trip
        # between a press and its release can land them on different elements, and the browser drops that click.
        events = [{**params, "type": kind, "buttons": buttons if kind == "mousePressed" else 0, "clickCount": click_count}
                  for click_count in range(1, count + 1) for kind in ("mousePressed", "mouseReleased")]
        await asyncio.gather(*(browser.command(tab, "Input.dispatchMouseEvent", event) for event in events))
    tab.refs.clear()
    return {"status": "delivered", **tab_ids(tab)}
