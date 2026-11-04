// What the settings panel draws (settings.ts holds the state and the events): the tabs, and each
// tab as HTML made from a snapshot of what the panel knows. Nothing here reads the page or calls
// the app, so the structure of every tab and the rules for it can be tested without a
// browser.
//
// The rules for every row: a choice among options is a dropdown (`sel`, never the options
// in a row), an action is a button with a shape (`btn`, never a word that can be clicked), and a
// line under a row's name only where the setting would otherwise be set wrong. Each tab opens with
// its name and one line on what it is for, then its rows in a few named groups.
//
// The tabs sit on the left in three groups: basics, integrations and account (Models & usage, Data, About).
// Settings search finds a row in any tab by its name in any of the three languages, and jumps to
// it (`SEARCH_INDEX`, `searchSettings`).

import { catalogs, t } from "../i18n";
import { messageHTML } from "../message-content";
import { ownerProfileHTML } from "../owner-settings";
import type { MessageKey } from "../i18n/zh-TW";

import { brandIcon } from "../brand";
import { type ConnectionsView, connectionsAddHTML, connectionsHTML } from "../connections";
import { DICTATION_MODES } from "../dictation";
import { KEEP_FOREVER_DAYS, formatClock, formatShortDateTime, formatRetention, formatUsd } from "../format";
import { type LanguageGroup, languageSelectHTML, normalizeLanguages } from "../languages";
import { bindingLabels } from "../keys";
import { type MessagingView, messagingHTML } from "../messaging";
import { type MemoryView, memoryHTML } from "../memory-view";
import { type RulesView, rulesHTML } from "../safety-rules";
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
import { type Choice, type IconName, actionRow, btn, esc, fieldHTML, ico, iconBtn, iconButton, keys, note, row, sel, st, tabs, tg } from "../ui";

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
export const UI_LANGUAGES: Choice[] = [
  { value: "zh-TW", get label() { return t("settings.023"); } },
  { value: "en", get label() { return t("locale.english"); } },
  { value: "ja", get label() { return t("settings.024"); } },
];

/** How long the dictation history is kept: at least a day (the core only checks that it is a number); "keep" is a hundred years. */
export const RETENTIONS: Choice[] = [1, 7, 30, 365, KEEP_FOREVER_DAYS].map((days) => ({
  value: String(days),
  get label() { return formatRetention(days); },
}));

const PRICES_LOADING = () => t("settings.026");

/** The groups of tabs: the basics have no name. */
export type PaneGroup = "basics" | "integrations" | "account";

/** The name of each group, over its tabs; the basics have none. */
export const PANE_GROUPS: Record<PaneGroup, () => string> = {
  basics: () => "",
  integrations: () => t("settings.navIntegrations"),
  account: () => t("settings.navAccount"),
};

/**
 * The tabs on the left of the panel, in order and in their groups, each with the line under its name
 * that says what it is for. 拉斐爾's tab has Raphael's emblem for its icon, as the window's does.
 */
export const PANES: { id: SettingsPane; group: PaneGroup; icon: IconName | "emblem"; title: () => string; purpose: (d: DeviceSettings) => string }[] = [
  { id: "general", group: "basics", icon: "gear", title: () => t("settings.paneGeneral"), purpose: () => t("settings.purposeGeneral") },
  { id: "appearance", group: "basics", icon: "grid", title: () => t("skin.title"), purpose: () => t("skin.about") },
  { id: "dictation", group: "basics", icon: "mic", title: () => t("settings.paneDictation"), purpose: () => t("settings.purposeDictation") },
  { id: "agent", group: "basics", icon: "emblem", title: () => t("settings.paneAgent"), purpose: agentPurpose },
  { id: "connections", group: "integrations", icon: "plug", title: () => t("settings.paneConnections"), purpose: () => t("settings.purposeConnections") },
  { id: "messaging", group: "integrations", icon: "send", title: () => t("settings.paneMessaging"), purpose: () => t("settings.purposeMessaging") },
  { id: "models", group: "account", icon: "bot", title: () => t("settings.paneUsage"), purpose: () => t("providers.about") },
  { id: "data", group: "account", icon: "database", title: () => t("settings.paneData"), purpose: () => t("settings.purposeData") },
  { id: "about", group: "account", icon: "info", title: () => t("common.about"), purpose: () => t("settings.purposeAbout") },
];

