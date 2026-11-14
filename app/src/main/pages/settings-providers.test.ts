// @vitest-environment happy-dom
// Exercise provider notifications through the real settings panel with a fake core API.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AppContext, MainEvent, ModelCatalog, SettingsPane } from "../types";
import { setLocale, t } from "../i18n";
import { Cleared } from "../cleared";
import * as analytics from "../usage-analytics";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(), settingsSet: vi.fn(), secretsStatus: vi.fn(), statusGet: vi.fn(), audioDevices: vi.fn(),
  desktopStatus: vi.fn(),
  historyList: vi.fn(), historyClear: vi.fn(), agentHistoryClear: vi.fn(), core: vi.fn(),
  keyboardHasAltgr: vi.fn(), languagesList: vi.fn(), modelsCatalog: vi.fn(), modelsLocal: vi.fn(), hotkeysPause: vi.fn(), audioMonitor: vi.fn(),
  providersKinds: vi.fn(), providersList: vi.fn(), providersModels: vi.fn(), providersAdd: vi.fn(), servicesStatus: vi.fn(),
  brainsCli: vi.fn(), brainsCliLogin: vi.fn(), brainsCliDisconnect: vi.fn(), openExternalUrl: vi.fn(),
  chatgptStatus: vi.fn(async () => ({ signed_in: false })), chatgptSignIn: vi.fn(), chatgptCancel: vi.fn(), chatgptSignOut: vi.fn(), chatgptModels: vi.fn(async () => ({ models: [] })),
  usageAllowances: vi.fn(),
}));
vi.mock("../api", () => api);
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "test" }));
import { createSettings } from "./settings";
const slideTo = (level: string): void => {
  const range = document.querySelector<HTMLInputElement>(".mc-range")!;
  range.value = String(range.dataset.levels!.split(",").indexOf(level));
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
};

const empty: ModelCatalog = { llm: [], stt: [], source: "builtin", fetched_at_ms: null, replaced: [] };
const direct: ModelCatalog = { ...empty, llm: [{
  id: "local:8b", name: "Local example", provider: "Meta", provider_id: "p4", provider_name: "Ollama",
  input_per_mtok: null, output_per_mtok: null, per_minute: null, free: false, variable_price: false,
  context_length: 8192, created_at_ms: null, capabilities: {}, roles: { answer: { usable: true, reason: null }, cleanup: { usable: true, reason: null }, stt: { usable: true, reason: null } },
}] };
direct.stt = direct.llm;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const listeners = new Set<(event: MainEvent) => void>();
const send = (event: MainEvent) => { for (const listener of listeners) listener(event); };
let page: ReturnType<typeof createSettings>;
const closeSettings = vi.fn();
const go = vi.fn();
async function mount(open: SettingsPane = "models") {
  create();
  await page.show(open); await flush();
}
function create() {
  page = createSettings({
    device: () => ({ dictation_keys: ["AltRight"], agent_keys: ["AltRight+Space"], ui_language: "en", dictation_mode: "hold" }),
    onEvent: (handler: (event: MainEvent) => void) => { listeners.add(handler); return () => { listeners.delete(handler); }; },
    refreshDevice: async () => {}, undo: { begin: vi.fn() },
    go, closeSettings, cleared: new Cleared(),
  } as unknown as AppContext);
  document.body.append(page.el); page.el.hidden = false;
}
const click = (selector: string) => { const button = document.querySelector<HTMLButtonElement>(selector); expect(button, selector).not.toBeNull(); button!.click(); };

test("opening Settings and navigating back to Models starts at the top and a redraw preserves its position", async () => {
  await mount();
  const body = page.el.querySelector<HTMLElement>('.modal-body')!;
  body.scrollTop = 210;
  click('[data-pane="about"]'); click('[data-pane="models"]'); await flush();
  expect(body.scrollTop).toBe(0);
  body.scrollTop = 170;
  send({type:'SettingsChanged'}); await flush();
  expect(body.scrollTop).toBe(170);
  page.hide(); await page.show('models'); await flush();
  expect(body.scrollTop).toBe(0);
  body.scrollTop = 190;
  click('[data-models-tab="usage"]'); await flush();
  expect(body.scrollTop).toBe(0);
  body.scrollTop = 140;
  click('[data-models-tab="models"]'); await flush();
  expect(body.scrollTop).toBe(0);
});

