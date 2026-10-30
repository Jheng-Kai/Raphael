/** The single conversation sidebar persists across page navigation. */
import { onLocaleChange, t } from "./i18n";
import { navHomeHTML, navItemHTML } from "./nav-items";
import { onOwnerProfile, ownerFaceHTML, ownerName } from "./owner-avatar";
import { ico, iconButton } from "./ui";

export function createSidebar(nav: HTMLElement, column: HTMLElement): { close(): void } {
  nav.classList.add("sidebar");
  nav.innerHTML = `<div class="sidebar-brand">${navHomeHTML()}${iconButton("x", t("common.close"), ' data-sidebar="close"', "sidebar-close")}</div><div class="sidebar-conversations"></div><div class="side-foot">${navItemHTML("dictation", t("nav.dictation"), ico("mic"))}<button type="button" class="nav sidebar-account" data-go="settings" data-pane="general"></button></div>`;
  nav.querySelector(".sidebar-conversations")!.append(column);
  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.className = "btn icon sidebar-toggle";
  toggle.dataset.sidebar = "open"; toggle.setAttribute("aria-controls", nav.id);
  const scrim = document.createElement("div"); scrim.className = "sidebar-scrim"; scrim.hidden = true;
  nav.after(scrim); document.querySelector(".window-chrome")!.prepend(toggle);
  const setOpen = (open: boolean): void => {
    document.documentElement.toggleAttribute("data-sidebar-open", open);
    toggle.setAttribute("aria-expanded", String(open)); scrim.hidden = !open;
    const compact = matchMedia("(max-width: 859px)").matches;
    nav.inert = compact && !open;
    document.getElementById("main")!.inert = compact && open;
    if (open) nav.querySelector<HTMLElement>(".brand")?.focus();
    else if (compact) toggle.focus();
  };
  const close = (): void => setOpen(false);
  const draw = (): void => {
    nav.setAttribute("aria-label", t("nav.pages"));
    const brand = nav.querySelector<HTMLElement>(".brand")!;
    brand.setAttribute("aria-label", t("nav.home")); brand.title = t("nav.home");
    nav.querySelector('[data-go="dictation"] .nav-t')!.textContent = t("nav.dictation");
    const account = nav.querySelector<HTMLElement>(".sidebar-account")!;
    account.innerHTML = ownerFaceHTML(32) + `<span class="sidebar-account-name"></span>` + ico("gear");
    account.querySelector(".sidebar-account-name")!.textContent = ownerName();
    account.setAttribute("aria-label", `${ownerName()} · ${t("nav.settings")}`);
    toggle.innerHTML = ico("menu"); toggle.setAttribute("aria-label", t("nav.pages"));
    nav.querySelector('[data-sidebar="close"]')?.setAttribute("aria-label", t("common.close"));
  };
  toggle.addEventListener("click", () => setOpen(!document.documentElement.hasAttribute("data-sidebar-open")));
  nav.addEventListener("click", event => {
    if ((event.target as Element).closest('[data-sidebar="close"], [data-go], [data-member], [data-room], [data-room-team]')) close();
  });
  scrim.addEventListener("click", close);
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
  matchMedia("(max-width: 859px)").addEventListener("change", close);
  onLocaleChange(draw); onOwnerProfile(draw); draw(); close();
  return { close };
}
