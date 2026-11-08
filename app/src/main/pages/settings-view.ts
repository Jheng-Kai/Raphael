// What the settings panel draws (settings.ts holds the state and the events): the tabs, and each
// tab as HTML made from a snapshot of what the panel knows. Nothing here reads the page or calls
// the app, so the structure of every tab and the rules for it can be tested without a
// browser.
//
// The rules for every row: a choice among options is a dropdown (`sel`, never the options
// in a row), an action is a button with a shape (`btn`, never a word that can be clicked), and a
// line under a row's name only where the setting would otherwise be set wrong. Each tab opens with
// its name, then its rows in a few named sections, each a rounded card (Grok Bot's settings, owner 2026-11-07).
//
// Six tabs sit flat on the left, as Grok Bot's: 一般 (account, appearance, the bot's timezone and folder, messaging,
// memory), 聽寫與快捷鍵, 工具, 安全, 模型與用量 and 關於. No group names, no search, no line under a tab's name.

import { LOCALES, t } from "../i18n";
import { updateHTML } from "../updates";
import { detectedTimezone, zoneLabel } from "../timezones";
import { ownerProfileHTML } from "../owner-settings";

import { brandIcon } from "../brand";
import { type ConnectionsView, connectionsHTML } from "../connections";
import { DICTATION_MODES } from "../dictation";
import { KEEP_FOREVER_DAYS, formatClock, formatRetention, formatUsd } from "../format";
import { type LanguageGroup, languageSelectHTML, normalizeLanguages } from "../languages";
import { bindingLabels } from "../keys";
import { type MemoryView, memoryHTML } from "../memory-view";
import { type RulesView, rulesHTML } from "../safety-rules";
import { type VaultView, emptyVaultView, vaultHTML } from "../vault";
import { AUTO_MICROPHONE, microphoneChoices } from "../microphone";
import type { LocalView } from "../local-models";
import { type ModelPickerLook, modelPickerHTML, modelsFor, planRef, priceDescription, splitEffort } from "../model-picker";
import { type ServicesView, servicesHTML } from "../services";
import { type ProvidersView, providersHTML, providersAddHTML, emptyProvidersView } from "../providers";
import { type CliBrainsView, cliBrainsHTML, cliModels, emptyCliBrainsView } from "../cli-brains";
import { pricingNote } from "../pricing";
import type { HotkeyField } from "../hotkey-recording";
import type { AudioDevices, BrainSettings, DeviceSettings, LocalModel, ModelCatalog, ModelRole, SettingsPane, Status } from "../types";
import { keyEntryRow, micRow } from "../setup-rows";
import { type Choice, type IconName, actionRow, btn, esc, ico, iconBtn, iconButton, keys, note, row, sel, st, tabs } from "../ui";

/** The models the core reads when none is chosen (brain/settings.py), shown while it does not answer. */
const DEFAULT_MODELS = { cleanup: "openai/gpt-6-luna", answer: "openai/gpt-6-luna", stt: "elevenlabs/scribe-v2" } as const;
/** One shared dropdown for the complete appearance preference. */
export const APPEARANCES: Choice[] = [
  { value: "system", get label() { return t("settings.013"); } },
  { value: "light", get label() { return t("settings.015"); } },
  { value: "dark", get label() { return t("settings.016"); } },
];
export const LOCAL_COMMAND_MODES: Choice[] = [
  { value: "ask", get label() { return t("local.ask"); } },
  { value: "always", get label() { return t("local.always"); } },
  { value: "never", get label() { return t("local.never"); } },
];
/** What one background task may spend (brain/settings.py, WORKER_COST_CAPS). */
export const WORKER_COST_CAPS: Choice[] = [
  { value: "0.1", label: "US$0.10" },
  { value: "0.2", label: "US$0.20" },
  { value: "0.5", label: "US$0.50" },
  { value: "1", label: "US$1.00" },
];
export const SIZES: Choice[] = [
  { value: "120", get label() { return t("settings.017"); }, get desc() { return t("settings.018"); } },
  { value: "150", get label() { return t("settings.019"); }, get desc() { return t("settings.020"); } },
  { value: "194", get label() { return t("settings.021"); }, get desc() { return t("settings.022"); } },
];
export const UI_LANGUAGES: Choice[] = LOCALES.map(({ id, native, english }) => ({ value: id, label: native, desc: english }));

/** How long the dictation history is kept: at least a day (the core only checks that it is a number); "keep" is a hundred years. */
export const RETENTIONS: Choice[] = [1, 7, 30, 365, KEEP_FOREVER_DAYS].map((days) => ({
  value: String(days),
  get label() { return formatRetention(days); },
}));

const PRICES_LOADING = () => t("settings.026");

