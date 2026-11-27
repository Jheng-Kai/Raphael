"""Semantic and viewport operations in a member-owned Chrome tab."""

import asyncio
import json
import secrets
import unicodedata
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
    // A select's accessible name never comes from its options (#329): an unlabelled one is named "", not their text, and
    // a label around it names it by its own words alone.
    const around = this.labels?.[0]?.cloneNode(true);
    around?.querySelectorAll("select, textarea").forEach(control => control.remove());
    const label = labelledBy || this.getAttribute("aria-label") || around?.textContent ||
        (this.matches("select") ? "" : this.innerText) ||
        (this.matches('input[type="submit"], input[type="button"]') ? this.value : "") ||
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

# The visible middle of the element a ref names (of its text, for a text node), in the page's viewport; null when none of
# it shows.
DRAG_POINT = r"""function() {
    if (!this.isConnected) return "browser_ref_changed";
    let box;
    if (this.nodeType === 1) {
        if (!this.getClientRects().length) return "browser_ref_changed";
        box = this.getBoundingClientRect();
    } else {
        const range = this.ownerDocument.createRange();
        range.selectNodeContents(this);
        box = range.getBoundingClientRect();
    }
    const left = Math.max(box.left, 0), right = Math.min(box.right, innerWidth);
    const top = Math.max(box.top, 0), bottom = Math.min(box.bottom, innerHeight);
    return right > left && bottom > top ? [(left + right) / 2, (top + bottom) / 2] : null;
}"""

KEYS = {
    "backspace": ("Backspace", 8), "tab": ("Tab", 9), "enter": ("Enter", 13), "escape": ("Escape", 27),
    "space": ("Space", 32), "pageup": ("PageUp", 33), "pagedown": ("PageDown", 34),
    "end": ("End", 35), "home": ("Home", 36), "left": ("ArrowLeft", 37), "up": ("ArrowUp", 38),
    "right": ("ArrowRight", 39), "down": ("ArrowDown", 40), "insert": ("Insert", 45), "delete": ("Delete", 46),
    **{f"f{n}": (f"F{n}", 111 + n) for n in range(1, 13)},
}
CLICKABLE = {"button", "link", "tab", "checkbox", "radio", "menuitem", "option", "switch"}
# What a page offers to drag or drop on besides its controls: a slider, a list's items, a card, a drop zone.
DRAGGABLE = {"slider", "scrollbar", "separator", "listitem", "treeitem", "row", "cell", "gridcell", "group", "article",
             "region", "heading", "img", "image", "StaticText"}
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
            # Where it was going is kept while a certificate may still be what it waits for (`HostBrowser.show_for_owner`).
            tab.requested = browser.checked_url(url)
            result = await browser.command(tab, "Page.navigate", {"url": tab.requested})
            if result.get("errorText", "").startswith("net::ERR_SSL_CLIENT_AUTH_"):
                raise BrowserError("browser_certificate_needed")
            if result.get("errorText") and not result.get("isDownload"):
                tab.requested = ""
                raise BrowserError("browser_navigation_failed")
            if result.get("isDownload"):
                tab.requested = ""
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
    tab.requested = ""
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
                              else ["click"] if role in CLICKABLE else [])
            if role in CLICKABLE | DRAGGABLE:
                row["actions"].append("drag")
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


async def on_ref(browser, tab, backend, function, arguments=(), *, gesture=False):
    """What `function` returns when called on the page element a ref names (its backend node), or browser_ref_changed
    when the element is gone."""
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
            "objectId": object_id, "functionDeclaration": function, "returnByValue": True, "userGesture": gesture,
            "arguments": [{"value": value} for value in arguments],
        })
    finally:
        with suppress(BrowserError):
            await browser.command(tab, "Runtime.releaseObject", {"objectId": object_id})
    if "exceptionDetails" in result:
        raise BrowserError("browser_page_changed")
    return result["result"].get("value")


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
    error = await on_ref(browser, tab, backend, ELEMENT_ACTION,
                         (action, text, arguments.get("replace", False), row["name"], match_label), gesture=action == "click")
    if error:
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


def readable(text):
    """Text as a reader sees it, for the safety check: compatibility forms folded (fullwidth letters) and invisible
    characters (zero-width spaces and joiners, soft hyphens, combining marks) removed."""
    return "".join(char for char in unicodedata.normalize("NFKC", text) if unicodedata.category(char) not in ("Cf", "Mn"))


def dialog_blocked(tab, *, opened_now):
    """A tool's result while a JavaScript dialog blocks the page (#336). Chrome holds the page's scripts and input until
    the dialog is answered, so the result says so at once instead of waiting for Chrome until the call times out."""
    note = ("This dialog opened during the request, and the page waits for it." if opened_now else
            "The page shows this dialog, so the request was not performed.")
    return {**tab_ids(tab), "status": "dialog_open", "dialog": tab.dialog,
            "note": note + " Use browser_dialog with its dialog_id to accept or dismiss it."}


