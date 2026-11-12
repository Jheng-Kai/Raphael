// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import * as api from "./api";
import type { AppContext, MainEvent } from "./types";
import { readFileSync } from "node:fs";
import { columnHTML } from "./member-column";
import { setLocale } from "./i18n";
import { createSidebar } from "./sidebar";
import { ownerFaceHTML, ownerName, setOwnerProfile } from "./owner-avatar";
import { roomAvatarHTML } from "./group-chats";
import type { Member } from "./types";

test("the foot is one row, the owner's face and the Connections pill, and refreshes only changed app marks", async () => {
  const inventory = { state: "complete", count: 4, apps: [
    { name: "Unknown sample", connected: true, last_used_at: 10 },
    { name: "GitHub", connected: true, last_used_at: 9 },
    { name: "Notion", connected: true, last_used_at: 8 },
    { name: "Slack", connected: true, last_used_at: 7 },
  ] };
  const read = vi.spyOn(api, "integrationsInventory").mockResolvedValue(inventory as never);
  let event!: (value: MainEvent) => void;
  document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!;
  const column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button data-col="add"></button></div>';
  createSidebar(nav, column, { onEvent: handler => { event = handler; return () => {}; } } as AppContext);
  await vi.waitFor(() => expect(nav.querySelectorAll('.sidebar-app-marks .mono')).toHaveLength(3));
  // 連結應用程式 opens its own dialog, not a page of Settings (R-UI-111).
  expect(nav.querySelector('.side-foot .sidebar-apps')?.hasAttribute('data-connect-apps')).toBe(true);
  // One row, as Grok Bot's (R-SIDE-01): the face (a button named by the owner's name, opening the account menu), then the pill; no page buttons.
  expect([...nav.querySelector('.sidebar-foot-row')!.children].map(el => el.className.split(' ').filter(name => name.startsWith('sidebar-'))[0])).toEqual(['sidebar-account', 'sidebar-apps']);
  expect(nav.querySelectorAll('.side-foot [data-go], .sidebar-dictation, .sidebar-home')).toHaveLength(0);
  const account = nav.querySelector<HTMLElement>('.sidebar-account')!;
  expect(account.tagName).toBe('BUTTON');
  expect(account.getAttribute('aria-label')).toBe(ownerName());
  expect(account.getAttribute('aria-haspopup')).toBe('menu');
  expect(account.querySelector('.owner-face')).not.toBeNull();
  expect(nav.querySelector('.sidebar-apps')?.getAttribute('aria-label')).toContain('4');
  // The pill says its own words: nothing more shows under the pointer (owner, 2026-11-12).
  expect(nav.querySelector('.sidebar-apps')?.hasAttribute('data-tooltip') || nav.querySelector('.sidebar-apps')?.hasAttribute('title')).toBe(false);
  // Each mark knows its place against the middle one, for the pill's hover: -1, 0 and +1 of the 3 px spread.
  expect([...nav.querySelectorAll<HTMLElement>('.sidebar-app-mark')].map(mark => mark.style.getPropertyValue('--spread'))).toEqual(['-1', '0', '1']);
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver(records => mutations.push(...records));
  observer.observe(nav.querySelector('.sidebar-apps')!, { attributes: true, childList: true, subtree: true });
  event({ type: 'ConnectionsChanged' });
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mutations).toHaveLength(0);
  read.mockRejectedValueOnce(new Error('unavailable'));
  event({ type: 'ConnectionsChanged' });
  await vi.waitFor(() => expect(nav.querySelectorAll('.sidebar-app-marks .mono')).toHaveLength(0));
  observer.disconnect(); read.mockRestore();
});