/**
 * The tabs on the left of the panel, flat and in order, as Grok Bot's six (owner, 2026-11-07): appearance and messaging
 * are sections of 一般 now, and 連結應用程式 is no tab.
 */
export const PANES: { id: SettingsPane; icon: IconName; title: () => string }[] = [
  { id: "general", icon: "gear", title: () => t("settings.paneGeneral") },
  // What every member remembers of the owner, a tab of its own (owner, 2026-11-08: memory out of 一般).
  { id: "memory", icon: "memory", title: () => t("mem.title") },
  { id: "dictation", icon: "mic", title: () => t("settings.paneDictation") },
  { id: "tools", icon: "steps", title: () => t("settings.paneTools") },
  { id: "safety", icon: "lock", title: () => t("settings.paneSafety") },
  { id: "models", icon: "bot", title: () => t("settings.paneUsage") },
  { id: "about", icon: "info", title: () => t("common.about") },
  // Not a tab: the sidebar's 連結應用程式 opens it as a dialog of its own, its only way in (owner, 2026-11-06; R-UI-111).
  { id: "connections", icon: "plug", title: () => t("nav.apps") },
];

/** The pane that is not a tab of Settings but a dialog of its own, opened only from the sidebar. */
export const STANDALONE_PANE: SettingsPane = "connections";

/** The button of a tab in the list on the left. */
const paneButton = (p: (typeof PANES)[number]): string =>
  `<button type="button" class="nav" data-pane="${p.id}" aria-current="false">${ico(p.icon)}<span>${esc(p.title())}</span></button>`;

/** The tabs, flat, as Grok Bot's list. */
export const paneListHTML = (): string => PANES.filter((p) => p.id !== STANDALONE_PANE).map(paneButton).join("");

/** Where a link to a tab of before lands: Models for usage, Tools for the agent, 聽寫 for data, 一般 for appearance and messaging. */
export const canonicalPane = (id: SettingsPane): SettingsPane =>
  id === "usage" ? "models" : id === "agent" ? "tools" : id === "data" ? "dictation" : id === "appearance" || id === "messaging" ? "general" : id;
/** The name of a tab, in the language of the window. */
export const paneTitle = (id: SettingsPane): string => PANES.find((p) => p.id === canonicalPane(id))!.title();
export type ModelsTab = "models" | "usage";

/** The shortcuts recorded here, and the row of each. */
export const HOTKEY_ROWS: Record<HotkeyField, string> = { dictation_keys: "hotkey", agent_keys: "agent-hotkey" };

/** Everything a tab is drawn from: what the panel has read, and what is being typed or done. */
export interface SettingsView {
  update?: import("../api").UpdateView | null;
  modelsTab?: ModelsTab;
  /** What the refresh of 模型與用量 is doing. */
  modelsRefresh?: "idle" | "busy" | "done";
  pane: SettingsPane;
  device: DeviceSettings;
  /** The brain's settings; null while the core does not answer. */
  brain: BrainSettings | null;
  hasKey: boolean;
  openrouter: Status["openrouter"] | null;
  spend: Status["spend"] | null;
  /** OpenRouter's catalog of models (`models.catalog`): being read (`loading`), read, or not to be had (`failed`). */
  catalog: ModelCatalog | "loading" | "failed";
  checkingOpenrouter: boolean;
  devices: AudioDevices | null;
  /** The keyboard layout makes Right Alt an AltGr. */
  altgr: boolean;
  /** The app's version, as Tauri gives it; empty while it is not known. */
  version: string;
  /** The key field is shown although there is a key (「變更」). */
  replacingKey: boolean;
  keyBusy: boolean;
  keyError: (() => string) | null;
  /** What was typed in the limit field while it is not a limit, and what is wrong with it. */
  limitDraft: string | null;
  limitError: (() => string) | null;
  /** What is typed in the weather city while it is not saved, and what is wrong with it. */
  /** Telegram, in the 訊息平台 tab. */
  /** Members with a bot of their own, set up in each member's panel. */
  /** The shared safety rules, in Safety (none: not drawn). */
  rules?: RulesView;
  vault?: VaultView;
  /** Shared owner memory, in General (none: not drawn). */
  memoryShared?: MemoryView;
  /** Shared services, in Tools: who searches, reads pages and PDFs, and looks at images (none: not drawn). */
  services?: ServicesView;
  providers?: ProvidersView;
  cliBrains?: CliBrainsView;
  /** The languages the core offers (`languages.list`); null while unknown or when it cannot say. */
  languageGroups: LanguageGroup[] | null;
  /** The time the forecasts and the age of the prices are told from. */
  now: number;
  /** The 「連接」 tab: the groups of tools, the form that adds one, the latest actions. */
  connections: ConnectionsView;
  /** The speech models of this computer (`models.local`): being read, read, or not to be had. */
  localModels: LocalModel[] | "loading" | "failed";
  /** The download of one of them under way: bytes done of bytes in all (0 while the size is not known). */
  localDownload: { name: string; done: number; total: number } | null;
}

