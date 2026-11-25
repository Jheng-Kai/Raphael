import { t, getLocale } from "./i18n";
import { actionRow, btn, esc, ico, iconButton, patchHTML, type IconName } from "./ui";

interface BrowserTab { id: string; title: string; url: string; favicon: string }
/** A JavaScript dialog that holds the shown page: a headless Chrome never draws it, so the view does (#336). */
export interface HostDialog { dialog_id: string; type: "alert" | "confirm" | "prompt" | "beforeunload"; message: string; omitted?: number; default_prompt?: string }
export interface HostBrowserModel { tabs: BrowserTab[]; shown: string; back: boolean; forward: boolean; dialog?: HostDialog }
type Action = "select" | "close" | "new" | "back" | "forward" | "reload" | "navigate" | "dialog";
export interface HostBrowserAction { action: Action; tab: string; url?: string; dialog?: string; accept?: boolean; text?: string }

let dialogIds = 0;

export function mountHostBrowserToolbar(screen: HTMLElement, send: (action: HostBrowserAction, id: number) => void) {
  const bar = document.createElement("div");
  bar.className = "host-browser-toolbar";
  bar.hidden = true;
  bar.innerHTML = '<div class="host-browser-tabs"><div class="host-browser-strip" role="group"></div><div class="host-browser-add"></div></div>' +
    '<div class="host-browser-address-row"><div class="host-browser-history"></div>' +
    '<input class="host-browser-address" type="text" inputmode="url" dir="ltr" autocomplete="off" spellcheck="false" maxlength="8192"></div>' +
    '<p class="host-browser-error" role="status" hidden></p>';
  screen.prepend(bar);
  // The page's dialog sits over the page, under the toolbar; only the owner holding the tab answers it.
  const card = document.createElement("div");
  card.className = "host-browser-dialog";
  card.setAttribute("role", "alertdialog");
  card.hidden = true;
  const cardId = `host-browser-dialog-${++dialogIds}`;
  card.setAttribute("aria-labelledby", `${cardId}-from`);
  card.setAttribute("aria-describedby", `${cardId}-message`);
  screen.append(card);
  let dialogDrawn = "", dialogShown = "", dialogAction: number | undefined, lastHolding = false;
  const strip = bar.querySelector<HTMLElement>(".host-browser-strip")!;
  const add = bar.querySelector<HTMLElement>(".host-browser-add")!;
  const history = bar.querySelector<HTMLElement>(".host-browser-history")!;
  const address = bar.querySelector<HTMLInputElement>(".host-browser-address")!;
  const error = bar.querySelector<HTMLElement>(".host-browser-error")!;
  let model: HostBrowserModel | undefined, drawn = "", actionId = 0, failed = false;
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

  function drawDialog(dialog: HostDialog | undefined, url: string, holding: boolean): void {
    screen.toggleAttribute("data-host-dialog", !!dialog);
    card.hidden = !dialog;
    // Watching, it is only read: a press on it is a press on the page, which opens the larger view to take control.
    card.toggleAttribute("data-readonly", !holding);
    if (!dialog) { dialogDrawn = dialogShown = ""; dialogAction = undefined; return; }
    const signature = JSON.stringify([dialog, url, holding, getLocale()]);
    if (signature === dialogDrawn) return;
    dialogDrawn = signature;
    const fresh = dialog.dialog_id !== dialogShown;
    const typed = fresh ? dialog.default_prompt ?? "" : card.querySelector<HTMLInputElement>(".host-browser-dialog-answer")?.value ?? "";
    dialogShown = dialog.dialog_id;
    if (fresh) dialogAction = undefined;
    let site = url;
    try { site = new URL(url).host || url; } catch { /* the address as written */ }
    const off = holding && dialogAction === undefined ? "" : " disabled";
    card.innerHTML = `<p class="host-browser-dialog-from" id="${cardId}-from">${esc(t("browser.dialogFrom", { p0: site }))}</p>` +
      `<p class="host-browser-dialog-message" id="${cardId}-message">${esc(dialog.message)}</p>` +
      // A long message keeps both its ends; what is left out between them is said, never silently cut.
      (dialog.omitted ? `<p class="host-browser-dialog-omitted">${esc(t("browser.dialogOmitted", { p0: new Intl.NumberFormat(getLocale()).format(dialog.omitted) }))}</p>` : "") +
      (dialog.type === "prompt" ? `<input class="host-browser-dialog-answer" type="text" maxlength="2000" autocomplete="off" spellcheck="false" aria-label="${esc(t("browser.dialogAnswer"))}"${off}>` : "") +
      (holding ? "" : `<p class="host-browser-dialog-hint">${esc(t("browser.dialogTakeOver"))}</p>`) +
      actionRow({
        secondary: dialog.type === "alert" ? "" : btn(esc(t("browser.dialogCancel")), "", ` data-dialog-answer="dismiss"${off}`),
        primary: { label: esc(t("browser.dialogOk")), attrs: ` data-dialog-answer="accept"${off}` },
      });
    const answer = card.querySelector<HTMLInputElement>(".host-browser-dialog-answer");
    if (answer) answer.value = typed;
    if (holding && !off && (fresh || !card.contains(document.activeElement))) {
      (answer ?? card.querySelector<HTMLButtonElement>('[data-dialog-answer="accept"]'))?.focus({ preventScroll: true });
    }
  }

  function answerDialog(accept: boolean): void {
    const dialog = model?.dialog;
    if (!model || !dialog || dialogAction !== undefined || card.querySelector("[data-dialog-answer]:disabled")) return;
    const text = card.querySelector<HTMLInputElement>(".host-browser-dialog-answer")?.value;
    dialogAction = ++actionId;
    for (const control of card.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) control.disabled = true;
    send({ action: "dialog", tab: model.shown, dialog: dialog.dialog_id, accept, ...(accept && text !== undefined ? { text } : {}) }, dialogAction);
  }

  card.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-dialog-answer]");
    if (button && !button.disabled) answerDialog(button.dataset.dialogAnswer === "accept");
  });
  card.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229 || (event.key !== "Enter" && event.key !== "Escape")) return;
    // The view's own Escape folds it, and its keys reach the page: these two answer the dialog instead.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") answerDialog(false);
    else if (!(event.target as Element).matches("button")) answerDialog(true);
    else (event.target as HTMLButtonElement).click();
  });

  function draw(next: HostBrowserModel | undefined, holding = false): void {
    const shown = next?.tabs.find(tab => tab.id === next.shown);
    const signature = JSON.stringify([next, getLocale(), holding]);
    if (signature === drawn) return;
    drawn = signature;
    lastHolding = holding;
    drawDialog(shown ? next?.dialog : undefined, shown?.url ?? "", holding);
    if (next?.shown !== model?.shown || !shown) {
      editing = false;
      actionId++;
      showError(false);
    }
    const changedTab = next?.shown !== model?.shown;
    model = next;
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
    patchHTML(add, control("plus", t("browser.newTab"), "new", false));
    patchHTML(history, control("arrowLeft", t("browser.back"), "back", !next!.back) +
      control("arrowRight", t("browser.forward"), "forward", !next!.forward) +
      control("rotateClockwise", t("browser.reload"), "reload", false));
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
  const shownUrl = (): string => model?.tabs.find(tab => tab.id === model?.shown)?.url ?? "";
  address.addEventListener("input", () => { editing = true; showError(false); });
  // As in Chrome: the first press into the field selects the whole address; a press while it has the focus places the caret.
  let selectOnUp = false;
  address.addEventListener("mousedown", () => { selectOnUp = document.activeElement !== address; });
  address.addEventListener("mouseup", event => {
    if (!selectOnUp) return;
    selectOnUp = false;
    if (address.selectionStart === address.selectionEnd) { event.preventDefault(); address.select(); }
  });
  address.addEventListener("focus", () => { if (!selectOnUp) address.select(); });
  address.addEventListener("blur", () => {
    if (failed) return;
    editing = false;
    address.value = shownUrl();
  });
  address.addEventListener("keydown", event => {
    if (!model || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      // Escape puts the page's own address back, a second one leaves the field.
      event.preventDefault();
      event.stopPropagation();
      if (editing || address.value !== shownUrl()) { editing = false; showError(false); address.value = shownUrl(); address.select(); }
      else address.blur();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    const value = address.value.trim();
    if (!value) { showError(true); return; }
    navigationId = ++actionId;
    send({ action: "navigate", tab: model.shown, url: addressTarget(value) }, navigationId);
  });

  return {
    draw,
    /** With the page's dialog to answer, the owner's keys go to it rather than to the page: whether it took them. */
    focusDialog(): boolean {
      if (card.hidden || card.hasAttribute("data-readonly")) return false;
      if (!card.contains(document.activeElement)) {
        [...card.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.host-browser-dialog-answer, [data-dialog-answer="accept"]')]
          .find(control => !control.disabled)?.focus({ preventScroll: true });
      }
      return true;
    },
    result(id: number, ok: boolean): void {
      if (id === dialogAction) {
        // Answered, the next read has no dialog; refused (the tab was handed back meanwhile), it can be answered again.
        if (!ok) { dialogAction = undefined; dialogDrawn = ""; drawDialog(model?.dialog, model?.tabs.find(tab => tab.id === model?.shown)?.url ?? "", lastHolding); }
        return;
      }
      if (id !== actionId || id !== navigationId) return;
      showError(!ok);
      if (ok) { editing = false; address.blur(); }
    },
  };
}

/** What the address field goes to, as Chrome's omnibox does: an address as written, a bare host on https, anything else a Google search. */
export function addressTarget(value: string): string {
  const text = value.trim();
  if (/^(?:[a-z][\w+.-]*:\/\/|about:)/i.test(text)) return text;
  const host = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,})(?::\d+)?(?:[/?#]\S*)?$/u;
  if (!/\s/.test(text) && host.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}
