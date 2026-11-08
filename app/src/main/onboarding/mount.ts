// The guide in the main window: it takes the place of the pages on a first run, and opens again
// over them from the settings. flow.ts says which screen is next, screens.ts draws it; this file
// holds the state and does what the buttons say, through the core and the app. It has three
// choices to offer after the welcome, each done where it is shown and the same way as in Settings:
// the AI tools (the account controller of Settings > Models and the OpenRouter key), the services
// (the store of Connect apps), and the abilities the members share (Settings > Tools).
//
// Never kept or logged here: the key that is pasted. It is sent once and the field is emptied.

import { onLocaleChange, t } from "../i18n";
import { Emblem } from "../../overlay/emblem";

import * as api from "../api";
import { createCliBrains } from "../cli-brains";
import { createProviders } from "../providers";
import { describeError, keyReasonText } from "../format";
import { wireKeyField } from "../keyfield";
import { UI_LANGUAGES } from "../pages/settings-view";
import { languageButtonHTML, openLanguagePicker } from "../language-picker";
import { storePlugin } from "../plugins-data";
import { modelPickerHTML, mountModelPicker, type ModelPickerLook } from "../model-picker";
import { createServices, servicesHTML as abilityRowsHTML } from "../services";
import type { AppContext, BrainSettings, MainEvent, ModelCatalog, StoreService } from "../types";
import { actionRow, btn, closeMenu, esc, openMenuOnArrow, toaster } from "../ui";
import { SERVICES_WAIT_MS, pickServices, within } from "./helpers";
import { type FlowState, type Mode, initialState, isLast, reduce } from "./flow";
import { DEMOS, abilitiesHTML, demoAsk, demoReply, serviceTilesHTML, servicesHTML, toolsHTML, toolsListHTML, welcomeHTML } from "./screens";

/** The emblem's diameter on the welcome, in px (its canvas is 1.3 times larger, so that its rays have room). */
const EMBLEM_PX = 96;

/** What the guide tells whoever opened it when it is over. */
export interface GuideResult {
  /** The guide was gone through to its end (a first run then saved `onboarded`). False: it was left. */
  finished: boolean;
}

export interface GuideOptions {
  mode: Mode;
  onDone: (result: GuideResult) => void;
}

/** A selector for the element that has focus inside `host`, to give it focus again after a redraw. */
function focusSelector(host: HTMLElement): string {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !host.contains(active)) return "";
  if (active.id) return `#${active.id}`;
  if (active.dataset.k) return `[data-k="${active.dataset.k}"]`;
  if (active.dataset.ob && active.dataset.id) return `[data-ob="${active.dataset.ob}"][data-id="${active.dataset.id}"]`;
  return active.dataset.ob ? `[data-ob="${active.dataset.ob}"]` : "";
}

