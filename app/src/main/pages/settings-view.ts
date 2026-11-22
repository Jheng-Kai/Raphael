// What the settings panel draws (settings.ts holds the state and the events): the tabs, and each
// tab as HTML made from a snapshot of what the panel knows. Nothing here reads the page or calls
// the app, so the structure of every tab and the rules for it can be tested without a
// browser.
//
// The rules for every row: a choice among options is a dropdown (`sel`, never the options
// in a row), an action is a button with a shape (`btn`, never a word that can be clicked), and a
// line under a row's name only where the setting would otherwise be set wrong. Each tab opens with
// its name, then its rows in a few named sections, each a rounded card.
//
// The tabs sit flat on the left, with no group names, no search and no line under a tab's name.
// No tab shows memory; the core keeps it.


import { LOCALES, getLocale, t } from "../i18n";
import { updateHTML } from "../updates";
import { detectedTimezone, zoneLabel } from "../timezones";
import { ownerProfileHTML } from "../owner-settings";

import { brandIcon } from "../brand";
import { type ConnectionsView, connectionsHTML } from "../connections";
import { DICTATION_MODES } from "../dictation";
import { KEEP_FOREVER_DAYS, formatRetention, formatUsd } from "../format";
import { type UsageAnalysisView, usageAnalysisHTML } from "../usage-analysis";
import { type LanguageGroup, languageSelectHTML, normalizeLanguages } from "../languages";
import { type RulesView, rulesHTML } from "../safety-rules";
import { type VaultView, emptyVaultView, vaultHTML } from "../vault";
import { type SkillLibraryView, emptySkillLibraryView, skillLibraryHTML } from "../skill-library";
import { AUTO_MICROPHONE, microphoneChoices } from "../microphone";
import { missingHTML } from "../missing";
import type { LocalView } from "../local-models";
import { type ModelPickerLook, modelDisplayName, modelPickerHTML, modelsFor, onPlan, planRef, priceDescription, priceHTML, splitEffort } from "../model-picker";
import { type ServicesView, servicesHTML } from "../services";
import { type ProvidersView, providersHTML, providersAddHTML, emptyProvidersView } from "../providers";
import { type CliBrainsView, cliBrainsHTML, cliDirectoryHTML, cliModels, emptyCliBrainsView } from "../cli-brains";
import { pricingNote } from "../pricing";
import { type HotkeyField, SHORTCUTS, shortcutCaps } from "../hotkey-recording";
import type { AudioDevices, BrainSettings, DeviceSettings, LocalModel, ModelCatalog, ModelRole, SettingsPane, Status } from "../types";
import { micRow } from "../setup-rows";
import { type Choice, type IconName, btn, esc, headerCloseButton, ico, iconBtn, note, row, sel, st, tabs, tg } from "../ui";