test("the chief is an ordinary row until it is pinned, then a larger centered face above its name", () => {
  const el = document.createElement("div");
  el.innerHTML = columnHTML({ list: null, current: 0, folded: new Set(), fresh: new Set(), previews: new Map([[0, "Latest report"]]) });
  expect(el.querySelector('.mb-chief .mb-row-p')?.textContent).toBe("Latest report");
  expect(el.querySelector('.mb-chief > .av')?.getAttribute("style")).toBe("--av:40px");
  expect(el.querySelector('.mb-pinned')).toBeNull();
  const chief = { id: 0, name: "Raphael", pinned: true } as Member;
  el.innerHTML = columnHTML({ list: { members: [chief], groups: [] }, current: 0, folded: new Set(), fresh: new Set(), previews: new Map([[0, "Latest report"]]) });
  expect(el.querySelector('.mb-pinned .mb-tile.mb-chief > .av')?.getAttribute("style")).toBe("--av:64px");
  expect(el.querySelector('.mb-tile > b')?.textContent).toBe("Raphael");
  expect(el.querySelector('.mb-tile .mb-row-p')).toBeNull();
  expect(el.querySelectorAll('[data-member="0"]')).toHaveLength(1);
});

test("the sidebar has no brand and no fold button, names its face by the owner in each language, and its edge drags it to a rail and back", () => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.documentElement.style.removeProperty("--sidebar-width");
  document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!;
  const column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button type="button" data-col="search"></button><button type="button" data-col="add"></button></div>';
  createSidebar(nav, column);
  expect(nav.querySelector(".brand, .app-icon, [data-sidebar='collapse']")).toBeNull();
  for (const [locale, label] of [["zh-TW", "連結應用程式"], ["en", "Connect apps"], ["ja", "アプリを連携"]] as const) {
    setLocale(locale);
    expect(nav.querySelector(".sidebar-apps .nav-t")!.textContent).toBe(label);
  }
  setLocale("zh-TW");
  const edge = nav.querySelector<HTMLElement>(".side-edge")!;
  expect(edge.getAttribute("role")).toBe("separator");
  expect(edge.getAttribute("aria-label")).toBe("拖曳調整側欄寬度");
  const add = nav.querySelector<HTMLElement>('[data-col="add"]')!;
  const pair = (): string[] => [...add.parentElement!.querySelectorAll("[data-col]")].map(button => button.getAttribute("data-col")!);
  expect(add.parentElement!.className).toBe("mb-top");
  expect(pair()).toEqual(["search", "add"]);
  edge.setPointerCapture = vi.fn(); edge.hasPointerCapture = () => true; edge.releasePointerCapture = vi.fn();
  const drag = (...xs: number[]): void => {
    edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: xs[0], bubbles: true }));
    for (const x of xs.slice(1)) edge.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: x, bubbles: true }));
    edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  };
  drag(296, 360);
  expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("360px");
  expect(localStorage.getItem("raphael.sidebar.width")).toBe("360");
  drag(360, 520);
  expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("400px");
  drag(400, 220, 120);
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(true);
  expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("");
  expect(add.parentElement!.className).toBe("side-foot");
  // The rail has no search (owner, 2026-11-12 23:25): only the plus stands in its foot.
  expect(pair()).toEqual(["add"]);
  expect(localStorage.getItem("raphael.sidebar.collapsed")).toBe("true");
  drag(72, 110);
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(true);
  drag(72, 260);
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(false);
  expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("260px");
  expect(add.parentElement!.className).toBe("mb-top");
  expect(pair()).toEqual(["search", "add"]);
  edge.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(true);
  window.dispatchEvent(new Event("raphael:toggle-sidebar"));
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(false);
  edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("276px");
  document.documentElement.style.removeProperty("--sidebar-width");
  document.documentElement.removeAttribute("data-sidebar-collapsed");
});

