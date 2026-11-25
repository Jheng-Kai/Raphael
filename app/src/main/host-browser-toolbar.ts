import { t, getLocale } from "./i18n";
import { actionRow, btn, esc, ico, iconButton, patchHTML, type IconName } from "./ui";

interface BrowserTab { id: string; title: string; url: string; favicon: string }
/** A JavaScript dialog that holds the shown page: a headless Chrome never draws it, so the view does (#336). */
export interface HostDialog { dialog_id: string; type: "alert" | "confirm" | "prompt" | "beforeunload"; message: string; omitted?: number; default_prompt?: string }
/** The site's sign-in prompt (HTTP authentication), which Chrome hands over instead of drawing; only the owner answers it. */
export interface HostAuth { auth_id: string; origin: string; realm: string; scheme: string }
/** The page's file chooser, which Chrome hands over instead of drawing its dialog. */
export interface HostChooser { chooser_id: string; mode: "single" | "multiple" }
export interface HostBrowserModel { tabs: BrowserTab[]; shown: string; back: boolean; forward: boolean; dialog?: HostDialog; auth?: HostAuth; chooser?: HostChooser }
type Action = "select" | "close" | "new" | "back" | "forward" | "reload" | "navigate" | "dialog" | "auth" | "upload" | "chooser";
export interface HostBrowserAction {
  action: Action; tab: string; url?: string; dialog?: string; accept?: boolean; text?: string;
  auth?: string; username?: string; password?: string; chooser?: string; files?: { stored_id: string; name: string }[];
}
/** What the card shows over the page: a dialog first, which holds the page, then a sign-in prompt, then a file chooser. */
type Prompt = { kind: "dialog"; id: string; dialog: HostDialog } | { kind: "auth"; id: string; auth: HostAuth } | { kind: "chooser"; id: string; chooser: HostChooser };
const promptOf = (model: HostBrowserModel | undefined): Prompt | undefined =>
  model?.dialog ? { kind: "dialog", id: model.dialog.dialog_id, dialog: model.dialog }
    : model?.auth ? { kind: "auth", id: model.auth.auth_id, auth: model.auth }
      : model?.chooser ? { kind: "chooser", id: model.chooser.chooser_id, chooser: model.chooser } : undefined;
const siteOf = (url: string): string => { try { return new URL(url).host || url; } catch { return url; } };

let dialogIds = 0;