def auth_blocked(tab):
    """A tool's result once the site asks for a sign-in in Chrome's own prompt (HTTP authentication). Only the owner
    answers it, in the view; the navigation that asked waits for that, while the page shown before stays usable."""
    return {**tab_ids(tab), "status": "sign_in_prompt", "sign_in_prompt": tab.auth,
            "note": "The site asks for a user name and password in Chrome's own sign-in prompt, which only the owner "
                    "answers: use request_takeover with reason sign_in. Unanswered, it is cancelled in 5 minutes."}


async def dialog_action(browser, tab, arguments, approver):
    """Inspect, accept or dismiss the dialog that blocks the tab, as the Docker browser's browser_dialog does (#336)."""
    dialog, action = tab.dialog, arguments["action"]
    if dialog is None:
        return {**tab_ids(tab), "dialog": None, **({"status": "no_dialog"} if action != "inspect" else {})}
    if action == "inspect":
        return {**tab_ids(tab), "dialog": dialog}
    if arguments.get("dialog_id") != dialog["dialog_id"]:
        raise BrowserError("browser_dialog_changed")
    text = arguments.get("prompt_text")
    if text is not None and (action != "accept" or dialog["type"] != "prompt"):
        raise BrowserError("browser_dialog_text")
    if action == "accept":
        # Accepting is pressing the dialog's OK: judged as a click on a button named by its message, and an answer to a
        # prompt as typing it there too. A headless dialog has no window the owner could answer, so a private answer is
        # refused. The whole message is judged as it reads (a payment past what the result shows, or split by an
        # invisible character, must not slip by), and one too long to judge is only dismissed.
        if tab.dialog_text is None:
            raise BrowserError("browser_dialog_private")
        message = readable(tab.dialog_text)
        verdicts = {safety.judge(action="click", declared_final=False, name=message, role="button")}
        if text:
            verdicts.add(safety.judge(action="type", declared_final=False, text=readable(text), focused_name=message,
                                      focused_role="Edit", focused_actions=("value",)))
        if safety.HANDOFF in verdicts or safety.handoff_by_name(message):
            raise BrowserError("browser_dialog_private")
        if safety.REFUSE in verdicts:
            raise BrowserError("browser_action_refused")
        if safety.CONFIRM in verdicts and approver != "user":
            raise BrowserError("browser_owner_approval_required")
    await browser.answer_dialog(tab, dialog, action == "accept", text)
    return {**tab_ids(tab), "status": "dialog_accepted" if action == "accept" else "dialog_dismissed"}


def key_event(arguments):
    key = arguments["key"]
    mods = arguments.get("modifiers", [])
    if not mods and len(key) == 1 and key.isascii() and key.isprintable():
        code = "Key" + key.upper() if key.isalpha() else "Digit" + key if key.isdigit() else ""
        return (key,), {"key": key, "code": code, "text": key, "windowsVirtualKeyCode": ord(key.upper())}
    try:
        chord = safety.parse_chord("+".join([*mods, key]))
    except safety.KeysRefused as refused:
        raise BrowserError("browser_key_is_text" if refused.why == "typing" else "browser_action_refused") from None
    *modifiers, key = chord
    code, virtual = KEYS.get(key, ("Key" + key.upper() if key.isalpha() else "Digit" + key, ord(key[0].upper())))
    args = {"key": " " if key == "space" else code if key in KEYS else key, "code": code,
            "windowsVirtualKeyCode": virtual, "modifiers": sum(MODIFIERS[mod] for mod in modifiers)}
    if not modifiers and key == "space":
        args["text"] = " "
    if not modifiers and key == "enter":
        args["text"] = "\r"
    return chord, args


HISTORY_STEPS = {("alt", "left"): -1, ("alt", "right"): 1}


async def history_step(browser, tab, step):
    """Back or forward in this tab's own history, as the browser's Alt+Left and Alt+Right do. A headless page never
    handles those keys, so they are never sent to it; the target must be a page `navigate` may open."""
    history = await browser.command(tab, "Page.getNavigationHistory")
    index = history["currentIndex"] + step
    if not 0 <= index < len(history["entries"]):
        return {**tab_ids(tab), "status": "no_history",
                "note": f"This tab has no {'earlier' if step < 0 else 'later'} page to go to. Use browser_navigate to open a URL."}
    entry = history["entries"][index]
    browser.checked_url(entry["url"])
    tab.refs.clear()
    await browser.command(tab, "Page.navigateToHistoryEntry", {"entryId": entry["id"]})
    with suppress(TimeoutError):
        async with asyncio.timeout(5):
            while (await browser.command(tab, "Page.getNavigationHistory"))["currentIndex"] != index:
                await asyncio.sleep(0.05)
    return {**tab_ids(tab), "status": "delivered"}


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
    if chord in HISTORY_STEPS:
        return await history_step(browser, tab, HISTORY_STEPS[chord])
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


