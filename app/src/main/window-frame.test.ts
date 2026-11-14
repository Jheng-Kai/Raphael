/// <reference types="node" />
// The custom window frame is built from index.html and styles.css. There is no browser here, so
// these tests read the two files and check the rules that keep the frame usable.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const styles = readFileSync(path.join(import.meta.dirname, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const html = readFileSync(path.join(import.meta.dirname, "..", "..", "index.html"), "utf8");

/** The declarations of the rules that name `selector`, in the order they are written. */
function declarations(selector: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const [, selectors, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").some((one) => one.trim() === selector)) continue;
    for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) found.push([property, value.trim()]);
  }
  return found;
}

/** The value the last declaration of any of `properties` gives. */
const lastOf = (selector: string, ...properties: string[]): string | undefined =>
  declarations(selector).filter(([property]) => properties.includes(property)).pop()?.[1];

describe("keyboard focus and the window controls", () => {
  test("the window controls come after the page in the document, so that Tab reaches the page first", () => {
    const chrome = html.indexOf('id="window-chrome"');
    expect(chrome).toBeGreaterThan(-1);
    for (const id of ["nav", "main", "ob"]) {
      expect(html.indexOf(`id="${id}"`), id).toBeGreaterThan(-1);
      expect(html.indexOf(`id="${id}"`), id).toBeLessThan(chrome);
    }
  });

  test("the maximize button starts as not pressed: its state is aria-pressed alone", () => {
    expect(html.match(/<button[^>]*data-window-action="maximize"[^>]*>/)?.[0]).toContain('aria-pressed="false"');
  });

  test("every window button shows its focus ring inside itself, where the window edge and resize handles do not cover it", () => {
    const ring = declarations(".window-button:focus-visible");
    expect(ring.map(([property]) => property)).not.toContain("outline");
    expect(lastOf(".window-button:focus-visible", "outline-offset")).toMatch(/^-\d+px$/);
  });

  test("caption buttons are square Windows cells that fill under the pointer, and close turns red with its focus ring", () => {
    expect(lastOf(".window-button", "border-radius")).toBe("0");
    expect(lastOf(".window-button", "width")).toBe("46px");
    expect(lastOf(".window-button:hover", "background")).toBe("var(--hover)");
    expect(lastOf(".window-button:active", "background")).toBe("var(--pressed)");
    expect(lastOf(".window-close:hover", "background")).toBe("var(--close)");
    expect(lastOf(".window-close:hover", "color")).toBe("var(--on-close)");
    expect(lastOf(".window-close:hover:focus-visible", "outline-color")).toBe("var(--focus)");
  });

  test("window controls stay transparent while settings dim the window", () => {
    expect(lastOf(':root[data-window-modal="true"] .window-button:focus-visible:not(:hover)', "background")).toBe("transparent");
  });

  test("a dialog dims the caption too and starts below it, whichever dialog it is", () => {
    for (const dimmed of [":root:has(.mb-scrim:not(.store-scrim))", ":root:has(.menu.side-search)"]) {
      expect(lastOf(`${dimmed} .window-chrome`, "background")).toBe("transparent");
      expect(lastOf(`${dimmed} .window-button:focus-visible:not(:hover)`, "background")).toBe("transparent");
    }
    const dialogs = readFileSync(path.join(import.meta.dirname, "members.css"), "utf8");
    expect(dialogs.match(/\.mb-scrim \{[^}]*padding: ([^;]+);/)?.[1]).toContain("var(--window-controls-height)");
  });

  test("the page scrolls a focused element to below the window controls that cover its top", () => {
    const top = lastOf(".main", "scroll-padding", "scroll-padding-block", "scroll-padding-block-start", "scroll-padding-top");
    expect(top).toBeDefined();
    expect(top).toContain("var(--window-controls-height)");
  });
});

