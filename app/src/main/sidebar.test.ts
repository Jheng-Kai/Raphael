// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import * as api from "./api";
import type { AppContext, MainEvent } from "./types";
import { readFileSync } from "node:fs";
import { columnHTML } from "./member-column";
import { setLocale } from "./i18n";
import { createSidebar } from "./sidebar";
import { iconHTML } from "./service-mark";
import { serviceIconOf } from "./service-icons";
import { ownerFaceHTML, ownerName, setOwnerProfile } from "./owner-avatar";
import { roomAvatarHTML } from "./group-chats";
import type { Member, MembersList } from "./types";

// R-PERF-25: the width a pointer drags is written to the grid that holds the panes, not to the root every element inherits from.
const live = (): string => document.body.style.getPropertyValue("--side-live");

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
  // One row (R-SIDE-01): the face (a button named by the owner's name, opening the account menu), then the pill; no page buttons.
  expect([...nav.querySelector('.sidebar-foot-row')!.children].map(el => el.className.split(' ').filter(name => name.startsWith('sidebar-'))[0])).toEqual(['sidebar-account', 'sidebar-apps']);
  expect(nav.querySelectorAll('.side-foot [data-go], .sidebar-dictation, .sidebar-home')).toHaveLength(0);
  const account = nav.querySelector<HTMLElement>('.sidebar-account')!;
  expect(account.tagName).toBe('BUTTON');
  expect(account.getAttribute('aria-label')).toBe(ownerName());
  expect(account.getAttribute('aria-haspopup')).toBe('menu');
  expect(account.querySelector('.owner-face')).not.toBeNull();
  expect(nav.querySelector('.sidebar-apps')?.getAttribute('aria-label')).toContain('4');
  // The pill says its own words: nothing more shows under the pointer.
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

test("with nothing connected the pill shows Gmail, Notion and Google Calendar, then the owner's own apps once one is connected", async () => {
  const empty = { state: "complete", count: 0, apps: [{ name: "Slack", connected: false, last_used_at: null }] };
  const read = vi.spyOn(api, "integrationsInventory").mockResolvedValue(empty as never);
  let event!: (value: MainEvent) => void;
  document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!;
  const column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button data-col="add"></button></div>';
  createSidebar(nav, column, { onEvent: handler => { event = handler; return () => {}; } } as AppContext);
  const drawn = (): string[] => [...nav.querySelectorAll<HTMLElement>('.sidebar-app-mark')].map(mark => mark.innerHTML);
  const mark = (name: string): string => { const box = document.createElement('div'); box.innerHTML = iconHTML(name, serviceIconOf({ name }), 'md'); return box.innerHTML; };
  await vi.waitFor(() => expect(nav.querySelectorAll('.sidebar-app-marks .mono')).toHaveLength(3));
  expect(drawn()).toEqual(['Gmail', 'Notion', 'Google Calendar'].map(mark));
  // An app we draw no mark for (Outlook) shows the catalogue's picture, as every other place does; one with neither is left out.
  const logo = "https://logos.composio.dev/api/outlook";
  read.mockResolvedValue({ state: "complete", count: 3, apps: [{ name: "Slack", connected: true, last_used_at: 5 }, { name: "Outlook", connected: true, last_used_at: 4, logo }, { name: "Unknown sample", connected: true, last_used_at: 3 }] } as never);
  event({ type: 'ConnectionsChanged' });
  await vi.waitFor(() => expect(nav.querySelector('.sidebar-app-mark[data-mark="slack"]')).not.toBeNull());
  expect(drawn()).toHaveLength(3);
  expect(drawn()[0]).toBe(mark('Slack'));
  expect(nav.querySelector<HTMLImageElement>('.sidebar-app-mark .logo-art img.logo')!.getAttribute('src')).toBe(logo);
  // The third is the first starter: the one with no mark of its own leaves no hole.
  expect(drawn()[2]).toBe(mark('Gmail'));
  read.mockRestore();
});

