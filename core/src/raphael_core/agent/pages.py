"""Durable conversation pages and their ephemeral, isolated loopback host.

No page is served from the application's origin.

Adapted from third-party code under Apache-2.0, with changes; see core/packaging/licenses/NOTICES.md.
"""

import asyncio
import base64
import html as html_lib
import ipaddress
import json
import re
import secrets
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from ..clock import wall_clock_ms
from ..frame_navigation import FRAME_NAVIGATION
from ..memory.scan import find_secret
from ..protocol import INTERNAL_ERROR, NOT_FOUND, RpcError, invalid_params
from .page_style import BASE

HTML_BYTES = 256 * 1024
MCP_MIME = "text/html;profile=mcp-app"
VIEWING_MS = 6 * 60 * 60 * 1000
CDNS = ("https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com")


class PageError(Exception):
    """A value-free refusal suitable for a model or an RPC caller."""

    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


# What an embedded file or a library's fingerprint holds is content, not a credential: a picture's or a font's bytes in
# base64 and a script's integrity hash are set aside, so that no run of them can pass for a key's shape. A text file (an
# SVG, JSON, plain text) is decoded and read like the rest of the page; a binary one is not read. Only credentials and
# payment secrets are refused on a page (`memory/scan.py`): an address, an article or an ID is content.
_EMBEDDED = re.compile(r"data:([\w.+-]+/[\w.+-]+)?((?:;[\w.+-]+=[\w.+-]+)*);base64,([A-Za-z0-9+/=\s]+)", re.I)
_TEXT_FILES = re.compile(r"text/[\w.+-]+|image/svg\+xml|application/(?:json|xml|javascript|ld\+json)", re.I)
_INTEGRITY = re.compile(r"\bsha(?:256|384|512)-[A-Za-z0-9+/]{40,}={0,2}")


def _readings(value):
    """The text the scanner reads of `value`: it with embedded files and fingerprints set aside, and each embedded text."""
    texts = []

    def embedded(match):
        if _TEXT_FILES.fullmatch(match[1] or "text/plain"):
            try:
                texts.append(base64.b64decode(re.sub(r"\s", "", match[3]) + "==").decode("utf-8", "replace"))
            except ValueError:
                return match[0]
        return "data:;base64,"

    return [_INTEGRITY.sub("", _EMBEDDED.sub(embedded, value)), *texts]


def checked_text(value, name, limit, *, required=False):
    if not isinstance(value, str) or (required and not value.strip()):
        raise PageError("bad_arguments", f"{name} must be nonempty text")
    if len(value.encode("utf-8")) > limit:
        raise PageError("too_large", f"{name} exceeds {limit} UTF-8 bytes; shorten it and try again")
    # Decode character references too, so HTML cannot disguise a secret from the existing scanner.
    if any(find_secret(text) for text in (*_readings(value), *_readings(html_lib.unescape(value)))):
        raise PageError("secret", f"{name} contains a secret; remove credentials and try again")
    return value


def domains(values):
    """Keep at most sixteen explicit public HTTPS origins; no CSP patterns or local networks."""
    kept = []
    if not isinstance(values, list):
        return kept
    for value in values[:64]:
        if not isinstance(value, str) or len(value) > 300 or re.search(r"[\s*'\";,\\]", value):
            continue
        try:
            url = urlsplit(value)
            host = url.hostname or ""
            if (url.scheme != "https" or url.username is not None or url.password is not None
                    or url.path not in ("", "/") or url.query or url.fragment
                    or not re.fullmatch(r"[a-zA-Z0-9.-]+", host) or "." not in host
                    or host.lower().endswith((".localhost", ".local", ".internal"))):
                continue
            try:
                if not ipaddress.ip_address(host).is_global:
                    continue
            except ValueError:
                pass
            port = url.port
            origin = f"https://{host.lower()}" + (f":{port}" if port and port != 443 else "")
        except ValueError:
            continue
        if origin not in kept:
            kept.append(origin)
        if len(kept) == 16:
            break
    return kept


def page_csp(page):
    network = page["network"]
    resources = network.get("resources", []) if page["source"] == "mcp" else list(CDNS)
    sources = " ".join(resources)
    connect = " ".join(network.get("connect", [])) if page["source"] == "mcp" else ""
    connect_source = connect or "'none'"
    fonts = "" if page["source"] == "mcp" else " https://fonts.gstatic.com"
    styles = "" if page["source"] == "mcp" else " https://fonts.googleapis.com"
    return "; ".join((
        "sandbox allow-scripts allow-forms", "default-src 'none'",
        f"script-src 'unsafe-inline' {sources}".strip(),
        f"style-src 'unsafe-inline' {sources}{styles}".strip(),
        f"font-src data: {sources}{fonts}".strip(), f"img-src data: blob: {sources}".strip(),
        (f"media-src data: blob: {sources}".strip() if page["source"] == "mcp" else "media-src data: blob:"),
        f"connect-src {connect_source}",
        "form-action 'none'", "base-uri 'none'", "frame-src 'none'", "object-src 'none'",
        "worker-src 'none'", "manifest-src 'none'",
    ))