// ---------- what is chosen ----------

/** The chosen languages, never none. */
export const languagesOf = (v: SettingsView): string[] => normalizeLanguages(v.brain?.languages);
export const sttEngine = (v: SettingsView): string => v.brain?.stt_engine ?? "cloud";
export const sttModel = (v: SettingsView): string => v.brain?.stt_cloud_model ?? DEFAULT_MODELS.stt;
/** The model of the catalogue that is the local engine (Qwen3-ASR until the user chooses another). */
export const sttLocalModel = (v: SettingsView): string => v.brain?.stt_local_model ?? "qwen3-asr";
/** Whether the speech-to-text in use is this computer's, and not the cloud's. */
export const sttIsLocal = (v: SettingsView): boolean => sttEngine(v) === "local";
/** What the picker's local tab is drawn from. */
export const localView = (v: SettingsView): LocalView => ({
  models: v.localModels,
  active: sttIsLocal(v) ? sttLocalModel(v) : null,
  fallback: sttIsLocal(v) ? null : (v.brain?.stt_local_model ?? null),
  download: v.localDownload,
});
export const cleanupModel = (v: SettingsView): string => v.brain?.cleanup_model ?? DEFAULT_MODELS.cleanup;
export const agentModel = (v: SettingsView): string => v.brain?.agent_model ?? DEFAULT_MODELS.answer;
export const quickModels = (v: SettingsView) => [
  ...(catalogOf(v) ? modelsFor(catalogOf(v)!, "answer").filter(m => m.roles.answer?.usable &&
    v.providers?.providers.find(p => p.id === m.provider_id)?.enabled !== false) : []),
  ...cliModels(v.cliBrains?.clis ?? []),
];
/**
 * 快速提問's picker: the same as the answer model's, its effort inside the list. The core keeps the quick model and
 * its effort apart (`quick_model`, `quick_effort`), so the picker is handed both as one ref and the page splits the
 * choice again (`splitEffort`); under 「與回答相同」 the effort row is the answer model's.
 */
export const quickPickerLook = (v: SettingsView): ModelPickerLook => ({
  ...modelPickerLook(v, "answer"), key: "quick-model", label: t("settings.quickModel"),
  current: `${v.brain?.quick_model ?? ""}?effort=${v.brain?.quick_effort ?? "low"}`, inheritFrom: agentModel(v), defaultEffort: "low",
  lead: { id: "", name: t("services.sameAsAnswer") },
});
const quickRow = (v: SettingsView): string =>
  row(t("settings.quickModel"), priceSpan(v, "quick-model", "price num"),
    modelPickerHTML(quickPickerLook(v)), { cls: "row-model", attrs: ' data-row="quick-model"' });
/** What one background task may spend, as the value of its dropdown (the core's default is 0.2). */
export const workerCostCap = (v: SettingsView): string => String(v.brain?.worker_cost_cap_usd ?? 0.2);
/** The catalog once it is read. */
const catalogOf = (v: SettingsView): ModelCatalog | null => (typeof v.catalog === "object" ? v.catalog : null);

/** The microphones of the settings page, fitted to its dropdown. */
export const settingsMicrophones = (v: SettingsView): Choice[] => microphoneChoices(v.devices, v.device.microphone, true);

/** The bars of the microphone's meter: 3 px wide and about 2 px apart across its dropdown, as the short meter's are. */
const MIC_METER_SEGMENTS = 46;

// ---------- prices ----------

/** The full price of the model chosen for `role`, from the catalog: 「輸入 $0.10 / 輸出 $0.50 每百萬 token」. */
function chosenPrice(catalog: ModelCatalog, role: ModelRole, id: string): string {
  const models = modelsFor(catalog, role);
  const base = splitEffort(id, models).model;
  if (planRef(base)) return t("brains.subscription");
  const model = models.find((m) => m.id === base);
  return model ? priceDescription(model, role) : t("pricing.001");
}

/** The texts that depend on the prices, by the `data-price` of the element that shows them. */
export function priceTexts(v: SettingsView): Record<string, string> {
  const catalog = catalogOf(v);
  const local = sttIsLocal(v) ? t("settings.sttLocalPrice") : null;
  const quick = v.brain?.quick_model || agentModel(v);
  const quickSubscription = planRef(quick) ? t("brains.subscription") : null;
  if (v.catalog === "loading") return { model: PRICES_LOADING(), "quick-model": quickSubscription ?? PRICES_LOADING(), "stt-model": local ?? PRICES_LOADING(), note: "" };
  if (!catalog) return { model: "", "quick-model": quickSubscription ?? "", "stt-model": local ?? "", note: t("settings.030") };
  return {
    model: chosenPrice(catalog, "cleanup", cleanupModel(v)),
    "quick-model": quickSubscription ?? chosenPrice(catalog, "answer", quick),
    "stt-model": local ?? chosenPrice(catalog, "stt", sttModel(v)),
    note: pricingNote(catalog, v.now),
  };
}

