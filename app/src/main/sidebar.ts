/** The single conversation sidebar persists across page navigation. */
import { onLocaleChange, t } from "./i18n";
import { messageTooltip } from "./message-tooltip";
import * as api from "./api";
import { entryLabel, type InventoryView } from "./apps-inventory";
import { iconHTML } from "./service-mark";
import { serviceIconOf } from "./service-icons";
import type { AppContext } from "./types";
import { onOwnerProfile, ownerFaceHTML, ownerName } from "./owner-avatar";
import { closeAndPress } from "./dismissals";
import { esc, ico, iconButton } from "./ui";
import { mountEdge, savedWidth, saveWidth } from "./edge-drag";
import { mountUpdateNotice } from "./update-notice";

/** The full list's widths (px): the list starts at the stylesheet's 296. */
const DEFAULT_WIDTH = 296, MIN_WIDTH = 240, MAX_WIDTH = 400;
/** The rail of faces (sidebar.css), the width a drag folds the list below, and the width a dragged rail opens again past.
 *  Opening needs the wider one: between the two nothing changes, so a pointer held near the fold point cannot flicker the
 *  list between its two shapes. */
const RAIL_WIDTH = 72, TO_RAIL = 150, FROM_RAIL = 170;
const WIDTH_KEY = "raphael.sidebar.width";
const clampWidth = (width: number): number => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

