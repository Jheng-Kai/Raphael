// 連結應用程式, one view as Grok Bot's Connect Apps (owner, 2026-11-12): a search over the whole catalog, a row of category chips, then
// 為你推薦 and a section for each category (or one list for a chosen chip or a search); the connected and the ones to connect stand together,
// with no tabs and no count of the catalogue. A chip at the top right opens the list of the connected apps (managed toolkits, private Google and
// custom MCP servers; connectors only, since a member's skills are managed in that member's own panel: the number is the core's, the one the
// sidebar and every model's roster show). An app's page, connected or not, replaces the view: its tools by write/read with their switches
// and how many are on, its information, and removal in the overflow menu. Existing custom MCP setup and device reauthentication stay available.
// Secrets go directly to the core vault and never enter the render snapshot.

import { noticeHTML } from "./missing";
import * as api from "./api";
import { type InventoryView, appOf, connectedCount, isConnected, whyNot } from "./apps-inventory";
import { openConnectionSetup } from "./connection-setup";
import { openDialog as openMemberDialog } from "./member-dialogs";
import { managedGroup, pluginTool, storePlugin, type ManagedConnector } from "./plugins-data";
import { openMcpImport } from "./mcp-import";
import { isTopLayer, registerDismissal } from "./dismissals";
import { dayLabel, describeError, formatClock } from "./format";
import { getLocale, t } from "./i18n";
import { STORE_GROUPS, popularApp, popularRank, storeGroup, storeMatches, storeNear } from "./store-finder";
import type { MessageKey } from "./i18n/zh-TW";
import { serviceIconOf } from "./service-icons";
import { entryIcon } from "./service-mark";
export { entryIcon, iconHTML } from "./service-mark";
import type { AuditEntry, ConnectionGroup, ConnectionTool, MainEvent, NewConnection, StoreService, Words } from "./types";
import { DISCONNECT_CONFIRM_MS, type Choice, actionRow, btn, closeMenu, copyButton, esc, fieldHTML, ico, iconButton, openPopover, row, sel, st, tg, toaster } from "./ui";

/** `t` for a key that is chosen at run time (its placeholders, if any, are none). */
const tr = t as unknown as (key: MessageKey) => string;
const STORE_GROUP_LABELS: Record<string, MessageKey> = {
  communication: "store.group.communication",
  productivity: "store.group.productivity",
  development: "store.group.development",
  documents: "store.group.documents",
  marketing: "store.group.marketing",
  sales: "store.group.sales",
  finance: "store.group.finance",
  media: "store.group.media",
  other: "store.group.other",
};

/** Where a service that is signed in to with a code keeps the list of the apps it has let in. */
const GRANTS_URL: Record<string, string> = { github: "https://github.com/settings/applications" };

/** How many of the latest actions the dialog of a service lists. */
const AUDIT_SHOWN = 5;
/** How many of the latest actions are read, to find each service's own among them. */
const AUDIT_READ = 50;

// ---------- what the dialog is drawn from ----------

/** What the dialog shows when no app's page is open: the one view of the apps, or the list of the connected ones. */
export type Screen = "apps" | "connected";
/** An app's page: an app of the catalog (by its id) or a connected one (by the id of its connection). */
export interface OpenApp {
  kind: "app" | "group";
  id: string;
}
export type ToolKind = ConnectionTool["kind"];

export interface PairDraft {
  name: string;
  value: string;
}

/** Split on the first equals sign only: tokens frequently contain padding or other equals signs. */
export function parseMcpPairs(text: string): PairDraft[] {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const at = line.indexOf("=");
    if (at < 1) throw new Error(t("mcp.badPair"));
    return { name: line.slice(0, at).trim(), value: line.slice(at + 1) };
  });
}

/** The form that connects a server of the user's own. */
export interface ConnectionForm {
  id?: string;
  pairLines?: string;
  limit?: number;
  testReport?: string;
  type: "stdio" | "http";
  name: string;
  command: string;
  args: string;
  url: string;
  /** The example address an app of `PRESET_FORMS` shows in the empty address field. */
  urlHint?: string;
  busy: boolean;
  error: (() => string) | null;
}

/** The login in the browser that is under way, and what it is for: a store entry's id, or a connected service's. */
export interface Login {
  target: string;
  name: string;
}

/** The code of a device login that is waiting for the user to type it at the service. */
export interface DeviceCode {
  catalog_id: string;
  user_code: string;
  verification_uri: string;
}

export interface ConnectionsView {
  configured: boolean | null;
  categories: Choice[];
  category: string;
  keyOpen: boolean;
  keyBusy: boolean;
  keyError: "" | "openrouter_key" | "consumer_key" | "auth" | "unreachable" | "unknown";
  /** The connected services: being read, read, or not to be had. */
  groups: ConnectionGroup[] | "loading" | "failed";
  /** Built-in services, loaded independently from the optional managed catalog. */
  catalog: StoreService[] | "loading" | "failed";
  composioCatalog: StoreService[] | "loading" | "failed";
  /** The owner's apps as the core counts them: the number on the chip at the top is its count, the one of the sidebar and the roster. */
  inventory: InventoryView;
  /** Which section each row took when this visit first read it. */
  placed?: ReadonlyMap<string, boolean | null>;
  audit: AuditEntry[];
  /** The one view of the apps, or the list of the connected ones (the chip at the top right). */
  screen: Screen;
  /** What was typed in the search box. */
  search: string;
  /** How many rows of a long list are drawn; more are drawn as it is scrolled. */
  shown?: number;
  /** 為你推薦 shows every one of its apps, not the first few. */
  recommendedAll?: boolean;
  /** What is open: an app's page, in the place of the dialog's view. */
  open: OpenApp | null;
  /** The dialog's list of tools is unfolded. */
  toolsOpen: boolean;
  /** The dialog's latest actions are unfolded. */
  auditOpen: boolean;
  /** The service whose 「中斷連線」 was pressed once. */
  confirmingDisconnect: string | null;
  /** The services a call is under way for. */
  busy: ReadonlySet<string>;
  login: Login | null;
  /** The code to type, while a device login waits for it. */
  device: DeviceCode | null;
  /** What went wrong with the latest login, for the app's page. */
  loginError: { target: string; kind: string } | null;
  /** Feedback stays inside the open dialog, clear of its actions. */
  dialogNotice: { text: string; kind: "ok" | "err" } | null;
  form: ConnectionForm | null;
  now: number;
}

export const emptyConnectionsView = (): ConnectionsView => ({
  configured: null, categories: [], category: "", keyOpen: false, keyBusy: false, keyError: "",
  groups: "loading",
  catalog: "loading",
  composioCatalog: "loading",
  inventory: "loading",
  audit: [],
  screen: "apps",
  search: "",
  open: null,
  toolsOpen: false,
  auditOpen: false,
  confirmingDisconnect: null,
  busy: new Set(),
  login: null,
  device: null,
  loginError: null,
  dialogNotice: null,
  form: null,
  now: Date.now(),
});

const emptyForm = (): ConnectionForm => ({
  type: "stdio",
  name: "",
  command: "",
  args: "",
  url: "",
  pairLines: "",
  busy: false,
  error: null,
});

/**
 * Apps the store offers as the owner's own server, filled in. n8n runs at each owner's own address and has no Composio
 * toolkit, so the built-in catalogue (fixed official addresses only) cannot carry it; its 加入 opens the server form with the type, name and header already there.
 */
const PRESET_FORMS: Record<string, Pick<ConnectionForm, "type" | "name" | "pairLines" | "urlHint">> = {
  n8n: { type: "http", name: "n8n", pairLines: "Authorization=Bearer ", urlHint: "https://n8n.example.com/mcp-server/http" },
};

/**
 * The store entries of `PRESET_FORMS`, in the current language; `serverOf` names the connection that already is the app.
 * The guide offers them too, with the address and the key typed in the tile (onboarding/screens.ts).
 */
export function ownServerApps(serverOf: (icon: string) => string | null = () => null): StoreService[] {
  // Drawn again for each language: the three required languages carry the current one's words.
  const said = (key: "store.n8nSummary" | "store.n8nAbout"): Words => { const text = t(key); return { "zh-TW": text, en: text, ja: text }; };
  const examples = [t("store.n8nTry")];
  return [{
    id: "n8n", name: "n8n", publisher: "n8n", url: "", category: "productivity", icon: "n8n", popular: false, auth: "none",
    summary: said("store.n8nSummary"), about: said("store.n8nAbout"), examples: { "zh-TW": examples, en: examples, ja: examples },
    server_id: serverOf("n8n"),
  }];
}

/** How an own-server app is reached: the name it is added as, its address's example, and its key's header with what goes before the key. */
export function ownServerForm(id: string): { name: string; urlHint: string; header: string; prefix: string } | null {
  const preset = PRESET_FORMS[id];
  if (!preset) return null;
  const [header = "Authorization", prefix = ""] = (preset.pairLines ?? "").split(/=(.*)/s);
  return { name: preset.name, urlHint: preset.urlHint ?? "", header, prefix };
}

/**
 * The owner's own Google: the store's row for Gmail and Calendar through a Google Cloud client of their own, no Composio. Like n8n it
 * is set up in the conversation (the member shows the card that walks the steps and takes the Client ID and Client secret), so its
 * 加入 leaves for the composer; it is marked added once that connection exists. It is the store's only, never the guide's.
 */
export const OWN_GOOGLE = "google";
export function ownGoogleEntry(googleId: string | null): StoreService {
  const said = (key: "plugins.googleDescription" | "store.googleAbout"): Words => { const text = t(key); return { "zh-TW": text, en: text, ja: text }; };
  const examples = [t("store.googleSetUp")];
  return {
    id: OWN_GOOGLE, name: t("plugins.privateGoogle"), publisher: "Google", url: "", category: "productivity", icon: "gmail", popular: false, auth: "none",
    summary: said("plugins.googleDescription"), about: said("store.googleAbout"), examples: { "zh-TW": examples, en: examples, ja: examples },
    server_id: googleId,
  };
}

/** The store entries of `PRESET_FORMS` and the owner's own Google, marked added when a connection already is that app. */
function presetEntries(v: ConnectionsView): StoreService[] {
  if (!Array.isArray(v.catalog)) return [];
  const groups = Array.isArray(v.groups) ? v.groups : [];
  return [...ownServerApps((icon) => groups.find((g) => serviceIconOf({ name: g.name, url: g.url }) === icon)?.id ?? null),
    ownGoogleEntry(groups.find((g) => g.source === "google")?.id ?? null)];
}

// ---------- words ----------

const typeChoices = (): Choice[] => [
  { value: "stdio", label: t("conn.type.stdio") },
  { value: "http", label: t("conn.type.http") },
];

/** The words in the language of the window. */
const words = (w: Words): string => w[getLocale()] ?? w.en;

const FAILURES: Record<string, MessageKey> = {
  mcp_unavailable: "missing.installation",
  not_found: "conn.err.not_found",
  timeout: "conn.err.timeout",
  auth: "conn.err.auth",
  network: "conn.err.network",
  protocol: "conn.err.protocol",
  missing_secret: "conn.err.missing_secret",
  gone: "conn.err.gone",
  denied: "conn.err.denied",
  toolkit_not_allowed: "conn.err.toolkit_not_allowed",
  invalid_request: "conn.err.invalid_request",
  error: "conn.err.error",
};