async def drag_end(browser, tab, arguments, ref, x, y):
    """Where one end of a drag is: the visible middle of the element the ref `ref` names, or the point (`x`, `y`)."""
    if ref in arguments:
        if x in arguments or y in arguments:
            raise BrowserError("browser_drag_points")
        entry = tab.refs.get(arguments[ref])
        if entry is None or "drag" not in entry[1]["actions"]:
            raise BrowserError("browser_current_ref_required")
        point = await on_ref(browser, tab, entry[0], DRAG_POINT)
        if isinstance(point, str):
            raise BrowserError(point)
        if point is None:
            raise BrowserError("browser_drag_offscreen")
        return tuple(point)
    if x not in arguments or y not in arguments:
        raise BrowserError("browser_drag_points")
    width, height = VIEWPORT
    if not (0 <= arguments[x] < width and 0 <= arguments[y] < height):
        raise BrowserError("browser_coordinates")
    return arguments[x], arguments[y]


async def drag_checked(browser, tab, point, approver):
    """What the page has under one end of a drag, judged as a click on it is: an owner's step (sign-in, code, payment)
    is answered with what it needs, a control that closes is refused, and one that sends, deletes or buys waits for the
    owner's yes. None when the drag may go on."""
    target, _ = await evaluate(browser, tab, f"({INPUT_TARGET})({json.dumps(list(point))}, false)")
    if not isinstance(target, dict) or target.get("opaque") or target.get("file"):
        raise BrowserError("browser_action_refused")
    name = target.get("name", "")
    if reason := target.get("reason"):
        return {**tab_ids(tab), "owner_needed": reason}
    verdict = safety.judge(action="click", declared_final=target.get("submits", False), focused_name=name, name=name,
                           focused_role=target.get("role", ""), focused_actions=("value",) if target.get("editable") else ())
    if verdict == safety.HANDOFF:
        return {**tab_ids(tab), "owner_needed": safety.handoff_reason(SimpleNamespace(name=name))}
    if verdict == safety.REFUSE:
        raise BrowserError("browser_action_refused")
    if verdict == safety.CONFIRM and approver != "user":
        raise BrowserError("browser_owner_approval_required")
    return None


async def drag(browser, tab, arguments, approver):
    """Press at the start, move to the end in steps and release, in the member's own tab (#337), so a page sees a real
    pointer drag. A page that starts an HTML5 drag (draggable, dragstart) has Chrome's intercepted drag handed back as
    dragenter, dragover and drop at the end, since a native drag has no place to run in a tab nobody sees."""
    if arguments.get("delivery_mode") == "foreground":
        raise BrowserError("browser_background_only")
    mods = {mod.casefold() for mod in arguments.get("modifier", [])}
    if not mods <= MODIFIERS.keys():
        raise BrowserError("browser_action_refused")
    if reason := await private_form(browser, tab):
        return {**tab_ids(tab), "owner_needed": reason}
    start = await drag_end(browser, tab, arguments, "ref", "from_x", "from_y")
    end = await drag_end(browser, tab, arguments, "destination_ref", "to_x", "to_y")
    for point in (start, end):
        if blocked := await drag_checked(browser, tab, point, approver):
            return blocked
    steps = arguments.get("steps", 20)
    pause = arguments.get("duration_ms", 500) / 1000 / steps
    modifiers = sum({MODIFIERS[mod] for mod in mods})

    def at(step):
        return start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps

    async def mouse(kind, point, **extra):
        await browser.command(tab, "Input.dispatchMouseEvent", {"type": kind, "x": point[0], "y": point[1], "button": "left",
                                                                 "modifiers": modifiers, **extra})

    async def dropped(kind, point):
        await browser.command(tab, "Input.dispatchDragEvent", {"type": kind, "x": point[0], "y": point[1],
                                                                "modifiers": modifiers, "data": tab.drag})

    tab.drag, pressed, html5 = None, False, False
    await browser.command(tab, "Input.setInterceptDrags", {"enabled": True})
    try:
        await mouse("mouseMoved", start, button="none", buttons=0)
        await mouse("mousePressed", start, buttons=1, clickCount=1)
        pressed = True
        for step in range(1, steps + 1):
            await asyncio.sleep(pause)
            await mouse("mouseMoved", at(step), buttons=1)
            if tab.drag is not None:
                # Chrome took the drag from the page's own pointer: what follows is the drag's own events.
                html5 = True
                await dropped("dragEnter", at(step))
                for later in range(step, steps + 1):
                    await dropped("dragOver", at(later))
                    await asyncio.sleep(pause)
                await dropped("drop", end)
                break
        await mouse("mouseReleased", end, buttons=0, clickCount=1)
        pressed = False
    finally:
        # A drag that failed or was stopped must not leave the button down or the drag taken from the page.
        with suppress(BrowserError, TimeoutError):
            async with asyncio.timeout(3):
                if pressed:
                    await mouse("mouseReleased", end, buttons=0, clickCount=1)
                await browser.command(tab, "Input.setInterceptDrags", {"enabled": False})
        tab.drag = None
    tab.refs.clear()
    return {"status": "delivered", **tab_ids(tab), "drag": "html5" if html5 else "pointer"}