/** The models the core reads when none is chosen (brain/settings.py), shown while it does not answer. */
const DEFAULT_MODELS = { cleanup: "openai/gpt-6-luna", answer: "openai/gpt-6-luna", stt: "elevenlabs/scribe-v2" } as const;
/** One shared dropdown for the complete appearance preference. */
export const APPEARANCES: Choice[] = [
  { value: "system", get label() { return t("settings.013"); } },
  { value: "light", get label() { return t("settings.015"); } },
  { value: "dark", get label() { return t("settings.016"); } },
];
/** What one background task may spend (brain/settings.py, WORKER_COST_CAPS). */
export const WORKER_COST_CAPS: Choice[] = [
  { value: "0.1", label: "US$0.10" },
  { value: "0.2", label: "US$0.20" },
  { value: "0.5", label: "US$0.50" },
  { value: "1", label: "US$1.00" },
  { value: "2", label: "US$2.00" },
  { value: "5", label: "US$5.00" },
  { value: "10", label: "US$10.00" },
  { value: "20", label: "US$20.00" },
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
 * General comes first, then Models (the setup needed before chatting) and Usage (spending).
 * Next are what members can do (Tools and Team skills), Dictation, Safety (vault and rules), and About.
 */
export const PANES: { id: SettingsPane; icon: IconName; title: () => string }[] = [
  { id: "general", icon: "gear", title: () => t("settings.paneGeneral") },
  { id: "models", icon: "bot", title: () => t("providers.title") },
  { id: "usage", icon: "gauge", title: () => t("models.usage") },
  { id: "tools", icon: "steps", title: () => t("settings.paneTools") },
  { id: "skills", icon: "sparkle", title: () => t("settings.paneSkills") },
  { id: "dictation", icon: "mic", title: () => t("settings.paneDictation") },
  { id: "safety", icon: "lock", title: () => t("settings.paneSafety") },
  { id: "about", icon: "info", title: () => t("common.about") },
  // Not a tab: the sidebar's 連結應用程式 opens it as a dialog of its own, its only way in (R-UI-111).
  { id: "connections", icon: "plug", title: () => t("nav.apps") },
];

/** The pane that is not a tab of Settings but a dialog of its own, opened only from the sidebar. */
export const STANDALONE_PANE: SettingsPane = "connections";

/** The button of a tab in the list on the left. */
const paneButton = (p: (typeof PANES)[number]): string =>
  `<button type="button" class="nav" data-pane="${p.id}" aria-current="false">${ico(p.icon)}<span>${esc(p.title())}</span></button>`;

/** The flat list of tabs. */
export const paneListHTML = (): string => PANES.filter((p) => p.id !== STANDALONE_PANE).map(paneButton).join("");

/** Where a link to a tab of before lands: Tools for the agent, 聽寫 for data, 一般 for appearance, messaging and the memory tab that is gone. */
export const canonicalPane = (id: SettingsPane): SettingsPane =>
  id === "agent" ? "tools" : id === "data" ? "dictation" : id === "appearance" || id === "messaging" || id === "memory" ? "general" : id;
/** The name of a tab, in the language of the window. */
export const paneTitle = (id: SettingsPane): string => PANES.find((p) => p.id === canonicalPane(id))!.title();
/** The two views of 用量: what this month and each subscription stand at, and the charts of a period. */
export type UsageTab = "overview" | "analysis";

/** The row of each shortcut in 聽寫與快捷鍵's read-only list. */
export const HOTKEY_ROWS: Record<HotkeyField, string> = { dictation_keys: "hotkey", agent_keys: "agent-hotkey", tidy_keys: "tidy-hotkey", paste_last_keys: "paste-hotkey" };

/** Everything a tab is drawn from: what the panel has read, and what is being typed or done. */
export interface SettingsView {
  update?: import("../api").UpdateView | null;
  /** The view of 用量 that is open (概覽 when none is said). */
  usageTab?: UsageTab;
  /** 用量 › 分析: the period, the groupings and what the core read for them (none: not drawn yet). */
  analysis?: UsageAnalysisView;
  pane: SettingsPane;
  device: DeviceSettings;
  /** The brain's settings; null while the core does not answer. */
  brain: BrainSettings | null;
  hasKey: boolean;
  openrouter: Status["openrouter"] | null;
  spend: Status["spend"] | null;
  /** OpenRouter's catalog of models (`models.catalog`): being read (`loading`), read, or not to be had (`failed`). */
  catalog: ModelCatalog | "loading" | "failed";
  devices: AudioDevices | null;
  /** The keyboard layout makes Right Alt an AltGr. */
  altgr: boolean;
  /** macOS's answer for the microphone, read without asking; null on Windows or while it is not known. */
  microphone?: import("../types").MicrophonePermission | null;
  /** macOS: whether the app may use Accessibility; null on Windows or while it is not known. */
  accessibility?: boolean | null;
  /** The app's version, as Tauri gives it; empty while it is not known. */
  version: string;
  /** What is typed in the weather city while it is not saved, and what is wrong with it. */
  /** Telegram, in the 訊息平台 tab. */
  /** Members with a bot of their own, set up in each member's panel. */
  /** The shared safety rules, in Safety (none: not drawn). */
  rules?: RulesView;
  vault?: VaultView;
  /** Team skills: the shared skills in packages, and who may use each (none: not drawn yet). */
  skillLibrary?: SkillLibraryView;
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

/** What a price element holds: a price in parts that never break inside; the note on where the prices come from is a sentence. */
export const priceMarkup = (k: string, text: string): string => (k === "note" ? esc(text) : priceHTML(text));

const priceSpan = (v: SettingsView, k: string, cls = ""): string =>
  `<span${cls ? ` class="${cls}"` : ""} data-price="${k}">${priceMarkup(k, priceTexts(v)[k] ?? "")}</span>`;

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
    // What the app ships as the choice is no choice while OpenRouter (or the provider it runs through) has no key: said once
    // the providers are read, so that a page still loading shows no flash of 「未設定」.
    ...((role === "cleanup" || role === "answer" || role === "stt") && v.providers?.state === "ready" ? { shipped: DEFAULT_MODELS[role] } : {}),
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
  if (model && onPlan(model)) return t("brains.subscription");
  return [model ? priceDescription(model, role) : chosen ? t("media.unavailable") : t("media.unset"), t("media.paid")].filter(Boolean).join(" · ") +
    (!chosen && !models.length && v.catalog !== "loading" ? ` · ${t("media.none")}` : "");
}
const modelRow = (v: SettingsView, { role, k, label }: (typeof MODEL_ROWS)[number]): string =>
  row(label(), role === "image" || role === "video" ? `<span data-media-price="${role}">${priceHTML(mediaRowPrice(v, role))}</span>` : priceSpan(v, k, "price num"),
    modelPickerHTML(modelPickerLook(v, role)), { cls: "row-model", attrs: ` data-row="${k}"` });

/** The monthly limit in force, from the status (null for none: 不設上限, or the core does not say). */
export const limitOf = (v: Pick<SettingsView, "spend" | "brain">): number | null => {
  const limit = v.spend ? v.spend.limit_usd : v.brain?.monthly_limit_usd ?? null;
  return typeof limit === "number" && Number.isFinite(limit) && limit >= 0 ? limit : null;
};

/**
 * 這個月: what this app spent this month with API keys, in a card under its section's name and a line of what it counts:
 * the amount, where the month ends at this pace and the limit (未設上限, or 上限 US$ X 已用 N% with a bar in Raphael's
 * blue). The gear at the card's top right opens the monthly limit (usage-cap.ts). Subscriptions are not counted here.
 */
function spendCardHTML(v: SettingsView): string {
  const { spend } = v;
  const first = new Date(v.now); first.setDate(1);
  const since = new Intl.DateTimeFormat(getLocale(), { month: "long", day: "numeric" }).format(first);
  const gear = iconBtn("gear", t("common.monthlyLimit"), ` data-act="usage-cap" data-k="usage-cap" aria-haspopup="dialog" aria-expanded="false"${v.brain === null ? " disabled" : ""}`, "spend-cap");
  const head = `<h2>${esc(t("usage.month"))}</h2><p class="ua-note">${esc(t("usage.monthNote", { p0: since }))}</p>`;
  if (!spend) return `<section class="sgroup usage-month">${head}<div class="spend-card" data-row="raphael-spend"><p class="spend-label">${esc(t("usage.spent"))}</p><p class="spend-note">${esc(t("settings.usageUnavailable"))}</p>${gear}</div></section>`;
  const limit = limitOf(v);
  const share = limit !== null ? Math.round(Math.max(0, Math.min(100, limit > 0 ? spend.month_usd / limit * 100 : 100))) : null;
  const forecast = Number.isFinite(spend.forecast_usd) && spend.forecast_usd > spend.month_usd ? spend.forecast_usd : null;
  const note = [forecast ? t("settings.spendForecast", { p0: formatUsd(forecast) }) : "",
    limit === null ? t("usage.noLimit") : t("usage.limitUsed", { p0: formatUsd(limit), p1: share ?? 0 })].filter(Boolean).join(" · ");
  return `<section class="sgroup usage-month">${head}<div class="spend-card" data-row="raphael-spend">` +
    `<p class="spend-label">${esc(t("usage.spent"))}</p>` +
    `<p class="spend-value"><strong class="num">${esc(formatUsd(spend.month_usd))}</strong></p>` +
    `<p class="spend-note">${esc(note)}</p>` +
    (share !== null ? `<div class="spend-bar" role="progressbar" aria-label="${esc(t("common.monthlyLimit"))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}"><i style="width:${share}%"></i></div>` : "") +
    gear + `</div></section>`;
}

// ---------- the parts of every tab ----------

/** A group of settings: a short name, then its rows on one card. */
const section = (title: string, rows: string[], foot = ""): string =>
  `<section class="sgroup">${title ? `<h2>${esc(title)}</h2>` : ""}<div class="slist">${rows.join("")}</div>` +
  (foot ? `<p class="foot">${foot}</p>` : "") +
  `</section>`;

/** A shortcut, read-only: its keys as caps. They are changed in the dialog that the section's 編輯 opens (shortcut-editor.ts). */
const shortcutRow = (name: string, bindings: readonly string[], field?: HotkeyField): string =>
  row(name, "", `<span class="caps">${shortcutCaps(bindings)}</span>`, { cls: "row-shortcut", attrs: field ? ` data-row="${HOTKEY_ROWS[field]}"` : "" });

/**
 * 快捷鍵: every shortcut in the order of use, then Esc, read-only, with one 編輯 at the section's top right that opens the
 * dialog where they are changed. The AltGr warning stands under the shortcut whose keys hold Right Alt.
 */
function shortcutsSection(v: SettingsView): string {
  const rows = SHORTCUTS.flatMap(({ field, name }) => {
    const bindings = v.device[field] ?? [];
    return [shortcutRow(name(), bindings, field), ...(field === "dictation_keys" || field === "agent_keys" ? altgrNote(v, bindings) : [])];
  });
  return `<section class="sgroup set-shortcuts"><div class="data-heading"><h2>${esc(t("home.shortcuts"))}</h2>` +
    btn(esc(t("keys.edit")), "sm", ' data-act="keys-edit" data-k="keys-edit"') + `</div>` +
    `<div class="slist">${[...rows, shortcutRow(t("common.cancel"), ["Escape"])].join("")}</div></section>`;
}

/** The warning under a shortcut whose keys hold Right Alt, on a keyboard layout that makes that key AltGr. */
const altgrNote = (v: SettingsView, bindings: readonly string[]): string[] =>
  v.altgr && bindings.some((binding) => binding.split("+").includes("AltRight")) ? [note(st("warn", t("settings.054")))] : [];

/**
 * A Mac's Accessibility while it is off: no global key is heard, so no paste or tidy fails to say so, and macOS asks only
 * once. This note is where the owner finds the pane again (R-PRIV-AX-01); while the permission is on it is not drawn.
 */
const accessibilityNote = (v: SettingsView): string =>
  v.accessibility === false ? missingHTML({ resource: "hotkeys", requirement: "accessibility", state: "missing", repair: null }) : "";

/**
 * A Mac's microphone while the meter may not open it: not decided yet (測試麥克風 asks macOS, once), or refused (its pane is
 * a press away). Nothing is drawn while it is allowed, or on Windows.
 */
const microphoneNote = (v: SettingsView): string =>
  v.microphone === "undecided"
    ? `<div class="missing-note" role="status"><span>${esc(t("settings.micUndecided"))}</span>${btn(esc(t("settings.micAsk")), "sm", ' data-act="mic-ask"')}</div>`
    : v.microphone === "denied" || v.microphone === "restricted"
      ? missingHTML({ resource: "microphone", requirement: "microphone", state: "missing", repair: null })
      : "";

/** The pane title receives focus when settings open. A tab is its name alone: no line under it, no action beside it. */
export const headingHTML = (v: SettingsView): string =>
  `<h1 id="set-title" tabindex="-1">${esc(paneTitle(v.pane))}</h1>`;

const settingsCloseHTML = (): string => headerCloseButton(t("common.close"), ' data-act="close" data-k="settings-close" data-nav-back', "modal-x");
const settingsHeaderHTML = (v: SettingsView): string => `<header class="set-head">${headingHTML(v)}${settingsCloseHTML()}</header>`;

/** What the tabs that need the core say when it does not answer. */
const coreNote = (v: SettingsView): string => (v.brain === null ? `<div class="alert core-note">${st("err", t("settings.052"))}</div>` : "");

// ---------- the tabs ----------

/**
 * The output folder as a native folder picker: no text field. Unset, it is 選擇資料夾 alone;
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
 * 一般, in a fixed order of sections: who you are, how the window looks, what Raphael works with (the timezone of
 * routines and the folder of what is delivered), and the guide. What it remembers is the 記憶 tab.
 */
function generalHTML(v: SettingsView): string {
  return (
    settingsHeaderHTML(v) +
    coreNote(v) + `<section class="sgroup set-account"><h2>${esc(t("settings.ownerSection"))}</h2>` + ownerProfileHTML(v.brain) + `</section>` +
    `<div class="appearance-settings">` + section(t("skin.title"), [
      row(t("settings.067"), "", sel(APPEARANCES, v.device.appearance, t("settings.067"), ' data-k="appearance"')),
      row(t("settings.059"), "", sel(UI_LANGUAGES, v.device.ui_language, t("settings.059"), ' data-k="ui-language"')),
    ]) + `</div>` +
    section(t("agent.title"), [
      row(t("zone.title"), t("zone.help"), sel([{value:v.brain?.routine_timezone ?? "",label:v.brain?.routine_timezone ? zoneLabel(v.brain.routine_timezone) : `${t("zone.auto")} · ${zoneLabel(detectedTimezone())}`}], v.brain?.routine_timezone ?? "", t("zone.title"), ' data-k="routine-timezone"' + (v.brain === null ? ' disabled' : ''))),
      // Where else each member may write is chosen in that member's settings (R-PC-05); this folder is every member's default.
      outputFolderRow(v),
    ])
    // Telegram, Slack and Discord moved to each member's panel, Raphael's too, and are set up in the conversation
    // Nothing of them is set here.
    // The emblem's size, its subtitles and starting with Windows are fixed (device-fixed.ts), and the
    // weather city is the member's to ask when it needs it: none of them is a setting any more.
    // The guide is the first run's only: Settings has no way to open it again.
  );
}

/** 聽寫: how a dictation starts (the keys and the mode), and how Raphael listens (the languages and the microphone). */
function dictationHTML(v: SettingsView): string {
  const d = v.device;
  return (
    settingsHeaderHTML(v) +
    coreNote(v) +
    accessibilityNote(v) +
    microphoneNote(v) +
    shortcutsSection(v) +
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
    // Learning from corrections asks the cleanup model, so it is the owner's choice.
    section(t("main.003"), [
      row(t("settings.autoLearn"), t("settings.autoLearnHelp"), tg(d.auto_learn ?? false, t("settings.autoLearn"), ' data-k="auto-learn"')),
    ]) +
    // How long the history is kept lives with dictation; there is no separate Data page.
    section(t("data.groupDictation"), [row(t("data.retention"), "", sel(retentionChoices(v), retentionOf(v), t("data.retention"), ` data-k="retention"${v.brain === null ? " disabled" : ""}`))])
  );
}

/**
 * The apps Raphael may always operate, from the device settings. Settings written before the
 * feature have none of them: that is no app.
 */
/** Services shared by every member. */
function toolsHTML(v: SettingsView): string {
  return settingsHeaderHTML(v) + coreNote(v) + (v.services ? servicesHTML(v.services, modelPickerHTML(visionPickerLook(v)), v.brain, (id) => modelDisplayName(catalogOf(v), id)) : "");
}

/** Team skills: every shared skill in its package, and who may use each (skill-library.ts). */
function skillsHTML(v: SettingsView): string {
  return skillLibraryHTML(v.skillLibrary ?? emptySkillLibraryView(), settingsHeaderHTML(v) + coreNote(v), settingsCloseHTML());
}

/** Shared safety rules and local command permissions. */
function safetyHTML(v: SettingsView): string {
  return settingsHeaderHTML(v) + coreNote(v) + vaultHTML(v.vault ?? emptyVaultView()) + (v.rules ? rulesHTML(v.rules) : "");
}

/** 連接: the services Raphael is connected to and the store that adds them; 「新增」 stands on the row of the two views. */
function connectionsTabHTML(v: SettingsView): string {
  return connectionsHTML(v.connections, headingHTML(v), settingsCloseHTML());
}

/** The dictation history's retention: the choices, with the one in force too if it is none of them. */
export function retentionChoices(v: SettingsView): Choice[] {
  const current = retentionOf(v);
  return RETENTIONS.some((c) => c.value === current) ? RETENTIONS : [...RETENTIONS, { value: current, label: formatRetention(Number(current)) }];
}

/** How long the dictation history is kept, as the value of its dropdown (30 days until the core says). */
export const retentionOf = (v: SettingsView): string => String(v.brain?.history_retention_days ?? 30);

/**
 * 模型: the models in use, the subscription accounts and the providers, one after the other with no views inside. What was
 * spent and what each subscription has left are 用量's.
 */
function modelsHTML(v: SettingsView): string {
  const providers = v.providers ?? emptyProvidersView();
  return settingsHeaderHTML(v) + coreNote(v) + `<div class="models-page">` +
    section(t("models.used"), [quickRow(v), ...MODEL_ROWS.slice(1).map(r => modelRow(v, r))], v.catalog === "failed" ? priceSpan(v, "note") : "") +
    cliBrainsHTML(v.cliBrains ?? emptyCliBrainsView()) + providersHTML(providers) + providersAddHTML(providers, cliDirectoryHTML(v.cliBrains ?? emptyCliBrainsView(), providers.role)) +
    `</div>`;
}

/** The ids of 用量's two views, for the tab and its panel. */
export const USAGE_TABS = ["overview", "analysis"] as const;

/**
 * 用量, in two small tabs: 概覽 (this month's spending with its limit, then what each subscription has left: the allowance
 * cards mount in `data-usage-host`, usage-analytics.ts) and 分析 (a period's charts, usage-analysis.ts). No refresh of its
 * own: opening Settings reads the allowances again, unseen (settings.ts `refreshInBackground`); 分析 reads its period when
 * it is opened.
 */
function usageHTML(v: SettingsView): string {
  const selected = v.usageTab ?? "overview";
  const content = selected === "overview" ? spendCardHTML(v) + `<div data-usage-host></div>`
    : v.analysis ? usageAnalysisHTML(v.analysis, { model: (id) => modelDisplayName(catalogOf(v), id) }) : "";
  return settingsHeaderHTML(v) + coreNote(v) + `<div class="usage-page">` +
    tabs(USAGE_TABS.map((id) => ({
      id, label: id === "overview" ? t("usage.overview") : t("usage.analysis"),
      attrs: ` id="usage-tab-${id}" data-usage-tab="${id}" data-k="usage-tab:${id}" aria-controls="usage-panel-${id}" tabindex="${id === selected ? 0 : -1}"`,
    })), selected, { label: t("models.usage"), kind: "nav", plain: true }) +
    USAGE_TABS.map((id) => `<div class="usage-content" id="usage-panel-${id}" role="tabpanel" aria-labelledby="usage-tab-${id}"${id === selected ? "" : " hidden"}>${id === selected ? content : ""}</div>`).join("") + `</div>`;
}

/** 關於: the version, the license and the fan-project statement. */
function aboutHTML(v: SettingsView): string {
  return (
    settingsHeaderHTML(v) +
    `<div class="about-brand">${brandIcon("about-icon")}<span class="about-name">Raphael</span></div>` +
    `<div class="slist about">` +
    row(t("settings.078"), "", `<span class="val num">${esc(v.version)}</span>`) +
    // The row names it; its control is an icon, never the same words again:
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
    // The old memory tab is gone: a link to it lands here (canonicalPane), so nothing draws memory.
    case "memory":
    case "general":
      return generalHTML(v);
    case "data":
    case "dictation":
      return dictationHTML(v);
    case "agent":
    case "tools":
      return toolsHTML(v);
    case "safety":
      return safetyHTML(v);
    case "skills":
      return skillsHTML(v);
    case "connections":
      return connectionsTabHTML(v);
    case "models":
      return modelsHTML(v);
    case "usage":
      return usageHTML(v);
    case "about":
      return aboutHTML(v);
  }
}

/** A tab whose settings are still being read: its name and purpose, and the shape of what is to come. */
export function loadingHTML(v: SettingsView): string {
  return settingsHeaderHTML(v) +
    `<p class="settings-loading" role="status">${esc(t("settings.loading"))}</p>` +
    `<div class="settings-skeleton" aria-hidden="true">${Array.from({ length: 3 }, () =>
      `<div class="skeleton-section"><i class="skeleton-heading"></i><div class="skeleton-card"><div class="skeleton-row"><i></i><i></i></div><div class="skeleton-row"><i></i><i></i></div></div></div>`).join("")}</div>`;
}