# The app's own theme (app/src/main/styles.css; app/src/main/page-theme.test.ts keeps the two equal), so a page reads as a
# part of the app in either theme: its surfaces, three greys of text, its line, links, status colours and the eight chart
# colours a report's charts draw with (report-chart.ts), in that order.
CHART = {"light": ("#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"),
         "dark": ("#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767")}
THEME = {
    theme: {**dict(zip(("bg", "surface", "fg", "fg-2", "muted", "line", "accent", "on-accent", "link", "ok", "warn", "err"),
                       colors)), **{f"chart-{n}": value for n, value in enumerate(CHART[theme], 1)}}
    for theme, colors in (
        ("light", ("#ffffff", "#f7f7f7", "#0a0a0a", "#404040", "#595959", "#ebebeb", "#0a0a0a", "#ffffff", "#1f63d1",
                   "#15703f", "#80560f", "#b3261e")),
        ("dark", ("#0a0a0a", "#161616", "#f5f5f5", "#b4b4b4", "#999999", "#262626", "#f5f5f5", "#0a0a0a", "#7aaef5",
                  "#9fd7b5", "#edc677", "#ff9aa9")))
}
FONT = '"Inter","Noto Sans TC","PingFang TC","Microsoft JhengHei UI","Microsoft JhengHei",system-ui,sans-serif'