describe("a conversation's header is the window's top row", () => {
  const sheet = (file: string): string => readFileSync(path.join(import.meta.dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const source = (file: string): string => readFileSync(path.join(import.meta.dirname, file), "utf8");
  const members = sheet("members.css"), agent = sheet("agent.css"), conversations = sheet("conversations.css"), pages = sheet("page-view.css"), report = sheet("report-page.css");

  test("the row is 60 px, so the pill's centre stands 30 px from the window's top as Grok Bot's, and the buttons' cells are the width the tools stay clear of", () => {
    expect(agent).toMatch(/--pa-top:\s*60px;/);
    expect(conversations).toMatch(/\.mb-head-c \{[^}]*margin-top: calc\(\(var\(--pa-top\) - 40px\) \/ 2 - var\(--sp-1\) - 2px\)/);
    const width = lastOf(".window-button", "width");
    expect(styles).toContain(`--window-controls-width: calc(3 * ${width});`);
    expect(styles).toMatch(/--window-controls-gap:\s*14px;/);
    expect(agent).toContain("--pa-top-end: calc(var(--window-controls-width) + var(--window-controls-gap));");
  });

  test("the header takes no room from the thread, which has no strip above it and passes under the row", () => {
    expect(members).toMatch(/\.mb-chat \{[^}]*padding: 0 var\(--pa-chat-pad\);/);
    expect(members).toMatch(/\.page-head\.mb-head \{[^}]*z-index: 3;[^}]*height: var\(--pa-top\);[^}]*margin-bottom: calc\(-1 \* var\(--pa-top\)\);/);
    expect(conversations).toMatch(/\.mb-chat \.ra-scroll \{[^}]*mask-image: linear-gradient\(to bottom, transparent calc\(var\(--row-lead\) - 36px\), var\(--text\) var\(--row-lead\)\);[^}]*padding-top: var\(--row-lead\);/);
    expect(report).toMatch(/\.rp-scroll \{[^}]*padding: var\(--pa-top\) var\(--pa-dock-x\) 0;[^}]*mask-image: linear-gradient\(to bottom, transparent calc\(var\(--pa-top\) - 36px\), var\(--text\) var\(--pa-top\)\)/);
    // An open page is the whole area under the row and scrolls as one, as the thread does (R-PAGE-06).
    expect(pages).toMatch(/\.pgv-page \{[^}]*overflow-y: auto;[^}]*padding: var\(--row-lead\) var\(--pa-dock-x\) var\(--sp-4\);[^}]*mask-image: linear-gradient\(to bottom, transparent calc\(var\(--row-lead\) - 36px\), var\(--text\) var\(--row-lead\)\);/);
  });

  test("the tools end short of the window's buttons, and go to their pane's edge where the details panel or a side thread stands beside them", () => {
    expect(members).toMatch(/\.mb-head \.ra-tools \{[^}]*margin-right: var\(--row-end\);/);
    expect(members).toContain("--row-end: max(0px, calc(var(--pa-top-end) - var(--row-edge)));");
    expect(members).toMatch(/@media \(min-width: 1120px\) \{ \.page-agent\[data-det="open"\]:not\(\.is-room\) \.mb-chat \{ --row-end: 0px; \} \}/);
    expect(members).toMatch(/@media \(min-width: 1100px\) \{ \.au-room-pane\.has-side-thread \{ --row-end: 0px; \} \}/);
    // The panel's and the side thread's own heads are the rows over them, ended short of the buttons too.
    expect(members).toMatch(/\.mb-det-head \{[^}]*height: var\(--pa-top\);[^}]*padding: 0 var\(--pa-top-end\) 0 var\(--pa-dpad\);/);
    expect(agent).toMatch(/\.room-side-thread > header \{[^}]*height: var\(--pa-top\);[^}]*padding: 0 var\(--pa-top-end\)/);
  });

  test("the row's empty parts move the window, and the strip's own drag cell steps aside over it so that the pill and the buttons press", () => {
    for (const [file, marker] of [["pages/agent.ts", 'class="page-head mb-head" data-window-drag'], ["group-chats.ts", 'class="page-head mb-head" data-window-drag'], ["member-details.ts", 'class="mb-det-head" data-window-drag'], ["peer-chat.ts", 'class="peer-head" data-window-drag'], ["room-thread.ts", "<header data-window-drag>"]] as const)
      expect(source(file), file).toContain(marker);
    expect(styles).toContain(':where(:root[data-window-layout="main"]:not([data-window-modal="true"], [data-desktop-expanded], [data-sidebar-open]):has(.main > .page-agent:not([hidden]) > .mb-chat:not([hidden]) > .mb-head):not(:has(.page-agent > .ms-pane:not([hidden]), .mb-scrim, .menu.side-search))) .window-chrome { pointer-events: none; }');
    expect(styles).toContain(':where(:root[data-window-layout="main"]:not([data-window-modal="true"], [data-desktop-expanded], [data-sidebar-open]):has(.main > .page-agent:not([hidden]) > .mb-chat:not([hidden]) > .mb-head):not(:has(.page-agent > .ms-pane:not([hidden]), .mb-scrim, .menu.side-search))) .window-chrome > :not(.window-drag) { pointer-events: auto; }');
    // Under 1120 px the details panel lies over the chat and its scrim dims the header: the scrim's top row moves the window instead.
    expect(members).toContain(".mb-det-scrim-row { position: absolute; inset: 0 0 auto; height: var(--pa-top); }");
    expect(source("pages/agent.ts")).toContain('<span class="mb-det-scrim-row" data-window-drag></span>');
  });
});