test("the pill always shows three marks: the connected apps' own first, the starters not connected filling up the rest", async () => {
  const app = (name: string, last: number, extra: object = {}) => ({ id: name, name, connected: true, enabled: true, state: "ready", tools: 1, last_used_at: last, ...extra });
  const read = vi.spyOn(api, "integrationsInventory");
  document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!;
  const column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button data-col="add"></button></div>';
  let event!: (value: MainEvent) => void;
  read.mockResolvedValue({ state: "complete", count: 0, apps: [] } as never);
  createSidebar(nav, column, { onEvent: handler => { event = handler; return () => {}; } } as AppContext);
  const keys = (): string[] => [...nav.querySelectorAll<HTMLElement>('.sidebar-app-mark')].map(mark => mark.dataset.mark!);
  const reads = async (apps: object[]): Promise<string[]> => {
    read.mockClear(); read.mockResolvedValue({ state: "complete", count: apps.length, apps } as never);
    event({ type: "ConnectionsChanged" });
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 0));
    return keys();
  };
  await vi.waitFor(() => expect(keys()).toEqual(["gmail", "notion", "googlecalendar"]));
  expect(await reads([app("Slack", 1)])).toEqual(["slack", "gmail", "notion"]);
  expect(await reads([app("Slack", 1), app("GitHub", 2)])).toEqual(["github", "slack", "gmail"]);
  expect(await reads([app("Slack", 3), app("GitHub", 2), app("Linear", 1)])).toEqual(["slack", "github", "linear"]);
  expect(await reads(["Slack", "GitHub", "Linear", "Figma", "Stripe"].map((name, at) => app(name, 9 - at)))).toEqual(["slack", "github", "linear"]);
  // A connected app that is a starter stands once, first, and the other starters follow in their own order.
  expect(await reads([app("Notion", 1)])).toEqual(["notion", "gmail", "googlecalendar"]);
  expect(await reads([app("google calendar", 2), app("GMAIL", 1)])).toEqual(["googlecalendar", "gmail", "notion"]);
  // A starter is told by its mark, not by how it is written; an app that is not connected counts for nothing.
  expect(await reads([app("Gmail (work)", 1, { connected: false }), app("Slack", 1)])).toEqual(["slack", "gmail", "notion"]);
  // An app with no mark of its own is left out, and the row is still filled to three.
  expect(await reads([app("Unknown sample", 5), app("Slack", 4)])).toEqual(["slack", "gmail", "notion"]);
  // The same reading again draws the same marks and touches nothing.
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver(records => mutations.push(...records));
  observer.observe(nav.querySelector('.sidebar-apps')!, { attributes: true, childList: true, subtree: true });
  expect(await reads([app("Unknown sample", 5), app("Slack", 4)])).toEqual(["slack", "gmail", "notion"]);
  expect(mutations).toHaveLength(0);
  observer.disconnect();
  // A reading that failed shows no marks at all.
  read.mockRejectedValue(new Error("unavailable"));
  event({ type: "ConnectionsChanged" });
  await vi.waitFor(() => expect(keys()).toEqual([]));
  read.mockRestore();
});

test("the chief is an ordinary row until it is pinned, then a larger centered face above its name", () => {
  const el = document.createElement("div");
  const roster = (pinned: boolean) => ({ members: [{ id: 0, name: "Raphael", raphael: true }, { id: 4, name: "Mochi", chief: true, pinned, preview: "Latest report" }] as Member[], groups: [], team_context: { primary_id: 4, members: [] } as unknown as MembersList["team_context"] });
  el.innerHTML = columnHTML({ list: roster(false), current: 4, folded: new Set(), fresh: new Set(), previews: new Map([[4, "Latest report"]]) });
  expect(el.querySelector('.mb-chief .mb-row-p')?.textContent).toBe("Latest report");
  expect(el.querySelector('.mb-chief > .av')?.getAttribute("style")).toBe("--av:40px");
  expect(el.querySelector('.mb-pinned')).toBeNull();
  el.innerHTML = columnHTML({ list: roster(true), current: 4, folded: new Set(), fresh: new Set(), previews: new Map([[4, "Latest report"]]) });
  expect(el.querySelector('.mb-pinned .mb-tile.mb-chief > .av')?.getAttribute("style")).toBe("--av:64px");
  expect(el.querySelector('.mb-tile > b')?.textContent).toBe("Mochi");
  expect(el.querySelector('.mb-tile .mb-row-p')).toBeNull();
  expect(el.querySelectorAll('[data-member="4"]')).toHaveLength(1);
  // Raphael is in neither drawing.
  expect(el.querySelector('[data-member="0"]')).toBeNull();
});

test("the sidebar has no brand and no fold button, names its face by the owner in each language, and its edge drags it to a rail and back", () => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.body.style.removeProperty("--side-live");
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
  expect(live()).toBe("360px");
  expect(localStorage.getItem("raphael.sidebar.width")).toBe("360");
  drag(360, 520);
  expect(live()).toBe("400px");
  drag(400, 220, 120);
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(true);
  expect(live()).toBe("");
  expect(add.parentElement!.className).toBe("side-foot");
  // The rail has no search: only the plus stands in its foot.
  expect(pair()).toEqual(["add"]);
  expect(localStorage.getItem("raphael.sidebar.collapsed")).toBe("true");
  drag(72, 110);
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(true);
  drag(72, 260);
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(false);
  expect(live()).toBe("260px");
  expect(add.parentElement!.className).toBe("mb-top");
  expect(pair()).toEqual(["search", "add"]);
  edge.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(true);
  window.dispatchEvent(new Event("raphael:toggle-sidebar"));
  expect(document.documentElement.hasAttribute("data-sidebar-collapsed")).toBe(false);
  edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(live()).toBe("276px");
  document.body.style.removeProperty("--side-live");
  document.documentElement.removeAttribute("data-sidebar-collapsed");
});

test("a slow drag through the fold point folds the list once and opens it once, never flickering between", () => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.body.style.removeProperty("--side-live");
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
  document.body.style.removeProperty("--side-live");
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
  document.body.style.removeProperty("--side-live");
  document.body.innerHTML = '<div class="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!, column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button data-col="search"></button><button data-col="add"></button></div>';
  createSidebar(nav, column);
  expect(live()).toBe("");
  expect(readFileSync("src/main/styles.css", "utf8")).toContain("--sidebar-width: min(348px, calc(100vw - 604px));");
  const edge = nav.querySelector<HTMLElement>(".side-edge")!;
  edge.setPointerCapture = vi.fn(); edge.hasPointerCapture = () => true; edge.releasePointerCapture = vi.fn();
  edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 348, bubbles: true }));
  edge.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 300, bubbles: true }));
  edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  expect(live()).toBe("300px");
  expect(localStorage.getItem("raphael.sidebar.width")).toBe("300");
  document.body.style.removeProperty("--side-live");
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