# A page open in the whole area is shown as a browser shows it (R-PAGE-10): its frame is the page's window, to the window's foot
# (R-PAGE-11), and the page scrolls in it. The height it says only sizes its card in the thread. The window tells it how much of its
# foot the composer floats over (`foot`) and how much of its head the header's buttons do (`head`), so its first and last lines
# scroll clear of them.
_HELPER = "<script>" + FRAME_NAVIGATION + """
(() => {
  const post = (type, data) => parent.postMessage({raphaelPage: 1, type, ...data}, '*');
  // What the owner does on the page is kept (R-PAGE-14): every field's value, what the page keeps in localStorage (the frame
  // has none of its own) and what its script keeps with raphael.state go to the window, which saves them with the page, and
  // they come back when it opens again, after a reload, a theme change, a new revision or a restart. Passwords, files and a
  // field marked autocomplete="off" or data-raphael-forget are never kept.
  const saved = window.__raphaelState && typeof window.__raphaelState === 'object' ? window.__raphaelState : {};
  const store = new Map(Object.entries(saved.storage || {}).filter(([, value]) => typeof value === 'string'));
  let custom = saved.custom === undefined ? null : saved.custom, restoring = false, timer = 0;
  const FIELD = 'input, textarea, select, [contenteditable]';
  const kept = el => el instanceof Element && el.matches(FIELD) && el.getAttribute('contenteditable') !== 'false'
    && !el.matches('input[type=password i], input[type=file i], input[type=hidden i], input[type=submit i], input[type=button i], input[type=reset i], input[type=image i], [autocomplete~="off" i], [data-raphael-forget]');
  const all = () => [...document.querySelectorAll(FIELD)].filter(kept);
  const keyOf = (el, index) => el.id ? '#' + el.id : el.name ? 'name:' + el.name + (el.type === 'radio' || el.type === 'checkbox' ? '=' + el.value : '') : 'at:' + index;
  const valueOf = el => el.isContentEditable ? el.innerHTML : el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.multiple ? [...el.selectedOptions].map(o => o.value) : el.value;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => {
    const fields = {}; all().forEach((el, index) => { fields[keyOf(el, index)] = valueOf(el); });
    post('state', {state: {fields, storage: Object.fromEntries(store), custom}}); }, 400); };
  const applied = new Set();
  const restore = () => {
    const values = saved.fields && typeof saved.fields === 'object' ? saved.fields : {};
    restoring = true;
    try {
      all().forEach((el, index) => {
        const key = keyOf(el, index), value = values[key];
        if (applied.has(key) || !(key in values)) return;
        applied.add(key);
        if (el.isContentEditable) { if (typeof value === 'string') el.innerHTML = value; }
        else if (el.type === 'checkbox' || el.type === 'radio') { if (typeof value === 'boolean') el.checked = value; }
        else if (el.multiple) { if (Array.isArray(value)) [...el.options].forEach(o => { o.selected = value.includes(o.value); }); }
        else if (typeof value === 'string') el.value = value;
        // The page's own script hears it as it hears the owner, so what it shows from the fields is drawn again.
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
      });
    } finally { restoring = false; }
  };
  for (const type of ['input', 'change']) addEventListener(type, event => { if (!restoring && kept(event.target)) save(); }, true);
  let own = null;
  try { own = window.localStorage; own.length; } catch { own = null; }
  if (!own) try {
    Object.defineProperty(window, 'localStorage', {configurable: true, value: Object.freeze({
      get length() { return store.size; },
      key(index) { return [...store.keys()][index] ?? null; },
      getItem(key) { key = String(key); return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(String(key), String(value)); save(); },
      removeItem(key) { store.delete(String(key)); save(); },
      clear() { store.clear(); save(); },
    })});
  } catch {}
  window.raphael = Object.freeze({
    send(text) { if (!restoring && typeof text === 'string' && text.trim() && text.length <= 4000) post('send', {text}); },
    open(url) { if (restoring) return; try { const u = new URL(url); if (u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 2048) post('open', {url:u.href}); } catch {} },
    state: Object.freeze({
      get() { return custom === null ? null : JSON.parse(JSON.stringify(custom)); },
      set(value) { try { custom = value === undefined ? null : JSON.parse(JSON.stringify(value)); } catch { return; } save(); },
    }),
  });
  addEventListener('DOMContentLoaded', () => {
    restore();
    // A page that draws its fields from its script after it loads gets their values as they appear, for a few seconds.
    const appear = new MutationObserver(restore);
    appear.observe(document.documentElement, {childList: true, subtree: true});
    setTimeout(() => appear.disconnect(), 3000);
  }, {once: true});
  addEventListener('load', restore, {once: true});
  // Where the owner is reading: the window keeps it, so a page changed while open comes back to the same place.
  let scrolling = 0;
  addEventListener('scroll', () => { if (!scrolling) scrolling = requestAnimationFrame(() => { scrolling = 0; post('scroll', {y: Math.round(scrollY)}); }); }, {passive: true});
  // The page has the keys once the owner pressed in it: Escape there goes back to the conversation as it does outside,
  // unless it only drops an input method's candidate (WebKit, on macOS, marks that Escape with keyCode 229 alone).
  addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229) post('escape', {}); });
  // The room the window keeps over the page (R-PAGE-11, R-PAGE-16): the composer at the foot and the header's buttons at the head. It is the
  // root's own padding, which is page and canvas alike, so the page's first line stands clear under the buttons and its last clear above the
  // composer, and nothing but the page's own background shows in either. A fixed or sticky part of the page that reaches into either room
  // (a rail one window tall with its buttons at its foot, a bar at the top or the bottom) is moved clear of it too, or it would stand under the
  // composer for good: a part as tall as the window takes the room as its own padding, so its background still runs to the edge, and a smaller
  // one moves by it.
  let foot = 0, head = 0, moved = [], settle = 0, tone = '';
  const fades = {};
  // The page's own ground (R-PAGE-17): the colour its root paints, else its body's, else (it paints nothing) the app's own colour behind the
  // frame, which follows the colour scheme. A page whose ground is not one opaque colour (a gradient, a picture, a translucent colour) has none.
  const numbers = text => { const match = /^rgba?[(]([^)]*)[)]$/.exec(text); return match ? match[1].split(/[ ,/]+/).filter(Boolean).map(Number) : null; };
  const ground = () => {
    const paint = element => { const style = getComputedStyle(element); return {image: style.backgroundImage !== 'none', numbers: numbers(style.backgroundColor)}; };
    const root = paint(document.documentElement), body = paint(document.body || document.documentElement);
    if (root.image || body.image) return null;
    const clear = list => !list || (list.length > 3 && list[3] === 0);
    const own = !clear(root.numbers) ? root.numbers : !clear(body.numbers) ? body.numbers : null;
    if (!own) return getComputedStyle(document.documentElement).colorScheme === 'dark' ? [10, 10, 10] : [255, 255, 255];
    const colour = own.slice(0, 3);
    return (own.length > 3 && own[3] !== 1) || colour.length < 3 || colour.some(Number.isNaN) ? null : colour.map(Math.round);
  };
  const lin = value => { value /= 255; return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); };
  // What the window's own buttons are drawn in over the page (its tone, light or dark; mixed when it has no one ground) and a fade of that
  // ground at the head and the foot, so what scrolls under the header's buttons and the composer fades out in the page's own colour, never the
  // app's. The fades are fixed, take no pointer and are none for a page that has no one ground.
  const shade = () => {
    const colour = ground(), say = !colour ? 'mixed' : 0.2126 * lin(colour[0]) + 0.7152 * lin(colour[1]) + 0.0722 * lin(colour[2]) > 0.179 ? 'light' : 'dark';
    if (say !== tone) { tone = say; post('tone', {tone}); }
    for (const [at, room] of [['top', head], ['bottom', foot]]) {
      const on = room > 0 && colour;
      if (!fades[at] && on) {
        fades[at] = document.createElement('div');
        fades[at].setAttribute('data-raphael-fade', at);
        fades[at].style.cssText = 'position:fixed;left:0;right:0;pointer-events:none;z-index:2147483647;' + at + ':0';
        document.documentElement.appendChild(fades[at]);
      }
      if (!fades[at]) continue;
      fades[at].style.display = on ? 'block' : 'none';
      if (!on) continue;
      const solid = 'rgb(' + colour.join(',') + ')', clear = 'rgba(' + colour.join(',') + ',0)';
      fades[at].style.height = (room + 16) + 'px';
      fades[at].style.backgroundImage = 'linear-gradient(' + (at === 'top' ? 'to bottom' : 'to top') + ',' + solid + ' 0,' + solid + ' ' + Math.round(room * 0.85) + 'px,' + clear + ' 100%)';
    }
  };
  const lift = () => {
    settle = 0;
    // What was moved is put back first, so that each pass reads the page as the page made it.
    for (const [element, was] of moved) for (const name in was) element.style[name] = was[name];
    moved = [];
    const root = document.documentElement.style;
    root.paddingTop = head ? head + 'px' : '';
    root.paddingBottom = foot ? foot + 'px' : '';
    shade();
    if ((!foot && !head) || !document.body) return;
    let seen = 0;
    for (const element of document.body.querySelectorAll('*')) {
      if (++seen > 4000) break;
      const style = getComputedStyle(element);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      const box = element.getBoundingClientRect(), was = {}, tall = box.height >= innerHeight * 0.6;
      if (!(box.width > 0 && box.height > 0)) continue;
      const take = (edge, room, reaches) => {
        if (!reaches) return;
        if (tall) {
          const side = edge === 'bottom' ? 'paddingBottom' : 'paddingTop';
          if (!('boxSizing' in was)) { was.boxSizing = element.style.boxSizing; element.style.boxSizing = 'border-box'; }
          was[side] = element.style[side];
          element.style[side] = (parseFloat(style[side]) || 0) + room + 'px';
        } else if (style[edge] !== 'auto') {
          was[edge] = element.style[edge];
          element.style[edge] = (parseFloat(style[edge]) || 0) + room + 'px';
        }
      };
      take('bottom', foot, foot > 0 && box.bottom > innerHeight - foot && box.top < innerHeight);
      take('top', head, head > 0 && box.top < head && box.bottom > 0);
      if (Object.keys(was).length) moved.push([element, was]);
    }
  };
  const settleSoon = () => { if (!settle && (foot || head)) settle = setTimeout(lift, 120); };
  addEventListener('DOMContentLoaded', () => {
    settleSoon();
    new MutationObserver(settleSoon).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-theme']});
  }, {once: true});
  addEventListener('load', settleSoon, {once: true});
  addEventListener('resize', settleSoon);
  // A page that changes its own theme does it by a press, and its colours may come by a transition: its ground is read again after either.
  addEventListener('click', settleSoon, true);
  addEventListener('transitionend', settleSoon, true);
  // A sticky part reaches a room only once it sticks, as the page is read down to it.
  addEventListener('scroll', settleSoon, {passive: true});
  addEventListener('message', event => {
    const data = event.data, own = event.source === parent && data && data.raphaelPage === 1;
    if (own && data.type === 'scroll-to' && Number.isFinite(data.y)) scrollTo(0, Math.max(0, data.y));
    if (own && (data.type === 'foot' || data.type === 'head') && Number.isFinite(data.y)) {
      const room = Math.max(0, Math.min(2000, Math.round(data.y)));
      if (data.type === 'foot') foot = room; else head = room;
      // A page opened again is told its tone again: the window clears it when the page is put away.
      tone = '';
      lift();
    }
  });
  // A style sheet the page loads from another host holds all of it back while it comes: nothing is drawn and the page's own
  // script waits. One still on its way after a few seconds stops holding the page, which draws in the fonts and styles it
  // has, and is still applied if it comes later (R-PAGE-13).
  setTimeout(() => {
    if (document.readyState === 'complete') return;
    for (const link of document.querySelectorAll('link[rel~="stylesheet" i]')) {
      if (link.sheet || !link.isConnected) continue;
      const late = link.cloneNode(), media = link.media || 'all';
      late.media = 'print';
      late.addEventListener('load', () => { late.media = media; }, {once: true});
      link.replaceWith(late);
    }
  }, 3000);
  addEventListener('DOMContentLoaded', () => {
    let previous = 0, framed = innerHeight;
    const report = () => { const box = document.body.getBoundingClientRect(), style = getComputedStyle(document.body);
      const own = box.height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      // The root also holds the margins of a first and last child, which collapse through the body.
      const height = Math.max(80, Math.min(20000, Math.ceil(Math.max(own, document.documentElement.getBoundingClientRect().height))));
      // A page sized by its window (a column `height: 100vh` with padding beside it) grows by just as much as its frame did: that
      // is the frame's own growth coming back, not more page, and passing it on would grow the frame without end (R-PAGE-12).
      const grown = innerHeight - framed;
      framed = innerHeight;
      if (height === previous || (previous && grown > 0 && Math.abs(height - previous - grown) <= 1)) return;
      previous = height; post('height', {height}); };
    const sizes = new ResizeObserver(report);
    sizes.observe(document.body); sizes.observe(document.documentElement); report();
  }, {once:true});
})();
</script>"""