const failureText = (kind: string | null): string => tr(FAILURES[kind ?? ""] ?? FAILURES.error);

/** What to tell the user about a login that did not work out, in a line. */
function loginFailure(kind: string): string {
  if (kind === "toolkit_not_allowed") return failureText(kind);
  if (kind === "denied") return t("conn.loginFail.denied");
  if (kind === "timeout") return t("conn.loginFail.timeout");
  return t("conn.loginFail.other", { p0: failureText(kind) });
}

const loginErrorHTML = (v: ConnectionsView, target: string): string =>
  v.loginError?.target === target ? `<div class="note" role="alert">${st("err", loginFailure(v.loginError.kind))}</div>` : "";

const dialogNoticeHTML = (v: ConnectionsView): string => v.dialogNotice
  ? `<div class="note" role="${v.dialogNotice.kind === "err" ? "alert" : "status"}" data-cs-notice>${st(v.dialogNotice.kind, v.dialogNotice.text)}</div>` : "";

// ---------- what the services are ----------

/** The store's entry a connected service was added from. */
function entryOf(g: ConnectionGroup, v: ConnectionsView): StoreService | undefined {
  return g.catalog_id && Array.isArray(v.catalog) ? v.catalog.find((s) => s.id === g.catalog_id) : undefined;
}

/** The login of a service ran out or was never finished: it asks to sign in again. */
export const needsLogin = (g: ConnectionGroup): boolean => g.auth !== "none" && g.status === "error" && g.error === "auth";

/** The first thing to say to 拉斐爾 with a service of the store, in the language of the window: what 「試試看」 puts in the composer. */
export function examplePrompt(s: StoreService | undefined): string | null {
  if (!s) return null;
  return (s.examples[getLocale()] ?? s.examples.en ?? [])[0] ?? null;
}

function groupIcon(g: ConnectionGroup, v: ConnectionsView, size: "md" | "xl"): string {
  const entry = entryOf(g, v);
  // The private Google connection is Gmail and its calendar: it wears Gmail's mark, never a generic plug (R-UI-28).
  const icon = g.source === "google" ? "gmail" : entry?.icon ?? serviceIconOf({ name: g.name, command: g.command, args: g.args, url: g.url });
  return entryIcon({ name: g.name, logo: g.logo, icon }, size);
}

/** The command or URL of a custom service; the row ellipsizes it and its title keeps it whole. */
function where(g: ConnectionGroup): string {
  return g.transport === "http" ? g.url : [g.command, ...g.args].join(" ");
}

/** The short line under a service's name: what it is for, or what is wrong with it. */
function lineOf(g: ConnectionGroup, v: ConnectionsView): string {
  if (needsLogin(g)) return st("err", t("conn.status.relogin"));
  if (g.status === "error") return st("err", t("conn.status.error", { p0: failureText(g.error) }));
  if (g.status === "unchecked") return esc(t("conn.status.unchecked"));
  // On and well, and still not one of the connected apps: a second way to an app that is counted, or every tool off.
  const state = appOf(v.inventory, g.id)?.state;
  const why = state ? whyNot(state) : null;
  if (why) return st(why === "conn.state.unknown" ? "warn" : "idle", tr(why));
  const entry = entryOf(g, v);
  return esc(g.description || (entry ? words(entry.summary) : where(g)));
}

// ---------- the dialog's one view, as Grok Bot's Connect Apps ----------
// (owner, 2026-11-12: 「它不會分已連結跟商店，他們都在一起…上面放你已連接的，下面放一些推薦的…分全部、溝通、生產力、開發之類的…也不會顯示它現在有幾個」)

/** The chip at the top right: the marks of up to four connected apps, overlapped, then how many are connected. */
const HAVE_MARKS = 4;

/** How many apps a section of 全部 shows before 查看全部, and how many rows a list shows before the next ones are drawn as it scrolls. */
const SECTION_SIZE = 6;
const LIST_STEP = 24;
/** The category chips that stand in the row; the rest are in 更多 (a chosen one always stands). */
const CHIP_CAP = 5;

const groupLabel = (group: string): string => tr(STORE_GROUP_LABELS[group] ?? STORE_GROUP_LABELS.other!);
const byRank = (a: StoreService, b: StoreService): number => popularRank(a) - popularRank(b) || a.name.localeCompare(b.name);

/** Every app the store offers, connected or not: built in, the owner's own, then Composio's. */
function everyApp(v: ConnectionsView): StoreService[] {
  return [...(Array.isArray(v.catalog) ? v.catalog : []), ...presetEntries(v), ...uniqueComposio(v)];
}

/** What a search finds over the whole catalog: as typed first, then the apps whose names it only nearly spells, nearest first. */
function searchApps(apps: StoreService[], query: string): StoreService[] {
  const found = apps.filter((s) => storeMatches(s, query)).sort(byRank);
  const have = new Set(found);
  const near = apps.filter((s) => !have.has(s)).map((s) => [s, storeNear(s, query)] as const).filter(([, score]) => score < Infinity);
  return [...found, ...near.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name)).map(([s]) => s)];
}

/** Well-known apps that are not connected yet, in the order the catalog ranks them; never one that is there already, however it was added. */
function recommendedApps(v: ConnectionsView, apps: StoreService[]): StoreService[] {
  const groups = Array.isArray(v.groups) ? v.groups : [];
  // Never an app already there, however it was added (Notion directly, Gmail through the Google connection).
  const fold = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const present = groups.map((g) => fold(`${g.id} ${g.name} ${g.description ?? ""} ${entryOf(g, v)?.id ?? ""}`));
  const added = (s: StoreService): boolean => [fold(s.id.replace(/^composio:/i, "")), fold(s.name)].some((key) => key.length > 2 && present.some((text) => text.includes(key)));
  return apps.filter((s) => !s.server_id && popularApp(s) && !added(s)).sort(byRank);
}

interface AppsLayout {
  /** What the search or the chosen chip lists; null under 全部 with nothing typed. */
  list: StoreService[] | null;
  recommended: StoreService[];
  recommendedMore: boolean;
  sections: { group: string; items: StoreService[]; more: boolean }[];
}

function layoutOf(v: ConnectionsView): AppsLayout {
  const apps = everyApp(v);
  if (v.search.trim()) return { list: searchApps(apps, v.search), recommended: [], recommendedMore: false, sections: [] };
  if (v.category) return { list: apps.filter((s) => storeGroup(s) === v.category).sort(byRank), recommended: [], recommendedMore: false, sections: [] };
  const all = recommendedApps(v, apps);
  const recommended = v.recommendedAll ? all : all.slice(0, SECTION_SIZE);
  const shown = new Set(recommended);
  const sections = STORE_GROUPS.map((group) => {
    const items = apps.filter((s) => storeGroup(s) === group && !shown.has(s)).sort(byRank);
    return { group, items: items.slice(0, SECTION_SIZE), more: items.length > SECTION_SIZE };
  }).filter((section) => section.items.length);
  return { list: null, recommended, recommendedMore: all.length > recommended.length, sections };
}

/** The mark of an app on the white tile of its row (Grok Bot's): bare, in its own colours, whichever theme the dialog is in. */
const tileHTML = (mark: string, size: "" | "lg" = ""): string => `<span class="cs-tile${size ? ` ${size}` : ""}" aria-hidden="true">${mark}</span>`;

/** The button that connects an app, or what takes its place: the wait for its login, or that it is connected. */
function joinControl(s: StoreService, v: ConnectionsView): string {
  const here = v.login?.target === s.id;
  if (s.server_id) return `<span class="cs-state">${ico("check")}<span>${esc(t("conn.tab.installed"))}</span></span>`;
  // Managed sign-in has no cancellation RPC; keep the shared action disabled until it completes.
  if (here) return btn(esc(t("conn.cancel")), "cs-connect", ` data-conn="cancel-login"${s.source ? " disabled" : ""}`);
  return btn(esc(t("conn.connect")), "cs-connect", ` data-conn="join" data-id="${esc(s.id)}" aria-label="${esc(t("conn.connectAria", { p0: s.name }))}"${v.login ? " disabled" : ""}`);
}

/** An app that is set up in the conversation rather than here: a server of the owner's own, or a developer app of theirs. */
const inChat = (s: StoreService): boolean => !!PRESET_FORMS[s.id] || s.id === OWN_GOOGLE || s.needs === "own_app";

const storeMark = (s: StoreService): string => entryIcon(s, "md").replace(/<img /g, '<img decoding="async" ');

/** A row of the dialog: the mark on its tile and the name open the app's page; 「連結」 (or 「✓ 已連結」) stands at the right. */
function appRowHTML(s: StoreService, v: ConnectionsView): string {
  const here = v.login?.target === s.id;
  const wait = here ? `<span class="sub wait">${esc(t(s.auth === "none" ? "conn.connecting" : "conn.loggingIn"))}</span>` : "";
  const summary = words(s.summary);
  return (
    `<div class="cs-card">` +
    btn(
      `${tileHTML(storeMark(s))}<span class="tx"><span class="nm">${esc(s.name)}</span>${wait}</span>`,
      "cs-main",
      ` data-conn="open-store" data-id="${esc(s.id)}" data-k="cs-store:${esc(s.id)}"${summary ? ` title="${esc(summary)}"` : ""}`,
    ) +
    `${joinControl(s, v)}</div>`
  );
}

const gridHTML = (apps: StoreService[], v: ConnectionsView): string => `<div class="cs-grid">${apps.map((s) => appRowHTML(s, v)).join("")}</div>`;

function sectionHTML(title: string, apps: StoreService[], v: ConnectionsView, more: { attrs: string } | null): string {
  const viewAll = more ? btn(esc(t("common.showAll")), "cs-viewall", more.attrs) : "";
  return `<section class="cs-sec"><div class="cs-sec-head"><h2>${esc(title)}</h2>${viewAll}</div>${gridHTML(apps, v)}</section>`;
}

function keyErrorMessage(kind: ConnectionsView["keyError"]): string {
  switch (kind) {
    case "openrouter_key": return t("plugins.keyOpenRouter");
    case "consumer_key": return t("plugins.keyConsumer");
    case "auth": return t("plugins.keyRefused");
    case "unreachable": return t("plugins.keyUnreachable");
    default: return t("plugins.keyFailed");
  }
}

/** What a Composio key that was not saved is told as, from the core's word for why (the store and the guide alike). */
export function composioKeyProblem(kind: string): string {
  return keyErrorMessage(kind === "openrouter_key" || kind === "consumer_key" || kind === "auth" ? kind : kind === "network" || kind === "timeout" ? "unreachable" : "unknown");
}

/** Built-in apps win over matching managed slugs or names, regardless of the current filter. */
function uniqueComposio(v: ConnectionsView): StoreService[] {
  if (!v.configured || !Array.isArray(v.composioCatalog)) return [];
  const identity = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const owned = new Set((Array.isArray(v.catalog) ? v.catalog : []).flatMap(s => [identity(s.id), identity(s.name)]));
  const seen = new Set<string>();
  return v.composioCatalog.filter(s => {
    const id = identity(s.id), name = identity(s.name);
    if (owned.has(id) || owned.has(name) || seen.has(id)) return false;
    seen.add(id); return true;
  });
}