/** Raphael's emblem at the size of a tab's icon, in the version for each theme (app/public/brand). */
const NAV_EMBLEM =
  `<span class="nav-em" aria-hidden="true"><img class="em-l" src="/brand/app-emblem-light-64.webp" alt="" width="18" height="18">` +
  `<img class="em-d" src="/brand/app-emblem-dark-64.webp" alt="" width="18" height="18"></span>`;

/** The button of a tab in the list on the left. */
const paneButton = (p: (typeof PANES)[number]): string =>
  `<button type="button" class="nav" data-pane="${p.id}" aria-current="false">${p.icon === "emblem" ? NAV_EMBLEM : ico(p.icon)}<span>${esc(p.title())}</span></button>`;

/** The tabs in their groups, each group under its small grey name. */
export const paneListHTML = (): string =>
  (Object.keys(PANE_GROUPS) as PaneGroup[])
    .map((group) => {
      const name = PANE_GROUPS[group]();
      return (name ? `<div class="nav-group">${esc(name)}</div>` : "") + PANES.filter((p) => p.group === group).map(paneButton).join("");
    })
    .join("");

// ---------- 搜尋設定 ----------

/**
 * A row the search can find: its tab, the key of its name (found by that name in every language,
 * and on the page by the name in the window's language) and, for a row whose name is not what one
 * would type ("快捷鍵" for 聽寫's keys), a key of more words to find it by, or words that are the
 * same in every language (a brand). A row with no `label` is the tab itself.
 */
export interface SearchEntry {
  pane: SettingsPane;
  label?: MessageKey;
  also?: MessageKey;
  words?: string[];
}

/**
 * Everything 「搜尋設定」 can find: every tab, and the rows of each. A row added to a tab is one more
 * entry here (its name's key), or the search does not know it.
 */
export const SEARCH_INDEX: readonly SearchEntry[] = [
  { pane: "general", label: "owner.name" },
  ...PANES.map((p) => ({ pane: p.id })),
  { pane: "appearance", label: "settings.059" },
  { pane: "appearance", label: "settings.067", words: ["dark", "light"] },
  { pane: "general", label: "settings.069" },
  { pane: "general", label: "settings.071" },
  { pane: "general", label: "settings.073" },
  { pane: "general", label: "settings.rerunGuide" },
  { pane: "dictation", label: "home.020", also: "settings.searchShortcut" },
  { pane: "dictation", label: "home.021", also: "settings.searchShortcut" },
  { pane: "dictation", label: "settings.055" },
  { pane: "dictation", label: "transcription.title" },
  { pane: "dictation", label: "common.microphone", words: ["mic"] },
  { pane: "agent", label: "settings.agentKeys", also: "settings.searchShortcut" },
  { pane: "agent", label: "settings.agentCity" },
  { pane: "agent", label: "mem.title", also: "settings.searchMemory" },
  { pane: "agent", label: "rules.title" },
  { pane: "agent", label: "settings.computerUse" },
  { pane: "agent", label: "local.title" },
  { pane: "agent", label: "services.title" },
  { pane: "agent", label: "services.search", words: ["Brave", "Tavily", "Exa", "SearXNG"] },
  { pane: "agent", label: "services.read", words: ["Jina", "Firecrawl"] },
  { pane: "agent", label: "services.vision" },
  { pane: "agent", label: "services.pdf", words: ["PDF"] },
  { pane: "agent", label: "services.voice", words: ["Fish Audio", "TTS"] },
  { pane: "messaging", words: ["Telegram"] },
  { pane: "models", label: "providers.add", words: ["OpenAI", "Anthropic", "Gemini", "Azure", "Bedrock", "Ollama", "LM Studio", "OpenRouter", "LiteLLM", "Portkey", "Vercel", "Nebius", "Bifrost", "Groq", "DeepSeek", "Mistral"] },
  { pane: "usage", label: "common.apiKey", words: ["OpenRouter"] },
  { pane: "usage", label: "settings.050" },
  { pane: "usage", label: "settings.usageMonthly" },
  { pane: "models", label: "settings.031", also: "settings.searchModel" },
  { pane: "models", label: "settings.035", also: "settings.searchModel" },
  { pane: "models", label: "settings.quickModel", also: "settings.searchModel", words: ["Alt", "Space"] },
  { pane: "models", label: "media.image", words: ["image", "drawing"] },
  { pane: "models", label: "media.video", words: ["video"] },
  { pane: "data", label: "data.retention", also: "settings.searchHistory" },
  { pane: "data", label: "data.groupDictation", also: "data.clearDictation" },
  { pane: "data", label: "data.groupConversation", also: "data.clearConversation" },
  { pane: "about", label: "settings.078" },
  { pane: "about", label: "nav.help" },
  { pane: "about", label: "settings.079" },
];