STATE_BYTES = 64 * 1024


def checked_state(value):
    """What the window saves of a page (R-PAGE-14): its fields, its storage and its script's own value, at most 64 KB as
    JSON, and no credential in it (a page that holds one keeps nothing until it is gone)."""
    if not isinstance(value, dict) or set(value) - {"fields", "storage", "custom"}:
        raise invalid_params("state must hold fields, storage and custom only")
    fields, storage = value.get("fields", {}), value.get("storage", {})
    if not isinstance(fields, dict) or not all(
            isinstance(key, str) and (isinstance(item, (str, bool)) or (isinstance(item, list) and all(isinstance(v, str) for v in item)))
            for key, item in fields.items()):
        raise invalid_params("fields must name text, a choice or a list of choices")
    if not isinstance(storage, dict) or not all(isinstance(key, str) and isinstance(item, str) for key, item in storage.items()):
        raise invalid_params("storage must name text")
    try:
        checked_text(json.dumps(value, ensure_ascii=False), "the page's state", STATE_BYTES)
    except PageError as error:
        raise invalid_params(str(error)) from None
    return value


def state_script(state):
    """The saved state of a page as the script the helper reads first (`window.__raphaelState`), empty for none. A `<` is
    written as its escape, so nothing in it can close the script."""
    if not state:
        return ""
    text = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    return "<script>window.__raphaelState=" + text.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029") + ";</script>"