const priceSpan = (v: SettingsView, k: string, cls = ""): string =>
  `<span${cls ? ` class="${cls}"` : ""} data-price="${k}">${esc(priceTexts(v)[k] ?? "")}</span>`;

// ---------- the model rows ----------
// A member's model is chosen in its own conversation, so nothing here says what any member answers on: the rows are
// Raphael's quick question, dictation and explicit paid media services. Each row stands alone: its name with the price of what is chosen under it, in full words, and the
// control, the model picker (model-picker.ts) of every OpenRouter model its role can use. The page
// draws the picker's button here; settings.ts makes it work. `k` names the control and its price.

/** What each picker is for: the `k` of its control and its price, and its name. The answer role has no row of its own: it lends 快速提問 its list. */
export const MODEL_ROWS: readonly { role: ModelRole | "image" | "video"; k: string; label: () => string }[] = [
  { role: "answer", k: "quick-model", label: () => t("settings.quickModel") },
  { role: "cleanup", k: "model", label: () => t("settings.035") },
  { role: "stt", k: "stt-model", label: () => t("settings.031") },
  { role: "image", k: "image-model", label: () => t("media.image") },
  { role: "video", k: "video-model", label: () => t("media.video") },
];

/**
 * What the picker of `role` is drawn from. Its button leaves the price out, which the row says
 * under its name, and it cannot be used while the core does not answer.
 */
export function modelPickerLook(v: SettingsView, role: ModelRole | "image" | "video"): ModelPickerLook {
  const { k, label } = MODEL_ROWS.find((r) => r.role === role)!;
  const media = role === "image" || role === "video";
  return {
    role,
    key: k,
    label: label(),
    current: media ? v.brain?.[role === "image" ? "image_model" : "video_model"] ?? "" : role === "stt" ? sttModel(v) : role === "cleanup" ? cleanupModel(v) : agentModel(v),
    catalog: catalogOf(v),
    providers: v.providers?.providers,
    clis: role === "answer" ? v.cliBrains?.clis : undefined,
    ...(role === "answer" ? { chatgpt: v.cliBrains?.chatgpt ?? null, chatgptError: v.cliBrains?.chatgptError ?? "" } : {}),
    loading: v.catalog === "loading",
    favorites: v.brain?.model_favorites?.[media ? "answer" : role as ModelRole] ?? [],
    ...(media ? { lead: { id: "", name: t("media.unset"), source: "" } } : {}),
    ...(role === "stt" ? { local: localView(v) } : {}),
    showPrice: false,
    disabled: v.brain === null,
  };
}

/**
 * What the 看圖片 picker of 服務 is drawn from: the language models, those that read images first,
 * under 「與回答相同」 (""). Its stars are the answer model's: the two choose among the same models,
 * and the core keeps favourites for its own roles only.
 */
export function visionPickerLook(v: SettingsView): ModelPickerLook {
  const status = typeof v.services?.status === "object" ? v.services.status : null;
  return {
    role: "vision",
    key: "svc-vision",
    label: t("services.vision"),
    current: status?.vision.model ?? v.brain?.vision_model ?? "",
    catalog: catalogOf(v),
    providers: v.providers?.providers,
    loading: v.catalog === "loading",
    favorites: v.brain?.model_favorites?.answer ?? [],
    lead: { id: "", name: t("services.sameAsAnswer") },
    showPrice: false,
    disabled: v.brain === null,
  };
}

/** A model row: the purpose, its price and the primary picker. */
export function mediaRowPrice(v: SettingsView, role: "image" | "video"): string {
  const chosen = v.brain?.[role === "image" ? "image_model" : "video_model"] ?? "";
  const models = catalogOf(v) ? modelsFor(catalogOf(v)!, role) : [];
  const model = models.find(m => m.id === chosen);
  return `${model ? priceDescription(model, role) : chosen ? t("media.unavailable") : t("media.unset")} · ${t("media.paid")}` +
    (!chosen && !models.length && v.catalog !== "loading" ? ` · ${t("media.none")}` : "");
}
const modelRow = (v: SettingsView, { role, k, label }: (typeof MODEL_ROWS)[number]): string =>
  row(label(), role === "image" || role === "video" ? `<span data-media-price="${role}">${esc(mediaRowPrice(v, role))}</span>` : priceSpan(v, k, "price num"),
    modelPickerHTML(modelPickerLook(v, role)), { cls: "row-model", attrs: ` data-row="${k}"` });