/** A row the search found: where it is, and its name in the window's language. */
export interface SearchHit {
  pane: SettingsPane;
  /** The key of the row's name; none for a tab itself. */
  label?: MessageKey;
  /** What the hit says: the row's name, or the tab's. */
  text: string;
}

/** How many hits are listed at most. */
const SEARCH_SHOWN = 12;

/** `t` for a key chosen at run time, with no placeholders. */
const tr = t as unknown as (key: MessageKey) => string;

/** The texts of `key` in every language, for the search. */
const allLanguages = (key: MessageKey): string[] => Object.values(catalogs).map((catalog) => catalog[key]);

/** The keys of the tabs' names, in every language. */
const PANE_TITLE_KEYS: Record<SettingsPane, MessageKey> = {
  appearance: "skin.title",
  general: "settings.paneGeneral", dictation: "settings.paneDictation", agent: "settings.paneAgent", connections: "settings.paneConnections",
  messaging: "settings.paneMessaging", models: "settings.paneUsage", usage: "settings.paneUsage", data: "settings.paneData", about: "common.about",
};

/**
 * The rows and tabs whose name (in any of the three languages), extra words or brand contain
 * `query`, ignoring case: the tabs first, then the rows, in the order of the tabs.
 */
export function searchSettings(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const found = SEARCH_INDEX.filter((entry) => {
    const texts = [
      ...allLanguages(entry.label ?? PANE_TITLE_KEYS[entry.pane]),
      ...(entry.also ? allLanguages(entry.also) : []),
      ...(entry.words ?? []),
    ];
    return texts.some((text) => text.toLowerCase().includes(q));
  });
  return found.slice(0, SEARCH_SHOWN).map((entry) => ({
    pane: entry.pane,
    label: entry.label,
    text: entry.label ? tr(entry.label) : paneTitle(entry.pane),
  }));
}

/** What the search found, as buttons in place of the tabs (each names its tab under it), or that it found nothing. */
export function searchResultsHTML(hits: SearchHit[]): string {
  if (!hits.length) return `<p class="set-none" role="status">${esc(t("settings.searchNone"))}</p>`;
  return hits
    .map(
      (hit, i) =>
        `<button type="button" class="nav set-hit" data-hit="${i}"><span class="hit-t">${esc(hit.text)}</span>` +
        (hit.label ? `<span class="hit-p">${esc(paneTitle(hit.pane))}</span>` : "") +
        `</button>`,
    )
    .join("");
}