/** Composio's mark, drawn in the text's colour: the store and the guide's services step both show it. */
export const COMPOSIO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h6v10H4zM14 7h6v10h-6zM10 10h4m-4 4h4"/></svg>`;
const composioMark = (): string => `<span class="cs-icon md cs-composio-mark" aria-hidden="true">${COMPOSIO_SVG}</span>`;

/** The dialog's close button, as the key dialog has it. */
const closeButton = (): string => iconButton("x", t("common.close"), ' data-conn="close" data-k="cs-close"');

function keyDialogHTML(v: ConnectionsView): string {
  return `<div class="cs-scrim" data-conn="scrim" data-dialog="composio-key"><div class="cs-dialog" id="cs-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-dlg-title" tabindex="-1" data-trap>` +
    `<div class="cs-dlg-head">${composioMark()}<h2 class="cs-dlg-name" id="cs-dlg-title">Composio</h2><span class="sp"></span>${closeButton()}</div>` +
    `<div class="cs-key-form"><label for="conn-key">${esc(t("plugins.keyPrompt"))}</label><p class="note">${esc(t("missing.composioGuide"))}</p>` +
    `<input class="field" type="password" id="conn-key" autocomplete="new-password" spellcheck="false"${v.keyBusy ? " disabled" : ""}${v.keyError ? ' aria-invalid="true" aria-describedby="conn-key-error"' : ""}>` +
    (v.keyError ? `<p id="conn-key-error" role="alert">${esc(keyErrorMessage(v.keyError))}</p>` : "") + dialogNoticeHTML(v) +
    actionRow({ primary: { label: esc(t("plugins.saveKey")), attrs: ` data-conn="save-key"${v.keyBusy ? " disabled" : ""}` } }) + `</div></div></div>`;
}

/** What is under the chips: the sections of 全部, or one list (a chosen category, or what a search finds). */
export function bodyHTML(v: ConnectionsView): string {
  const retry = (action: string): string => `<div class="alert core-note" role="alert">${st("err", t("conn.loadFailed"))}${btn(esc(t("plugins.retry")), "sm", ` data-conn="${action}"`)}</div>`;
  const loading = `<p class="settings-loading" role="status">${esc(t("conn.loading"))}</p>`;
  let html = v.catalog === "loading" ? loading : v.catalog === "failed" ? retry("retry-builtin-store") : "";
  const layout = layoutOf(v);
  if (layout.list) {
    const limit = Math.max(v.shown ?? LIST_STEP, LIST_STEP);
    if (layout.list.length) html += gridHTML(layout.list.slice(0, limit), v);
    else if (Array.isArray(v.catalog) && (!v.configured || Array.isArray(v.composioCatalog))) html += `<p class="cs-none" role="status">${esc(t("conn.noMatch"))}</p>`;
  } else {
    if (layout.recommended.length) html += sectionHTML(t("conn.recommendedFor"), layout.recommended, v, layout.recommendedMore ? { attrs: ' data-conn="recommended-all"' } : null);
    for (const section of layout.sections) html += sectionHTML(groupLabel(section.group), section.items, v, section.more ? { attrs: ` data-conn="store-group" data-id="${section.group}"` } : null);
  }
  if (v.configured) {
    if (v.composioCatalog === "loading") html += loading;
    else if (v.composioCatalog === "failed") html += retry("retry-store");
  } else if (v.configured === false) {
    html += `<div class="cs-composio-setup">${composioMark()}<span>${esc(t("plugins.moreApps"))}</span>${btn(esc(t("plugins.configure")), "sm", ' data-conn="configure-composio"')}</div>`;
  }
  return html;
}

/** Are there more rows of the list than are drawn? */
export function moreRows(v: ConnectionsView): boolean {
  const layout = layoutOf(v);
  return !!layout.list && layout.list.length > Math.max(v.shown ?? LIST_STEP, LIST_STEP);
}

/** The category chips: 全部, the first few categories, then 更多 for the rest. The chips that do not fit are hidden in the dialog (`fitChips`). */
function chipsHTML(v: ConnectionsView): string {
  const standing = STORE_GROUPS.slice(0, CHIP_CAP);
  if (v.category && !standing.includes(v.category)) standing[CHIP_CAP - 1] = v.category;
  const chip = (group: string, label: string, hidden: boolean): string =>
    btn(esc(label), "cs-chip", ` data-conn="store-group" data-id="${group}" aria-pressed="${!v.search.trim() && v.category === group}"${hidden ? " hidden data-capped" : ""}`);
  return `<div class="cs-chips" data-cs-chips role="group" aria-label="${esc(t("plugins.category"))}">` +
    chip("", t("conn.all"), false) + STORE_GROUPS.map((group) => chip(group, groupLabel(group), !standing.includes(group))).join("") +
    `<button type="button" class="sel cs-chip cs-more" aria-haspopup="menu" aria-expanded="false" data-k="conn-more"><span>${esc(t("conn.moreCategories"))}</span>${ico("down")}</button></div>`;
}

/**
 * Hides the chips at the end of the row that do not fit (the row never wraps and never scrolls sideways); they are in 更多. A chosen
 * chip stays, and so does every one that was capped to begin with. 更多 stands only while a chip is hidden.
 */
export function fitChips(row: HTMLElement): void {
  const chips = [...row.querySelectorAll<HTMLElement>('[data-conn="store-group"]:not([data-capped])')];
  for (const chip of chips) chip.hidden = false;
  const more = row.querySelector<HTMLElement>(".cs-more");
  const hiddenSome = (): boolean => !!row.querySelector('[data-conn="store-group"][hidden]');
  if (more) more.hidden = !hiddenSome();
  for (let at = chips.length - 1; at >= 0 && row.scrollWidth > row.clientWidth + 1; at--) {
    const chip = chips[at]!;
    if (chip.getAttribute("aria-pressed") === "true") continue;
    chip.hidden = true;
    if (more) more.hidden = false;
  }
  if (typeof ResizeObserver !== "undefined" && !watched.has(row)) {
    watched.add(row);
    new ResizeObserver(() => { if (row.isConnected) fitChips(row); }).observe(row);
  }
}
const watched = new WeakSet<HTMLElement>();

/** The categories that are not in the row of chips, in order: what 更多 offers. */
function hiddenCategories(root: ParentNode | null, v: ConnectionsView): string[] {
  const chips = root?.querySelector("[data-cs-chips]");
  if (chips) return [...chips.querySelectorAll<HTMLElement>('[data-conn="store-group"][hidden]')].map((chip) => chip.dataset.id ?? "").filter(Boolean);
  const standing = STORE_GROUPS.slice(0, CHIP_CAP);
  if (v.category && !standing.includes(v.category)) standing[CHIP_CAP - 1] = v.category;
  return STORE_GROUPS.filter((group) => !standing.includes(group));
}

// ---------- the top of the dialog ----------

/** The apps whose tools can be called now: the ones the chip counts and the connected list leads with. */
function connectedGroups(v: ConnectionsView): ConnectionGroup[] {
  if (!Array.isArray(v.groups)) return [];
  const connected = (g: ConnectionGroup): boolean => (v.placed?.get(g.id) ?? isConnected(v.inventory, g.id)) !== false;
  // Exactly the apps the chip counts: one that is switched off, waits for a sign-in or failed is not connected, so it has no mark.
  return v.groups.filter(connected);
}

/** The quiet chip at the top right: up to four marks, overlapped, and how many apps are connected. It opens the list of them. */
function haveChipHTML(v: ConnectionsView): string {
  if (!Array.isArray(v.groups) || !v.groups.length) return "";
  const count = connectedCount(v.inventory);
  const marks = connectedGroups(v).slice(0, HAVE_MARKS).map((g) => `<span class="cs-mini">${groupIcon(g, v, "md")}</span>`).join("");
  return `<button type="button" class="btn cs-have" data-conn="connected" data-k="cs-have"><span class="cs-minis" aria-hidden="true">${marks}</span>` +
    `<span class="cs-have-t">${esc(count ? t("conn.have", { p0: count }) : t("conn.haveSome"))}</span>${ico("right")}</button>`;
}

/** The bar: the search over the whole catalog, and 新增 beside it for a server of the owner's own. */
function barHTML(v: ConnectionsView): string {
  return `<div class="cs-bar"><div class="cs-find">${fieldHTML(t("conn.searchApps"), v.search, { id: "conn-search", icon: "search", label: t("conn.searchApps") })}</div>${connectionsAddHTML()}</div>`;
}

/** 「新增 ▾」, the menu that adds a server of the user's own, beside the search. */
export const connectionsAddHTML = (): string =>
  `<button type="button" class="sel cs-add" aria-haspopup="menu" aria-expanded="false" data-k="conn-add">` +
  `<span>${esc(t("conn.addMenu"))}</span>${ico("down")}</button>`;

/** A bare chevron at the top left: back from an app's page or from the list of the connected apps. */
const backHTML = (): string => iconButton("left", t("conn.back"), ' data-conn="back" data-k="cs-back"', "cs-back");

// ---------- the connected apps: one list ----------

/** The app switch reflects only the app's enabled flag; tool exclusions stay independent. */
function serviceSwitch(g: ConnectionGroup, attrs: string): string {
  return tg(g.enabled, t("conn.switch", { p0: g.name }), attrs);
}

/** A row of the connected list: the row opens the app's page; its name is a real button for the keyboard; the switch is the whole service's. */
function itemHTML(g: ConnectionGroup, v: ConnectionsView): string {
  const busy = v.busy.has(g.id) || v.login?.target === g.id;
  const id = esc(g.id);
  return (
    `<div class="cs-linked" data-conn="open" data-id="${id}">` +
    btn(
      `${tileHTML(groupIcon(g, v, "md"))}<span class="tx"><span class="nm">${esc(g.name)}</span><span class="ds">${lineOf(g, v)}</span></span>`,
      "cs-main",
      ` data-conn="open" data-id="${id}" data-k="cs-open:${id}"`,
    ) +
    serviceSwitch(g, ` data-conn="enable" data-id="${id}" data-k="cs-enable:${id}"${busy ? " disabled" : ""}`) +
    `</div>`
  );
}

function installedHTML(v: ConnectionsView): string {
  if (v.groups === "loading") return `<p class="settings-loading" role="status">${esc(t("conn.loading"))}</p>`;
  if (v.groups === "failed") return `<div class="alert core-note">${st("err", t("conn.loadFailed"))}${btn(esc(t("plugins.retry")), "sm", ' data-conn="retry-connections"')}</div>`;
  if (!v.groups.length) return noticeHTML("emptyApps", "store", "apps");
  // The apps that can be called now first, then the ones that cannot (waiting for a sign-in, failed, off, a second way to an app already
  // counted): each still has its switch and its page. While the inventory is not read, or cannot be, they are one list as before.
  // A row keeps its section for the whole visit: flipping its switch must not move it from under the pointer.
  const connected = (g: ConnectionGroup): boolean => (v.placed?.get(g.id) ?? isConnected(v.inventory, g.id)) !== false;
  const counted = v.groups.filter(connected);
  const others = v.groups.filter((g) => !connected(g));
  // The connected first; then what is on but cannot be called (waiting for a sign-in, failed, a second way to an app already counted); then
  // what is switched off, under 「已關閉」, each with its switch (owner's coordinator, 2026-11-12). A section with nothing in it is not drawn.
  const waiting = others.filter((g) => g.enabled);
  const off = others.filter((g) => !g.enabled);
  const list = (groups: ConnectionGroup[]): string => `<div class="cs-grid">${groups.map((g) => itemHTML(g, v)).join("")}</div>`;
  const named = others.length > 0;
  const section = (title: string, body: string): string => `<section class="cs-sec"><div class="cs-sec-head"><h2>${esc(title)}</h2></div>${body}</section>`;
  return (
    (counted.length ? (named ? section(t("conn.apps"), list(counted)) : list(counted)) : "") +
    (waiting.length ? section(t("conn.notConnected"), list(waiting)) : "") +
    (off.length ? section(t("conn.off"), list(off)) : "")
  );
}