// ---------- the OpenRouter rows ----------

/** How the latest contact with OpenRouter went: a dot and a word, and the latency or the time of the check. */
function keyStatus(v: SettingsView): string {
  const { openrouter } = v;
  if (openrouter === null) return "";
  const more = (text: string): string => `<span class="status-more">${esc(text)}</span>`;
  switch (openrouter.state) {
    case "ok":
      return st("ok", t("settings.040")) + (openrouter.latency_ms !== null ? more(t("settings.041", { p0: openrouter.latency_ms })) : "");
    case "error":
      return (
        st("err", openrouter.error === "auth" ? t("settings.036") : t("settings.042")) +
        (openrouter.checked_at_ms !== null ? more(t("settings.043", { p0: formatClock(openrouter.checked_at_ms) })) : "")
      );
    default:
      return st("idle", t("settings.044"));
  }
}

/** The key: with one, how OpenRouter took it and the buttons to check again or change it; without, the field to paste one. */
function keyRow(v: SettingsView): string {
  const attrs = ' data-row="openrouter-key"';
  if (v.hasKey && !v.replacingKey) {
    return row(
      t("common.apiKey"),
      keyStatus(v),
      actionRow({
        secondary: btn(v.checkingOpenrouter ? t("common.checking") : t("settings.046"), "", ` data-act="or-check"${v.checkingOpenrouter ? " disabled" : ""}`) +
          // Changing it is the pencil, as everywhere (owner, 2026-11-08: icons over text buttons).
          iconBtn("pencil", t("home.018"), ' data-act="key-replace" data-k="key"'),
      }) + iconButton("more", t("members.more", { p0: t("common.apiKey") }), ' data-act="key-menu" aria-haspopup="menu" aria-expanded="false"'),
      { attrs, cls: "row-key" },
    );
  }
  return keyEntryRow({
    desc: t("settings.039"),
    fieldWidth: 200,
    inputId: "key-input",
    hook: (name) => ` data-act="${name}"`,
    busy: v.keyBusy,
    invalid: v.keyError !== null,
    canCancel: v.hasKey,
    row: { attrs, cls: "row-key" },
  });
}

/**
 * What this app spent this month, as Grok Bot's usage card (owner, 2026-11-07): the amount, how much of the monthly limit
 * it is, as a bar in a member's colour, and where the month ends at this pace. Only the app's own spending: an OpenRouter
 * account's usage is the owner's to read on OpenRouter.
 */
function spendCardHTML(v: SettingsView): string {
  const { spend } = v;
  if (!spend) return `<section class="spend-card" data-row="raphael-spend"><h2>${esc(t("settings.050"))}</h2><p class="spend-note">${esc(t("settings.usageUnavailable"))}</p></section>`;
  const limit = Number.isFinite(spend.limit_usd) && spend.limit_usd > 0 ? spend.limit_usd : null;
  const share = limit ? Math.round(Math.max(0, Math.min(100, spend.month_usd / limit * 100))) : null;
  const forecast = Number.isFinite(spend.forecast_usd) && spend.forecast_usd > spend.month_usd ? spend.forecast_usd : null;
  return `<section class="spend-card" data-row="raphael-spend"><h2>${esc(t("settings.050"))}</h2>` +
    `<p class="spend-value"><strong class="num">${esc(formatUsd(spend.month_usd))}</strong>${share !== null ? `<small>${esc(t("overview.used", { p0: share }))}</small>` : ""}</p>` +
    (share !== null ? `<div class="spend-bar" role="progressbar" aria-label="${esc(t("settings.050"))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}"><i style="width:${share}%"></i></div>` : "") +
    `<p class="spend-note">${[limit ? esc(t("settings.spendLimit", { p0: formatUsd(limit) })) : "", forecast ? esc(t("settings.spendForecast", { p0: formatUsd(forecast) })) : ""].filter(Boolean).join(" · ")}</p>` +
    `</section>`;
}

// ---------- the parts of every tab ----------

/** A group of settings: a short name, then its rows on one card. */
const section = (title: string, rows: string[], foot = ""): string =>
  `<section class="sgroup">${title ? `<h2>${esc(title)}</h2>` : ""}<div class="slist">${rows.join("")}</div>` +
  (foot ? `<p class="foot">${foot}</p>` : "") +
  `</section>`;

/**
 * A shortcut: its keys as caps and, for one that can be changed here, a pencil (「變更」) that records
 * new ones (`change` names the button for the click handler and the focus).
 */
