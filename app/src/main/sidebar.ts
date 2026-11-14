/** The single conversation sidebar persists across page navigation. */
import { onLocaleChange, t } from "./i18n";
import { messageTooltip } from "./message-tooltip";
import * as api from "./api";
import { entryLabel, type InventoryView } from "./apps-inventory";
import { iconHTML } from "./service-mark";
import { serviceIconOf } from "./service-icons";
import type { AppContext } from "./types";
import { onOwnerProfile, ownerFaceHTML, ownerName } from "./owner-avatar";
import { ico } from "./ui";
import { openAccountMenu } from "./account-menu";
import { mountEdge, savedWidth, saveWidth } from "./edge-drag";
import { mountUpdateNotice } from "./update-notice";

/** The full list's widths (px): it starts at the stylesheet's own width (348 on a wide window, in proportion below that,
 *  styles.css `--sidebar-width`), and a width the owner dragged it to wins over that. */
const MIN_WIDTH = 240, MAX_WIDTH = 400;
/** The conversation never gets narrower than it is on a 900 px window with the old list: the list gives way to it. */
const CONVERSATION_MIN = 604;
/** The rail of faces (sidebar.css), the width a drag folds the list below, and the width a dragged rail opens again past.
 *  Opening needs the wider one: between the two nothing changes, so a pointer held near the fold point cannot flicker the
 *  list between its two shapes. */
const RAIL_WIDTH = 88, TO_RAIL = 150, FROM_RAIL = 170;
const WIDTH_KEY = "raphael.sidebar.width";
const clampWidth = (width: number): number => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