/** `store` puts a file the owner chose for a page's file chooser in the core's upload store and gives its stored_id. */
export function mountHostBrowserToolbar(screen: HTMLElement, send: (action: HostBrowserAction, id: number) => void,
  store?: (file: File) => Promise<string>) {
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
  // The owner's own files for a page's file chooser, picked as for any web page.
  const picker = document.createElement("input");
  picker.type = "file";
  picker.hidden = true;
  picker.className = "host-browser-picker";
  screen.append(picker);
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

  function drawDialog(prompt: Prompt | undefined, url: string, holding: boolean): void {
    screen.toggleAttribute("data-host-dialog", !!prompt);
    card.hidden = !prompt;
    // Watching, it is only read: a press on it is a press on the page, which opens the larger view to take control.
    card.toggleAttribute("data-readonly", !holding);
    if (!prompt) { dialogDrawn = dialogShown = ""; dialogAction = undefined; return; }
    const signature = JSON.stringify([prompt, url, holding, getLocale()]);
    if (signature === dialogDrawn) return;
    dialogDrawn = signature;
    const key = `${prompt.kind}:${prompt.id}`, fresh = key !== dialogShown;
    // What the owner typed stays through a redraw of the same prompt; a new prompt starts from its own default.
    const typed = new Map([...card.querySelectorAll<HTMLInputElement>(".host-browser-dialog-answer")].map(input => [input.dataset.field ?? "", input.value]));
    dialogShown = key;
    if (fresh) { dialogAction = undefined; typed.clear(); }
    const off = holding && dialogAction === undefined ? "" : " disabled";
    const field = (name: string, type: string, label: string, max: number) =>
      `<input class="host-browser-dialog-answer" data-field="${name}" type="${type}" maxlength="${max}" autocomplete="off" spellcheck="false" aria-label="${esc(label)}" placeholder="${esc(label)}"${off}>`;
    const cancel = btn(esc(t("browser.dialogCancel")), "", ` data-dialog-answer="dismiss"${off}`);
    let from: string, body = "", secondary = cancel, primary = t("browser.dialogOk");
    let takeOver: "browser.dialogTakeOver" | "browser.authTakeOver" | "browser.chooserTakeOver";
    if (prompt.kind === "dialog") {
      const dialog = prompt.dialog;
      from = t("browser.dialogFrom", { p0: siteOf(url) });
      body = `<p class="host-browser-dialog-message" id="${cardId}-message">${esc(dialog.message)}</p>` +
        // A long message keeps both its ends; what is left out between them is said, never silently cut.
        (dialog.omitted ? `<p class="host-browser-dialog-omitted">${esc(t("browser.dialogOmitted", { p0: new Intl.NumberFormat(getLocale()).format(dialog.omitted) }))}</p>` : "") +
        (dialog.type === "prompt" ? field("text", "text", t("browser.dialogAnswer"), 2000) : "");
      if (fresh && dialog.type === "prompt") typed.set("text", dialog.default_prompt ?? "");
      if (dialog.type === "alert") secondary = "";
      takeOver = "browser.dialogTakeOver";
    } else if (prompt.kind === "auth") {
      // The site names its realm; the user name and password go to Chrome alone, never kept here.
      from = t("browser.authFrom", { p0: siteOf(prompt.auth.origin) });
      body = (prompt.auth.realm ? `<p class="host-browser-dialog-message" id="${cardId}-message">${esc(prompt.auth.realm)}</p>` : "") +
        field("username", "text", t("browser.authUser"), 1000) + field("password", "password", t("browser.authPassword"), 1000);
      primary = t("browser.authSignIn");
      takeOver = "browser.authTakeOver";
    } else {
      from = t("browser.chooserFrom", { p0: siteOf(url) });
      picker.multiple = prompt.chooser.mode === "multiple";
      primary = t("browser.chooserPick");
      takeOver = "browser.chooserTakeOver";
    }
    card.innerHTML = `<p class="host-browser-dialog-from" id="${cardId}-from">${esc(from)}</p>` + body +
      (holding ? "" : `<p class="host-browser-dialog-hint">${esc(t(takeOver))}</p>`) +
      actionRow({ secondary, primary: { label: esc(primary), attrs: ` data-dialog-answer="accept"${off}` } });
    for (const input of card.querySelectorAll<HTMLInputElement>(".host-browser-dialog-answer")) input.value = typed.get(input.dataset.field ?? "") ?? "";
    if (holding && !off && (fresh || !card.contains(document.activeElement))) {
      (card.querySelector<HTMLElement>(".host-browser-dialog-answer") ?? card.querySelector<HTMLButtonElement>('[data-dialog-answer="accept"]'))?.focus({ preventScroll: true });
    }
  }

  function disableCard(): void {
    for (const control of card.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) control.disabled = true;
  }

  function answerDialog(accept: boolean): void {
    const prompt = promptOf(model);
    if (!model || !prompt || dialogAction !== undefined || card.querySelector("[data-dialog-answer]:disabled")) return;
    // Choosing files opens the owner's own file dialog; they are sent once chosen.
    if (prompt.kind === "chooser" && accept) { if (store) picker.click(); return; }
    const value = (name: string) => card.querySelector<HTMLInputElement>(`.host-browser-dialog-answer[data-field="${name}"]`)?.value;
    dialogAction = ++actionId;
    disableCard();
    if (prompt.kind === "dialog") {
      const text = value("text");
      send({ action: "dialog", tab: model.shown, dialog: prompt.id, accept, ...(accept && text !== undefined ? { text } : {}) }, dialogAction);
    } else if (prompt.kind === "auth") {
      send({ action: "auth", tab: model.shown, auth: prompt.id, accept, ...(accept ? { username: value("username") ?? "", password: value("password") ?? "" } : {}) }, dialogAction);
    } else {
      send({ action: "chooser", tab: model.shown, chooser: prompt.id }, dialogAction);
    }
  }

  picker.addEventListener("change", () => {
    const files = [...picker.files ?? []];
    picker.value = "";
    const prompt = promptOf(model);
    if (!files.length || !model || !store || prompt?.kind !== "chooser" || dialogAction !== undefined) return;
    const id = dialogAction = ++actionId, tab = model.shown;
    disableCard();
    void Promise.all(files.slice(0, prompt.chooser.mode === "multiple" ? 20 : 1).map(async file => ({ stored_id: await store(file), name: file.name })))
      .then(stored => { if (dialogAction === id) send({ action: "upload", tab, chooser: prompt.id, files: stored }, id); })
      .catch(() => { if (dialogAction === id) refused(); });
  });

  /** An answer the core refused (the tab was handed back meanwhile) or files not stored: the prompt can be answered again. */
  function refused(): void {
    dialogAction = undefined;
    dialogDrawn = "";
    drawDialog(promptOf(model), model?.tabs.find(tab => tab.id === model?.shown)?.url ?? "", lastHolding);
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
    drawDialog(shown ? promptOf(next) : undefined, shown?.url ?? "", holding);
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
        if (!ok) refused();
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