function shortcutRow(name: string, bindings: readonly string[], change?: { act: string; field: HotkeyField }): string {
  const caps = bindings.length > 0
    ? bindings.map((binding) => keys(bindingLabels(binding))).join(t("common.or"))
    : `<span class="val">${esc(t("home.noKeys"))}</span>`;
  return row(
    name,
    "",
    `<span class="caps">${caps}</span>` + (change ? iconBtn("pencil", t("home.018"), ` data-act="${change.act}" data-k="${change.act}"`) : ""),
    { cls: "row-shortcut", attrs: change ? ` data-row="${HOTKEY_ROWS[change.field]}"` : "" },
  );
}

/** The warning under a shortcut whose keys hold Right Alt, on a keyboard layout that makes that key AltGr. */
const altgrNote = (v: SettingsView, bindings: readonly string[]): string[] =>
  v.altgr && bindings.some((binding) => binding.split("+").includes("AltRight")) ? [note(st("warn", t("settings.054")))] : [];

/**
 * The pane title receives focus when settings open. Actions share its row.
 */
export const headingHTML = (v: SettingsView, actions = ""): string => {
  // A tab is its name alone, as Grok Bot's: no line under it (owner, 2026-11-07).
  const title = `<h1 id="set-title" tabindex="-1">${esc(paneTitle(v.pane))}</h1>`;
  return actions ? `<div class="set-head">${title}${actions}</div>` : title;
};

/** What the tabs that need the core say when it does not answer. */
const coreNote = (v: SettingsView): string => (v.brain === null ? `<div class="alert core-note">${st("err", t("settings.052"))}</div>` : "");

// ---------- the tabs ----------

/**
 * The output folder as a folder picker of Claude's or ChatGPT's (owner, 2026-11-07): no text field. Unset, it is 選擇資料夾 alone;
 * set, the button names the folder and the whole path stands under the row's name, so where it is stays plain.
 */
function outputFolderRow(v: SettingsView): string {
  const folder = v.brain?.owner_output_folder ?? "", off = v.brain === null ? " disabled" : "";
  if (!folder) return row(t("output.folder"), esc(t("output.helpPick")), btn(ico("folder") + esc(t("output.pick")), "sm", ` data-act="output-pick"${off}`), { attrs: ' data-row="output-folder"' });
  const name = folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder;
  return row(t("output.folder"), `<span class="output-path">${esc(folder)}</span>`,
    btn(ico("folder") + `<span class="output-name">${esc(name)}</span>`, "sm output-chosen", ` data-act="output-pick" aria-label="${esc(t("output.change", { p0: name }))}"${off}`),
    { attrs: ' data-row="output-folder"' });
}

/**
 * 一般, in Grok Bot's order of sections: who you are, how the window looks, what Raphael works with (the timezone of
 * routines and the folder of what is delivered), and the guide. What he remembers is the 記憶 tab.
 */
function generalHTML(v: SettingsView): string {
  return (
    headingHTML(v) +
    coreNote(v) + `<section class="sgroup set-account"><h2>${esc(t("settings.ownerSection"))}</h2>` + ownerProfileHTML(v.brain) + `</section>` +
    `<div class="appearance-settings">` + section(t("skin.title"), [
      row(t("settings.067"), "", sel(APPEARANCES, v.device.appearance, t("settings.067"), ' data-k="appearance"')),
      row(t("settings.059"), "", sel(UI_LANGUAGES, v.device.ui_language, t("settings.059"), ' data-k="ui-language"')),
    ]) + `</div>` +
    section(t("agent.title"), [
      row(t("zone.title"), t("zone.help"), sel([{value:v.brain?.routine_timezone ?? "",label:v.brain?.routine_timezone ? zoneLabel(v.brain.routine_timezone) : `${t("zone.auto")} · ${zoneLabel(detectedTimezone())}`}], v.brain?.routine_timezone ?? "", t("zone.title"), ' data-k="routine-timezone"' + (v.brain === null ? ' disabled' : ''))),
      outputFolderRow(v),
    ]) +
    // Telegram, Slack and Discord moved to each member's panel, Raphael's too, and are set up in the conversation
    // (owner, 2026-11-07): nothing of them is set here.
    // The emblem's size, its subtitles and starting with Windows are fixed (device-fixed.ts, owner 2026-11-06), and the
    // weather city is the member's to ask when it needs it: none of them is a setting any more.
    // The tour, as one button named 導覽 (owner, 2026-11-07: it is there to look at the guide while it is built).
    `<section class="sgroup"><h2>${esc(t("settings.groupStartup"))}</h2><div class="sgroup-act">${btn(esc(t("settings.rerunGuide")), "", ' data-act="rerun-guide"')}</div></section>`
  );
}