test("快速提問 picks its effort inside the model list, as the answer model does, and saves model and effort apart", async () => {
  api.settingsGet.mockResolvedValue({ settings: { agent_model: "cli:codex", quick_model: "", quick_effort: "low" } });
  api.settingsSet.mockImplementation(async (key: string, value: string) => ({ settings: { agent_model: "cli:codex", quick_model: "", quick_effort: "low", [key]: value } }));
  api.brainsCli.mockResolvedValue({ clis: [{ id: "codex", name: "Codex", available: true, installed: true, logged_in: true,
    models: [{ id: "cli:codex:fast", name: "Fast", is_default: true, reasoning_efforts: ["medium", "low"] }] }] });
  await mount();
  expect(page.el.querySelector('[data-row="quick-model"]')!.textContent).toContain("Raphael's quick question");
  expect(page.el.querySelector('[data-row="quick-model"] .models-purpose-note')).toBeNull();
  expect(page.el.querySelector('[data-k="quick-model"] .mp-tname')!.textContent).toBe("Fast");
  expect(page.el.querySelector('[data-k="quick-model"] .mp-source')!.textContent).toContain("Codex");
  expect(page.el.querySelector('[data-price="quick-model"]')!.textContent).toBe(t("brains.subscription"));
  expect(page.el.querySelector('[data-row="quick-model"] [data-k="quick-effort"]')).toBeNull();
  // 與回答相同: the list shows the answer model's effort row, from the saved effort
  click('[data-k="quick-model"]');
  expect(document.querySelector('.model-chooser .mc-inherit')!.getAttribute("aria-pressed")).toBe("true");
  expect([...document.querySelectorAll<HTMLElement>('.model-chooser [data-effort]')].map(b => b.dataset.effort)).toEqual(["low", "medium", "", "", ""]);
  expect(document.querySelector('.model-chooser [data-effort="low"]')!.getAttribute("data-on")).toBe("true");
  slideTo("medium"); click('.model-chooser [data-dlg="use"]'); await flush();
  expect(api.settingsSet).toHaveBeenCalledWith("quick_model", "");
  expect(api.settingsSet).toHaveBeenLastCalledWith("quick_effort", "medium");
  // a model of its own starts quick (low) and takes its effort in the same list
  click('[data-k="quick-model"]'); click('[data-source="cli:codex"]');
  expect(document.querySelector('.model-chooser [data-dlg="sources"]')!.classList.contains("ghost")).toBe(false);
  click('.model-chooser [data-model="cli:codex:fast"]');
  expect(document.querySelector('.model-chooser [data-effort="low"]')!.getAttribute("data-on")).toBe("true");
  slideTo("medium"); click('.model-chooser [data-dlg="use"]'); await flush();
  expect(api.settingsSet).toHaveBeenCalledWith("quick_model", "cli:codex:fast");
  expect(api.settingsSet).toHaveBeenLastCalledWith("quick_effort", "medium");
  expect(page.el.querySelector('select')).toBeNull();
});

beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); listeners.clear(); setLocale("en");
  api.core.mockImplementation(async method => method === "memory.get" ? {text:"",revision:0} : method === "safety.rules.list" ? {rules:[]} : {});
  api.settingsGet.mockResolvedValue({ settings: { stt_engine: "cloud" } });
  api.secretsStatus.mockResolvedValue({ has_key: true });
  api.statusGet.mockResolvedValue({ openrouter: null, spend: null });
  api.audioDevices.mockResolvedValue({ devices: [], default_id: null });
  api.desktopStatus.mockResolvedValue({ state: "absent", ready: false, control: "member" });
  api.keyboardHasAltgr.mockResolvedValue(false);
  api.languagesList.mockResolvedValue({ groups: [] });
  api.modelsLocal.mockResolvedValue({ models: [] });
  api.modelsCatalog.mockResolvedValue(empty);
  api.providersKinds.mockResolvedValue({ kinds: [] });
  api.providersList.mockResolvedValue({ providers: [] });
  api.brainsCli.mockResolvedValue({ clis: [] });
  api.usageAllowances.mockResolvedValue({ brains: [{ id: "codex", name: "Codex", source: "live", windows: [{ period: "weekly", remaining_percent: 89, resets_at: 1792900000 }] }] });
  api.settingsSet.mockImplementation(async (key: string, value: string) => ({ settings: { stt_engine: "cloud", [key]: value } }));
});
afterEach(() => { page?.hide(); document.body.innerHTML = ""; setLocale("zh-TW"); });

test("keeps drawing and video unset until the owner chooses their separate paid models", async () => {
  await mount();
  for (const key of ["image-model", "video-model"]) {
    const row = page.el.querySelector(`[data-row="${key}"]`);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Not set");
    expect(row!.textContent).toContain("paid API");
    expect(row!.querySelector('.mp-source')!.textContent).toBe("");
  }
  expect(api.settingsSet).not.toHaveBeenCalled();
});