// ---------- an app's page, as Grok Bot's ----------

/**
 * The name of a tool for the screen: the title its server gives it, else its name made readable (the
 * service's own name at the start taken off, the dashes and underscores as spaces, a capital first).
 */
export function toolLabel(tool: ConnectionTool, service = ""): string {
  const title = tool.title?.trim();
  if (title) return title;
  let name = tool.name;
  const prefix = service.trim().toLowerCase();
  if (prefix) {
    for (const sep of ["-", "_"]) if (name.toLowerCase().startsWith(prefix + sep) && name.length > prefix.length + 1) name = name.slice(prefix.length + 1);
  }
  const spaced = name.replace(/[-_]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : tool.name;
}

function toolRow(g: ConnectionGroup, tool: ConnectionTool, busy: boolean): string {
  return row(
    `<span class="tool-name" title="${esc(tool.name)}">${esc(toolLabel(tool, g.name))}</span>`,
    esc(tool.description),
    tg(
      tool.enabled,
      t("conn.toolSwitch", { p0: toolLabel(tool, g.name) }),
      ` data-conn="tool" data-id="${esc(g.id)}" data-tool="${esc(tool.name)}" data-k="cs-tool:${esc(tool.name)}"${busy ? " disabled" : ""}`,
    ),
    { cls: "conn-tool" },
  );
}

const kindName = (kind: ToolKind): string => t(kind === "write" ? "conn.group.write" : "conn.group.read");

/** The latest actions of one service, folded under a row that says how many there are. */
function auditHTML(v: ConnectionsView, server: string): string {
  const entries = v.audit.filter((e) => e.server === server).slice(0, AUDIT_SHOWN);
  if (!entries.length) return "";
  const outcomes: Record<AuditEntry["outcome"], { kind: "ok" | "warn" | "err" | "idle"; key: MessageKey }> = {
    ok: { kind: "ok", key: "conn.audit.ok" },
    error: { kind: "err", key: "conn.audit.error" },
    timeout: { kind: "warn", key: "conn.audit.timeout" },
    denied: { kind: "idle", key: "conn.audit.denied" },
    expired: { kind: "idle", key: "conn.audit.expired" },
    blocked: { kind: "warn", key: "conn.audit.blocked" },
  };
  const approvers: Record<AuditEntry["approver"], MessageKey> = { auto: "conn.audit.auto", user: "conn.audit.user", none: "conn.audit.none" };
  const head = btn(
    `<span class="gt">${esc(t("conn.audit.title"))}<em class="num">${entries.length}</em></span>${ico(v.auditOpen ? "down" : "right")}`,
    "gr",
    ` data-conn="audit" aria-expanded="${v.auditOpen}" data-k="cs-audit"`,
  );
  if (!v.auditOpen) return `<div class="cs-grp cs-audit">${head}</div>`;
  const rows = entries.map((e) => {
    const when = `${dayLabel(e.at_ms, v.now)} ${formatClock(e.at_ms)}`;
    const outcome = outcomes[e.outcome] ?? outcomes.error;
    return row(esc(toolLabel({ name: e.tool, description: "", enabled: true, kind: "read" }, e.server)), esc(`${when} · ${tr(approvers[e.approver] ?? approvers.none)}`), st(outcome.kind, tr(outcome.key)), {
      cls: "conn-audit",
    });
  });
  return `<div class="cs-grp cs-audit">${head}<div class="audit">${rows.join("")}<p class="foot">${esc(t("conn.audit.foot"))}</p></div></div>`;
}

/** What a managed account's status says, in words: Composio's own names for the states of a sign-in. */
const ACCOUNT_STATUS: Record<string, { kind: "ok" | "warn" | "err" | "idle"; key: MessageKey }> = {
  ACTIVE: { kind: "ok", key: "conn.acct.active" },
  INITIALIZING: { kind: "warn", key: "conn.acct.waiting" },
  INITIATED: { kind: "warn", key: "conn.acct.waiting" },
  EXPIRED: { kind: "err", key: "conn.acct.expired" },
  REVOKED: { kind: "err", key: "conn.acct.revoked" },
  FAILED: { kind: "err", key: "conn.acct.failed" },
  INACTIVE: { kind: "idle", key: "conn.acct.inactive" },
};
const accountStatus = (status: string): { kind: "ok" | "warn" | "err" | "idle"; text: string } => {
  const known = ACCOUNT_STATUS[status] ?? ACCOUNT_STATUS.INACTIVE!;
  return { kind: known.kind, text: tr(known.key) };
};

/**
 * The account(s) a service is signed in with, using public owner labels and status:
 * a row for each account of a managed service (two when one was signed in again and the first has not gone), the owner's own Google as
 * one, and a signed-in server as one. A server that needs no sign-in has none.
 */
function accountsHTML(g: ConnectionGroup): string {
  const rows: { label: string; kind: "ok" | "warn" | "err" | "idle"; text: string }[] =
    g.source === "composio" ? (g.accounts ?? []).map((account, n) => ({ label: account.label || t("conn.accountN", { p0: n + 1 }), ...accountStatus(account.status) }))
    : g.source === "google" ? [{ label: g.accounts?.[0]?.label || t("conn.googleAccount"), ...accountStatus(g.accounts?.[0]?.status ?? (g.status === "ready" ? "ACTIVE" : "INACTIVE")) }]
    : g.auth !== "none" ? [{ label: t("conn.account"), ...(needsLogin(g) ? { kind: "err" as const, text: t("conn.status.relogin") } : { kind: "ok" as const, text: t("conn.signedIn") }) }]
    : [];
  if (!rows.length) return "";
  return `<div class="cs-accts cs-box">${rows.map((r, n) => `<div class="cs-acct">${ico("person")}<span class="nm">${esc(r.label)}</span>${st(r.kind, r.text)}${g.accounts?.[n]?.id ? btn(esc(t("account.label")), "sm", ` data-conn="account-label" data-id="${esc(g.id)}" data-account="${esc(g.accounts[n].id!)}"`) : ""}</div>`).join("")}${g.source === "composio" ? btn(esc(t("account.add")), "sm", ` data-conn="add-account" data-id="${esc(g.id)}"`) : ""}</div>`;
}

/** How an app is signed in to, in a word, from what the catalog says it needs; null when it is not known. */
function signInWords(s: StoreService | undefined, g: ConnectionGroup | undefined): string | null {
  if (s) {
    if (s.id === OWN_GOOGLE) return "OAuth";
    if (s.needs === "key" || PRESET_FORMS[s.id]) return t("conn.info.key");
    if (s.needs === "own_app") return t("conn.info.ownApp");
    if (s.auth === "none") return t("conn.info.none");
    return "OAuth";
  }
  if (!g) return null;
  return g.auth === "none" ? t("conn.info.none") : "OAuth";
}

/** Who provides the app: Composio, Google, or the app itself when it is built in; none for a server of the owner's own. */
function providerWords(s: StoreService | undefined): string | null {
  if (!s) return null;
  if (s.source === "composio") return "Composio";
  if (s.id === OWN_GOOGLE) return "Google";
  return PRESET_FORMS[s.id] ? s.publisher : t("conn.info.builtIn");
}

/** A card of rows with a thin line round it and between them: a label at the left and its value at the right. */
const infoRow = (label: string, value: string): string => `<div class="cs-info-row"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;

/** What is the app's tools, one card: the kinds with their switches, how many are on, and the tools themselves unfolded. */
function toolsHTML(g: ConnectionGroup, v: ConnectionsView, busy: boolean, loggingIn: boolean): string {
  const id = ` data-id="${esc(g.id)}"`;
  const kinds = (["write", "read"] as const).filter((kind) => g.tools.some((tool) => tool.kind === kind));
  const on = g.tools.filter((tool) => tool.enabled).length;
  // Tools that are known stay while they are read again (a switch just pressed): the page would otherwise shrink and scroll from under the pointer.
  if (g.tools_state === "loading" && !g.tools.length) return `<p role="status">${esc(t("conn.loading"))}</p>`;
  if (g.tools_state === "failed") return `<div class="note" role="alert">${esc(t("conn.loadFailed"))}${btn(esc(t("plugins.retry")), "sm", ` data-conn="refresh"${id}`)}</div>`;
  if (!g.tools.length) return `<p class="cs-count conn-empty">${esc(t("conn.noTools"))}</p>`;
  return `<section class="cs-sec"><h3>${esc(t("conn.toolsHeading"))}</h3><div class="cs-box cs-grp cs-tools"><div class="cs-kind-list">${(["write", "read"] as const).map(kind => {
      const list = g.tools.filter(tool => tool.kind === kind), enabled = list.filter(tool => tool.enabled).length;
      return row(`${esc(kindName(kind))}<em class="num">${enabled}/${list.length}</em>`, "",
        tg(list.length > 0 && enabled === list.length, t("conn.groupSwitch", { p0: kindName(kind) }),
          ` data-conn="kind"${id} data-kind="${kind}" data-k="cs-kind:${kind}"${busy || loggingIn || !list.length ? " disabled" : ""}`), { cls: "cs-kind" });
    }).join("")}</div>` +
    btn(`<span class="gt">${esc(t("conn.tools.enabled", { p0: on, p1: g.tools.length, p2: g.write_count, p3: g.read_count }))}</span>${ico(v.toolsOpen ? "down" : "right")}`,
      "gr", ` data-conn="tool-list" aria-expanded="${v.toolsOpen}" data-k="cs-count"`) +
    `</div>${v.toolsOpen ? `<div class="cs-plugin-tools">${kinds.map(kind => `<section><h3>${esc(kindName(kind))}</h3><div class="cs-box cs-tool-list">${g.tools.filter(tool => tool.kind === kind).map(tool => toolRow(g, tool, busy)).join("")}</div></section>`).join("")}</div>` : ""}</section>`;
}

/**
 * An app's page, in the dialog's place: a back chevron (the dialog's own × is at the other corner), the app's mark on a white tile with its
 * name and, at the right, 「連結」 (or, when it is connected, its state, its switch and its ⋯), a paragraph on it, then what is known of it in
 * bordered cards: its tools, and its information. It is the page of an app of the catalog, of a connected one, and of a server of the owner's own.
 */
function appPageHTML(s: StoreService | undefined, g: ConnectionGroup | undefined, v: ConnectionsView): string {
  const name = g?.name ?? s!.name;
  const key = g?.id ?? s!.id;
  const busy = v.busy.has(key);
  const loggingIn = !!v.login && (v.login.target === g?.id || v.login.target === s?.id);
  const id = ` data-id="${esc(g?.id ?? "")}"`;
  const mark = g ? groupIcon(g, v, "xl") : entryIcon(s!, "xl");
  const action = g
    ? `<span class="cs-state">${ico("check")}<span>${esc(t("conn.tab.installed"))}</span></span>` +
      serviceSwitch(g, ` data-conn="enable"${id} data-k="cs-dlg-enable"${busy ? " disabled" : ""}`) +
      iconButton("more", t("mcp.actions"), ` data-conn="server-menu"${id} aria-haspopup="menu"${busy ? " disabled" : ""}`)
    : loggingIn
      ? `<span class="cs-wait" role="status">${esc(t(s!.auth === "none" ? "conn.connecting" : "conn.loggingIn"))}</span>` + btn(esc(t("conn.cancel")), "cs-connect", ` data-conn="cancel-login"${s!.source ? " disabled" : ""}`)
      : btn(esc(t("conn.connect")), "pri cs-connect", ` data-conn="join" data-id="${esc(s!.id)}"${v.login ? " disabled" : ""}`);
  const head = `<div class="cs-head">${tileHTML(mark, "lg")}<h2 class="big" id="cs-page-title">${esc(name)}</h2><div class="cs-join">${action}</div></div>`;
  const about = `<p class="cs-desc">${esc(g?.description || (s ? words(s.about) : t("conn.customServer")))}</p>`;
  const secrets = g ? [...g.env, ...g.headers] : [];
  // What signing in asks of the owner, said once, in a line, where the old page said it twice.
  const lead = !g && s?.needs === "key" && !inChat(s) ? `<p class="cs-needs">${esc(t("setup.leadKey", { p0: s.name }))}</p>` : "";
  const alert = g && needsLogin(g)
    ? `<div class="ca-alert">${ico("info")}<span class="msg">${esc(t("conn.status.relogin"))}</span>` +
      btn(esc(v.login?.target === g.id ? t("conn.loggingIn") : t("conn.relogin")), "sm", ` data-conn="relogin"${id} data-k="cs-relogin-top"${busy || v.login ? " disabled" : ""}`) +
      `</div>`
    : g?.status === "error"
      ? `<div class="ca-alert">${ico("info")}<span class="msg">${esc(t("conn.status.error", { p0: failureText(g.error) }))}</span></div>`
      : "";
  const example = g ? examplePrompt(s ?? entryOf(g, v)) : null;
  const acts = g
    ? actionRow({
      cls: "cs-acts",
      primary: example ? { label: esc(t("conn.tryIt")), attrs: ` data-conn="try"${id} data-k="cs-try"` } : undefined,
      secondary: (g.auth !== "none" && !needsLogin(g)
        ? btn(esc(v.login?.target === g.id ? t("conn.loggingIn") : t("conn.relogin")), "sm", ` data-conn="relogin"${id} data-k="cs-relogin"${busy || v.login ? " disabled" : ""}`)
        : "") +
      btn(esc(busy ? t("conn.refreshing") : t("conn.refresh")), "sm", ` data-conn="refresh"${id} data-k="cs-refresh"${busy ? " disabled" : ""}`) +
      (g.auth === "device" && g.catalog_id && GRANTS_URL[g.catalog_id] ? btn(esc(t("conn.revokeOpen", { p0: g.name })), "sm", ` data-conn="open-grants"${id}`) : ""),
    })
    : "";
  const tryItems = !g && s ? (s.examples[getLocale()] ?? s.examples.en ?? []).map((text) => `<li>${ico("chat")}<span>${esc(text)}</span></li>`).join("") : "";
  const facts: string[] = [];
  const provider = providerWords(s);
  if (provider) facts.push(infoRow(t("conn.info.provider"), provider));
  if (s) facts.push(infoRow(t("conn.info.category"), groupLabel(storeGroup(s))));
  const signIn = signInWords(s, g);
  if (signIn) facts.push(infoRow(t("conn.info.signIn"), signIn));
  const where = s?.url || (g?.transport === "http" ? g.url : "");
  if (where) facts.push(infoRow(t("conn.server"), where));
  if (g && g.tools_state !== "failed" && g.tools.length) facts.push(infoRow(t("conn.toolsHeading"), String(g.tools.length)));
  // A server of the owner's own says where it is and which secrets it was given, by name.
  const meta = g && !s && !g.source
    ? `<div class="cs-meta"><span>${ico("link")}<span class="code">${esc(g.transport === "http" ? g.url : g.command)}</span></span>` +
      (secrets.length ? `<span>${ico("lock")}<span class="code">${esc(secrets.join(", "))}</span></span>` : "") + `</div>`
    : "";
  return (
    backHTML() + head + about + lead + alert + loginErrorHTML(v, key) + dialogNoticeHTML(v) +
    (loggingIn && g ? deviceHTML(v) : "") +
    (g ? accountsHTML(g) : "") +
    (tryItems ? `<section class="cs-sec"><h3>${esc(t("conn.try"))}</h3><ul class="cs-say">${tryItems}</ul></section>` : "") +
    (g ? toolsHTML(g, v, busy, loggingIn) : "") +
    (facts.length ? `<section class="cs-sec"><h3>${esc(t("conn.info"))}</h3><div class="cs-box cs-info">${facts.join("")}</div></section>` : "") +
    meta + (g ? auditHTML(v, g.name) : "") + acts
  );
}

// ---------- the form that connects a server of the user's own ----------

const fld = (label: string, control: string, hint = "", forId = ""): string =>
  `<div class="fld">${forId ? `<label class="flabel" for="${forId}">${esc(label)}</label>` : `<span class="flabel">${esc(label)}</span>`}${hint ? `<span class="fhint">${esc(hint)}</span>` : ""}${control}</div>`;

function pairsHTML(f: ConnectionForm): string {
  const http = f.type === "http";
  const label = http ? t("conn.form.headers") : t("conn.form.env");
  const adder = `<textarea class="field mcp-lines" id="conn-pairs" rows="4" ${f.busy ? "disabled" : ""} spellcheck="false" aria-label="${esc(label)}" placeholder="${http ? 'Authorization=Bearer ...' : 'API_KEY=...'}">${esc(f.pairLines ?? "")}</textarea>`;
  return fld(label, adder, t(f.id ? "mcp.keepSecrets" : "conn.form.secretNote"));
}

function formHTML(f: ConnectionForm): string {
  const off = f.busy;
  const fields =
    f.type === "stdio"
      ? `<div class="two">` +
        fld(t("conn.form.command"), fieldHTML(t("conn.form.commandHint"), f.command, { id: "conn-command", label: t("conn.form.command"), disabled: off }), "", "conn-command") +
        fld(t("mcp.args"), `<textarea class="field mcp-lines" id="conn-args" rows="4" ${off ? "disabled" : ""}>${esc(f.args)}</textarea>`, "", "conn-args") +
        `</div>`
      : fld(t("conn.form.url"), fieldHTML(f.urlHint ?? t("conn.form.urlHint"), f.url, { id: "conn-url", label: t("conn.form.url"), disabled: off }), "", "conn-url");
  const error = f.error ? `<div class="note" role="alert">${st("err", f.error())}</div>` : "";
  const typeSel = sel(typeChoices(), f.type, t("conn.form.type"), ` data-k="conn-type"${off ? " disabled" : ""}`);
  return (
    `<h2 class="big">${esc(t(f.id ? "mcp.edit" : "mcp.add"))}</h2>` +
    `<div class="add-grid">` +
    `<div class="two">${fld(t("conn.form.type"), typeSel)}${fld(t("conn.form.name"), fieldHTML(t("conn.form.nameHint"), f.name, { id: "conn-name", label: t("conn.form.name"), disabled: off }), "", "conn-name")}</div>` +
    fields +
    pairsHTML(f) +
    fld(t("mcp.limit"), `<input class="field" type="number" id="conn-limit" min="100" max="100000" value="${f.limit ?? 8000}" ${off ? "disabled" : ""}>`, "", "conn-limit") +
    (f.testReport ? `<p role="status">${esc(f.testReport)}</p>` : "") +
    `</div><div class="trust">${ico("shield")}<span><b>${esc(t("conn.form.trustTitle"))}</b> ${esc(t("conn.form.trustBody"))}</span></div>` +
    error +
    actionRow({
      cls: "add-acts", sticky: true,
      secondary: btn(t("mcp.test"), "", ` data-conn="test-draft"${off ? " disabled" : ""}`) + btn(esc(t("conn.form.cancel")), "", ` data-conn="form-cancel"${off ? " disabled" : ""}`),
      primary: { label: esc(off ? t("conn.form.connecting") : t("mcp.save")), attrs: ` data-conn="connect"${off ? " disabled" : ""}` },
    })
  );
}

// ---------- the code of a device login ----------

/** The code in keycaps, the one button that copies it and opens the service's page, and a cancel button. */
function deviceHTML(v: ConnectionsView): string {
  const d = v.device;
  if (!d || !v.login) return "";
  const name = (Array.isArray(v.catalog) ? v.catalog.find((s) => s.id === d.catalog_id)?.name : undefined) ?? v.login.name;
  const caps = [...d.user_code].map((ch) => (ch === "-" ? '<span class="cs-dash">-</span>' : `<span class="cs-cap">${esc(ch)}</span>`)).join("");
  return (
    `<div class="cs-device" role="group" aria-label="${esc(name)}"><p class="cs-device-hint">${esc(t("conn.device.hint"))}</p>` +
    `<div class="cs-code" aria-label="${esc(d.user_code)}">${caps}</div>` +
    actionRow({ cls: "cs-device-acts", secondary: btn(esc(t("conn.cancel")), "", ' data-conn="cancel-login"'), primary: { label: esc(t("conn.device.open", { p0: name })), attrs: ' data-conn="device-open"' } }) + `</div>`
  );
}

// ---------- the dialog ----------

/** What is open: the page of an app of the catalog, of a connected one, or of a server of the owner's own. */
function openTarget(v: ConnectionsView): { entry?: StoreService; group?: ConnectionGroup } | null {
  if (!v.open) return null;
  const groups = Array.isArray(v.groups) ? v.groups : [];
  if (v.open.kind === "group") {
    const group = groups.find((g) => g.id === v.open!.id);
    return group ? { group, entry: entryOf(group, v) ?? everyApp(v).find((s) => s.server_id === group.id) } : null;
  }
  const entry = everyApp(v).find((s) => s.id === v.open!.id);
  return entry ? { entry, group: entry.server_id ? groups.find((g) => g.id === entry.server_id) : undefined } : null;
}

/** The dialog's title as a heading only a screen reader meets, over a page that has no title row. */
const quietHeading = (heading: string): string => (heading ? `<div class="cs-vh">${heading}</div>` : "");

/**
 * The dialog, below its title: the form, an app's page, the list of the connected apps, or the one view of the apps (a search, the
 * chips of its categories, then the sections). The key dialog of Composio stands over any of them.
 */
export function connectionsHTML(v: ConnectionsView, heading = ""): string {
  const key = v.keyOpen ? keyDialogHTML(v) : "";
  if (v.form) return `<div class="cs cs-form">${formHTML(v.form)}</div>`;
  const target = openTarget(v);
  if (target) return `<div class="cs cs-page">${quietHeading(heading)}${appPageHTML(target.entry, target.group, v)}</div>` + key;
  if (v.screen === "connected" && Array.isArray(v.groups) && v.groups.length) {
    return `<div class="cs cs-connected"><div class="cs-top">${backHTML()}<h2 class="cs-top-t">${esc(t("conn.tab.installed"))}</h2></div>${quietHeading(heading)}${deviceHTML(v)}` +
      `<div class="cs-body" data-cs-body>${installedHTML(v)}</div></div>` + key;
  }
  // The connected apps could not be read: the chip that would open them says so instead, with the way to read them again.
  const unread = v.groups === "failed" ? `<div class="alert core-note">${st("err", t("conn.loadFailed"))}${btn(esc(t("plugins.retry")), "sm", ' data-conn="retry-connections"')}</div>` : "";
  return `<div class="cs cs-apps">${deviceHTML(v)}<div class="cs-top">${heading}${haveChipHTML(v)}</div>${unread}${barHTML(v)}${chipsHTML(v)}` +
    `<div class="cs-results" data-cs-scroll><div class="cs-body" data-cs-body>${bodyHTML(v)}</div></div></div>` + key;
}

// ---------- doing ----------

/** Focuses the element `selector` names, if the page is there (not in a test without one). */
const focusOn = (selector: string): void => {
  if (typeof document !== "undefined") document.querySelector<HTMLElement>(selector)?.focus();
};

/** A dropdown's menu, as the settings panel opens it. */
export interface ConnectionMenu {
  choices: Choice[];
  current: string;
  pick: (value: string) => void;
}

export interface ConnectionsHost {
  root?: HTMLElement;
  /** The dialog is on screen. */
  visible(): boolean;
  /** Draws the page again. */
  redraw(): void;
  /** 「試試看」: closes the settings and puts `text` in the composer of the 拉斐爾 page. */
  tryPrompt(text: string): void;
}

export interface Connections {
  view(): ConnectionsView;
  /** Reads the services, the store and the latest actions. */
  load(): Promise<void>;
  /** A click on one of this dialog's buttons or switches; false for anything else. */
  click(target: Element): boolean;
  /** Something typed in one of this dialog's fields; false for any other input. */
  input(input: HTMLInputElement): boolean;
  /** Enter in one of the form's fields, or Esc with an app's page, the connected list or the key's dialog open; false for any other key. */
  key(e: KeyboardEvent): boolean;
  /** The menu of a dropdown of this dialog, by its `data-k`. */
  menuFor(k: string): ConnectionMenu | null;
  /** The dialog was drawn: the row of chips is fitted to its width. */
  painted(): void;
  /** Something scrolled: a long list draws its next rows when its end is near. */
  scrolled(target: Element): void;
  /** An event of the main window: the code of a device login. */
  followEvent(event: MainEvent): void;
  /** The panel is closed or leaves the dialog: drop what must not stay (an unsent form, a pending disconnect). */
  reset(): void;
}

export function createConnections(host: ConnectionsHost): Connections {
  let configured: boolean | null = null;
  let categories: Choice[] = [];
  let category = "";
  let keyOpen = false;
  let keySaves = 0;
  let keyBusy = false;
  let keyError: ConnectionsView["keyError"] = "";
  let managed: ManagedConnector[] = [];
  let catalogLoads = 0;
  let groups: ConnectionsView["groups"] = "loading";
  let catalog: ConnectionsView["catalog"] = "loading";
  let composioCatalog: ConnectionsView["composioCatalog"] = "loading";
  let inventory: InventoryView = "loading";
  const placed = new Map<string, boolean | null>();
  let audit: AuditEntry[] = [];
  let screen: Screen = "apps";
  let search = "";
  let shown = LIST_STEP;
  let recommendedAll = false;
  let open: ConnectionsView["open"] = null;
  let toolsOpen = false;
  let auditOpen = false;
  let confirming: string | null = null;
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  const busy = new Set<string>();
  let login: Login | null = null;
  let device: DeviceCode | null = null;
  let loginError: ConnectionsView["loginError"] = null;
  let dialogNotice: ConnectionsView["dialogNotice"] = null;
  let form: ConnectionForm | null = null;
  let loads = 0;
  let stopOutside: (() => void) | null = null;

  /** Something is over the view: an app's page, or the key's dialog. */
  const dialogOpen = (): boolean => keyOpen || open !== null;

  const redraw = (): void => {
    if (host.visible()) host.redraw();
    // The key's dialog is the one that stands over the page; a press outside it closes it.
    if (keyOpen && !stopOutside && typeof document !== "undefined") {
      const root = host.root ?? document.querySelector("#cs-dialog")?.parentElement?.parentElement;
      if (root) stopOutside = registerDismissal(() => root.querySelector<HTMLElement>("#cs-dialog"), closeDialog);
    } else if (!keyOpen) { stopOutside?.(); stopOutside = null; }
  };

  /** Connection actions report inside the open page instead of covering its footer. */
  const notify = (text: string, kind: "ok" | "err" = "ok"): void => {
    if (dialogOpen()) { dialogNotice = { text, kind }; redraw(); }
    else toaster.info(text);
  };

  const view = (): ConnectionsView => ({
    configured, categories, category, keyOpen, keyBusy, keyError,
    groups, catalog, composioCatalog, inventory, placed, audit, screen, search, shown, recommendedAll, open, toolsOpen, auditOpen, confirmingDisconnect: confirming, busy, login, device, loginError, dialogNotice, form, now: Date.now(),
  });

  /** The dialog's scrolling list. */
  const scroller = (): HTMLElement | null => (typeof document !== "undefined" ? (host.root ?? document).querySelector<HTMLElement>("[data-cs-scroll]") : null);

  /**
   * Draws only what is under the search: the chips and the list (the search box keeps its focus and its input method). A new
   * category or a new search starts at the top of the list; the rows drawn further down keep their place.
   */
  function repaintBody(top = false, withChips = true): void {
    const root = typeof document !== "undefined" ? host.root ?? document : null;
    const body = root?.querySelector<HTMLElement>("[data-cs-body]");
    const chips = root?.querySelector<HTMLElement>("[data-cs-chips]");
    if (!body || !chips || !host.visible() || screen !== "apps" || open) { redraw(); return; }
    const current = view();
    // The chips change only when a category is chosen or a search starts or ends: a letter typed in the search leaves them alone.
    if (withChips) {
      const active = document.activeElement instanceof HTMLElement && chips.contains(document.activeElement) ? document.activeElement.dataset : undefined;
      chips.outerHTML = chipsHTML(current);
      const next = root!.querySelector<HTMLElement>("[data-cs-chips]");
      if (next) {
        fitChips(next);
        if (active?.conn === "store-group") next.querySelector<HTMLElement>(`[data-conn="store-group"][data-id="${active.id}"]`)?.focus({ preventScroll: true });
      }
    }
    body.innerHTML = bodyHTML(current);
    if (top) { const list = scroller(); if (list) list.scrollTop = 0; }
  }

  const groupById = (id: string): ConnectionGroup | undefined => (Array.isArray(groups) ? groups.find((g) => g.id === id) : undefined);
  const entryById = (id: string): StoreService | undefined => everyApp(view()).find(s => s.id === id);
  /** The connection of what is open: an app's page of a connected app is its connection's. */
  const openedGroup = (): ConnectionGroup | undefined => {
    if (!open) return undefined;
    if (open.kind === "group") return groupById(open.id);
    const server = entryById(open.id)?.server_id;
    return server ? groupById(server) : undefined;
  };

  async function load(): Promise<void> {
    const mine = ++loads;
    const [list, status, recent, counted, builtins] = await Promise.allSettled([api.toolsetsList(), api.connectorsStatus(), api.integrationsAudit(AUDIT_READ), api.integrationsInventory(), api.integrationsCatalog()]);
    if (mine !== loads) return;
    // The count is the core's, read with the list it counts: both say the same moment.
    inventory = counted.status === "fulfilled" ? counted.value : "failed";
    if (inventory !== "failed") for (const app of inventory.apps) if (!placed.has(app.id)) placed.set(app.id, app.connected);
    if (status.status === "fulfilled") {
      configured = status.value.composio_configured;
      managed = status.value.connectors;
    }
    const previous = Array.isArray(groups) ? groups : [];
    if (list.status === "fulfilled" && status.status === "fulfilled") groups = [
      ...managed.map(c => managedGroup(c, previous.find(g => g.id === c.id))),
      ...list.value.groups.filter(g => !["connectors_composio", "connectors_google"].includes(g.id)),
    ];
    else if (!Array.isArray(groups)) groups = "failed";
    catalog = builtins.status === "fulfilled" ? builtins.value.services : "failed";
    if (Array.isArray(composioCatalog)) composioCatalog = composioCatalog.map(s => s.source ? { ...s,
      server_id: managed.find(c => c.id === `composio:${s.id}` && c.status === "ACTIVE")?.id ?? null } : s);
    if (recent.status === "fulfilled") audit = recent.value.entries;
    // what is open is gone (removed from elsewhere): back to the list
    if (open && !(open.kind === "group" ? groupById(open.id) : entryById(open.id))) open = null;
    redraw();
    if (configured && status.status === "fulfilled" && !Array.isArray(composioCatalog)) await loadCatalog();
  }

  async function loadCatalog(): Promise<void> {
    if (!configured) return;
    const mine = ++catalogLoads;
    const before = Array.isArray(composioCatalog) ? composioCatalog : null;
    // A refresh keeps the existing rows; drawing them again before its reply forces extra layout.
    if (!before) { composioCatalog = "loading"; repaintBody(); }
    try {
      const result = await api.connectorsCatalog();
      if (mine !== catalogLoads) return;
      const next = result.items.map(s => storePlugin(s, managed));
      const nextCategories = result.categories.map(c => ({ value: c.id, label: c.name }));
      // A background refresh still reads the catalog, but identical rows need no second layout.
      const unchanged = before && JSON.stringify(before) === JSON.stringify(next) && JSON.stringify(categories) === JSON.stringify(nextCategories);
      composioCatalog = next;
      categories = nextCategories;
      if (unchanged) return;
    } catch (error) {
      if (mine !== catalogLoads) return;
      if (error instanceof Error && error.message === "missing_key") { configured = false; composioCatalog = []; }
      else composioCatalog = before ?? "failed";
    }
    redraw();
  }

  async function loadTools(id: string): Promise<void> {
    const group = groupById(id);
    if (!group?.source || group.tools_state === "loading") return;
    group.tools_state = "loading"; redraw();
    try {
      const result = await api.connectorsTools(id);
      const current = groupById(id);
      if (!current) return;
      current.tools = result.items.map(pluginTool);
      current.tools_state = "ready";
      current.tool_count = current.tools.length;
      current.write_count = current.tools.filter(t => t.kind === "write").length;
      current.read_count = current.tools.length - current.write_count;
    } catch { const current = groupById(id); if (current) current.tools_state = "failed"; }
    redraw();
  }

  async function saveKey(): Promise<void> {
    const input = (host.root ?? document).querySelector<HTMLInputElement>("#conn-key");
    if (!input?.value.trim() || keyBusy) return;
    const mine = ++keySaves;
    let key = input.value.trim();
    input.value = "";
    keyBusy = true; keyError = ""; redraw();
    try {
      await api.connectorsSetKey(key);
      if (mine !== keySaves) return;
      configured = true; keyOpen = false;
      await loadCatalog();
    } catch (error) {
      if (mine !== keySaves) return;
      const kind = error instanceof Error ? error.message : "";
      keyError = kind === "openrouter_key" || kind === "consumer_key" || kind === "auth" ? kind
        : kind === "network" || kind === "timeout" ? "unreachable" : "unknown";
    }
    finally { key = ""; if (mine === keySaves) { keyBusy = false; redraw(); } }
  }

  /** Does `work` for a service (its buttons wait meanwhile), says what went wrong, and reads everything again. */
  async function act(id: string, work: () => Promise<void>): Promise<void> {
    if (busy.has(id)) return;
    busy.add(id);
    redraw();
    try {
      await work();
    } catch (err) {
      notify(describeError(err), "err");
    }
    busy.delete(id);
    await load();
    if (openedGroup()?.id === id) await loadTools(id);
  }

  /** Opens an app's page in the place of the view, and reads its tools when it is connected. */
  function openPage(next: OpenApp): void {
    open = next;
    loginError = null;
    dialogNotice = null;
    toolsOpen = false;
    auditOpen = false;
    clearTimeout(confirmTimer);
    confirming = null;
    redraw();
    const group = openedGroup();
    if (group) void loadTools(group.id);
  }

  /** The key's dialog closes, and the focus goes back to what opened it. */
  function closeDialog(): void {
    loginError = null;
    dialogNotice = null;
    if (!keyOpen) return;
    keyOpen = false; keyError = ""; keySaves++; keyBusy = false;
    redraw(); focusOn('[data-conn="configure-composio"]');
  }

  /** Steps back: from an app's page to the view it was opened from, or from the list of the connected apps to the one view. */
  function back(): void {
    clearTimeout(confirmTimer);
    confirming = null;
    loginError = null;
    dialogNotice = null;
    const from = open;
    if (from) {
      open = null;
      toolsOpen = false;
      auditOpen = false;
    } else if (screen === "connected") screen = "apps";
    else return;
    redraw();
    // The focus returns to the row (or the chip) that was pressed.
    if (from) focusOn(`[data-k="${from.kind === "group" ? "cs-open" : "cs-store"}:${typeof CSS !== "undefined" ? CSS.escape(from.id) : from.id}"]`);
    else focusOn('[data-k="cs-have"]');
  }

  function disconnect(id: string): void {
    clearTimeout(confirmTimer);
    if (confirming !== id) {
      confirming = id;
      confirmTimer = setTimeout(() => {
        confirming = null;
        redraw();
      }, DISCONNECT_CONFIRM_MS);
      redraw();
      return;
    }
    confirming = null;
    const group = groupById(id);
    void act(id, async () => {
      if (group?.source) await api.connectorsDisconnect(id);
      else await api.integrationsDisconnect(id);
      if (open && (open.id === id || openedGroup()?.id === id)) open = null;
      if (group) notify(t(group.auth !== "none" ? "conn.disconnectedLogin" : "conn.disconnected", { p0: group.name }));
    });
  }

  function nameAccount(id: string, account: { id?: string; label?: string }): void {
    if (!account.id) return;
    const dialog = openMemberDialog({title: t("account.label"), body: `<label class="mp-label">${esc(t("account.labelHelp"))}<input class="mb-fin" data-account-name maxlength="100" value="${esc(account.label || "")}" autocomplete="off"></label><p role="alert" hidden></p>`,
      actions: {secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: {label: esc(t("members.save")), attrs: ' data-dlg="save"'}},
      onAct(action, button) {
        if (action === "cancel") return dialog.close();
        const label = dialog.el.querySelector<HTMLInputElement>("[data-account-name]")!.value.trim();
        if (!label) return;
        button.setAttribute("disabled", "");
        void api.core("connectors.label", {id, account_id: account.id, label}).then(() => {dialog.close(); return load();}).catch(error => {
          const notice = dialog.el.querySelector<HTMLElement>('[role="alert"]')!; notice.textContent = describeError(error); notice.hidden = false; button.removeAttribute("disabled");
        });
      }});
    dialog.el.querySelector<HTMLInputElement>("[data-account-name]")?.focus();
  }

  /** Opens the browser login for a store entry (`catalog_id`) or for a service that must sign in again (`id`). */
  async function signIn(target: { catalog_id: string } | { id: string }, name: string, again: boolean): Promise<void> {
    if (login) return;
    const key = "catalog_id" in target ? target.catalog_id : target.id;
    const previousAccounts = new Set((Array.isArray(groups) ? groups : []).flatMap(group => (group.accounts ?? []).map(account => account.id)));
    const fromDialog = open && (open.id === key || entryById(open.id)?.id === key || openedGroup()?.id === key) ? open : null;
    dialogNotice = null;
    login = { target: key, name };
    loginError = null;
    redraw();
    let result: { connected: boolean; error?: string; connector?: ManagedConnector };
    try {
      result = ("catalog_id" in target ? !entryById(target.catalog_id)?.source : !groupById(target.id)?.source) ? await api.integrationsConnect(target)
        : "id" in target && groupById(target.id)?.source === "google"
        ? await api.connectorsGoogleConnect()
        : await api.connectorsConnect(key.replace(/^composio:/, ""));
    } catch (error) {
      result = { connected: false, error: error instanceof Error && error.message === "toolkit_not_allowed" ? "toolkit_not_allowed" : "error" };
    }
    login = null;
    device = null;
    if (result.connected) {
      loginError = null;
      if (!fromDialog || open === fromDialog || !dialogOpen()) notify(t(again ? "conn.relogged" : "conn.connected", { p0: name }));
    } else if (result.error !== "cancelled") {
      // Closing or replacing a page discards its pending failure as well as its visible one.
      if (!fromDialog || open === fromDialog) loginError = { target: key, kind: result.error ?? "error" };
      if (!fromDialog) notify(result.error === "toolkit_not_allowed" ? failureText(result.error) : t("plugins.connectFailed"), "err");
    }
    await load();
    if (result.connected) {
      const group = groupById(result.connector?.id || (key.startsWith("composio:") || key === "google" ? key : "composio:" + key));
      const account = result.connector?.accounts?.find(account => !previousAccounts.has(account.id)) || group?.accounts?.find(account => !previousAccounts.has(account.id));
      if (group && account) nameAccount(group.id, account);
    }
  }

  /**
   * Adds an app that asks for the owner's own key, or a developer app of their own: its form asks first (the values go to
   * the core in one call and to nothing else), then the core adds it, and for a developer app the browser signs in.
   */
  async function addWithForm(entry: StoreService, needs: "key" | "own_app"): Promise<void> {
    if (login) return;
    const added = await openConnectionSetup({ slug: entry.id, name: entry.name, needs }, {
      connect: async (fields) => {
        login = { target: entry.id, name: entry.name };
        loginError = null;
        redraw();
        try {
          return await api.connectorsConnect(entry.id, fields);
        } catch (error) {
          return { connected: false, error: error instanceof Error ? error.message : "error" };
        } finally {
          login = null;
          redraw();
        }
      },
      composioKey: () => { keyOpen = true; keyError = ""; redraw(); focusOn("#conn-key"); },
    });
    if (added) notify(t("conn.connected", { p0: entry.name }));
    await load();
  }

  function followEvent(event: MainEvent): void {
    if (event.type === "ConnectionsChanged" && host.visible()) { void load(); return; }
    if (event.type !== "DeviceCode" || !login) return;
    device = { catalog_id: event.catalog_id, user_code: event.user_code, verification_uri: event.verification_uri };
    redraw();
  }

  /** Puts the code on the clipboard, so that it is pasted at the page that opens, and opens the page. */
  async function openDevicePage(control: HTMLElement): Promise<void> {
    const d = device;
    if (!d) return;
    try {
      if (!await copyButton(control, d.user_code)) return;
      await api.openLink(d.verification_uri);
    } catch (err) {
      notify(describeError(err), "err");
    }
  }

  async function connectCustom(): Promise<void> {
    const f = form;
    if (!f || f.busy) return;
    const missing = !f.name.trim()
      ? "conn.form.needName"
      : f.type === "stdio" && !f.command.trim()
        ? "conn.form.needCommand"
        : f.type === "http" && !f.url.trim()
          ? "conn.form.needUrl"
          : null;
    if (missing) {
      f.error = () => t(missing);
      redraw();
      return;
    }
    const pairs: { name: string; value: string }[] = [];
    const request: NewConnection =
      f.type === "stdio"
        ? { name: f.name.trim(), transport: "stdio", command: f.command.trim(), args: f.args.split(/\r?\n/).map(line => line.trim()).filter(Boolean), env: pairs }
        : { name: f.name.trim(), transport: "http", url: f.url.trim(), headers: pairs };
    f.busy = true;
    f.error = null;
    redraw();
    try {
      request.result_size_limit = f.limit ?? 8000;
      request.env = f.type === "stdio" ? parseMcpPairs(f.pairLines ?? "") : undefined;
      request.headers = f.type === "http" ? parseMcpPairs(f.pairLines ?? "") : undefined;
      if (f.id) await api.integrationsUpdate(f.id, request);
      else await api.integrationsAdd(request);
      form = null; // the values were sent to the core's vault: nothing of them stays here
      screen = "connected";
      notify(t("conn.connected", { p0: request.name }));
      await load();
      return;
    } catch (err) {
      f.busy = false;
      const text = describeError(err);
      f.error = () => text;
    }
    await load();
    redraw();
  }

  async function testDraft(): Promise<void> {
    const f = form;
    if (!f || f.busy) return;
    f.busy = true; f.error = null; redraw();
    try {
      const values = parseMcpPairs(f.pairLines ?? "");
      const result = await api.integrationsTest({ ...(f.id ? { id: f.id } : {}), name: f.name.trim(), transport: f.type, command: f.command.trim(), args: f.args.split(/\r?\n/).filter(Boolean), url: f.url.trim(),
        env: f.type === "stdio" ? values : undefined, headers: f.type === "http" ? values : undefined, result_size_limit: f.limit ?? 8000 });
      f.testReport = result.ok ? `${t("mcp.testOk")} (${result.tools.length}): ${result.tools.join(", ")}` : `${t("mcp.testFailed")}: ${result.error ?? ""}`;
    } catch (error) { const message = describeError(error); f.error = () => message; }
    f.busy = false; redraw();
  }

  function click(target: Element): boolean {
    const button = target.closest<HTMLElement>("[data-conn]");
    if (!button) return false;
    const id = button.dataset.id ?? "";
    switch (button.dataset.conn) {
      case "server-menu": {
        const group = groupById(id);
        if (!group) return true;
        const panel = openPopover(button, [
          ...(!group.source ? [["test-server", t("mcp.test")], ["edit-server", t("mcp.edit")]] : []),
          ["disconnect", t(confirming === id ? group.source ? "conn.disconnectConfirm" : "conn.deleteConfirm" : group.source ? "conn.disconnect" : "mcp.delete")],
        ].map(([act, label]) => `<button type="button" role="menuitem"${act === "disconnect" ? ' class="danger"' : ""} data-conn="${act}" data-id="${esc(id)}">${esc(label)}</button>`).join(""), { className: "menu", role: "menu", label: t("mcp.actions") });
        panel.addEventListener("click", event => {
          const action = (event.target as Element).closest("[data-conn]");
          if (action) {
            const confirm = (action as HTMLElement).dataset.conn === "disconnect" && confirming !== id;
            closeMenu(); click(action);
            if (confirm) {
              const anchor = Array.from((host.root ?? document).querySelectorAll<HTMLElement>('[data-conn="server-menu"]')).find(anchor => anchor.dataset.id === id);
              if (anchor) { click(anchor); document.querySelector<HTMLButtonElement>('.menu [data-conn="disconnect"]')?.focus(); }
            }
          }
        });
        panel.querySelector<HTMLButtonElement>("button")?.focus();
        break;
      }
      case "test-server":
        void api.integrationsTest({ id }).then(result => notify(result.ok ? t("mcp.testOk") + ` (${result.tools.length})` : t("mcp.testFailed") + `: ${result.error ?? ""}`, result.ok ? "ok" : "err"), error => notify(describeError(error), "err"));
        break;
      case "edit-server": {
        const group = groupById(id);
        if (!group || group.catalog_id) return true;
        open = null;
        form = { ...emptyForm(), id, type: group.transport, name: group.name, command: group.command, args: group.args.join("\n"), url: group.url, limit: group.result_size_limit ?? 8000,
          pairLines: (group.transport === "stdio" ? group.env : group.headers).map(name => `${name}=`).join("\n") };
        redraw(); focusOn("#conn-name");
        break;
      }
      case "test-draft": void testDraft(); break;
      case "connected":
        screen = "connected";
        redraw();
        focusOn('[data-k="cs-back"]');
        break;
      case "open":
        if (groupById(id)) openPage({ kind: "group", id });
        break;
      case "scrim":
        // Outside gestures are handled by the shared dismissal layer.
        break;
      case "close":
        closeDialog();
        break;
      case "tool-list":
        toolsOpen = !toolsOpen;
        redraw();
        focusOn('[data-k="cs-count"]');
        break;
      case "audit":
        auditOpen = !auditOpen;
        redraw();
        break;
      case "try": {
        const group = groupById(id);
        const text = group ? examplePrompt(entryOf(group, view()) ?? everyApp(view()).find(s => s.server_id === group.id)) : null;
        if (text) host.tryPrompt(text);
        break;
      }
      case "open-store":
        if (entryById(id)) openPage({ kind: "app", id });
        break;
      case "back":
        back();
        break;
      case "enable": {
        const group = groupById(id);
        if (group) void act(id, async () => {
          if (group.source) await api.connectorsSetTools(id, { enabled: !group.enabled });
          else await api.integrationsSetEnabled(id, !group.enabled);
        });
        break;
      }
      case "kind": {
        const group = groupById(id), kind = button.dataset.kind;
        const tools = group?.tools.filter(tool => tool.kind === kind) ?? [];
        if (group && (kind === "write" || kind === "read") && tools.length && group.tools_state !== "loading" && group.tools_state !== "failed") void act(id, async () => {
          const on = !tools.every(tool => tool.enabled);
          if (group.source) {
            const disabled = new Set(group.disabled_tools ?? []);
            for (const tool of tools) { if (on) disabled.delete(tool.name); else disabled.add(tool.name); }
            await api.connectorsSetTools(id, { disabled_tools: [...disabled] });
          } else await api.integrationsSetToolsEnabled(id, tools.map(tool => tool.name), on);
        });
        break;
      }
      case "tool": {
        const group = groupById(id);
        const tool = group?.tools.find((x) => x.name === button.dataset.tool);
        if (tool && group) void act(id, async () => {
          if (group.source) {
            const disabled = new Set(group.disabled_tools ?? []);
            if (tool.enabled) disabled.add(tool.name); else disabled.delete(tool.name);
            await api.connectorsSetTools(id, { disabled_tools: [...disabled] });
          } else await api.integrationsSetToolEnabled(id, tool.name, !tool.enabled);
        });
        break;
      }
      case "refresh":
        if (groupById(id)?.source) { void loadTools(id); break; }
        void act(id, async () => {
          await api.integrationsRefresh(id);
          notify(t("conn.refreshed"));
        });
        break;
      case "disconnect":
        disconnect(id);
        break;
      case "join": {
        const entry = entryById(id);
        if (!entry || entry.server_id) break;
        // A sign-in, or one key, is done here at once. Anything more (a server of the owner's own, a developer app) is set
        // up in the conversation, where the member says what it needs and explains it (owner, 2026-11-09: 「一律全部都在對話中
        // 進行…除非真的是登入就結束 或是輸入金鑰匙就結束」).
        if (inChat(entry)) { host.tryPrompt(entry.id === OWN_GOOGLE ? t("store.googleSetUp") : t("store.setUpInChat", { p0: entry.name })); break; }
        if (entry.needs === "key") void addWithForm(entry, entry.needs);
        else void signIn({ catalog_id: entry.id }, entry.name, false);
        break;
      }
      case "relogin": {
        const group = groupById(id);
        if (group) void signIn({ id }, group.name, true);
        break;
      }
      case "device-open":
        void openDevicePage(button);
        break;
      case "open-grants": {
        const url = GRANTS_URL[groupById(id)?.catalog_id ?? ""];
        if (url) void api.openLink(url).catch((err) => notify(describeError(err), "err"));
        break;
      }
      case "cancel-login":
        if (login && (entryById(login.target)?.source || groupById(login.target)?.source)) break;
        void api.integrationsConnectCancel().catch((err) => notify(describeError(err), "err"));
        break;
      case "form-cancel":
        form = null; // an unsent value is dropped with the form
        redraw();
        break;
      case "connect":
        void connectCustom();
        break;
      case "configure-composio": keyOpen = true; keyError = ""; redraw(); focusOn("#conn-key"); break;
      case "save-key": void saveKey(); break;
      case "account-label": {
        const account = groupById(id)?.accounts?.find(a => a.id === button.dataset.account);
        if (account) nameAccount(id, account);
        break;
      }
      case "add-account": { const group = groupById(id); if (group) void signIn({id}, group.name, true); break; }
      case "retry-connections": void load(); break;
      case "retry-builtin-store": void load(); break;
      case "store-group":
        // A chip clears the search and lists its category (全部 goes back to the sections); pressing the chosen one again changes nothing.
        chooseCategory(id);
        break;
      case "recommended-all":
        recommendedAll = true;
        repaintBody();
        break;
      case "retry-store": void (configured ? loadCatalog() : load()); break;
      default:
        return false;
    }
    return true;
  }

  function input(el: HTMLInputElement): boolean {
    if (el.id === "conn-search") {
      // The search is over the whole catalog: its results take the place of the sections while it has words.
      const searching = search.trim() !== "";
      search = el.value; shown = LIST_STEP;
      repaintBody(true, searching !== (search.trim() !== ""));
      return true;
    }
    if (el.id === "conn-key") return true;
    if (!form || !el.id.startsWith("conn-")) return false;
    switch (el.id) {
      case "conn-pairs": form.pairLines = el.value; break;
      case "conn-limit": form.limit = Number(el.value); break;
      case "conn-name":
        form.name = el.value;
        break;
      case "conn-command":
        form.command = el.value;
        break;
      case "conn-args":
        form.args = el.value;
        break;
      case "conn-url":
        form.url = el.value;
        break;
      default:
        return false;
    }
    return true;
  }

  function key(e: KeyboardEvent): boolean {
    if (e.key === "Enter" && (e.target as HTMLElement)?.id === "conn-key") { e.preventDefault(); void saveKey(); return true; }
    const panel = typeof document !== "undefined" ? (host.root ?? document).querySelector<HTMLElement>("#cs-dialog") : null;
    if (e.key === "Escape" && panel && !isTopLayer(panel)) return false;
    // Escape steps back (the key's dialog, then an app's page, then the list of the connected apps); once there is nothing to step back
    // from it is the settings' own, and closes the dialog.
    if (e.key === "Escape" && !e.defaultPrevented && (keyOpen || open || screen === "connected")) {
      e.preventDefault();
      if (keyOpen) closeDialog(); else back();
      return true;
    }
    const el = e.target as HTMLElement | null;
    if (e.key !== "Enter" || !form || !el?.id?.startsWith("conn-") || el instanceof HTMLTextAreaElement) return false;
    e.preventDefault();
    void connectCustom();
    return true;
  }

  /** A category is chosen (a chip, or 更多): its list replaces the sections, and the search is cleared. */
  function chooseCategory(id: string): void {
    if (id === category && !search.trim()) return;
    category = id; search = ""; shown = LIST_STEP;
    const input = typeof document !== "undefined" ? (host.root ?? document).querySelector<HTMLInputElement>("#conn-search") : null;
    if (input) input.value = "";
    repaintBody(true);
  }

  /** Fits the row of chips to the width the dialog has now. */
  function painted(): void {
    const row = typeof document !== "undefined" ? (host.root ?? document).querySelector<HTMLElement>("[data-cs-chips]") : null;
    if (row) fitChips(row);
  }

  /** A long list draws its next rows when the end of what is drawn comes near. */
  function scrolled(target: Element): void {
    if (!(target instanceof HTMLElement) || !target.matches("[data-cs-scroll]") || screen !== "apps" || open) return;
    if (target.scrollTop + target.clientHeight < target.scrollHeight - 320) return;
    const from = shown;
    const list = layoutOf(view()).list;
    if (!list || list.length <= from) return;
    shown = from + LIST_STEP;
    const grid = target.querySelector<HTMLElement>("[data-cs-body] > .cs-grid");
    if (grid) grid.insertAdjacentHTML("beforeend", list.slice(from, shown).map((s) => appRowHTML(s, view())).join(""));
    else repaintBody();
  }

  function menuFor(k: string): ConnectionMenu | null {
    switch (k) {
      case "conn-more":
        return {
          choices: hiddenCategories(typeof document !== "undefined" ? host.root ?? document : null, view()).map((group) => ({ value: group, label: groupLabel(group) })),
          current: category,
          pick: chooseCategory,
        };
      case "conn-add":
        return {
          choices: [{ value: "custom", label: t("mcp.add") }, { value: "paste", label: t("mcp.paste") }, { value: "import", label: t("mcp.fromApps") }],
          current: "", // nothing is checked: it is an act, not a state
          pick: (value) => {
            if (value === "paste" || value === "import") { openMcpImport(value === "import", () => void load()); return; }
            if (value !== "custom" || form?.busy) return;
            open = null;
            form = emptyForm();
            redraw();
            focusOn("#conn-name");
          },
        };
      case "conn-type":
        return form
          ? {
              choices: typeChoices(),
              current: form.type,
              pick: (value) => {
                if (form && (value === "stdio" || value === "http") && value !== form.type) {
                  form.type = value;
                  form.pairLines = ""; // Variables and headers are different things.
                  form.testReport = undefined;
                  redraw();
                }
              },
            }
          : null;
      default:
        return null;
    }
  }

  function reset(): void {
    placed.clear();
    catalogLoads++;
    category = ""; shown = LIST_STEP; recommendedAll = false;
    keyError = ""; keyOpen = false; keySaves++; keyBusy = false;
    stopOutside?.(); stopOutside = null;
    clearTimeout(confirmTimer);
    confirming = null;
    form = null;
    open = null;
    toolsOpen = false;
    auditOpen = false;
    search = "";
    screen = "apps";
    loginError = null;
    dialogNotice = null;
    // the code stays: the login still waits for it in the core, which does not send it again
    loads++;
  }

  return { view, load, click, input, key, menuFor, painted, scrolled, followEvent, reset };
}
