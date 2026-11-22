import { t, getLocale } from "./i18n";
import { btn, esc, ico, iconButton, patchHTML, type IconName } from "./ui";

interface BrowserTab { id: string; title: string; url: string; favicon: string }
export interface HostBrowserModel { tabs: BrowserTab[]; shown: string; back: boolean; forward: boolean }
type Action = "select" | "close" | "new" | "back" | "forward" | "reload" | "navigate";
export interface HostBrowserAction { action: Action; tab: string; url?: string }

export function mountHostBrowserToolbar(screen: HTMLElement, send: (action: HostBrowserAction, id: number) => void) {
  const bar = document.createElement("div");
  bar.className = "host-browser-toolbar";
  bar.hidden = true;
  bar.innerHTML = '<div class="host-browser-tabs"><div class="host-browser-strip" role="group"></div><div class="host-browser-add"></div></div>' +
    '<div class="host-browser-address-row"><div class="host-browser-history"></div><span class="host-browser-url" dir="ltr"></span>' +
    '<input class="host-browser-address" type="text" inputmode="url" dir="ltr" autocomplete="off" spellcheck="false" maxlength="8192" hidden></div>' +
    '<p class="host-browser-error" role="status" hidden></p>';
  screen.prepend(bar);
  const strip = bar.querySelector<HTMLElement>(".host-browser-strip")!;
  const add = bar.querySelector<HTMLElement>(".host-browser-add")!;
  const history = bar.querySelector<HTMLElement>(".host-browser-history")!;
  const url = bar.querySelector<HTMLElement>(".host-browser-url")!;
  const address = bar.querySelector<HTMLInputElement>(".host-browser-address")!;
  const error = bar.querySelector<HTMLElement>(".host-browser-error")!;
  let model: HostBrowserModel | undefined, owned = false, drawn = "", actionId = 0, failed = false;
  let editing = false, navigationId: number | undefined;

  const measureTitles = () => {
    if (bar.hidden) return;
    for (const button of strip.querySelectorAll<HTMLButtonElement>('[data-browser-action="select"]')) {
      const title = button.querySelector<HTMLElement>(".host-browser-tab-title")!;
      if (title.scrollWidth > title.clientWidth) button.dataset.tooltip = title.textContent ?? "";
      else button.removeAttribute("data-tooltip");
    }
  };
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      // The enlarged frame budgets for the full toolbar, including a wrapped navigation error.
      screen.style.setProperty("--host-browser-toolbar-height", `${bar.getBoundingClientRect().height}px`);
      measureTitles();
    });
    observer.observe(bar, { box: "border-box" });
    observer.observe(strip);
  }
  const control = (icon: IconName, label: string, action: Action, disabled: boolean, tab?: string) =>
    iconButton(icon, label, ` data-browser-action="${action}"${tab ? ` data-browser-tab="${esc(tab)}"` : ""}${disabled ? " disabled" : ""}`, action === "close" ? "row" : "");

  function showError(show: boolean): void {
    error.hidden = !show;
    if (show) address.setAttribute("aria-invalid", "true");
    else address.removeAttribute("aria-invalid");
    failed = show;
  }

  function draw(next: HostBrowserModel | undefined, held: boolean): void {
    const shown = next?.tabs.find(tab => tab.id === next.shown);
    const signature = JSON.stringify([next, held, getLocale()]);
    if (signature === drawn) return;
    drawn = signature;
    if (next?.shown !== model?.shown || held !== owned || !shown) {
      editing = false;
      actionId++;
      showError(false);
    }
    const changedTab = next?.shown !== model?.shown;
    model = next;
    owned = held;
    screen.toggleAttribute("data-host-browser", !!shown);
    bar.hidden = !shown;
    if (!shown) return;
    strip.setAttribute("aria-label", t("browser.tabs"));
    address.setAttribute("aria-label", t("browser.address"));
    error.textContent = t("browser.navigationFailed");
    patchHTML(strip, next!.tabs.map(tab => {
      const name = esc(tab.title || (tab.url === "about:blank" ? t("browser.newTab") : tab.url));
      const favicon = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(tab.favicon)
        ? `<img alt="" src="${tab.favicon}">` : ico("globe");
      return `<div class="host-browser-tab" data-k="browser-${esc(tab.id)}"${tab.id === shown.id ? " data-shown" : ""}>` +
        btn(`<span class="host-browser-favicon">${favicon}</span><span class="host-browser-tab-title">${name}</span>`,
          "host-browser-tab-button", ` data-browser-action="select" data-browser-tab="${esc(tab.id)}" aria-pressed="${tab.id === shown.id}" aria-label="${name}"`) +
        control("x", t("browser.closeTab"), "close", false, tab.id) + '</div>';
    }).join(""));
    patchHTML(add, control("plus", t("browser.newTab"), "new", !owned));
    patchHTML(history, control("arrowLeft", t("browser.back"), "back", !owned || !next!.back) +
      control("arrowRight", t("browser.forward"), "forward", !owned || !next!.forward) +
      control("rotateClockwise", t("browser.reload"), "reload", !owned));
    url.hidden = owned;
    address.hidden = !owned;
    url.textContent = shown.url;
    if (!editing) address.value = shown.url;
    if (changedTab) {
      const selected = strip.querySelector<HTMLElement>("[data-shown]");
      if (selected) {
        const bounds = strip.getBoundingClientRect(), tab = selected.getBoundingClientRect();
        strip.scrollLeft += tab.left < bounds.left ? tab.left - bounds.left : Math.max(0, tab.right - bounds.right);
      }
    }
    measureTitles();
  }

  bar.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-browser-action]");
    if (!button || button.disabled || !model) return;
    const action = button.dataset.browserAction as Action;
    send({ action, tab: button.dataset.browserTab ?? model.shown }, ++actionId);
  });
  address.addEventListener("input", () => { editing = true; showError(false); });
  address.addEventListener("blur", () => {
    if (failed) return;
    editing = false;
    address.value = model?.tabs.find(tab => tab.id === model?.shown)?.url ?? "";
  });
  address.addEventListener("keydown", event => {
    if (!model || !owned || event.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    const value = address.value.trim();
    if (!value) { showError(true); return; }
    const url = /^(?:[a-z][\w+.-]*:\/\/|about:)/i.test(value) ? value : `https://${value}`;
    navigationId = ++actionId;
    send({ action: "navigate", tab: model.shown, url }, navigationId);
  });

  return {
    draw,
    result(id: number, ok: boolean): void {
      if (id !== actionId || id !== navigationId) return;
      showError(!ok);
      if (ok) { editing = false; address.blur(); }
    },
  };
}