test("media selection uses the image-only catalog and repairs focus the exact row without saving", async () => {
  const image = { ...direct.llm[0], id: "test/image-only", name: "Image only", provider_id: "openrouter", provider_name: "OpenRouter", roles: {}, per_image: .04 };
  api.modelsCatalog.mockResolvedValue({ ...empty, image: [image], video: [] });
  api.providersList.mockResolvedValue({ providers: [{ id: "openrouter", kind: "openrouter", name: "OpenRouter", enabled: true, has_key: true }] });
  await mount();
  await page.show("repair:models:image"); await flush();
  expect(document.activeElement?.getAttribute("data-k")).toBe("image-model");
  expect(api.settingsSet).not.toHaveBeenCalled();
  click('[data-k="image-model"]');
  click('[data-model="test/image-only"]'); click('[data-dlg="use"]'); await flush();
  expect(api.settingsSet).toHaveBeenLastCalledWith("image_model", "test/image-only");
  expect(page.el.querySelector('[data-row="image-model"]')!.textContent).toContain("$0.04 per image");
  await page.show("repair:models:video"); await flush();
  expect(document.activeElement?.getAttribute("data-k")).toBe("video-model");
  expect(page.el.querySelector('[data-row="video-model"]')!.textContent).toContain("No models available");
});

test("profile notifications update idle fields and preserve the field currently being typed", async () => {
  api.settingsGet.mockResolvedValue({ settings: { stt_engine: "cloud", owner_name: "Before", owner_about: "Before" } });
  await mount("general");
  const about = page.el.querySelector<HTMLTextAreaElement>('[data-owner="owner_about"]')!;
  about.focus(); about.value = "My unfinished description";
  api.settingsGet.mockResolvedValue({ settings: { stt_engine: "cloud", owner_name: "Updated elsewhere", owner_about: "Updated elsewhere" } });
  send({ type: "SettingsChanged" }); await flush();
  expect(page.el.querySelector<HTMLInputElement>('[data-owner="owner_name"]')!.value).toBe("Updated elsewhere");
  expect(page.el.querySelector<HTMLTextAreaElement>('[data-owner="owner_about"]')!.value).toBe("My unfinished description");
  expect(document.activeElement).toBe(page.el.querySelector('[data-owner="owner_about"]'));
});

test("outside gestures close the provider or chooser before settings, preserving inside-start selections", async () => {
  await mount(); click('[data-pv="directory"]');
  const outside = (start: Element, end = start) => {
    start.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true }));
    end.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, isPrimary: true }));
    end.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  };
  const providerScrim = (): Element => page.el.querySelector(".cs-scrim[data-pv]")!;
  outside(page.el.querySelector("#pv-dialog")!, providerScrim());
  expect(page.el.querySelector("#pv-dialog")).not.toBeNull();
  send({ type: "ProvidersChanged" }); await flush();
  outside(providerScrim());
  expect(page.el.querySelector("#pv-dialog")).toBeNull(); expect(closeSettings).not.toHaveBeenCalled();
  click('[data-model-picker="answer"] .mp-trigger');
  outside(document.querySelector(".model-chooser")!.parentElement!);
  expect(document.querySelector(".model-chooser")).toBeNull(); expect(closeSettings).not.toHaveBeenCalled();
  outside(page.el); expect(closeSettings).toHaveBeenCalledOnce();
});

test("models in use precede subscription accounts and providers, login uses the core, and live readiness refreshes only the answer picker", async () => {
  const claude = { id: "claude", name: "Claude Code", disconnected: false, installed: true, logged_in: false, available: false, models: [], login_command: "claude auth login" };
  api.brainsCli.mockResolvedValue({ clis: [claude] });
  api.brainsCliLogin.mockResolvedValue({ started: true });
  await mount();
  const sections = [...page.el.querySelectorAll(".models-content > section h2")].map((el) => el.textContent);
  expect(sections.slice(0, 3)).toEqual(["Models in use", "Subscription accounts", "Providers"]);
  click('[data-cli="claude"]'); await flush();
  expect(api.brainsCliLogin).toHaveBeenCalledWith("claude");
  api.brainsCli.mockResolvedValue({ clis: [{ ...claude, logged_in: true, available: true, version: "2.1", models: [{ id: "cli:claude:sonnet", name: "Claude Sonnet", is_default: true }] }] });
  send({ type: "BrainsChanged" }); await flush();
  expect(page.el.querySelector('.cli-card:not([data-chatgpt-card])')!.textContent).toContain("Signed in · v2.1");
  expect(page.el.querySelector('[data-cli="claude"]')).toBeNull();
  click('[data-model-picker="answer"] .mp-trigger');
  expect(document.querySelector('[data-source="cli:claude"]')).not.toBeNull();
  click('[data-source="cli:claude"]'); click('.mp-opt[data-id="cli:claude:sonnet"]'); click('[data-dlg="use"]'); await flush();
  expect(api.settingsSet).toHaveBeenCalledWith("quick_model", "cli:claude:sonnet");
  click('[data-model-picker="cleanup"] .mp-trigger');
  expect(document.querySelector('[data-source="cli:claude"]')).toBeNull();
});