/** 「按 右 Alt + Space 問拉斐爾」: the line names the keys that are set, so that it stays true when they change. */
function agentPurpose(d: DeviceSettings): string {
  // an app from before the question key has none yet
  const binding = d.agent_keys?.[0];
  return binding ? t("settings.purposeAgent", { p0: bindingLabels(binding).join(" + ") }) : t("settings.purposeAgentNoKeys");
}

/** Both legacy entry points select the single Models pane. */
export const canonicalPane = (id: SettingsPane): SettingsPane => id === "usage" ? "models" : id;
/** The name of a tab, in the language of the window. */
export const paneTitle = (id: SettingsPane): string => PANES.find((p) => p.id === canonicalPane(id))!.title();
export type ModelsTab = "models" | "usage";

/** The shortcuts recorded here, and the row of each. */
export const HOTKEY_ROWS: Record<HotkeyField, string> = { dictation_keys: "hotkey", agent_keys: "agent-hotkey" };

/** Everything a tab is drawn from: what the panel has read, and what is being typed or done. */
export interface SettingsView {
  data?: { items: import("../types").HistoryItem[]; total: number; conversations: number; more: boolean; busy?: boolean; error?: string };
  /** An absent runtime is shown once in the existing computer settings area. */
  desktopRequired?: boolean;
  computerRemote?: boolean;
  computerAliasDraft?: string;
  computerHostError?: boolean;
  computerHostHealth?: import('../api').ComputerHostHealth;
  checkingComputerHost?: boolean;
  modelsTab?: ModelsTab;
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
  cityDraft: string | null;
  cityError: (() => string) | null;
  /** Telegram, in the 訊息平台 tab. */
  messaging: MessagingView;
  /** Raphael's own memory, in the 拉斐爾 tab, after its settings (none: not drawn). */
  memory?: MemoryView;
  /** The owner's safety rules, in the 拉斐爾 tab, after the memory (none: not drawn). */
  rules?: RulesView;
  /** 「共同記憶」, which every agent shares, drawn before Raphael's own (none: not drawn). */
  memoryShared?: MemoryView;
  /** 服務, in the 拉斐爾 tab: who searches, reads pages and PDFs, and looks at images (none: not drawn). */
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
export const agentCity = (v: SettingsView): string => v.brain?.agent_city ?? "";
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
          btn(t("home.018"), "", ' data-act="key-replace" data-k="key"'),
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

/** This month's recorded spend, independent of the retired spending caps. */
function spendRow(v: SettingsView): string {
  const attrs = ' data-row="raphael-spend"';
  const { spend } = v;
  if (!spend) return row(t("settings.050"), "", esc(t("settings.usageUnavailable")), { attrs });
  return row(t("settings.050"), "", `<span class="val num">${esc(formatUsd(spend.month_usd))}</span>`, { attrs });
}

/** Key-wide usage is separate from Raphael's local spending and its editable limit. */
function usageRow(v: SettingsView): string {
  const { hasKey, openrouter, checkingOpenrouter } = v;
  const usage = hasKey ? openrouter?.usage : null;
  const monthly = usage?.monthly;
  const available = monthly != null && Number.isFinite(monthly);
  const state = !hasKey ? "no-key" : available ? (openrouter?.state === "error" ? "stale" : "ready") : checkingOpenrouter ? "loading" : "unavailable";
  const details: string[] = [];
  if (usage?.limit != null && Number.isFinite(usage.limit)) {
    details.push(`<span data-usage="limit">${esc(t("settings.usageLimit", { p0: formatUsd(usage.limit) }))}</span>`);
  }
  if (usage?.limit_remaining != null && Number.isFinite(usage.limit_remaining)) {
    details.push(`<span data-usage="remaining">${esc(t("settings.usageRemaining", { p0: formatUsd(usage.limit_remaining) }))}</span>`);
  }
  if (state === "stale") details.push(esc(t("settings.usageCached")));
  const value = available ? formatUsd(monthly) : !hasKey ? t("settings.usageNoKey") : checkingOpenrouter ? t("common.loading") :
    openrouter?.state === "unknown" ? t("settings.usageUnchecked") : t("settings.usageUnavailable");
  return row(
    t("settings.usageMonthly"),
    details.join(" · "),
    `<span class="${available ? "val num" : "val"}" data-usage="monthly">${esc(value)}</span>`,
    { attrs: ` data-row="openrouter-usage" data-usage-state="${state}"` },
  );
}

// ---------- the parts of every tab ----------

/** A group of settings: a short name, then its rows on one card. */
const section = (title: string, rows: string[], foot = ""): string =>
  `<section class="sgroup">${title ? `<h2>${esc(title)}</h2>` : ""}<div class="slist">${rows.join("")}</div>` +
  (foot ? `<p class="foot">${foot}</p>` : "") +
  `</section>`;

/**
 * A shortcut: its keys as caps and, for one that can be changed here, a 「變更」 button that records
 * new ones (`change` names the button for the click handler and the focus).
 */
function shortcutRow(name: string, bindings: readonly string[], change?: { act: string; field: HotkeyField }): string {
  const caps = bindings.length > 0
    ? bindings.map((binding) => keys(bindingLabels(binding))).join(t("common.or"))
    : `<span class="val">${esc(t("home.noKeys"))}</span>`;
  return row(
    name,
    "",
    `<span class="caps">${caps}</span>` + (change ? btn(t("home.018"), "", ` data-act="${change.act}" data-k="${change.act}"`) : ""),
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
  const title = `<h1 id="set-title" tabindex="-1">${esc(paneTitle(v.pane))}</h1>`;
  return actions ? `<div class="set-head">${title}${actions}</div>` : title;
};

/** What the tabs that need the core say when it does not answer. */
const coreNote = (v: SettingsView): string => (v.brain === null ? `<div class="alert core-note">${st("err", t("settings.052"))}</div>` : "");

// ---------- the tabs ----------

/** 一般: the language of the window, and how Raphael looks and starts on this computer. */
function generalHTML(v: SettingsView): string {
  const d = v.device;
  return (
    headingHTML(v) +
    coreNote(v) + ownerProfileHTML(v.brain) +
    section(t("settings.groupAppearance"), [
      row(t("settings.069"), "", sel(SIZES, String(d.emblem_size), t("settings.069"), ' data-k="size"')),
      row(t("settings.071"), "", tg(d.subtitles !== "off", t("settings.071"), ' data-k="subtitles"')),
    ]) +
    section(t("settings.groupStartup"), [
      row(t("settings.073"), "", tg(d.autostart, t("settings.073"), ' data-k="autostart"')),
      row(t("settings.rerunGuide"), "", btn(esc(t("settings.rerunGuideButton")), "", ' data-act="rerun-guide"')),
    ]) + `<section class="mb-hidden-list" data-hidden-members></section>`
  );
}

/** 聽寫: how a dictation starts (the keys and the mode), and how Raphael listens (the languages and the microphone). */
function dictationHTML(v: SettingsView): string {
  const d = v.device;
  return (
    headingHTML(v) +
    coreNote(v) +
    section(t("settings.groupStart"), [
      shortcutRow(t("home.020"), d.dictation_keys, { act: "rec", field: "dictation_keys" }),
      ...altgrNote(v, d.dictation_keys),
      ...(d.paste_last_keys.length ? [shortcutRow(t("home.021"), d.paste_last_keys)] : []),
      shortcutRow(t("common.cancel"), ["Escape"]),
      row(t("settings.055"), "", sel(DICTATION_MODES, d.dictation_mode, t("settings.055"), ' data-k="mode"')),
    ]) +
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
    ])
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
  const remote = v.computerRemote ?? !!v.brain?.computer_ssh_alias;
  const desktop = [
    row(t("desktop.host"), t("desktop.memberLogins"), sel([
      { value: "local", label: t("desktop.local") }, { value: "remote", label: t("desktop.remote") },
    ], remote ? "remote" : "local", t("desktop.host"), ` data-k="computer-host"${v.brain ? "" : " disabled"}`)),
    ...(remote ? [row(t("desktop.sshAlias"), "", fieldHTML("", v.computerAliasDraft ?? v.brain?.computer_ssh_alias ?? "", {
      id: "computer-ssh-alias", label: t("desktop.sshAlias"), w: 200, disabled: !v.brain, invalid: v.computerHostError,
    })), ...(v.computerHostError ? [note(st("err", t("desktop.invalidAlias")), ' role="alert" data-computer-host-error')] : [])] : []),
    ...(remote ? [row(t('desktop.checkHost'), '', btn(t(v.checkingComputerHost ? 'desktop.checkingHost' : 'desktop.checkHost'), 'sm', ` data-act="computer-host-check"${v.checkingComputerHost || v.computerHostError ? ' disabled' : ''}`)),
      ...(v.computerHostHealth ? v.computerHostHealth.checks.flatMap(check => {
        const words = { ssh: 'desktop.health.ssh', docker: 'desktop.health.docker', ssh_unreachable: 'desktop.health.ssh_unreachable', ssh_key: 'desktop.health.ssh_key', docker_path: 'desktop.health.docker_path', docker_missing: 'desktop.health.docker_missing', docker_stopped: 'desktop.health.docker_stopped', architecture: 'desktop.health.architecture', image_missing: 'desktop.health.image_missing' } as const;
        const label = t(check.kind.startsWith('ssh') ? 'desktop.health.connection' : check.kind === 'architecture' || check.kind === 'image_missing' ? 'desktop.health.image' : 'desktop.health.runtime');
        const state = check.ok ? t('desktop.health.ok') : t(words[check.kind as keyof typeof words] ?? 'desktop.health.ssh_unreachable');
        const repair: { where: 'desktop.health.macTerminal' | 'desktop.health.projectTerminal' | 'desktop.health.localTerminal'; command: string } = check.kind === 'docker_path' ? { where: 'desktop.health.macTerminal', command: `echo 'export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"' >> ~/.zshenv` } :
          check.kind === 'docker_stopped' ? { where: 'desktop.health.macTerminal', command: 'open -a Docker' } :
          check.kind === 'docker_missing' ? { where: 'desktop.health.macTerminal', command: 'open https://www.docker.com/products/docker-desktop/' } :
          check.kind === 'architecture' || check.kind === 'image_missing' ? { where: 'desktop.health.projectTerminal', command: 'docker build --tag raphael/cua-local-vm:driver-0.37.0-v4 core/src/raphael_core/computer/image' } :
          { where: 'desktop.health.localTerminal', command: `ssh ${v.computerHostHealth!.host}` };
        return [row(esc(label), '', st(check.ok ? 'ok' : 'err', state), { attrs: ` data-computer-host-health="${esc(check.kind)}" role="status"` }),
          ...(!check.ok ? [note(`<p>${esc(t(repair.where))}</p>` + messageHTML('```sh\n' + repair.command + '\n```', '', true), ' data-computer-host-repair')] : [])];
      }) : [])] : []),
    ...(!remote && v.desktopRequired ? [row(esc(t("desktop.required")), "", btn(t("desktop.download"), "sm", ' data-act="docker-download"'))] : []),
    row(t("local.title"), "", sel(LOCAL_COMMAND_MODES, v.brain?.local_commands_mode ?? "ask", t("local.title"), ` data-k="local-commands"${v.brain === null ? " disabled" : ""}`)),
  ];
  if (apps.length === 0) return [...desktop, row(`<span class="val">${esc(t("settings.computerNone"))}</span>`)];
  return [...desktop, ...apps.map((app) =>
    row(esc(app.name), "", iconBtn("more", t("members.more", { p0: app.name }), ` data-act="computer-menu" data-exe="${esc(app.exe)}" aria-haspopup="menu" aria-expanded="false"`)),
  )];
}

/**
 * 拉斐爾: the key that asks Raphael, the city of the weather, what a background task may spend,
 * then the services of his tools (services.ts), his memory (the shared one first, then his own),
 * the owner's safety rules (safety-rules.ts) and the apps he may always operate. The model that
 * answers is with the other models. His picture is changed in his details panel on the 拉斐爾 page,
 * as every member's is (member-details.ts).
 */
function agentHTML(v: SettingsView): string {
  const cityShown = v.cityDraft ?? agentCity(v);
  // an app from before the question key has none yet
  const agentKeys = v.device.agent_keys ?? [];
  return (
    headingHTML(v) +
    coreNote(v) +
    section("", [
      shortcutRow(t("settings.agentKeys"), agentKeys, { act: "rec-agent", field: "agent_keys" }),
      ...altgrNote(v, agentKeys),
      row(
        t("settings.agentCity"),
        "",
        fieldHTML(t("settings.agentCityHint"), cityShown, { w: 200, get label() { return t("settings.agentCity"); }, id: "agent-city", invalid: v.cityError !== null, disabled: v.brain === null }),
      ),
      ...(v.cityError ? [note(st("err", v.cityError()), ' role="alert"')] : []),
    ]) +
    (v.services ? servicesHTML(v.services, modelPickerHTML(visionPickerLook(v)), v.brain) : "") +
    (v.memoryShared ? memoryHTML(v.memoryShared) : "") +
    (v.memory ? memoryHTML(v.memory) : "") +
    (v.rules ? rulesHTML(v.rules) : "") +
    section(t("settings.computerUse"), computerRows(v))
  );
}

/** 連接: the services Raphael is connected to and the store that adds them, under the heading and its 「新增」. */
function connectionsTabHTML(v: SettingsView): string {
  return headingHTML(v, connectionsAddHTML()) + connectionsHTML(v.connections);
}

/** 訊息平台: Telegram, where Raphael can be reached from a phone (Slack and Discord to come here too). */
function messagingTabHTML(v: SettingsView): string {
  return headingHTML(v) + messagingHTML(v.messaging);
}

/** The dictation history's retention: the choices, with the one in force too if it is none of them. */
export function retentionChoices(v: SettingsView): Choice[] {
  const current = retentionOf(v);
  return RETENTIONS.some((c) => c.value === current) ? RETENTIONS : [...RETENTIONS, { value: current, label: formatRetention(Number(current)) }];
}

/** How long the dictation history is kept, as the value of its dropdown (30 days until the core says). */
export const retentionOf = (v: SettingsView): string => String(v.brain?.history_retention_days ?? 30);

function dataHTML(v: SettingsView): string {
  const data = v.data;
  const clear = (what: string, count: number) => count > 0 ? btn(esc(t("data.deleteAll")), "sm", ` data-act="data-clear" data-what="${what}"${data?.busy ? " disabled" : ""}`) : "";
  const records = data?.items.map(item => `<div class="data-record" data-record="${item.id}"><time class="num" datetime="${new Date(item.created_at_ms).toISOString()}">${esc(formatShortDateTime(item.created_at_ms, v.now))}</time><div class="data-record-text">${esc(item.text)}</div></div>`).join("");
  return headingHTML(v) + coreNote(v) +
    `<section class="sgroup data-section"><div class="data-heading"><h2>${esc(t("data.groupDictation"))}</h2>${clear("dictation", data?.total ?? 0)}</div><div class="slist">` +
    row(t("data.retention"), "", sel(retentionChoices(v), retentionOf(v), t("data.retention"), ` data-k="retention"${v.brain === null ? " disabled" : ""}`)) +
    (records || `<p class="note">${esc(t(data ? "data.emptyDictation" : "settings.loading"))}</p>`) +
    (data?.more ? btn(esc(t("history.009")), "sm", ` data-act="data-more"${data.busy ? " disabled" : ""}`) : "") + `</div></section>` +
    `<section class="sgroup data-section"><div class="data-heading"><h2>${esc(t("data.groupConversation"))}</h2>${clear("conversation", data?.conversations ?? 0)}</div><p class="note">${esc(data ? t("data.conversationCount", {p0:data.conversations}) : t("settings.loading"))}</p></section>` +
    (data?.error ? `<p class="note" role="alert">${esc(data.error)}</p>` : "");
}

/** One page with model connections and usage in separate views. Legacy ids choose their own view. */
function modelsHTML(v: SettingsView): string {
  const providers = v.providers ?? emptyProvidersView();
  const selected = v.modelsTab ?? (v.pane === "usage" ? "usage" : "models");
  const content = selected === "models" ? section(t("models.used"), [quickRow(v), ...MODEL_ROWS.slice(1).map(r => modelRow(v, r))], v.catalog === "failed" ? priceSpan(v, "note") : "") +
    cliBrainsHTML(v.cliBrains ?? emptyCliBrainsView()) + providersHTML(providers) + providersAddHTML(providers) :
    `<div data-usage-host></div><section class="sgroup" aria-label="${esc(t("models.usage"))}"><div class="slist">` + [
      keyRow(v),
      ...(v.keyError ? [note(st("err", v.keyError()), ' role="alert"')] : []),
      spendRow(v),
      usageRow(v),
    ].join("") + `</div><p class="foot">${esc(t("settings.usageDifference"))}</p></section>`;
  return headingHTML(v) + coreNote(v) + `<div class="models-page">` +
    tabs((["models", "usage"] as const).map((id) => ({
      id, label: id === "models" ? t("providers.title") : t("models.usage"),
      attrs: ` id="models-tab-${id}" data-models-tab="${id}" data-k="models-tab:${id}" aria-controls="models-panel-${id}" tabindex="${id === selected ? 0 : -1}"`,
    })), selected, { label: t("settings.paneUsage"), kind: "nav", plain: true, fill: true }) +
    (["models", "usage"] as const).map((id) => `<div class="models-content" id="models-panel-${id}" role="tabpanel" aria-labelledby="models-tab-${id}"${id === selected ? "" : " hidden"}>${id === selected ? content : ""}</div>`).join("") + `</div>`;
}

/** 關於: the version, the license and the fan-project statement. */
function aboutHTML(v: SettingsView): string {
  return (
    headingHTML(v) +
    `<div class="about-brand">${brandIcon("about-icon")}<span class="about-name">Raphael</span></div>` +
    `<div class="slist about">` +
    row(t("settings.078"), "", `<span class="val num">${esc(v.version)}</span>`) +
    row(t("nav.help"), "", btn(t("nav.help"), "", ' data-act="help"')) +
    row(t("settings.079"), t("settings.080"), btn(t("settings.081"), "", ' data-act="license"')) +
    `</div>` +
    t("settings.082")
  );
}

/** The tab that is open, as HTML. */
export function paneHTML(v: SettingsView): string {
  switch (v.pane) {
    case "appearance":
      return headingHTML(v) + coreNote(v) + `<div class="appearance-settings">` + section("", [
        row(t("settings.067"), "", sel(APPEARANCES, v.device.appearance, t("settings.067"), ' data-k="appearance"')),
        row(t("settings.059"), "", sel(UI_LANGUAGES, v.device.ui_language, t("settings.059"), ' data-k="ui-language"')),
      ]) + `</div>`;
    case "general":
      return generalHTML(v);
    case "dictation":
      return dictationHTML(v);
    case "agent":
      return agentHTML(v);
    case "connections":
      return connectionsTabHTML(v);
    case "messaging":
      return messagingTabHTML(v);
    case "usage":
    case "models":
      return modelsHTML(v);
    case "data":
      return dataHTML(v);
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