test("a slow drag through the fold point folds the list once and opens it once, never flickering between", () => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.documentElement.style.removeProperty("--sidebar-width");
  document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!;
  const column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button type="button" data-col="search"></button><button type="button" data-col="add"></button></div>';
  createSidebar(nav, column);
  const edge = nav.querySelector<HTMLElement>(".side-edge")!;
  edge.setPointerCapture = vi.fn(); edge.hasPointerCapture = () => true; edge.releasePointerCapture = vi.fn();
  let flips = 0, folded = false;
  const count = (): void => {
    const now = document.documentElement.hasAttribute("data-sidebar-collapsed");
    if (now !== folded) { flips++; folded = now; }
  };
  const sweep = (from: number, to: number): void => {
    edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: from, bubbles: true }));
    for (let x = from; x !== to; x += Math.sign(to - from)) {
      edge.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: x, bubbles: true }));
      count();
    }
    edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  };
  sweep(296, 60);
  expect(flips).toBe(1);
  expect(folded).toBe(true);
  sweep(72, 320);
  expect(flips).toBe(2);
  expect(folded).toBe(false);
  // Held still near the fold point, small pointer tremors change nothing.
  for (const x of [161, 159, 162, 158, 160]) { edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 300, bubbles: true })); edge.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: x, bubbles: true })); count(); }
  expect(flips).toBeLessThanOrEqual(3);
  edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  document.documentElement.style.removeProperty("--sidebar-width");
  document.documentElement.removeAttribute("data-sidebar-collapsed");
});

test("a window under 860 px shows the rail of faces: no menu button or drawer, and only the plus in its foot", () => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.documentElement.removeAttribute("data-sidebar-narrow");
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn() }));
  const read = vi.spyOn(api, "integrationsInventory").mockResolvedValue({ state: "complete", count: 0, apps: [] } as never);
  try {
    document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
    const nav = document.getElementById("nav")!, column = document.createElement("aside");
    column.innerHTML = '<div class="mb-top"><button data-col="search"></button><button data-col="add"></button></div>';
    createSidebar(nav, column);
    expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(true);
    expect(document.documentElement.hasAttribute("data-sidebar-narrow")).toBe(true);
    expect(document.querySelector('[data-sidebar="open"], .sidebar-toggle, .sidebar-scrim')).toBeNull();
    expect(nav.inert).toBe(false);
    expect([...nav.querySelectorAll(".side-foot [data-col]")].map(button => button.getAttribute("data-col"))).toEqual(["add"]);
    // The Connections button shows nothing under the pointer on the rail either; a screen reader still has its name.
    expect(nav.querySelector<HTMLElement>(".sidebar-apps")!.hasAttribute("data-tooltip")).toBe(false);
    expect(nav.querySelector<HTMLElement>(".sidebar-apps")!.getAttribute("aria-label")).toBeTruthy();
  } finally { read.mockRestore(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-sidebar-collapsed"); document.documentElement.removeAttribute("data-sidebar-narrow"); }
});

test("the list has the stylesheet's own width until it is dragged, and a dragged width keeps winning", () => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--sidebar-width");
  document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!, column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button data-col="search"></button><button data-col="add"></button></div>';
  createSidebar(nav, column);
  expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("");
  expect(readFileSync("src/main/styles.css", "utf8")).toContain("--sidebar-width: min(348px, calc(100vw - 604px));");
  const edge = nav.querySelector<HTMLElement>(".side-edge")!;
  edge.setPointerCapture = vi.fn(); edge.hasPointerCapture = () => true; edge.releasePointerCapture = vi.fn();
  edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 348, bubbles: true }));
  edge.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 300, bubbles: true }));
  edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("300px");
  expect(localStorage.getItem("raphael.sidebar.width")).toBe("300");
  document.documentElement.style.removeProperty("--sidebar-width");
  document.documentElement.removeAttribute("data-sidebar-collapsed");
});

test("the shell has one permanent conversation sidebar and no Team route or apps entry", () => {
  const main = readFileSync("src/main/main.ts", "utf8");
  expect(main).not.toContain("createTeamPage");
  expect(main).not.toContain("navAppsHTML");
  expect(main).toContain("createSidebar");
  const types = readFileSync("src/main/types.ts", "utf8");
  expect(types.match(/export type PageId = ([^;]+)/)?.[1]).not.toContain('"team"');
});