test.each(["usage", "models"] as const)("%s opens the single Models pane without exposing saved fallback settings", async (alias) => {
  api.settingsGet.mockResolvedValue({ settings: { stt_engine: "cloud", cleanup_fallbacks: ["@p1:private-chain"] } });
  await mount(); await page.show(alias); await flush();
  expect(page.pane()).toBe("models");
  expect(page.el.querySelectorAll('.set-list [data-pane="models"]')).toHaveLength(1);
  expect(page.el.querySelector('.set-list [data-pane="usage"]')).toBeNull();
  expect(page.el.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-models-tab")).toBe(alias);
  expect(page.el.querySelectorAll('[data-model-picker]')).toHaveLength(alias === "models" ? 5 : 0);
  expect(page.el.querySelector('[data-fallback-purpose]')).toBeNull();
  expect(page.el.textContent).not.toContain("Fallback models");
  expect(api.settingsSet).not.toHaveBeenCalled();
});

test("settings delegates the CLI row menu and refreshes an open model chooser on disconnect", async () => {
  const claude = { id: "claude", name: "Claude Code", installed: true, logged_in: true, available: true, disconnected: false, models: [{ id: "cli:claude:sonnet", name: "Claude Sonnet" }], login_command: "claude auth login" };
  api.brainsCli.mockResolvedValue({ clis: [claude] });
  await mount();
  click('[data-cli-menu="claude"]');
  expect(document.querySelector('#app-popover.mb-menu [data-pick="disconnect"]')?.textContent).toContain("Disconnect");
  api.brainsCli.mockResolvedValue({ clis: [{ ...claude, available: false, disconnected: true, models: [] }] });
  click('#app-popover [data-pick="disconnect"]'); await flush();
  expect(api.brainsCliDisconnect).toHaveBeenCalledExactlyOnceWith("claude");
  expect(page.el.querySelector('[data-cli="claude"]')?.textContent).toBe("Connect");
  click('[data-model-picker="answer"] .mp-trigger');
  click('[data-source="cli:claude"]');
  expect(document.querySelectorAll('.mc-row')).toHaveLength(0);
  expect(document.querySelector('.mc-pane')?.textContent).toContain("Disconnected");
  api.brainsCli.mockResolvedValue({ clis: [claude] });
  send({ type: "BrainsChanged" }); await flush();
  expect(document.querySelector('.mc-row')?.textContent).toContain("Claude Sonnet");
  expect(closeSettings).not.toHaveBeenCalled();
});

test("Models contains no spending and Usage mounts its allowances once, plainly, across tabs and redraws", async () => {
  const mountAnalytics = vi.spyOn(analytics, "mountUsageAnalytics");
  await mount();
  expect(page.el.querySelector("#set-title")?.textContent).toBe("Models & usage");
  expect(page.el.querySelector('[data-row="openrouter-usage"]')).toBeNull();
  expect(page.el.querySelector('[data-row="raphael-spend"]')).toBeNull();
  // Opening Settings read the allowances already, on the tab that was not the usage.
  expect(mountAnalytics).toHaveBeenCalledTimes(1);
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
  click('[data-models-tab="usage"]'); await flush();
  expect(mountAnalytics).toHaveBeenCalledTimes(1);
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
  // Only what the app itself spent: an OpenRouter account's usage is read on OpenRouter.
  expect(page.el.querySelector('[data-row="openrouter-usage"]')).toBeNull();
  const spend = page.el.querySelector('[data-row="raphael-spend"]')!;
  expect(spend.classList.contains("spend-card")).toBe(true);
  expect(page.el.querySelector('[data-pv="directory"]')).toBeNull();
  const node = page.el.querySelector(".usage-analytics")!;
  // This month's spending leads in a card, then the allowances, and nothing else is on the page.
  expect(spend.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // No refresh button anywhere on the tab, and nothing beside its name: opening Settings reads it all.
  expect(node.querySelector("button.icon")).toBeNull();
  expect(page.el.querySelector('[data-act="models-refresh"], .set-head, .models-refresh')).toBeNull();
  expect(page.el.querySelector(".set-content > h1")?.nextElementSibling?.classList.contains("models-page")).toBe(true);
  expect(page.el.querySelector(".ua-chart, .run-tiles, .run-bill, [data-range], .foot")).toBeNull();
  setLocale("ja"); await flush();
  expect(page.el.querySelector(".usage-analytics")).toBe(node);
  click('[data-models-tab="models"]');
  expect(page.el.querySelector(".usage-analytics")).toBeNull();
  click('[data-models-tab="usage"]'); await flush();
  expect(page.el.querySelector(".usage-analytics")).toBe(node);
  expect(mountAnalytics).toHaveBeenCalledTimes(1);
});

test("the allowances are kept across tabs and Settings closing, refresh on completed activity while visible, and are read again by the next opening", async () => {
  const mountAnalytics = vi.spyOn(analytics, "mountUsageAnalytics");
  await mount(); click('[data-models-tab="usage"]'); await flush();
  const first = mountAnalytics.mock.results[0].value;
  const destroyed = vi.spyOn(first, "destroy");
  const calls = api.usageAllowances.mock.calls.length;
  send({ type: "ProvidersChanged" }); await flush();
  send({ type: "AgentTurn", turn_id: 42 }); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(calls + 2);
  click('[data-models-tab="models"]');
  send({ type: "AgentTurn", turn_id: 43 }); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(calls + 2);
  // Leaving the tab keeps what was read and reads nothing; closing Settings keeps it too, and the next opening reads once.
  click('[data-pane="general"]'); click('[data-pane="models"]'); click('[data-models-tab="usage"]'); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(calls + 2);
  page.hide(); await page.show("models"); click('[data-models-tab="usage"]'); await flush();
  expect(destroyed).not.toHaveBeenCalled();
  expect(mountAnalytics).toHaveBeenCalledTimes(1);
  expect(api.usageAllowances).toHaveBeenCalledTimes(calls + 3);
  // Every opening starts afresh (owner, 2026-11-15): 模型與用量 is at 模型 again, not at the 用量 looked at last.
  await page.show("general"); click('[data-pane="models"]'); await flush();
  expect(page.el.querySelector('[data-models-tab="models"][aria-selected="true"]')).not.toBeNull();
  await page.show("usage");
  expect(page.el.querySelector('[data-models-tab="usage"][aria-selected="true"]')).not.toBeNull();
  await page.show("models");
  expect(page.el.querySelector('[data-models-tab="models"][aria-selected="true"]')).not.toBeNull();
});

test("the models' usage is read once after the app starts, before Settings is ever opened, and again at the opening", async () => {
  // Owner, 2026-11-15: 「在打開 app 的時候就跑一次，之後才是每次設定的時候再跑一次」.
  vi.useFakeTimers();
  try {
    const mountAnalytics = vi.spyOn(analytics, "mountUsageAnalytics");
    create(); page.el.hidden = true;
    await page.preload();
    await vi.advanceTimersByTimeAsync(3100);
    expect(mountAnalytics).toHaveBeenCalledTimes(1);
    expect(api.usageAllowances).toHaveBeenCalledTimes(1);
    page.el.hidden = false;
    void page.show("general");
    await vi.advanceTimersByTimeAsync(10);
    expect(api.usageAllowances).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

const cardsOf = (): string[] => [...document.querySelectorAll(".usage-analytics .run-subscription")].map(card => card.textContent ?? "");

test("every opening of Settings reads the allowances again at once, on any tab, and none of it is seen", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const mountAnalytics = vi.spyOn(analytics, "mountUsageAnalytics");
    const windowsOf = (left: number) => ({ brains: [{ id: "codex", name: "Codex", source: "live", windows: [{ period: "weekly", remaining_percent: left, resets_at: 1792900000 }] }] });
    api.usageAllowances.mockResolvedValue(windowsOf(89));
    // Opened on 一般: the reading starts with the opening, before the tab with the allowances is ever reached.
    await mount("general");
    expect(page.pane()).toBe("general");
    expect(mountAnalytics).toHaveBeenCalledTimes(1);
    expect(api.usageAllowances).toHaveBeenCalledTimes(1);
    expect(page.el.querySelector('[data-act="models-refresh"]')).toBeNull();
    click('[data-pane="models"]'); click('[data-models-tab="usage"]');
    // The numbers are on the page the moment the tab is: nothing is waited for.
    expect(cardsOf()).toHaveLength(1);
    expect(cardsOf()[0]).toContain("89%");
    expect(document.querySelector(".usage-analytics")!.getAttribute("aria-busy")).toBe("false");
    expect(api.usageAllowances).toHaveBeenCalledTimes(1);

    // Opened again at once after a good reading: the allowances are asked again all the same (owner, 2026-11-12: a reset
    // must show at the very next opening), however soon, and the same numbers touch nothing.
    page.hide(); await page.show("safety"); await flush();
    expect(api.usageAllowances).toHaveBeenCalledTimes(2);

    // On another tab, a new value replaces the old one in place: the same card, no busy state at any moment.
    api.usageAllowances.mockResolvedValue(windowsOf(72));
    page.hide(); await page.show("models"); click('[data-models-tab="usage"]');
    const card = document.querySelector(".usage-analytics .run-subscription");
    const busy: string[] = [];
    const watch = new MutationObserver(() => busy.push(document.querySelector(".usage-analytics")!.getAttribute("aria-busy") ?? ""));
    watch.observe(document.querySelector(".usage-analytics")!, { attributes: true, attributeFilter: ["aria-busy"], subtree: true });
    await flush();
    watch.disconnect();
    expect(api.usageAllowances).toHaveBeenCalledTimes(3);
    expect(busy).not.toContain("true");
    expect(cardsOf()[0]).toContain("72%");
    expect(document.querySelector(".usage-analytics .run-subscription")).toBe(card);
    expect(document.querySelector(".toast, [role=status]")).toBeNull();
    expect(mountAnalytics).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

test("a window that was reset shows its higher number at the very next opening, with no wait between two openings", async () => {
  const weekly = (left: number) => ({ brains: [{ id: "claude", name: "Claude", source: "live", windows: [{ period: "weekly", remaining_percent: left, resets_at: 1792900000 }] }] });
  api.usageAllowances.mockResolvedValue(weekly(4));
  await mount("models"); click('[data-models-tab="usage"]'); await flush();
  expect(cardsOf()[0]).toContain("4%");
  const asked = api.usageAllowances.mock.calls.length;
  api.usageAllowances.mockResolvedValue(weekly(29));
  page.hide(); await page.show("models"); click('[data-models-tab="usage"]'); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(asked + 1);
  expect(cardsOf()[0]).toContain("29%");
  expect(cardsOf()[0]).not.toContain("4% ");
});

test("a reading at an opening that finds the same numbers touches nothing, and one that fails keeps what is shown without a word", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    await mount("models"); click('[data-models-tab="usage"]'); await flush();
    const root = document.querySelector(".usage-analytics")!;
    const before = root.innerHTML, card = root.querySelector(".run-subscription");
    const touched: MutationRecord[] = [];
    const watch = new MutationObserver(records => touched.push(...records));
    watch.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
    vi.setSystemTime(Date.now() + 31_000);
    page.hide(); await page.show("models"); click('[data-models-tab="usage"]'); await flush();
    expect(api.usageAllowances).toHaveBeenCalledTimes(2);
    expect(touched).toEqual([]);
    expect(root.innerHTML).toBe(before);
    expect(root.querySelector(".run-subscription")).toBe(card);
    // The core does not answer at the next opening: the page still shows what it last knew, and says nothing about it.
    vi.setSystemTime(Date.now() + 31_000);
    api.usageAllowances.mockRejectedValue(new Error("offline"));
    page.hide(); await page.show("models"); click('[data-models-tab="usage"]'); await flush();
    expect(api.usageAllowances).toHaveBeenCalledTimes(3);
    watch.disconnect();
    expect(touched).toEqual([]);
    expect(document.querySelector(".usage-analytics")!.innerHTML).toBe(before);
    expect(document.querySelector(".toast, [role=status]")).toBeNull();
    // A failed reading is tried again at the very next opening, not kept for the reuse window.
    api.usageAllowances.mockResolvedValue({ brains: [] });
    page.hide(); await page.show("models"); await flush();
    expect(api.usageAllowances).toHaveBeenCalledTimes(4);
  } finally { vi.useRealTimers(); }
});

test("an opening while a reading is under way joins it instead of asking again", async () => {
  let finish!: (value: unknown) => void;
  const result = await api.usageAllowances();
  api.usageAllowances.mockClear();
  api.usageAllowances.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await mount("general");
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
  page.hide(); await page.show("general"); page.hide(); await page.show("tools"); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
  expect(api.modelsCatalog.mock.calls.length).toBe(1);
  finish(result); await flush();
  click('[data-pane="models"]'); click('[data-models-tab="usage"]'); await flush();
  expect(cardsOf()).toHaveLength(1);
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
});

test("the shared tabs support arrow keys, and Settings has no search", async () => {
  await mount();
  const modelTab = page.el.querySelector<HTMLElement>('[data-models-tab="models"]')!;
  modelTab.focus(); modelTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await flush();
  expect((document.activeElement as HTMLElement).dataset.modelsTab).toBe("usage");
  expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  expect((document.activeElement as HTMLElement).dataset.modelsTab).toBe("models");
  expect(page.el.querySelector("#set-search")).toBeNull();
});

test("opening on the allowances waits for their first reading, other tabs never do, and leaving during it keeps the reading off the page", async () => {
  const result = await api.usageAllowances();
  let finish!: (value: unknown) => void;
  api.usageAllowances.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  create();
  let ready = false;
  const showing = Promise.resolve(page.show("usage")).then(() => { ready = true; });
  await flush();
  expect(ready).toBe(false);
  click('[data-pane="general"]');
  finish(result); await showing; await flush();
  expect(page.pane()).toBe("general");
  expect(page.el.querySelector(".usage-analytics")).toBeNull();
  const requests = api.usageAllowances.mock.calls.length;
  send({ type: "AgentTurn", turn_id: 44 }); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(requests);
  // Opened on another tab while the first reading is still out: the opening is not held up by it.
  page.hide();
  let pending!: (value: unknown) => void;
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 60_000);
    api.usageAllowances.mockImplementationOnce(() => new Promise((resolve) => { pending = resolve; }));
    let opened = false;
    void Promise.resolve(page.show("general")).then(() => { opened = true; });
    await flush();
    expect(api.usageAllowances).toHaveBeenCalledTimes(requests + 1);
    expect(opened).toBe(true);
    pending(result); await flush();
  } finally { vi.useRealTimers(); }
});

test("activity during the initial reading is coalesced into one refresh", async () => {
  const result = await api.usageAllowances();
  api.usageAllowances.mockClear();
  let finish!: (value: unknown) => void;
  api.usageAllowances.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await mount(); click('[data-models-tab="usage"]');
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
  send({ type: "AgentTurn", turn_id: 45 });
  send({ type: "AgentTurn", turn_id: 46 });
  send({ type: "Dictation", phase: "pasted", agent: false });
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
  finish(result); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(2);
});

test("a quota change the page's own reading caused does not start a second reading, one from elsewhere does", async () => {
  const result = await api.usageAllowances();
  api.usageAllowances.mockClear();
  let finish!: (value: unknown) => void;
  api.usageAllowances.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await mount(); click('[data-models-tab="usage"]');
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
  send({ type: "QuotaChanged" });
  finish(result); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(1);
  send({ type: "QuotaChanged" }); await flush();
  expect(api.usageAllowances).toHaveBeenCalledTimes(2);
});

test("the Models add action opens its searchable dialog of providers", async () => {
  api.providersKinds.mockResolvedValue({ kinds: [{ kind: "openai", name: "OpenAI", fields: ["key"], group: "official", available: true }] });
  await mount("models");
  await flush();
  expect(page.pane()).toBe("models");
  expect(page.el.querySelector('[data-pv="directory"]')).toBe(page.el.querySelector(".pv > .pv-grid")?.lastElementChild);
  click('[data-pv="directory"]');
  expect(page.el.querySelector('[role="dialog"] #pv-kind-search')).not.toBeNull();
  click('[data-pv="add"]');
  expect(page.el.querySelector('input[type="password"][id^="pv-"]')).not.toBeNull();
  click('[data-pv="back"]');
  expect(page.el.querySelector('[role="dialog"] #pv-kind-search')).not.toBeNull();
});

test("a late catalog response cannot undo a newer provider notification in an open picker", async () => {
  await mount(); click('[data-model-picker="answer"] .mp-trigger');
  let old!: (catalog: ModelCatalog) => void;
  api.modelsCatalog.mockImplementationOnce(() => new Promise((resolve) => { old = resolve; })).mockResolvedValueOnce(direct);
  send({ type: "ProvidersChanged" }); send({ type: "ProvidersChanged" }); await flush();
  click('[data-source="p4"]'); expect(document.querySelector(".mc-list")?.textContent).toContain("Local example");
  old(empty); await flush();
  expect(document.querySelector(".mc-list")?.textContent).toContain("Local example");
});

test.each([
  ["cleanup", "cleanup_model"], ["answer", "quick_model"], ["stt", "stt_cloud_model"],
])("the %s purpose stores provider refs and still accepts plain OpenRouter slugs", async (role, setting) => {
  api.modelsCatalog.mockResolvedValue(direct);
  await mount();
  click(`[data-model-picker="${role}"] .mp-trigger`);
  click('[data-source="p4"]'); click('[data-id="@p4:local:8b"]'); click('[data-dlg="use"]'); await flush();
  expect(api.settingsSet).toHaveBeenCalledWith(setting, "@p4:local:8b");
  const legacy = { ...direct, llm: direct.llm.map((model) => ({ ...model, id: "openai/example", provider_id: "openrouter", provider_name: "OpenRouter", name: "OpenRouter example" })) };
  legacy.stt = legacy.llm;
  api.modelsCatalog.mockResolvedValue(legacy);
  send({ type: "ProvidersChanged" }); await flush();
  click(`[data-model-picker="${role}"] .mp-trigger`);
  click('[data-source="openrouter"]'); click('[data-id="openai/example"]'); click('[data-dlg="use"]'); await flush();
  expect(api.settingsSet).toHaveBeenCalledWith(setting, "openai/example");
});

test("provider dropdowns and local JSON fields work through settings event delegation", async () => {
  api.providersList.mockResolvedValue({ providers: [] });
  api.providersKinds.mockResolvedValue({ kinds: [{ kind: "vertex", name: "Vertex", fields: ["service_account", "project", "location"], group: "official", available: true }] });
  await mount(); click('[data-pane="models"]'); await flush(); click('[data-pv="directory"]'); click('[data-pv="add"]');
  click('[data-pv-field="location"]');
  const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((node) => node.textContent?.includes("asia-east1"))!;
  expect(choice).toBeDefined(); choice.click();
  const area = page.el.querySelector<HTMLTextAreaElement>('textarea')!;
  area.value = '{"client_email":"test@example.com","private_key":"secret"}'; area.dispatchEvent(new Event("input", { bubbles: true }));
  const project = page.el.querySelector<HTMLInputElement>('[id$="-project"]')!;
  project.value = "project"; project.dispatchEvent(new Event("input", { bubbles: true }));
  api.providersAdd.mockRejectedValue(new Error("failed")); click('[data-pv="save"]'); await flush();
  expect(api.providersAdd).toHaveBeenCalledWith({ kind: "vertex", name: "Vertex", location: "asia-east1", project: "project", service_account: '{"client_email":"test@example.com","private_key":"secret"}' });
});

test("pickers opened outside Models include enabled connections with zero models for their role", async () => {
  api.modelsCatalog.mockResolvedValue(direct);
  api.providersList.mockResolvedValue({ providers: [{ id: "p9", kind: "ollama", name: "Empty server", enabled: true, has_key: false, base_url: "http://localhost:11434/v1", status: "unknown", models: 0 }] });
  api.servicesStatus.mockResolvedValue({
    search: { enabled: true, service: "openrouter", options: [] }, read: { enabled: true, service: "builtin", options: [] },
    pdf: { enabled: true, service: "builtin", options: [] },
    vision: { enabled: true, model: "", resolved_model: "example", supports_images: true },
  });
  await mount("agent");
  click('button[data-svc="open"][data-id="vision"]');
  click('button[data-svc="service"][data-service="model"]');
  click('[data-model-picker="vision"] .mp-trigger');
  expect(document.querySelector('[data-source="p9"]')?.textContent).toBe("Empty serverLocal · 0 models");
});

test("vision keeps its primary image picker without fallback controls", async () => {
  const visionCatalog = { ...direct, llm: direct.llm.map((m) => ({ ...m, capabilities: { input_modalities: ["text", "image"] } })) };
  api.modelsCatalog.mockResolvedValue(visionCatalog);
  api.servicesStatus.mockResolvedValue({
    search: { enabled: true, service: "openrouter", options: [] }, read: { enabled: true, service: "builtin", options: [] },
    pdf: { enabled: true, service: "builtin", options: [] },
    vision: { enabled: true, model: "", resolved_model: "example", supports_images: true },
  });
  await mount(); click('[data-pane="tools"]'); await flush();
  click('button[data-svc="open"][data-id="vision"]');
  click('button[data-svc="service"][data-service="model"]');
  expect(page.el.querySelector('[data-fallback-purpose]')).toBeNull();
  expect(page.el.querySelectorAll('[data-model-picker="vision"]')).toHaveLength(1);
  click('[data-model-picker="vision"] .mp-trigger');
  click('[data-source="p4"]'); click('[data-id="@p4:local:8b"]'); click('[data-dlg="use"]'); await flush();
  expect(api.settingsSet).toHaveBeenCalledWith("vision_model", "@p4:local:8b");
});