/** 聽寫: how a dictation starts (the keys and the mode), and how Raphael listens (the languages and the microphone). */
function dictationHTML(v: SettingsView): string {
  const d = v.device;
  return (
    headingHTML(v) +
    coreNote(v) +
    section(t("home.shortcuts"), [
      shortcutRow(t("settings.agentKeys"), v.device.agent_keys ?? [], { act: "rec-agent", field: "agent_keys" }),
      ...altgrNote(v, v.device.agent_keys ?? []),
      shortcutRow(t("home.020"), d.dictation_keys, { act: "rec", field: "dictation_keys" }),
      ...altgrNote(v, d.dictation_keys),
      ...(d.paste_last_keys.length ? [shortcutRow(t("home.021"), d.paste_last_keys)] : []),
      shortcutRow(t("common.cancel"), ["Escape"]),
    ]) +
    section(t("settings.groupStart"), [row(t("settings.055"), "", sel(DICTATION_MODES, d.dictation_mode, t("settings.055"), ' data-k="mode"'))]) +
    section(t("settings.groupListen"), [
      row(
        t("transcription.title"),
        "",
        languageSelectHTML(v.languageGroups ?? [], languagesOf(v), ` data-k="languages"${v.brain ? "" : " disabled"}`),
        { cls: "row-lang" },
      ),
      // The meter under the dropdown, as wide as it, moves with the microphone's loudness while
      // this tab is open.
      micRow({
        choices: settingsMicrophones(v),
        current: d.microphone ?? AUTO_MICROPHONE,
        selAttrs: ' data-k="mic"',
        meter: { place: "after", segments: MIC_METER_SEGMENTS },
        row: { cls: "row-mic" },
      }),
    ]) +
    // How long the history is kept lives with dictation; there is no separate Data page (2026-11-05).
    section(t("data.groupDictation"), [row(t("data.retention"), "", sel(retentionChoices(v), retentionOf(v), t("data.retention"), ` data-k="retention"${v.brain === null ? " disabled" : ""}`))])
  );
}

/**
 * The apps Raphael may always operate, from the device settings. Settings written before the
 * feature have none of them: that is no app.
 */
export const computerApps = (device: DeviceSettings): readonly { exe: string; name: string }[] => device.computer_apps ?? [];

/**
 * Computer access: one row per always-allowed app, with removal in its overflow menu,
 * or a single muted row when there is none. The apps are put there by the
 * answer 「一律允許」 of the question that asks before Raphael first uses an app.
 */
function computerRows(v: SettingsView): string[] {
  const apps = computerApps(v.device);
  const desktop = [
    row(t("local.title"), "", sel(LOCAL_COMMAND_MODES, v.brain?.local_commands_mode ?? "ask", t("local.title"), ` data-k="local-commands"${v.brain === null ? " disabled" : ""}`)),
  ];
  if (apps.length === 0) return [...desktop, row(`<span class="val">${esc(t("settings.computerNone"))}</span>`)];
  return [...desktop, ...apps.map((app) =>
    row(esc(app.name), "", iconBtn("more", t("members.more", { p0: app.name }), ` data-act="computer-menu" data-exe="${esc(app.exe)}" aria-haspopup="menu" aria-expanded="false"`)),
  )];
}

/** Services shared by every member. */
function toolsHTML(v: SettingsView): string {
  return headingHTML(v) + coreNote(v) + (v.services ? servicesHTML(v.services, modelPickerHTML(visionPickerLook(v)), v.brain) : "");
}

/** Shared safety rules and local command permissions. */
function safetyHTML(v: SettingsView): string {
  return headingHTML(v) + coreNote(v) + vaultHTML(v.vault ?? emptyVaultView()) + (v.rules ? rulesHTML(v.rules) : "") + section(t("settings.computerUse"), computerRows(v));
}

/** 連接: the services Raphael is connected to and the store that adds them; 「新增」 stands on the row of the two views. */
function connectionsTabHTML(v: SettingsView): string {
  return headingHTML(v) + connectionsHTML(v.connections);
}

/** The dictation history's retention: the choices, with the one in force too if it is none of them. */
export function retentionChoices(v: SettingsView): Choice[] {
  const current = retentionOf(v);
  return RETENTIONS.some((c) => c.value === current) ? RETENTIONS : [...RETENTIONS, { value: current, label: formatRetention(Number(current)) }];
}

/** How long the dictation history is kept, as the value of its dropdown (30 days until the core says). */
export const retentionOf = (v: SettingsView): string => String(v.brain?.history_retention_days ?? 30);

/**
 * One page with model connections and usage in separate views. Legacy ids choose their own view. Usage is as plain as
 * Grok Bot's (owner, 2026-11-06): what each subscription has left, then the key and what was spent, with no charts.
 */
/**
 * The one refresh of 模型與用量 and what it is doing (owner, 2026-11-08: 「這個 Icon 沒有任何的 feedback」): it turns while it
 * reads, then is a check for a moment. It stays a button that keeps the focus; a press while it reads does nothing.
 */