test("room identity uses the participants' own faces and caps the cluster at four", () => {
  const list = { members: [1, 2, 3, 4, 5].map(id => ({ id, name: `Person ${id}` } as Member)), groups: [] };
  const el = document.createElement("div");
  el.innerHTML = roomAvatarHTML({ member_ids: [2, 1, 3, 4, 5] }, list);
  expect(el.querySelector(".room-avatar")?.getAttribute("data-faces")).toBe("4");
  expect([...el.querySelectorAll(".slime-surface")].map(face => (face as HTMLElement).dataset.slimeStill)).toEqual(["2", "1", "3", "4"]);
});

test("owner profile updates the existing outgoing face as well as the footer identity", () => {
  document.body.innerHTML = `<div class="me">${ownerFaceHTML()}</div>`;
  setOwnerProfile({ owner_name: "Sam", owner_photo: "data:image/webp;base64,YQ==" } as never);
  expect(ownerName()).toBe("Sam");
  expect(document.querySelector(".me .owner-face img")?.getAttribute("src")).toBe("data:image/webp;base64,YQ==");
  setOwnerProfile({ owner_name: "", owner_photo: "" } as never);
  expect(document.querySelector(".me .owner-face svg")).not.toBeNull();
  document.body.replaceChildren();
});

test("the rail is 88 px, and under 860 px there is no drawer: the list stays in its column", () => {
  const css = readFileSync("src/main/sidebar.css", "utf8");
  expect(css).toContain(':root[data-sidebar-collapsed] { --sidebar-width: 88px; }');
  expect(css).toContain("@media (max-width: 859px) { :root { --sidebar-width: 88px; } }");
  expect(css).not.toMatch(/translateX\(-100%\)|sidebar-scrim|sidebar-toggle|data-sidebar-open/);
});

test("a row is a 54 px highlight 58 px from the next, and the foot is one row", () => {
  const css = readFileSync("src/main/sidebar.css", "utf8");
  expect(css).toContain("--side-row: 54px; --side-face: 36px;");
  expect(css).toMatch(/\.side :is\(\.mb-list, \.mb-gclip\) \{ gap: var\(--sp-1\); \}/);
  expect(css).toMatch(/\.side \.nav\.mb-row \{[^}]*min-height: var\(--side-row\)[^}]*border-radius: var\(--r-md\)/);
  expect(css).toMatch(/\.side \.mb-row-t b \{ font-size: var\(--fs-sm\)/);
  expect(css).toMatch(/\.side \.mb-row-p \{ font-size: var\(--fs-xs\)/);
  // The face and the Connections pill share one row (the face 32 px, the pill 36 px and round, on --surface-2); only the rail unwraps it.
  expect(css).toMatch(/\.side \.side-foot \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  expect(css).toMatch(/\n\.sidebar-foot-row \{ display: flex; align-items: center;/);
  expect(css).toMatch(/:root\[data-sidebar-collapsed\] \.sidebar-foot-row \{ display: contents; \}/);
  expect(css).toMatch(/\.side \.sidebar-account \{[^}]*width: 32px; height: 32px/);
  expect(css).toMatch(/\.sidebar-apps \{[^}]*height: 36px[^}]*border-radius: var\(--r-pill\); background: var\(--surface-2\)/);
  // The hover's values live in named custom properties on the pill, and the motion is a transform under no-preference only.
  expect(css).toMatch(/--marks-spread: 3px; --marks-lift: 1\.5px; --marks-scale: 1\.1; --marks-turn: 8deg; --marks-time-in: 180ms; --marks-ease-in: ease-out; --marks-time-out: 280ms; --marks-ease-out: ease-in-out/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[^@]*\.sidebar-apps:hover \.sidebar-app-mark \{[^}]*transform: translate\(/);
  expect(css).not.toMatch(/sidebar-account-name|sidebar-dictation|sidebar-home/);
  expect(readFileSync("src/main/sidebar.ts", "utf8")).not.toMatch(/placeTools|FOOT_TOOLS_MIN/);
});

test("private timeline events use the full conversation column", () => {
  const css = readFileSync("src/main/conversations.css", "utf8");
  expect(css).toMatch(/\.page-agent \.tn > \.ra \{[^}]*max-width: 100%;/);
});