def theme_script(theme):
    """The app's theme on the page's root as `data-theme`, before the page's own markup: a page written with a light and a
    dark palette (`html[data-theme="light"]`) reads in the window's theme, even one whose `<html data-theme="dark">` names
    a default (the parser keeps an attribute the root already has). The page's own script may still change it, a toggle of
    its own, and the frame is drawn again when the window's theme changes."""
    name = "dark" if theme == "dark" else "light"
    return f"<script>document.documentElement.setAttribute('data-theme','{name}')</script>"


def document(page, theme, state=None):
    """Prepend host styles/helper to a fragment or a full document, after its preamble. `state` is what the owner left on
    the page (R-PAGE-14): the helper puts it back."""
    content = page["html"]
    while True:
        before = content
        content = content.lstrip("\ufeff \r\n\t")
        if content.startswith("<!--"):
            end = content.find("-->", 4)
            content = "" if end < 0 else content[end + 3:]
        elif re.match(r"^<[!?]", content):
            end = content.find(">")
            content = "" if end < 0 else content[end + 1:]
        if content == before:
            break
    variables = ";".join(f"--{key}:{value}" for key, value in {**THEME[theme], "font": FONT}.items())
    # The app's base style (page_style.py) for the pages a member writes, ahead of the page's own, which wins over it; a
    # plugin's page comes with its own design and is left as it is.
    base = BASE if page["source"] == "html" else ""
    return ('<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            f"<title>{html_lib.escape(page['title'])}</title><style>:root{{{variables};color-scheme:{theme}}}"
            f"body{{color:var(--fg);font-family:var(--font)}}{base}</style>" + state_script(state)
            + theme_script(theme) + _HELPER + content)


def page_file(page):
    """An HTML page as one file the owner can pass on (R-PAGE-08): the stored page as `document()` draws it, without the
    helper that talks to the window, in its reader's own theme (the dark words stand under `prefers-color-scheme`), and
    with the page's own policy first in its head: the same sources, no connection, no form, no frame. The sandbox of that
    policy is a header's alone, and a meta element cannot carry it."""
    # A file follows its reader's own theme (prefers-color-scheme below), so it carries neither the helper nor the theme.
    text = document(page, "light").replace(_HELPER, "", 1).replace(theme_script("light"), "", 1)
    policy = "; ".join(part for part in page_csp(page).split("; ") if not part.startswith("sandbox"))
    dark = ";".join(f"--{key}:{value}" for key, value in {**THEME["dark"], "font": FONT}.items())
    text = text.replace('<meta charset="utf-8">', '<meta charset="utf-8">'
                        f'<meta http-equiv="Content-Security-Policy" content="{html_lib.escape(policy, quote=True)}">', 1)
    return text.replace("</style>", f"</style><style>@media (prefers-color-scheme:dark){{:root{{{dark};color-scheme:dark}}}}</style>", 1)