export function modelsRefreshHTML(state: "idle" | "busy" | "done"): string {
  const label = t(state === "busy" ? "conn.refreshing" : state === "done" ? "runs.refreshed" : "runs.refresh");
  return iconBtn(state === "done" ? "check" : "refresh", label, ` data-act="models-refresh" data-state="${state}" aria-busy="${state === "busy"}"${state === "busy" ? ' aria-disabled="true"' : ""}`, "models-refresh");
}

function modelsHTML(v: SettingsView): string {
  const providers = v.providers ?? emptyProvidersView();
  const selected = v.modelsTab ?? (v.pane === "usage" ? "usage" : "models");
  const content = selected === "models" ? section(t("models.used"), [quickRow(v), ...MODEL_ROWS.slice(1).map(r => modelRow(v, r))], v.catalog === "failed" ? priceSpan(v, "note") : "") +
    cliBrainsHTML(v.cliBrains ?? emptyCliBrainsView()) + providersHTML(providers) + providersAddHTML(providers) :
    spendCardHTML(v) + `<div data-usage-host></div>` + section(t("common.apiKey"), [
      keyRow(v),
      ...(v.keyError ? [note(st("err", v.keyError()), ' role="alert"')] : []),
    ]);
  // Read once while the app runs; this reads it all again (owner, 2026-11-08: 「點一下右上角的那個重跑」).
  return headingHTML(v, modelsRefreshHTML(v.modelsRefresh ?? "idle")) + coreNote(v) + `<div class="models-page">` +
    tabs((["models", "usage"] as const).map((id) => ({
      id, label: id === "models" ? t("providers.title") : t("models.usage"),
      attrs: ` id="models-tab-${id}" data-models-tab="${id}" data-k="models-tab:${id}" aria-controls="models-panel-${id}" tabindex="${id === selected ? 0 : -1}"`,
    })), selected, { label: t("settings.paneUsage"), kind: "nav", plain: true }) +
    (["models", "usage"] as const).map((id) => `<div class="models-content" id="models-panel-${id}" role="tabpanel" aria-labelledby="models-tab-${id}"${id === selected ? "" : " hidden"}>${id === selected ? content : ""}</div>`).join("") + `</div>`;
}

/**
 * 記憶: what every member remembers of the owner. It lives in Raphael's own data folder; there is no import from other
 * assistants (owner, 2026-11-08: 「匯入記憶不要這樣設計…沒有什麼實際的意義」), and moving to another PC means keeping that folder.
 */
function memoryPaneHTML(v: SettingsView): string {
  return headingHTML(v) + coreNote(v) + (v.memoryShared ? memoryHTML(v.memoryShared) : "");
}

/** 關於: the version, the license and the fan-project statement. */
function aboutHTML(v: SettingsView): string {
  return (
    headingHTML(v) +
    `<div class="about-brand">${brandIcon("about-icon")}<span class="about-name">Raphael</span></div>` +
    `<div class="slist about">` +
    row(t("settings.078"), "", `<span class="val num">${esc(v.version)}</span>`) +
    // The row names it; its control is an icon, never the same words again (owner, 2026-11-08: icons over text buttons):
    // a page out of the app has the outward arrow, one inside it the chevron.
    row(t("nav.help"), "", iconBtn("external", t("desktop.openShort"), ' data-act="help"')) +
    row(t("settings.079"), t("settings.080"), iconBtn("right", t("settings.081"), ' data-act="license"')) +
    `</div>` +
    updateHTML(v.update ?? null, v.device.auto_update ?? false, v.version) +
    t("settings.082")
  );
}

/** The tab that is open, as HTML. */
export function paneHTML(v: SettingsView): string {
  switch (v.pane) {
    case "appearance":
    case "messaging":
    case "general":
      return generalHTML(v);
    case "memory":
      return memoryPaneHTML(v);
    case "data":
    case "dictation":
      return dictationHTML(v);
    case "agent":
    case "tools":
      return toolsHTML(v);
    case "safety":
      return safetyHTML(v);
    case "connections":
      return connectionsTabHTML(v);
    case "usage":
    case "models":
      return modelsHTML(v);
    case "about":
      return aboutHTML(v);
  }
}

/** A tab whose settings are still being read: its name and purpose, and the shape of what is to come. */
export function loadingHTML(v: SettingsView): string {
  return headingHTML(v) +
    `<p class="settings-loading" role="status">${esc(t("settings.loading"))}</p>` +
    `<div class="settings-skeleton" aria-hidden="true">${Array.from({ length: 3 }, () =>
      `<div class="skeleton-section"><i class="skeleton-heading"></i><div class="skeleton-card"><div class="skeleton-row"><i></i><i></i></div><div class="skeleton-row"><i></i><i></i></div></div></div>`).join("")}</div>`;
}