export function createSidebar(nav: HTMLElement, column: HTMLElement, app?: Pick<AppContext, "onEvent">): { close(): void } {
  nav.classList.add("sidebar");
  nav.innerHTML = `<div class="sidebar-conversations"></div><div class="side-foot"><div class="sidebar-update" hidden></div><button type="button" class="nav sidebar-apps" data-connect-apps>${ico("plug")}<span class="nav-t"></span><span class="sidebar-app-marks" aria-hidden="true"></span></button><div class="sidebar-foot-row"><button type="button" class="nav sidebar-account" data-go="settings" data-pane="general"></button>${iconButton("mic", t("nav.dictation"), ' data-go="dictation" aria-current="false"', "sidebar-dictation")}${iconButton("home", t("nav.home"), ' data-go="home" aria-current="false"', "sidebar-home")}</div></div>`;
  let inventory: InventoryView = "loading";
  let lastMarks = "";
  // The sidebar lives as long as the window: its update line is never taken down.
  mountUpdateNotice(nav.querySelector<HTMLElement>(".sidebar-update")!);
  const apps = nav.querySelector<HTMLElement>(".sidebar-apps")!;
  const drawApps = (): void => {
    const label = entryLabel(inventory), name = t("nav.apps");
    if (apps.getAttribute("aria-label") !== label) apps.setAttribute("aria-label", label);
    if (apps.dataset.tooltip !== label) apps.dataset.tooltip = label;
    if (apps.querySelector(".nav-t")!.textContent !== name) apps.querySelector(".nav-t")!.textContent = name;
    const marks = typeof inventory === "object" ? [...inventory.apps].filter(item => item.connected)
      .sort((a, b) => (b.last_used_at ?? 0) - (a.last_used_at ?? 0))
      .flatMap(item => { const icon = serviceIconOf({ name: item.name }); return icon ? [iconHTML(item.name, icon, "md")] : []; }).slice(0, 3).join("") : "";
    const host = apps.querySelector(".sidebar-app-marks")!;
    if (lastMarks !== marks) { host.innerHTML = marks; lastMarks = marks; }
  };
  let inventoryRead = 0;
  const refreshApps = async (): Promise<void> => {
    const read = ++inventoryRead;
    const next = await api.integrationsInventory().catch(() => "failed" as const);
    if (read !== inventoryRead) return;
    inventory = next; drawApps();
  };
  app?.onEvent(event => { if (["ConnectionsChanged", "CoreReady"].includes(event.type)) void refreshApps(); });
  void refreshApps();
  const header = column.querySelector('.mb-top');
  nav.querySelector(".sidebar-conversations")!.append(column);
  const search = column.querySelector<HTMLElement>('[data-col="search"]')!;
  const add = column.querySelector<HTMLElement>('[data-col="add"]')!;
  const foot = nav.querySelector<HTMLElement>(".side-foot")!;
  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.className = "btn icon sidebar-toggle";
  toggle.dataset.sidebar = "open"; toggle.setAttribute("aria-controls", nav.id);
  const scrim = document.createElement("div"); scrim.className = "sidebar-scrim"; scrim.hidden = true;
  nav.after(scrim); document.querySelector(".window-chrome")!.prepend(toggle);
  const setOpen = (open: boolean): void => {
    const wasOpen = document.documentElement.hasAttribute("data-sidebar-open");
    if (wasOpen !== open) document.documentElement.toggleAttribute("data-sidebar-open", open);
    if (toggle.getAttribute("aria-expanded") !== String(open)) toggle.setAttribute("aria-expanded", String(open));
    if (scrim.hidden === open) scrim.hidden = !open;
    const compact = matchMedia("(max-width: 859px)").matches;
    if (nav.inert !== (compact && !open)) nav.inert = compact && !open;
    const main = document.getElementById("main")!;
    if (main.inert !== (compact && open)) main.inert = compact && open;
    if (open && !wasOpen) search.focus();
    else if (!open && wasOpen && compact) toggle.focus();
  };
  const close = (): void => setOpen(false);
  window.addEventListener("raphael:toggle-sidebar", () => {
    if (compactWindow.matches) setOpen(!document.documentElement.hasAttribute("data-sidebar-open"));
    else toggleRail();
  });
  const compactWindow = matchMedia("(max-width: 859px)");
  let collapsed = false;
  try { collapsed = localStorage.getItem("raphael.sidebar.collapsed") === "true"; } catch { /* Keep the full list when storage is unavailable. */ }
  let width = savedWidth(WIDTH_KEY, MIN_WIDTH, MAX_WIDTH) ?? DEFAULT_WIDTH;
  const edge = document.createElement("div");
  edge.className = "side-edge";
  nav.append(edge);
  // The full list's width is the owner's (dragged); the rail and the drawer keep the stylesheet's.
  const placeWidth = (): void => {
    const own = !collapsed && !compactWindow.matches && width !== DEFAULT_WIDTH;
    if (own) document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    else document.documentElement.style.removeProperty("--sidebar-width");
    edge.setAttribute("aria-valuenow", String(collapsed ? RAIL_WIDTH : width));
    edge.setAttribute("aria-valuemin", String(RAIL_WIDTH));
    edge.setAttribute("aria-valuemax", String(MAX_WIDTH));
  };
  // Below the desktop width the list is a drawer, so the rail only exists on a wide window.
  const placeRail = (): void => {
    const rail = collapsed && !compactWindow.matches;
    document.documentElement.toggleAttribute("data-sidebar-collapsed", rail);
    if (rail) foot.prepend(search, add); else header?.append(search, add);
    if (!rail) nav.querySelectorAll(".mb-row[data-tooltip], .sidebar-account[data-tooltip]").forEach(row => row.removeAttribute("data-tooltip"));
    placeWidth();
  };
  const keep = (): void => {
    try { localStorage.setItem("raphael.sidebar.collapsed", String(collapsed)); } catch { /* Keep the current session choice. */ }
    saveWidth(WIDTH_KEY, width === DEFAULT_WIDTH ? null : width);
  };
  const toggleRail = (): void => { collapsed = !collapsed; placeRail(); keep(); };
  // The list's edge drags it wider or narrower; dragged narrow enough it folds to a rail of faces, and the
  // rail dragged out opens the list again. There is no button for it.
  mountEdge(edge, {
    label: t("nav.sidebarWidth"),
    grow: 1,
    widthAt: x => x - nav.getBoundingClientRect().left,
    width: () => (collapsed ? FROM_RAIL : width),
    resize: next => {
      if (collapsed) {
        if (next <= FROM_RAIL) return;
        collapsed = false; width = clampWidth(next); placeRail();
      } else if (next < TO_RAIL) { collapsed = true; placeRail(); }
      else { width = clampWidth(next); placeWidth(); }
    },
    done: keep,
    toggle: toggleRail,
  });
  // A face in the rail is named on hover or focus; the row's name stays in the page for screen readers.
  const nameFace = (event: Event): void => {
    if (!document.documentElement.hasAttribute("data-sidebar-collapsed")) return;
    const row = (event.target as Element).closest<HTMLElement>(".mb-row, .sidebar-account");
    if (row) row.dataset.tooltip = row.querySelector("b, .nav-t, .sidebar-account-name")?.textContent ?? "";
  };
  nav.addEventListener("pointerover", nameFace, true);
  nav.addEventListener("focusin", nameFace, true);
  messageTooltip(nav);
  const draw = (): void => {
    nav.setAttribute("aria-label", t("nav.pages"));
    const home = nav.querySelector<HTMLElement>('[data-go="home"]')!;
    home.setAttribute("aria-label", t("nav.home"));
    add.setAttribute("aria-label", t("members.add")); add.title = t("members.add");
    edge.setAttribute("aria-label", t("nav.sidebarWidth"));
    const dictation = nav.querySelector<HTMLElement>('[data-go="dictation"]')!;
    dictation.setAttribute("aria-label", t("nav.dictation"));
    dictation.title = t("nav.dictation"); home.title = t("nav.home");
    drawApps();
    const account = nav.querySelector<HTMLElement>(".sidebar-account")!;
    account.innerHTML = `${ownerFaceHTML(32)}<span class="sidebar-account-name">${esc(ownerName())}</span>`;
    account.setAttribute("aria-label", `${ownerName()} · ${t("nav.settings")}`);
    toggle.innerHTML = ico("menu"); toggle.setAttribute("aria-label", t("nav.pages"));
    nav.querySelector('[data-sidebar="close"]')?.setAttribute("aria-label", t("common.close"));
  };
  toggle.addEventListener("click", () => setOpen(!document.documentElement.hasAttribute("data-sidebar-open")));
  nav.addEventListener("click", event => {
    if ((event.target as Element).closest('[data-sidebar="close"], [data-go], [data-connect-apps], [data-member], [data-room]')) close();
  });
  // The press that closes the drawer goes on to what it was over (R-UI-121).
  scrim.addEventListener("click", event => closeAndPress(event, scrim, close, toggle));
  // What takes the whole window from a menu of the drawer has no use for the drawer behind it.
  window.addEventListener("raphael:close-sidebar", close);
  document.addEventListener("keydown", event => {
    if (!document.documentElement.hasAttribute("data-sidebar-open")) return;
    if (event.key === "Escape" && !document.querySelector("#app-popover, .mb-scrim")) { event.preventDefault(); close(); }
    if (event.key === "Tab" && !document.querySelector("#app-popover, .mb-scrim")) {
      const stops = [...nav.querySelectorAll<HTMLElement>('button:not(:disabled), input')].filter(el => el.getClientRects().length && !el.closest("[inert]"));
      const first = stops[0], last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  compactWindow.addEventListener("change", () => { close(); placeRail(); });
  // The list's own width never squeezes the conversation on a window narrower than it was dragged on.
  window.addEventListener("resize", () => {
    const room = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, innerWidth - 560));
    if (!collapsed && width > room) { width = room; placeWidth(); }
  });
  onLocaleChange(draw); onOwnerProfile(draw); placeRail(); draw(); close();
  return { close };
}