class PageStore:
    def __init__(self, conn, now_ms=wall_clock_ms):
        self.conn, self.now_ms = conn, now_ms

    def state(self, page_id):
        """What the owner left on the page (R-PAGE-14), or None."""
        row = self.conn.execute("SELECT state FROM page_state WHERE page_id=?", (page_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def keep_state(self, page_id, state):
        with self.conn:
            self.conn.execute("INSERT INTO page_state (page_id, state, updated_at_ms) VALUES (?, ?, ?)"
                              " ON CONFLICT(page_id) DO UPDATE SET state=excluded.state, updated_at_ms=excluded.updated_at_ms",
                              (page_id, json.dumps(state, ensure_ascii=False, separators=(",", ":")), self.now_ms()))

    def get(self, page_id):
        row = self.conn.execute("SELECT * FROM pages WHERE id=?", (page_id,)).fetchone()
        if row is None:
            return None
        page = dict(row)
        for key in ("network", "tool_input", "tool_result"):
            page[key] = json.loads(page[key])
        return page

    def write(self, *, turn_id, member_id, conversation_id, title, html, fallback_text="", height=320,
              source="html", server=None, tool=None, tool_input=None, tool_result=None, network=None):
        title = checked_text(title, "title", 320, required=True)
        if len(title) > 80:
            raise PageError("too_large", "title exceeds 80 characters; shorten it and try again")
        html = checked_text(html, "html", HTML_BYTES, required=True)
        fallback_text = checked_text(fallback_text, "fallback_text", 6000)
        if len(fallback_text) > 1500:
            raise PageError("too_large", "fallback_text exceeds 1500 characters")
        if type(height) is not int:
            raise PageError("bad_arguments", "height must be a whole number")
        height = max(80, min(2400, height))
        network = network if isinstance(network, dict) else {}
        network = {"connect": domains(network.get("connectDomains", [])),
                   "resources": domains(network.get("resourceDomains", []))}
        inputs, result = json.dumps(tool_input or {}, ensure_ascii=False), json.dumps(tool_result or {}, ensure_ascii=False)
        checked_text(inputs, "tool_input", 64 * 1024)
        checked_text(result, "tool_result", 256 * 1024)
        # The turn is authoritative; tools cannot attach a page to someone else's conversation.
        turn = self.conn.execute("SELECT member_id, conversation_id FROM agent_turns WHERE id=?", (turn_id,)).fetchone()
        if turn is None or turn["member_id"] != member_id or turn["conversation_id"] != conversation_id:
            raise PageError("gone", "The page's conversation is gone")
        page_id, now = secrets.token_urlsafe(24), self.now_ms()
        with self.conn:
            self.conn.execute(
                "INSERT INTO pages (id, turn_id, member_id, conversation_id, title, html, fallback, height, rev, source,"
                " server, tool, tool_input, tool_result, network, created_at_ms, updated_at_ms)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
                (page_id, turn_id, member_id, conversation_id, title, html, fallback_text, height, source, server, tool,
                 inputs, result, json.dumps(network), now, now))
            self._revision(page_id)
        return self.get(page_id)

    def update(self, page_id, html, title=None, tool_input=None):
        """Replace a page's HTML; `tool_input` replaces what it was made from too (a report's content, or {} once it
        becomes plain HTML)."""
        page = self.get(page_id)
        if page is None:
            raise PageError("gone", "The page is gone; use show_page to create another")
        html = checked_text(html, "html", HTML_BYTES, required=True)
        title = page["title"] if title is None else checked_text(title, "title", 320, required=True)
        if len(title) > 80:
            raise PageError("too_large", "title exceeds 80 characters; shorten it and try again")
        inputs = json.dumps(page["tool_input"] if tool_input is None else tool_input, ensure_ascii=False)
        checked_text(inputs, "tool_input", 64 * 1024)
        with self.conn:
            self.conn.execute("UPDATE pages SET html=?, title=?, tool_input=?, rev=rev+1, updated_at_ms=? WHERE id=?",
                              (html, title, inputs, self.now_ms(), page_id))
            self._revision(page_id)
        return self.get(page_id)

    def _revision(self, page_id):
        self.conn.execute("INSERT INTO page_revisions (page_id, rev, title, html, at_ms)"
                          " SELECT id, rev, title, html, updated_at_ms FROM pages WHERE id=?", (page_id,))
        self.conn.execute("DELETE FROM page_revisions WHERE page_id=? AND rev <="
                          " (SELECT rev-10 FROM pages WHERE id=?)", (page_id, page_id))

    def listed(self, member_id, conversation_id, limit=5):
        """The newest pages of a member's conversation, for the words that refuse an update: what a member can still name."""
        return [dict(row) for row in self.conn.execute(
            "SELECT id, title, rev, source FROM pages WHERE member_id=? AND conversation_id IS ? ORDER BY updated_at_ms DESC, rowid DESC LIMIT ?",
            (member_id, conversation_id, limit))]

    def shown_in(self, turn_ids):
        found = {}
        ids = list(dict.fromkeys(turn_ids))
        for start in range(0, len(ids), 500):
            chunk = ids[start:start + 500]
            for row in self.conn.execute(f"SELECT id, turn_id FROM pages WHERE turn_id IN ({','.join('?' for _ in chunk)})"
                                         " ORDER BY created_at_ms, rowid", chunk):
                found.setdefault(row["turn_id"], []).append(card(self.get(row["id"])))
        return found


def is_report(page):
    """A report page (agent/report_page.py): its content is structured, kept as its tool_input, and the app draws it."""
    return page["source"] == "html" and isinstance(page["tool_input"], dict) and "report" in page["tool_input"]


def card(page):
    return {**{key: page[key] for key in ("id", "title", "rev", "height", "source", "server", "fallback")},
            "kind": "report" if is_report(page) else "page"}


# A YouTube video's id, the only thing `/v/` serves (PageHost.video_base).
_VIDEO_PATH = re.compile(r"/v/([A-Za-z0-9_-]{6,20})")
_VIDEO_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.youtube-nocookie.com"


def video_player(video_id, start=0):
    """The page that holds YouTube's player for `video_id`, filling its frame, from `start` seconds."""
    query = f"?start={start}" if start else ""
    return ("<!doctype html><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">"
            "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style>"
            f"<iframe src=\"https://www.youtube-nocookie.com/embed/{video_id}{query}\" title=\"YouTube\" "
            "allow=\"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen\" "
            "allowfullscreen referrerpolicy=\"strict-origin-when-cross-origin\"></iframe>")


class PageHost:
    """One host per core; bearer tokens exist only in memory and are never page ids."""

    def __init__(self, store):
        self.store, self.server = store, None
        self.tokens = {}
        self.lock = asyncio.Lock()
        self.clients = set()

    async def _port(self):
        if self.server is None:
            self.server = await asyncio.start_server(self._serve, "127.0.0.1", 0, limit=8192)
        return self.server.sockets[0].getsockname()[1]

    async def url(self, page_id, theme):
        async with self.lock:
            port = await self._port()
            token = self.tokens.setdefault(page_id, secrets.token_urlsafe(32))
        return f"http://127.0.0.1:{port}/p/{token}?theme={theme}"

    def page_at(self, url):
        """The page this host serves at `url` (an address `url` gave while it runs), or None."""
        if self.server is None or not isinstance(url, str):
            return None
        try:
            parts = urlsplit(url)
            port = parts.port
        except ValueError:
            return None
        token = parts.path.removeprefix("/p/") if parts.path.startswith("/p/") else ""
        if parts.scheme != "http" or parts.hostname != "127.0.0.1" or port != self.server.sockets[0].getsockname()[1] or not token:
            return None
        page_id = next((key for key, value in self.tokens.items() if secrets.compare_digest(value, token)), None)
        return self.store.get(page_id) if page_id else None

    async def video_base(self):
        """Where a YouTube video plays inside the window on a Mac (`/v/<id>`): WebKit sends YouTube no referrer from the
        app's own `tauri://` page, and YouTube then refuses to play (its error 153), so the player is put in a page of this
        host, which names itself to YouTube. Only a video id is ever served there, and nothing of the owner's."""
        async with self.lock:
            port = await self._port()
        return f"http://127.0.0.1:{port}/v/"

    async def aclose(self):
        async with self.lock:
            if self.server is not None:
                self.server.close()
                await self.server.wait_closed()
                self.server = None
            self.tokens.clear()
        for writer in list(self.clients):
            writer.close()

    async def _serve(self, reader, writer):
        self.clients.add(writer)
        try:
            async with asyncio.timeout(5):
                request = (await reader.readuntil(b"\r\n\r\n")).decode("ascii")
                lines = request.split("\r\n")
                method, target, version = lines[0].split(" ")
                headers = [line.split(":", 1) for line in lines[1:] if line]
                hosts = [value.strip() for name, value in headers if name.lower() == "host"]
                port = writer.get_extra_info("sockname")[1]
                status, body, csp = 404, b"Not found", "default-src 'none'; sandbox"
                referrer = "no-referrer"
                if hosts != [f"127.0.0.1:{port}"]:
                    status, body = 403, b"Forbidden"
                elif method == "GET" and version in ("HTTP/1.0", "HTTP/1.1") and (video := _VIDEO_PATH.fullmatch(urlsplit(target).path)):
                    start = parse_qs(urlsplit(target).query).get("start", [""])[0]
                    status, body, csp = 200, video_player(video[1], int(start) if start.isdigit() else 0).encode("utf-8"), _VIDEO_CSP
                    referrer = "strict-origin-when-cross-origin"
                elif method == "GET" and version in ("HTTP/1.0", "HTTP/1.1"):
                    url = urlsplit(target)
                    token = url.path.removeprefix("/p/") if url.path.startswith("/p/") else ""
                    page_id = next((key for key, value in self.tokens.items() if secrets.compare_digest(value, token)), None)
                    page = self.store.get(page_id) if page_id else None
                    if page is not None and not url.scheme and not url.netloc:
                        theme = parse_qs(url.query).get("theme", ["light"])[0]
                        theme = "dark" if theme == "dark" else "light"
                        status, body, csp = 200, document(page, theme, self.store.state(page_id)).encode("utf-8"), page_csp(page)
                response = (f"HTTP/1.1 {status} { {200:'OK', 403:'Forbidden', 404:'Not Found'}[status]}\r\n"
                            "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                            f"Referrer-Policy: {referrer}\r\nX-Content-Type-Options: nosniff\r\n"
                            f"Content-Security-Policy: {csp}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n")
                writer.write(response.encode("ascii") + body)
                await writer.drain()
        except (TimeoutError, ValueError, UnicodeError, ConnectionError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            pass
        finally:
            self.clients.discard(writer)
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass


class Pages:
    def __init__(self, conn, *, notify=None, now_ms=wall_clock_ms, project_folder=lambda member: None):
        self.store = PageStore(conn, now_ms)
        self.host = PageHost(self.store)
        self.notify, self.tool_call = notify, None
        self.project_folder = project_folder
        # The page the owner has open in front of them, as the window last said (`pages.viewing`): in memory only.
        self._viewing = None

    def register(self, router):
        router.register("pages.open", self.open)
        router.register("pages.video_base", self.video_base)
        router.register("pages.viewing", self.viewing)
        router.register("pages.state", self.keep_state)
        router.register("pages.tool_call", self.call)
        # The shell's alone (`report_save`): the window may not call it, so it never names a folder.
        router.register("pages.export", self.export)

    async def video_base(self, _params=None):
        return {"base": await self.host.video_base()}

    def changed(self, page):
        if self.notify is not None:
            self.notify("agent.turn", {"turn_id": page["turn_id"], "member_id": page["member_id"]})

    def of(self, params):
        page_id = params.get("id")
        page = self.store.get(page_id) if isinstance(page_id, str) else None
        if page is None:
            raise RpcError(NOT_FOUND, "The page is gone", {"kind": "page_gone"})
        return page

    async def open(self, params):
        page = self.of(params)
        theme = params.get("theme", "light")
        if theme not in ("dark", "light"):
            raise invalid_params("theme must be dark or light")
        result = card(page)
        result.pop("fallback")
        result.pop("id")
        if result["kind"] == "report":
            # The app draws a report itself from its checked content: no frame, so the host is not started for it.
            return {**result, "report": page["tool_input"]["report"]}
        result["url"] = await self.host.url(page["id"], theme)
        if page["source"] == "mcp":
            result.update(tool_input=page["tool_input"], tool_result=page["tool_result"], tool=page["tool"])
        return result

    async def keep_state(self, params):
        """What the owner left on a page, as its frame told the window (R-PAGE-14): served back with the page next time."""
        page = self.of(params)
        self.store.keep_state(page["id"], checked_state(params.get("state")))
        return {"kept": True}

    async def viewing(self, params):
        """The window's word, before it sends what the owner wrote, of the page that stands open beside it (null: none).
        The member that answers is told which page "here" and "this" mean (`viewed_by`)."""
        page_id = params.get("id")
        if page_id is None:
            self._viewing = None
            return {"viewing": None}
        if not isinstance(page_id, str):
            raise invalid_params("id must be a page id or null")
        page = self.of(params)
        self._viewing = (page["id"], self.store.now_ms())
        return {"viewing": page["id"]}

    def viewed_by(self, member_id, conversation_id):
        """The page open in front of the owner, when it is one of this member's conversation; else None. The window
        says so again at every send, so a word older than a few hours is a window that closed without saying."""
        if self._viewing is None:
            return None
        page_id, at = self._viewing
        page = self.store.get(page_id)
        if (page is None or self.store.now_ms() - at > VIEWING_MS
                or page["member_id"] != member_id or page["conversation_id"] != conversation_id):
            return None
        return page

    def file_at(self, url):
        """The page this core serves at `url`, as the file `export` saves of it (`page_file`, R-PAGE-08), for a chat on a
        phone that cannot open this PC's addresses (R-MSG-LINK-03): (name, html), or None for no such page and for a
        report or a plugin's page, which only the window can draw."""
        page = self.host.page_at(url)
        if page is None or page["source"] != "html" or is_report(page):
            return None
        from .report_page import FILE_BYTES, file_name  # report_page imports this module
        try:
            return file_name(page["title"]) + ".html", checked_text(page_file(page), "the page file", FILE_BYTES)
        except PageError:
            return None

    async def call(self, params):
        page = self.of(params)
        if page["source"] != "mcp" or self.tool_call is None:
            raise RpcError(NOT_FOUND, "This page has no plugin server", {"kind": "not_mcp"})
        return await self.tool_call(page, params)

    async def export(self, params):
        """Saves a page as a file the owner can pass on: a
        report as the document the app drew of it (`html`, checked by report_page.checked_file), an HTML page as the file
        this core builds of what is stored (`page_file`: nothing the window says goes into it). Named after the page, in
        the member's selected project, or Downloads. Answers where it went; the shell selects it."""
        from .report_page import FILE_BYTES, checked_file, file_name, save_file  # report_page imports this module
        page = self.of(params)
        try:
            if is_report(page):
                text = checked_file(params.get("html"))
            elif page["source"] == "html":
                text = checked_text(page_file(page), "the page file", FILE_BYTES)
            else:
                # A plugin's page works through its host, which a file does not have.
                raise RpcError(NOT_FOUND, "Only a report or an HTML page is saved as a file", {"kind": "not_shareable"})
        except PageError as error:
            raise invalid_params(str(error)) from None
        folders = [("work", Path(chosen))] if (chosen := self.project_folder(page["member_id"])) else []
        downloads = params.get("downloads")
        folders.append(("downloads", Path(downloads) if isinstance(downloads, str) and Path(downloads).is_absolute()
                        else Path.home() / "Downloads"))
        try:
            place, path = await asyncio.to_thread(save_file, text, file_name(page["title"]), folders)
        except PageError as error:
            raise RpcError(INTERNAL_ERROR, "The report could not be saved", {"kind": error.kind}) from None
        return {"path": str(path), "place": place, "folder": path.parent.name or str(path.parent)}