export function createSidebar(nav: HTMLElement, column: HTMLElement, app?: Pick<AppContext, "onEvent" | "go">): void {
  nav.classList.add("sidebar");
  // The foot is one row, as Grok Bot's (R-SIDE-01): the owner's face (it opens the account menu) and the 連結應用程式 pill, which takes
  // the rest of the row. On the rail the pill is the icon button of its own and the face stands under it.
  nav.innerHTML = `<div class="sidebar-conversations"></div><div class="side-foot"><div class="sidebar-update" hidden></div><div class="sidebar-foot-row"><button type="button" class="nav sidebar-account" aria-haspopup="menu" aria-expanded="false"></button><button type="button" class="nav sidebar-apps" data-connect-apps><span class="sidebar-apps-icon" aria-hidden="true">${ico("gridPlus")}</span><span class="nav-t"></span><span class="sidebar-app-marks" aria-hidden="true"></span></button></div></div>`;
  let inventory: InventoryView = "loading";
  let lastMarks = "";
  // The sidebar lives as long as the window: its update line is never taken down.
  mountUpdateNotice(nav.querySelector<HTMLElement>(".sidebar-update")!);
  const apps = nav.querySelector<HTMLElement>(".sidebar-apps")!;
  const drawApps = (): void => {
    const label = entryLabel(inventory), name = t("nav.apps");
    if (apps.getAttribute("aria-label") !== label) apps.setAttribute("aria-label", label);
    // Nothing shows under the pointer over this button, in the list or on the rail (owner, 2026-11-12): its name is for a screen reader.
    if (apps.querySelector(".nav-t")!.textContent !== name) apps.querySelector(".nav-t")!.textContent = name;
    const marks = typeof inventory === "object" ? [...inventory.apps].filter(item => item.connected)
      .sort((a, b) => (b.last_used_at ?? 0) - (a.last_used_at ?? 0))
      .flatMap(item => { const icon = serviceIconOf({ name: item.name }); return icon ? [iconHTML(item.name, icon, "md")] : []; }).slice(0, 3)
      // Each mark knows where it stands against the middle one, for the pill's hover (sidebar.css `--spread`).
      .map((mark, at, all) => `<span class="sidebar-app-mark" style="--spread:${at - (all.length - 1) / 2}">${mark}</span>`).join("") : "";
    const host = apps.querySelector(".sidebar-app-marks")!;
    if (lastMarks !== marks) { host.innerHTML = marks; lastMarks = marks; }
    fitMarks();
  };
  /** The marks that fit beside the words, as many as there is room for: the rest drop out, the last first (the words never give way). */
  const fitMarks = (): void => {
    const host = apps.querySelector<HTMLElement>(".sidebar-app-marks")!, marks = [...host.children] as HTMLElement[];
    if (!marks.length) return;
    // What the pill has left after its padding, its words and the gap, in tiles of 14 px that touch; the box has 4 px of its own on each side for the hover's spread.
    const style = getComputedStyle(apps), words = apps.querySelector<HTMLElement>(".nav-t")!;
    const room = apps.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - words.scrollWidth - parseFloat(style.columnGap || "8") - 8;
    const fit = Math.max(0, Math.min(marks.length, Math.floor(room / parseFloat(style.getPropertyValue("--marks-tile-w") || "14"))));
    marks.forEach((mark, at) => {
      const shown = at < fit, spread = String(at - (fit - 1) / 2);
      if (mark.hidden === shown) mark.hidden = !shown;
      if (shown && mark.style.getPropertyValue("--spread") !== spread) mark.style.setProperty("--spread", spread);
    });
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(fitMarks).observe(apps);
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
  // Under 860 px the list is its rail of faces: the conversation keeps the room, and every member is one press away.
  const compactWindow = matchMedia("(max-width: 859px)");
  let collapsed = false;
  try { collapsed = localStorage.getItem("raphael.sidebar.collapsed") === "true"; } catch { /* Keep the full list when storage is unavailable. */ }
  /** The width the owner dragged the list to, null while it has the stylesheet's own. */
  let width: number | null = savedWidth(WIDTH_KEY, MIN_WIDTH, MAX_WIDTH);
  const edge = document.createElement("div");
  edge.className = "side-edge";
  nav.append(edge);
  const fitWidth = (): number => Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, innerWidth - CONVERSATION_MIN)));
  // The full list's width is the owner's when it was dragged; the rail keeps the stylesheet's.
  const placeWidth = (): void => {
    const own = !collapsed && !compactWindow.matches && width !== null;
    if (own) document.documentElement.style.setProperty("--sidebar-width", `${Math.min(width!, fitWidth())}px`);
    else document.documentElement.style.removeProperty("--sidebar-width");
    edge.setAttribute("aria-valuenow", String(Math.round(nav.getBoundingClientRect().width) || (collapsed ? RAIL_WIDTH : width ?? 0)));
    edge.setAttribute("aria-valuemin", String(RAIL_WIDTH));
    edge.setAttribute("aria-valuemax", String(MAX_WIDTH));
  };
  const rail = (): boolean => collapsed || compactWindow.matches;
  const placeRail = (): void => {
    const folded = rail();
    document.documentElement.toggleAttribute("data-sidebar-collapsed", folded);
    document.documentElement.toggleAttribute("data-sidebar-narrow", compactWindow.matches);
    // The rail has no search (owner, 2026-11-12 23:25): only the plus stands in its foot; search stays in the top row, hidden there (sidebar.css).
    if (folded) foot.prepend(add); else header?.append(search, add);
    if (!folded) nav.querySelectorAll(".mb-row[data-tooltip], .sidebar-account[data-tooltip]").forEach(row => row.removeAttribute("data-tooltip"));
    placeWidth();
  };
  const keep = (): void => {
    try { localStorage.setItem("raphael.sidebar.collapsed", String(collapsed)); } catch { /* Keep the current session choice. */ }
    saveWidth(WIDTH_KEY, width);
  };
  const toggleRail = (): void => { collapsed = !collapsed; placeRail(); keep(); };
  // Ctrl+B folds the list to its rail and back; a narrow window is the rail already, and has nothing narrower to fold to.
  window.addEventListener("raphael:toggle-sidebar", () => { if (!compactWindow.matches) toggleRail(); });
  // The list's edge drags it wider or narrower; dragged narrow enough it folds to a rail of faces, and the
  // rail dragged out opens the list again. There is no button for it.
  mountEdge(edge, {
    label: t("nav.sidebarWidth"),
    grow: 1,
    widthAt: x => x - nav.getBoundingClientRect().left,
    width: () => (collapsed ? FROM_RAIL : width ?? Math.round(nav.getBoundingClientRect().width)),
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
    if (row) row.dataset.tooltip = row.matches(".sidebar-account") ? row.getAttribute("aria-label") ?? "" : row.querySelector("b, .nav-t")?.textContent ?? "";
  };
  nav.addEventListener("pointerover", nameFace, true);
  nav.addEventListener("focusin", nameFace, true);
  messageTooltip(nav);
  const draw = (): void => {
    nav.setAttribute("aria-label", t("nav.pages"));
    add.setAttribute("aria-label", t("members.add")); add.title = t("members.add");
    edge.setAttribute("aria-label", t("nav.sidebarWidth"));
    drawApps();
    // The face is a real button named by the owner's name; a redraw changes it only when the picture or the name changed.
    const face = ownerFaceHTML(32);
    if (drawnFace !== face) { account.innerHTML = face; drawnFace = face; }
    if (account.getAttribute("aria-label") !== ownerName()) account.setAttribute("aria-label", ownerName());
  };
  const account = nav.querySelector<HTMLElement>(".sidebar-account")!;
  let drawnFace = "";
  account.addEventListener("click", () => {
    if (!app?.go) return;
    openAccountMenu(account, { go: app.go, allowances: api.usageAllowances, chatgptStatus: api.chatgptStatus, status: api.statusGet }, rail() ? "right" : "above");
  });
  compactWindow.addEventListener("change", placeRail);
  // The list's own width never squeezes the conversation on a window narrower than it was dragged on.
  window.addEventListener("resize", () => placeWidth());
  onLocaleChange(draw); onOwnerProfile(draw); placeRail(); draw();
}
