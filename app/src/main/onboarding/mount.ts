// The guide in the main window: it takes the place of the pages on a first run, and opens again
// over them from the settings. flow.ts says which screen is next, screens.ts draws it; this file
// holds the state and does what the buttons say, through the core and the app. It has three
// choices to offer after the welcome, each done where it is shown and the same way as in Settings:
// the AI tools (the account controller of Settings > Models and the OpenRouter key), the services
// (the store of Connect apps), and the abilities the members share (Settings > Tools).
//
// Never kept or logged here: the key that is pasted. It is sent once and the field is emptied.

import { onLocaleChange, t } from "../i18n";

import * as api from "../api";
import { createCliBrains } from "../cli-brains";
import { createProviders } from "../providers";
import { describeError, keyReasonText } from "../format";
import { wireKeyField } from "../keyfield";
import { UI_LANGUAGES } from "../pages/settings-view";
import { storePlugin } from "../plugins-data";
import { CAPABILITIES } from "../services";
import { Stage } from "../stage";
import type { AppContext, BrainSettings, MainEvent, ServicesStatus, StoreService } from "../types";
import { actionRow, closeMenu, esc, openMenu, openMenuOnArrow, sel, toaster } from "../ui";
import { type AbilityRow, abilityRows, pickServices } from "./helpers";
import { type FlowState, type Mode, initialState, isLast, reduce, segments } from "./flow";
import { abilitiesHTML, servicesHTML, toolsHTML, topHTML, welcomeHTML } from "./screens";

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
  let stage: Stage | null = null;
  let finishing = false;
  let destroyed = false;
  /** Every listener on the root ends with the guide: a guide opened again on the same root is a new one. */
  const lifetime = new AbortController();
  const { signal } = lifetime;

  // the OpenRouter key
  let key = { has: false, name: null as string | null, replacing: false, busy: false };
  let keyError: (() => string) | null = null;
  let keyLoaded = false;

  // the services
  let services: StoreService[] | "loading" | "failed" = "loading";
  let servicesLoaded = false;
  let waitingService: string | null = null;
  let connectFailed: string | null = null;

  // the abilities
  let abilities: AbilityRow[] | "loading" | "failed" = "loading";
  let abilitiesLoaded = false;
  let brain: BrainSettings | null = null;
  let abilityBusy: string | null = null;

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
        return welcomeHTML({
          rerun: mode === "rerun",
          languageSelect: sel(UI_LANGUAGES, device().ui_language, t("settings.059"), ' data-ob="lang"'),
        });
      case "tools":
        return toolsHTML(accounts.view(), { ...key, error: keyError?.() ?? null }, accountsError(), providers.view());
      case "services":
        return servicesHTML({ services, waiting: waitingService, failed: connectFailed });
      case "abilities":
        return abilitiesHTML({ rows: abilities, busy: abilityBusy });
    }
  }

  /** What stopped the last ChatGPT sign-in, in the owner's words (the account controller keeps it). */
  const accountsError = (): string => accounts.view().chatgptError;

  const topHTMLNow = (): string => topHTML({ segments: segments(flow), back: flow.step !== "welcome" || mode === "rerun" });

  function footHTML(): string {
    const label = flow.step === "welcome" ? "onboarding.start" : isLast(flow) ? (mode === "rerun" ? "onboarding.finishRerun" : "onboarding.finish") : "onboarding.next";
    return actionRow({ cls: "ob-actions", primary: { label: esc(t(label)), attrs: ` data-ob="next"${finishing ? " disabled" : ""}` } });
  }

  function paintFoot(): void {
    const foot = root.querySelector<HTMLElement>(".ob-foot");
    if (foot) foot.innerHTML = footHTML();
  }

  /** Draws the whole screen. */
  function render(): void {
    stage?.dispose();
    stage = null;
    closeMenu();
    const quiet = flow.step === "welcome" && mode === "first";
    root.dataset.step = flow.step;
    root.innerHTML =
      `<div class="ob-top${quiet ? " quiet" : ""}">${topHTMLNow()}</div>` +
      `<div class="ob-body"${flow.step === "welcome" ? " data-welcome" : ""}><div class="ob-col">${bodyHTML()}</div></div>` +
      `<div class="ob-foot">${footHTML()}</div>`;
    enterScreen();
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
  }

  function enterScreen(): void {
    switch (flow.step) {
      case "welcome": {
        const canvas = root.querySelector<HTMLCanvasElement>("canvas.emb");
        const subs = root.querySelector<HTMLElement>(".subs");
        if (canvas && subs) {
          stage = new Stage(canvas, subs, () => {});
          stage.play();
        }
        break;
      }
      case "tools":
        accounts.start();
        void loadKey();
        void providers.load();
        break;
      case "services":
        if (!servicesLoaded || services === "failed") void loadServices();
        break;
      case "abilities":
        if (!abilitiesLoaded || abilities === "failed") void loadAbilities();
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
    stage?.dispose();
    stage = null;
    closeMenu();
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
    services = "loading";
    if (flow.step === "services") repaintBody();
    try {
      const [builtin, status] = await Promise.allSettled([api.integrationsCatalog(), api.connectorsStatus()]);
      if (destroyed) return;
      if (builtin.status !== "fulfilled") throw builtin.reason;
      let managed: StoreService[] = [];
      if (status.status === "fulfilled" && status.value.composio_configured) {
        try {
          managed = (await api.connectorsCatalog()).items.map((item) => storePlugin(item, status.value.connectors));
        } catch {
          // the managed apps are a bonus: the built-in ones are enough to go on
        }
      }
      services = pickServices(builtin.value.services, managed);
      servicesLoaded = true;
    } catch {
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
      if (result.connected) {
        const serverId = "server" in result ? result.server.id : (result.connector?.id ?? `composio:${id}`);
        if (Array.isArray(services)) services = services.map((s) => (s.id === id ? { ...s, server_id: serverId } : s));
      } else if (result.error !== "cancelled") {
        connectFailed = t("onboarding.connFailed");
      }
    } catch (err) {
      connectFailed = describeError(err);
    }
    waitingService = null;
    if (!destroyed && flow.step === "services") repaintBody();
  }

  // ---------- the abilities ----------

  async function loadAbilities(): Promise<void> {
    abilities = "loading";
    if (flow.step === "abilities") repaintBody();
    try {
      const [status, settings] = await Promise.all([api.servicesStatus(), api.settingsGet()]);
      if (destroyed) return;
      brain = settings.settings;
      abilities = abilityRows(status, brain);
      abilitiesLoaded = true;
    } catch {
      abilities = "failed";
    }
    if (!destroyed && flow.step === "abilities") repaintBody();
  }

  async function toggleAbility(kind: string): Promise<void> {
    const entry = CAPABILITIES.find((c) => c.kind === kind);
    const row = Array.isArray(abilities) ? abilities.find((r) => r.kind === kind) : undefined;
    if (!entry || !row || abilityBusy !== null) return;
    abilityBusy = kind;
    repaintBody();
    try {
      brain = (await api.settingsSet(entry.enabled, !row.on)).settings;
      const status: ServicesStatus = await api.servicesStatus();
      if (!destroyed) abilities = abilityRows(status, brain);
    } catch (err) {
      toaster.info(describeError(err));
    }
    abilityBusy = null;
    if (!destroyed && flow.step === "abilities") repaintBody();
  }

  // ---------- events ----------

  function onAppEvent(event: MainEvent): void {
    if (!destroyed) accounts.followEvent(event);
  }
  const stopEvents = app.onEvent(onAppEvent);

  root.addEventListener("click", (e) => {
    if (destroyed) return;
    const target = e.target as Element;

    const choose = target.closest<HTMLElement>(".sel");
    if (choose) {
      if (choose.dataset.ob === "lang") {
        openMenu(choose, UI_LANGUAGES, device().ui_language, (value) => void app.setDevice({ ui_language: value as "zh-TW" | "en" | "ja" }).catch((err) => toaster.info(describeError(err))));
      }
      return;
    }

    // ChatGPT and the command-line accounts: the same controller, and the same buttons, as Settings > Models.
    if (flow.step === "tools" && target.closest("button[data-chatgpt], button[data-cli]")) {
      void accounts.click(target);
      return;
    }
    if (flow.step === "tools" && providers.click(target)) return;

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
        void api.integrationsConnectCancel().catch(() => {});
        break;
      case "conn-reload":
        void loadServices();
        break;
      case "ability":
        void toggleAbility(button.dataset.id ?? "");
        break;
      case "abilities-reload":
        void loadAbilities();
        break;
    }
  }, { signal });

  // The key is sent by Enter or 貼上 only, never by leaving the field (see keyfield.ts).
  root.addEventListener("keydown", (e) => {
    if (destroyed) return;
    if (flow.step === "tools" && providers.key(e)) return;
    openMenuOnArrow(e);
  }, { signal });
  root.addEventListener("input", (e) => {
    if (!destroyed && flow.step === "tools" && e.target instanceof HTMLInputElement) providers.input(e.target);
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