export function mountOnboarding(root: HTMLElement, options: GuideOptions, app: AppContext): void {
  const mode = options.mode;
  let flow: FlowState = initialState(mode);
  let finishing = false;
  let destroyed = false;
  /** Every listener on the root ends with the guide: a guide opened again on the same root is a new one. */
  const lifetime = new AbortController();
  const { signal } = lifetime;

  // the OpenRouter key
  let key = { has: false, name: null as string | null, replacing: false, busy: false };
  let keyError: (() => string) | null = null;
  let keyLoaded = false;
  const keyView = () => ({ ...key, error: keyError?.() ?? null });
  /** What the AI tools' search box holds. */
  let toolsQuery = "";

  // the services
  let services: StoreService[] | "loading" | "failed" = "loading";
  let servicesLoaded = false;
  let servicesRead = 0;
  let waitingService: string | null = null;
  let connectFailed: string | null = null;
  let query = "";

  /** Raphael's emblem on the welcome: drawn by the voice screen's renderer, ended with the screen. */
  let emblem: Emblem | null = null;

  // the abilities: the same rows and dialogs as Settings › 工具, and its 看圖片 model picker
  let brain: BrainSettings | null = null;
  let catalog: ModelCatalog | null | "loading" = "loading";
  const abilities = createServices({
    root,
    visible: () => !destroyed && flow.step === "abilities",
    redraw: () => {
      if (!destroyed && flow.step === "abilities") repaintBody();
    },
    brain: () => brain,
    changeSetting: async (key, value) => {
      try {
        brain = (await api.settingsSet(key, value)).settings;
      } catch (err) {
        toaster.info(describeError(err));
      }
    },
  });
  const visionLook = (): ModelPickerLook => {
    const status = abilities.view().status;
    return {
      role: "vision",
      key: "svc-vision",
      label: t("services.vision"),
      current: (typeof status === "object" ? status.vision.model : null) ?? brain?.vision_model ?? "",
      catalog: typeof catalog === "object" ? catalog : null,
      providers: providers.view().providers,
      loading: catalog === "loading",
      favorites: brain?.model_favorites?.answer ?? [],
      lead: { id: "", name: t("services.sameAsAnswer") },
      showPrice: false,
      disabled: brain === null,
    };
  };

  const accounts = createCliBrains({
    visible: () => !destroyed && flow.step === "tools",
    redraw: () => {
      if (!destroyed && flow.step === "tools") repaintBody();
    },
  });

  // Every provider of the catalog, with the same editor as Settings › 模型與用量 (providers.ts).
  const providers = createProviders({
    root,
    visible: () => !destroyed && flow.step === "tools",
    redraw: () => {
      if (!destroyed && flow.step === "tools") repaintBody();
    },
  });

  const device = () => app.device();

  // ---------- drawing ----------

  function bodyHTML(): string {
    switch (flow.step) {
      case "welcome":
        return welcomeHTML();
      case "tools":
        return toolsHTML(accounts.view(), keyView(), accountsError(), providers.view(), toolsQuery);
      case "services":
        return servicesHTML({ services, waiting: waitingService, failed: connectFailed, query });
      case "abilities":
        return abilitiesHTML(abilityRowsHTML(abilities.view(), modelPickerHTML(visionLook()), brain));
    }
  }

  /** What stopped the last ChatGPT sign-in, in the owner's words (the account controller keeps it). */
  const accountsError = (): string => accounts.view().chatgptError;

  /**
   * One wide black pill, with a grey one for the way back under it (as Grok Bot's first run); a first run has nothing to
   * go back to from its welcome, and a rerun's welcome leaves the guide.
   */
  function footHTML(): string {
    const label = flow.step === "welcome" ? "onboarding.start" : isLast(flow) ? (mode === "rerun" ? "onboarding.finishRerun" : "onboarding.finish") : "onboarding.next";
    const way = flow.step === "welcome" ? (mode === "rerun" ? "common.cancel" : null) : "onboarding.back";
    return actionRow({
      cls: "ob-actions",
      secondary: way ? btn(esc(t(way)), "ob-back", ' data-ob="back"') : undefined,
      primary: { label: esc(t(label)), attrs: ` data-ob="next"${finishing ? " disabled" : ""}` },
    });
  }

  function paintFoot(): void {
    const foot = root.querySelector<HTMLElement>(".ob-foot");
    if (foot) foot.innerHTML = footHTML();
  }

  /** Draws the whole screen. */
  function render(): void {
    closeMenu();
    stopEmblem();
    stopTyping();
    root.dataset.step = flow.step;
    // The language waits at the window's top left on the welcome, out of the way of what the screen says (owner,
    // 2026-11-08: more languages are coming, and their names are long).
    const language = flow.step === "welcome" ? `<div class="ob-lang">${languageButtonHTML(UI_LANGUAGES, device().ui_language, ' data-ob="lang"')}</div>` : "";
    root.innerHTML =
      `<div class="ob-card">${language}<div class="ob-pane">` +
      `<div class="ob-body"><div class="ob-col">${bodyHTML()}</div></div>` +
      `<div class="ob-foot">${footHTML()}</div>` +
      `</div></div>`;
    enterScreen();
    mountVisionPicker();
    showEmblem();
    startTyping();
  }

  function stopEmblem(): void {
    emblem?.dispose();
    emblem = null;
  }

  /** The welcome types an ask a letter at a time, shows Raphael's answer, deletes the ask and types the next one. */
  let typing: ReturnType<typeof setTimeout> | undefined;
  function stopTyping(): void { clearTimeout(typing); typing = undefined; }
  function startTyping(): void {
    const typed = flow.step === "welcome" ? root.querySelector<HTMLElement>("[data-ob-typed]") : null;
    const reply = root.querySelector<HTMLElement>("[data-ob-reply]");
    if (!typed || !reply || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let index = 0, shown = 0;
    const later = (ms: number, then: () => void): void => { typing = setTimeout(() => { if (!destroyed && typed.isConnected) then(); }, ms); };
    const typeNext = (): void => {
      const ask = [...demoAsk(DEMOS[index]!)];
      if (shown < ask.length) { shown++; typed.textContent = ask.slice(0, shown).join(""); later(70, typeNext); return; }
      reply.textContent = demoReply(DEMOS[index]!);
      reply.classList.add("is-on");
      later(2600, erase);
    };
    const erase = (): void => {
      reply.classList.remove("is-on");
      const ask = [...demoAsk(DEMOS[index]!)];
      if (shown > 0) { shown--; typed.textContent = ask.slice(0, shown).join(""); later(28, erase); return; }
      index = (index + 1) % DEMOS.length;
      later(380, typeNext);
    };
    typed.textContent = "";
    reply.textContent = "";
    later(700, typeNext);
  }

  /** The welcome's emblem appears as it does on the desktop (with reduced motion it just stands there). */
  function showEmblem(): void {
    const canvas = flow.step === "welcome" ? root.querySelector<HTMLCanvasElement>("canvas.ob-emb") : null;
    if (!canvas || typeof canvas.getContext !== "function") return;
    emblem = new Emblem(canvas, EMBLEM_PX, { base: 0.05, surface: "transparent" });
    emblem.set("steady");
    emblem.appear();
  }

  /** Draws the part between the bar and the button again, keeping what is typed and where the focus is. */
  function repaintBody(): void {
    const col = root.querySelector<HTMLElement>(".ob-col");
    if (!col) return;
    const typed = Array.from(col.querySelectorAll<HTMLInputElement>("input")).map((input) => [input.id, input.value] as const);
    const focus = focusSelector(col);
    closeMenu();
    col.innerHTML = bodyHTML();
    for (const [id, value] of typed) {
      const input = id ? col.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`) : null;
      if (input) input.value = value;
    }
    if (focus) col.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
    mountVisionPicker();
  }

  /** The 看圖片 picker of 「指定模型」, on the button the dialog drew (only when that page is open). */
  function mountVisionPicker(): void {
    const slot = flow.step === "abilities" ? root.querySelector<HTMLElement>('[data-model-picker="vision"]') : null;
    if (slot) mountModelPicker(slot, { ...visionLook(), onChoose: (id) => void abilities.chooseVision(id) });
  }

  function enterScreen(): void {
    switch (flow.step) {
      case "welcome":
        break;
      case "tools":
        accounts.start();
        void loadKey();
        void providers.load();
        break;
      case "services":
        if (!servicesLoaded || services === "failed") void loadServices();
        break;
      case "abilities":
        void loadAbilities();
        break;
    }
    root.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }

  // ---------- the flow ----------

  function go(event: { type: "NEXT" | "BACK" }): void {
    if (destroyed) return;
    const after = reduce(flow, event);
    if (after === flow) return;
    flow = after;
    render();
  }

  async function next(): Promise<void> {
    if (finishing || destroyed) return;
    if (flow.step !== "welcome" && isLast(flow)) {
      await finish();
      return;
    }
    go({ type: "NEXT" });
  }

  function back(): void {
    if (flow.step === "welcome") {
      // Only a rerun can be left from its first screen: a first run has nothing to go back to.
      if (mode === "rerun") leave({ finished: false });
      return;
    }
    go({ type: "BACK" });
  }

  async function finish(): Promise<void> {
    finishing = true;
    paintFoot();
    if (mode === "first") {
      try {
        await app.setDevice({ onboarded: true });
      } catch (err) {
        toaster.info(describeError(err));
        finishing = false;
        paintFoot();
        return;
      }
    }
    leave({ finished: true });
  }

  function leave(result: GuideResult): void {
    destroy();
    options.onDone(result);
  }

  function destroy(): void {
    destroyed = true;
    abilities.reset();
    closeMenu();
    stopEmblem();
    stopTyping();
    accounts.stop();
    stopEvents();
    stopLocale();
    lifetime.abort();
    delete root.dataset.step;
    root.replaceChildren();
  }

  // ---------- the AI tools ----------

  async function loadKey(): Promise<void> {
    if (keyLoaded) return;
    try {
      const stored = await api.secretsStatus();
      if (destroyed) return;
      keyLoaded = true;
      if (stored.has_key !== key.has) {
        key = { ...key, has: stored.has_key };
        if (flow.step === "tools") repaintBody();
      }
    } catch {
      // not read: the field stays, and the next visit asks again
    }
  }

  async function submitKey(text: string): Promise<void> {
    const typed = text.trim();
    if (!typed || key.busy) return;
    key = { ...key, busy: true };
    keyError = null;
    repaintBody();
    try {
      const result = await api.secretsSetOpenrouterKey(typed);
      if (result.valid) {
        key = { has: true, name: result.label, replacing: false, busy: false };
        toaster.info(t("common.keySaved"));
      } else {
        key = { ...key, busy: false };
        keyError = () => keyReasonText(result.reason);
      }
    } catch (err) {
      key = { ...key, busy: false };
      keyError = () => describeError(err);
    }
    if (!destroyed && flow.step === "tools") repaintBody();
  }

  async function pasteKey(): Promise<void> {
    if (key.busy) return;
    const input = root.querySelector<HTMLInputElement>("#ob-key-input");
    if (input?.value.trim()) {
      void submitKey(input.value);
      return;
    }
    let copied: string;
    try {
      copied = await navigator.clipboard.readText();
    } catch {
      // the webview does not let the page read the clipboard: the field takes Ctrl+V
      input?.focus();
      toaster.info(t("common.keyPasteHint"));
      return;
    }
    if (copied.trim()) {
      void submitKey(copied);
    } else {
      input?.focus();
      toaster.info(t("onboarding.clipboardEmpty"));
    }
  }

  // ---------- the services ----------

  async function loadServices(): Promise<void> {
    // A 重試 starts a new read; an older one that answers late changes nothing.
    const mine = ++servicesRead;
    services = "loading";
    if (flow.step === "services") repaintBody();
    try {
      const [builtin, status] = await Promise.allSettled([within(api.integrationsCatalog(), SERVICES_WAIT_MS), within(api.connectorsStatus(), SERVICES_WAIT_MS)]);
      if (destroyed || mine !== servicesRead) return;
      if (builtin.status !== "fulfilled") throw builtin.reason;
      let managed: StoreService[] = [];
      if (status.status === "fulfilled" && status.value.composio_configured) {
        try {
          managed = (await within(api.connectorsCatalog(), SERVICES_WAIT_MS)).items.map((item) => storePlugin(item, status.value.connectors));
        } catch {
          // the managed apps are a bonus: the built-in ones are enough to go on
        }
        if (destroyed || mine !== servicesRead) return;
      }
      services = pickServices(builtin.value.services, managed);
      servicesLoaded = true;
    } catch {
      if (mine !== servicesRead) return;
      services = "failed";
    }
    if (!destroyed && flow.step === "services") repaintBody();
  }

  async function connectService(id: string): Promise<void> {
    const entry = Array.isArray(services) ? services.find((s) => s.id === id) : undefined;
    if (!entry || waitingService) return;
    waitingService = id;
    connectFailed = null;
    repaintBody();
    try {
      const result = entry.source ? await api.connectorsConnect(id) : await api.integrationsConnect({ catalog_id: id });
      // 取消 already stopped the wait: what the login says afterwards is not shown.
      if (waitingService !== id) return;
      if (result.connected) {
        const serverId = "server" in result ? result.server.id : (result.connector?.id ?? `composio:${id}`);
        if (Array.isArray(services)) services = services.map((s) => (s.id === id ? { ...s, server_id: serverId } : s));
      } else if (result.error !== "cancelled") {
        connectFailed = t("onboarding.connFailed");
      }
    } catch (err) {
      if (waitingService !== id) return;
      connectFailed = describeError(err);
    }
    waitingService = null;
    if (!destroyed && flow.step === "services") repaintBody();
  }

  // ---------- the abilities ----------

  async function loadAbilities(): Promise<void> {
    const [settings] = await Promise.allSettled([api.settingsGet(), abilities.load()]);
    if (destroyed) return;
    if (settings.status === "fulfilled") brain = settings.value.settings;
    if (flow.step === "abilities") repaintBody();
    if (catalog === "loading") {
      try {
        catalog = await api.modelsCatalog();
      } catch {
        catalog = null;
      }
      if (!destroyed && flow.step === "abilities") repaintBody();
    }
  }

  // ---------- events ----------

  function onAppEvent(event: MainEvent): void {
    if (!destroyed) accounts.followEvent(event);
  }
  const stopEvents = app.onEvent(onAppEvent);

  root.addEventListener("click", (e) => {
    if (destroyed) return;
    const target = e.target as Element;

    const language = target.closest<HTMLElement>('[data-ob="lang"]');
    if (language) {
      openLanguagePicker(language, UI_LANGUAGES, device().ui_language, (value) => void app.setDevice({ ui_language: value as "zh-TW" | "en" | "ja" }).catch((err) => toaster.info(describeError(err))));
      return;
    }
    if (target.closest(".sel")) return;

    // ChatGPT and the command-line accounts: the same controller, and the same buttons, as Settings > Models.
    if (flow.step === "tools" && target.closest("button[data-chatgpt], button[data-cli]")) {
      void accounts.click(target);
      return;
    }
    if (flow.step === "tools" && providers.click(target)) return;
    if (flow.step === "abilities" && abilities.click(target)) return;

    const button = target.closest<HTMLElement>("[data-ob]");
    switch (button?.dataset.ob) {
      case "next":
        void next();
        break;
      case "back":
        back();
        break;
      case "key-paste":
        void pasteKey();
        break;
      case "key-replace":
        key = { ...key, replacing: true };
        keyError = null;
        repaintBody();
        root.querySelector<HTMLElement>("#ob-key-input")?.focus();
        break;
      case "key-cancel":
        key = { ...key, replacing: false };
        keyError = null;
        repaintBody();
        break;
      case "conn-login":
        void connectService(button.dataset.service ?? "");
        break;
      case "conn-cancel":
        // The tile stops waiting at once, whether or not the core's login answers its cancel (a store app has none).
        if (!(Array.isArray(services) && services.find((s) => s.id === waitingService)?.source)) void api.integrationsConnectCancel().catch(() => {});
        waitingService = null;
        connectFailed = null;
        repaintBody();
        break;
      case "conn-reload":
        void loadServices();
        break;
    }
  }, { signal });

  // The key is sent by Enter or 貼上 only, never by leaving the field (see keyfield.ts).
  root.addEventListener("keydown", (e) => {
    if (destroyed) return;
    if (flow.step === "tools" && providers.key(e)) return;
    if (flow.step === "abilities" && abilities.key(e)) return;
    openMenuOnArrow(e);
  }, { signal });
  root.addEventListener("input", (e) => {
    if (destroyed || !(e.target instanceof HTMLInputElement)) return;
    if (flow.step === "tools") providers.input(e.target);
    // The search narrows the tiles where they stand: the field keeps its caret, and the page its place.
    if (flow.step === "tools" && e.target.id === "ob-tools-find") {
      toolsQuery = e.target.value;
      const list = root.querySelector<HTMLElement>("[data-ob-tools]");
      if (list) list.innerHTML = toolsListHTML(accounts.view(), keyView(), providers.view(), toolsQuery);
    }
    if (flow.step === "services" && e.target.id === "ob-find") {
      query = e.target.value;
      const grid = root.querySelector<HTMLElement>("[data-ob-services]");
      if (grid) grid.innerHTML = serviceTilesHTML({ services, waiting: waitingService, failed: connectFailed, query });
    }
  }, { signal });
  wireKeyField(root, { inputId: "ob-key-input", pasteSelector: '[data-ob="key-paste"]', submit: (value) => void submitKey(value), signal });

  const stopLocale = onLocaleChange(() => {
    if (destroyed) return;
    const focus = focusSelector(root);
    const typed = Array.from(root.querySelectorAll<HTMLInputElement>("input")).map((input) => [input.id, input.value] as const);
    render();
    for (const [id, value] of typed) {
      const input = id ? root.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`) : null;
      if (input) input.value = value;
    }
    if (focus) root.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  });

  render();
}
