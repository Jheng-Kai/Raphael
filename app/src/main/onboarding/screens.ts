// What each screen of the guide looks like, as HTML for a given state. Each screen is one calm centred column, as Grok
// Bot's first run is (owner, 2026-11-07): a title, the choice it is about (tiles in a grid, or rows), and, drawn by
// mount.ts, one wide black pill under it with a round arrow beside it for the way back. Nothing here reads the window or
// the core, so a screen can be drawn from made-up data (the browser check does).

import { getLocale, t } from "../i18n";
import type { MessageKey } from "../i18n/zh-TW";

import { CLIS, type CliBrainsView } from "../cli-brains";
import { COMPOSIO_SVG, entryIcon, ownServerForm } from "../connections";
import { nameScore } from "../find-match";
import { popularServices } from "./helpers";
import { providerMark } from "../provider-marks";
import { type ProvidersView, description, emptyProvidersView, providersAddHTML } from "../providers";
import type { ProviderKind, StoreService } from "../types";
import { slimeFaceHTML } from "../slime";
import { btn, esc, fieldHTML, ico, st } from "../ui";

export type GuideStep = "welcome" | "tools" | "services" | "abilities";

/** A slime floating by a step's title: who it is, where (from the column's left or right edge, and down from the
 * title's top) and how large. */
interface Floater { avatar: string; side: "left" | "right"; x: number; y: number; px: number }
/**
 * The team's own characters float by each step's title, as Grok Bot's bots float around its questions: different ones on
 * every step, never in the same places (owner, 2026-11-08: 「可以放我們特別設定好的成員…位置也可以放在不一樣的地方」).
 */
const FLOATERS: Record<Exclude<GuideStep, "welcome">, readonly Floater[]> = {
  tools: [
    { avatar: "slime:gobta", side: "left", x: 2, y: 2, px: 42 },
    { avatar: "slime:shion", side: "right", x: 4, y: 40, px: 36 },
    { avatar: "slime:ranga", side: "right", x: 18, y: -18, px: 28 },
  ],
  services: [
    { avatar: "slime:shuna", side: "left", x: 9, y: 38, px: 36 },
    { avatar: "slime:diablo", side: "right", x: 1, y: 6, px: 42 },
    { avatar: "slime:benimaru", side: "left", x: 20, y: -16, px: 28 },
  ],
  abilities: [
    { avatar: "slime:milim", side: "left", x: 0, y: -8, px: 38 },
    { avatar: "slime:souei", side: "right", x: 12, y: 42, px: 32 },
    { avatar: "slime:rigurd", side: "right", x: 0, y: -14, px: 30 },
  ],
};

/** The decoration around a title: it takes no room and no part in the reading order. */
function floaters(step: Exclude<GuideStep, "welcome">): string {
  const one = (floater: Floater, index: number): string =>
    `<span class="ob-fl" style="${floater.side}:${floater.x}%;top:${floater.y}px">${slimeFaceHTML({ id: -1 - index, avatar: floater.avatar }, floater.px)}</span>`;
  return `<div class="ob-floaters" aria-hidden="true">${FLOATERS[step].map(one).join("")}</div>`;
}

/** The title of a screen; what the step is for is the choice itself, never a line under it. */
export const head = (title: string, step?: Exclude<GuideStep, "welcome">): string => (step ? floaters(step) : "") + `<h2 tabindex="-1">${esc(title)}</h2>`;

/** A check in a small black square, on a tile that is chosen or ready (as Grok Bot's chosen tiles); `word` is what a reader hears. */
const tick = (word: string): string => `<span class="ob-tick" role="img" aria-label="${esc(word)}">${ico("check")}</span>`;

/**
 * One tile of a choice, one row as a store's app is (owner, 2026-11-09: the tiles were too tall and an email broke over
 * two lines): the mark in its square, the name over one quiet line that never wraps, and on the right the control,
 * then the check when the tile is `on` (the word a reader hears for it). A `wide` tile spans its row and its line may
 * wrap; an `entry` tile (a key or an address being typed) spans it too, with its fields and buttons under its name, so
 * a narrow window never squeezes its words into a sliver.
 */
function tile(o: { id: string; mark: string; name: string; line?: string; lineHTML?: string; control?: string; on?: string; wide?: boolean; entry?: boolean }): string {
  const line = o.lineHTML ?? (o.line ? esc(o.line) : "");
  return (
    `<div class="ob-tile${o.wide || o.entry ? " wide" : ""}${o.entry ? " entry" : ""}${o.on ? " on" : ""}" data-item="${esc(o.id)}">` +
    `<span class="ob-ic">${o.mark}</span>` +
    `<span class="ob-tx"><span class="nm">${esc(o.name)}</span>${line ? `<span class="ds">${line}</span>` : ""}</span>` +
    `<span class="ob-ctl">${o.control ?? ""}${o.on && !o.wide && !o.entry ? tick(o.on) : ""}</span>` +
    `</div>`
  );
}

const alert = (html: string): string => `<div class="ob-alert" role="alert">${html}</div>`;

// ---------- welcome ----------

/** What the welcome types (owner, 2026-11-08): something the owner might ask, and Raphael's answer in his own manner,
 * 告。, 解。 or 否。 — what the team can do, said by him rather than a slogan. */
export const DEMOS = [
  ["onboarding.demo1Ask", "onboarding.demo1Reply"], ["onboarding.demo2Ask", "onboarding.demo2Reply"],
  ["onboarding.demo3Ask", "onboarding.demo3Reply"], ["onboarding.demo4Ask", "onboarding.demo4Reply"],
  ["onboarding.demo5Ask", "onboarding.demo5Reply"], ["onboarding.demo6Ask", "onboarding.demo6Reply"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];
export const demoAsk = (demo: (typeof DEMOS)[number]): string => t(demo[0]);
export const demoReply = (demo: (typeof DEMOS)[number]): string => t(demo[1]);

/**
 * Raphael's emblem (the canvas is drawn by mount.ts with the same renderer as the voice screen), his name, and under it
 * an ask being typed with his answer: mount.ts types, deletes and moves on; with reduced motion the first pair stands.
 * A reader hears one sentence of what the team does instead. The language is chosen at the window's top left.
 */
export function welcomeHTML(): string {
  // His name is one wordmark for every language, 「智慧之王ラファエル」 (owner, 2026-11-08: 「夠酷就好…所有語言都是一樣的」),
  // inked in the theme's colour through a mask; a reader hears the name in the window's language.
  return (
    `<div class="ob-emblem" aria-hidden="true"><canvas class="ob-emb"></canvas></div>` +
    `<h2 tabindex="-1" class="ob-wordmark"><span class="ob-wm" aria-hidden="true"></span><span class="ob-name">${esc(t("onboarding.welcomeTitle"))}</span></h2>` +
    `<div class="ob-demo"><p class="ob-sr">${esc(t("onboarding.demoSummary"))}</p>` +
    `<p class="ob-demo-ask" aria-hidden="true"><span data-ob-typed>${esc(demoAsk(DEMOS[0]))}</span><span class="ob-caret"></span></p>` +
    `<p class="ob-demo-reply" aria-hidden="true" data-ob-reply>${esc(demoReply(DEMOS[0]))}</p></div>`
  );
}

// ---------- 1. the AI tools ----------

/** The OpenRouter key, as the guide knows it. The key itself is never held here. */
export interface KeyView {
  has: boolean;
  /** The name the key was given at OpenRouter, once it has been checked in this run. */
  name: string | null;
  /** The field is open although there is a key: it is being replaced. */
  replacing: boolean;
  busy: boolean;
  error: string | null;
}

type ToolId = "chatgpt" | (typeof CLIS)[number]["id"];

export interface ToolCard {
  id: ToolId;
  mark: string;
  name: string;
  /** The quiet line: what the account is at, or who it is. */
  line: string;
  /** The tool is signed in and ready. */
  ready: boolean;
  /** The one button the card has when it is not: its label and the hook the account controller listens to. */
  action: { label: string; attrs: string } | null;
}

const versionOf = (text: string | undefined): string => text?.match(/\d+(?:\.\d+)+(?:[-+][\w.-]+)?/)?.[0] ?? "";

/** The subscription accounts as cards, from the account controller's view. */
export function toolCards(v: CliBrainsView): ToolCard[] {
  const waiting = v.state !== "ready";
  const waitLine = t(v.state === "loading" ? "common.loading" : "missing.cli");
  const chatgpt = v.chatgpt;
  const signing = !!chatgpt?.signing_in;
  const signedIn = !!chatgpt?.signed_in && !signing && chatgpt.plan_scope_granted !== false;
  const cards: ToolCard[] = [
    {
      id: "chatgpt",
      mark: providerMark("openai"),
      name: "ChatGPT",
      // Signed in, the account is the line: the check already says it is ready.
      line: waiting ? waitLine : signing ? t("brains.chatgptSigning") : signedIn ? chatgpt?.email || t("brains.usingPlan") : chatgpt?.signed_in ? t("brains.chatgptNoPlan") : t("brains.signedOut"),
      ready: !waiting && signedIn,
      action: waiting || signedIn ? null : signing ? { label: t("common.cancel"), attrs: ' data-chatgpt="cancel" data-k="chatgpt:cancel"' } : { label: t("providers.connect"), attrs: ' data-chatgpt="sign-in" data-k="chatgpt:sign-in"' },
    },
  ];
  for (const known of CLIS) {
    const cli = v.clis.find((c) => c.id === known.id);
    const ready = !waiting && !!cli?.available;
    // Every tile of the guide says 連接 for the same act, whatever kind of tool it is.
    const label = t(cli?.installed ? "providers.connect" : "brains.install");
    const version = versionOf(cli?.version);
    cards.push({
      id: known.id,
      mark: providerMark(known.mark),
      name: known.name,
      // Every tile has its quiet line, so the names stand at one height: a ready tool says so, with its version.
      line: waiting ? waitLine : ready ? [t("brains.ready"), version].filter(Boolean).join(" · ") : t(cli?.disconnected ? "brains.disconnected" : !cli?.installed ? "brains.missing" : "brains.signedOut"),
      ready,
      action: waiting || ready ? null : { label, attrs: ` data-cli="${known.id}" data-k="cli:${known.id}" aria-label="${esc(`${label} ${known.name}`)}"${v.busy ? " disabled" : ""}` },
    });
  }
  return cards;
}

const toolTile = (card: ToolCard): string =>
  tile({ id: card.id, mark: card.mark, name: card.name, line: card.line, on: card.ready ? t("brains.ready") : undefined, control: !card.ready && card.action ? btn(esc(card.action.label), "sm", card.action.attrs) : "" });

/**
 * A key typed in a wide tile: the masked field, 「取消」 and 「貼上」 (「檢查中…」 while it is checked). The guide's two keys,
 * OpenRouter's and Composio's, are typed alike; a key is sent by Enter or 貼上 only.
 */
function keyEntry(o: { id: string; placeholder: string; label: string; busy: boolean; invalid: boolean; cancel: string; paste: string }): string {
  return (
    fieldHTML(o.placeholder, "", { label: o.label, id: o.id, type: "password", invalid: o.invalid, disabled: o.busy }) +
    btn(esc(t("common.cancel")), "sm", ` data-ob="${o.cancel}"${o.busy ? " disabled" : ""}`) +
    btn(esc(o.busy ? t("common.checking") : t("common.paste")), "sm", ` data-ob="${o.paste}"${o.busy ? " disabled" : ""}`)
  );
}

/**
 * The OpenRouter tile, one tile like the others: 「連接」 (or the check and 「更換」) until it is pressed, then it spans its row
 * with the key's field while the key is typed. A refused key keeps the field open with its alert.
 */
function keyTile(k: KeyView): string {
  const entering = k.replacing || k.busy || k.error !== null;
  const control = entering
    ? keyEntry({ id: "ob-key-input", placeholder: "sk-or-v1-…", label: t("common.apiKeyField"), busy: k.busy, invalid: k.error !== null, cancel: "key-cancel", paste: "key-paste" })
    : k.has
      ? btn(esc(t("onboarding.keyReplace")), "sm", ' data-ob="key-replace"')
      : btn(esc(t("providers.connect")), "sm", ` data-ob="key-replace" aria-label="${esc(`${t("providers.connect")} OpenRouter`)}"`);
  // One short line like every other tile's: the key's own name once it is known, otherwise what it is.
  const line = k.has && !entering && k.name !== null ? t("onboarding.keyNamed", { p0: k.name }) : t("common.apiKey");
  return tile({ id: "openrouter", mark: providerMark("openrouter"), name: "OpenRouter", line, control, entry: entering, on: k.has && !entering ? t("onboarding.keyIsSet") : undefined }) + (k.error ? alert(st("err", k.error)) : "");
}

/**
 * Every provider the app can connect, as tiles, from the core's catalog (the same as Settings › 模型與用量's 新增供應商):
 * the guide is for everyone, not only the providers one owner uses (owner, 2026-11-07). A tile's button opens the same
 * editor as Settings. OpenRouter keeps its own key tile above them; ChatGPT is a sign-in among the accounts.
 */
const GROUP_TITLE: Record<ProviderKind["group"], MessageKey> = { official: "providers.official", gateway: "providers.gateway", local: "providers.local" };

function providerTile(kind: ProviderKind, v: ProvidersView): string {
  const provider = v.providers.find((p) => p.kind === kind.kind);
  const control = provider
    ? btn(esc(t("providers.manage")), "sm", ` data-pv="open" data-id="${esc(provider.id)}" aria-label="${esc(`${t("providers.manage")} ${kind.name}`)}"${v.busy ? " disabled" : ""}`)
    : btn(esc(t("providers.connect")), "sm", ` data-pv="add" data-id="${esc(kind.kind)}" aria-label="${esc(`${t("providers.connect")} ${kind.name}`)}"${kind.available && !v.busy ? "" : " disabled"}`);
  return tile({ id: `provider:${kind.kind}`, mark: providerMark(kind.kind), name: kind.name, line: kind.available ? description(kind) : t("providers.soon"), on: provider ? t("providers.connected") : undefined, control });
}

const tr = t as unknown as (key: MessageKey) => string;

/** One AI tool the guide offers, whatever kind it is: a subscription account, the OpenRouter key or a catalog provider. */
interface ToolTile { id: string; name: string; group: "accounts" | ProviderKind["group"]; html: string }

/**
 * The tools most people reach for, the same for everyone (owner, 2026-11-08: 「所有的服務是平等的…可以放一個 popular 的
 * 區域」). The guide is a store: it never orders itself by what one owner has set up.
 */
export const POPULAR_TOOLS = ["chatgpt", "claude", "codex", "openrouter", "provider:anthropic", "provider:google"] as const;
const GROUPS = ["accounts", "official", "gateway", "local"] as const;
const groupTitle = (group: ToolTile["group"]): string => (group === "accounts" ? t("brains.accounts") : tr(GROUP_TITLE[group]));

function toolTiles(accounts: CliBrainsView, key: KeyView, providers: ProvidersView): ToolTile[] {
  const tiles: ToolTile[] = toolCards(accounts).map((card) => ({ id: card.id, name: card.name, group: "accounts", html: toolTile(card) }));
  tiles.push({ id: "openrouter", name: "OpenRouter", group: "gateway", html: keyTile(key) });
  if (providers.state === "ready") {
    for (const kind of providers.kinds) {
      if (kind.kind !== "openrouter" && kind.kind !== "chatgpt") tiles.push({ id: `provider:${kind.kind}`, name: kind.name, group: kind.group, html: providerTile(kind, providers) });
    }
  }
  return tiles;
}

const toolGrid = (tiles: readonly ToolTile[], attrs: string): string => `<div class="ob-grid"${attrs}>${tiles.map((tile) => tile.html).join("")}</div>`;

/**
 * The tools as a store: 熱門 first, then every other tool under its kind, each kind by name; a search shows the tools whose
 * name it finds (typos forgiven, R-FIND-01) in one grid instead.
 */
export function toolsListHTML(accounts: CliBrainsView, key: KeyView, providers: ProvidersView = emptyProvidersView(), query = ""): string {
  const tiles = toolTiles(accounts, key, providers);
  const wanted = query.trim();
  if (wanted) {
    const found = tiles.map((tile) => ({ tile, score: nameScore([tile.name, tile.id.replace(/^provider:/, "")], wanted) })).filter((hit) => hit.score < Infinity).sort((a, b) => a.score - b.score);
    return found.length ? toolGrid(found.map((hit) => hit.tile), " data-ob-found") : `<p class="ob-state">${esc(t("onboarding.toolsNone"))}</p>`;
  }
  const popular = POPULAR_TOOLS.map((id) => tiles.find((tile) => tile.id === id)).filter((tile): tile is ToolTile => !!tile);
  const rest = tiles.filter((tile) => !popular.includes(tile));
  const byName = (a: ToolTile, b: ToolTile): number => a.name.localeCompare(b.name, "en");
  return `<h3 class="ob-section">${esc(t("onboarding.popular"))}</h3>${toolGrid(popular, ' data-ob-group="popular"')}` +
    GROUPS.map((group) => {
      const shown = rest.filter((tile) => tile.group === group).sort(byName);
      return shown.length ? `<h3 class="ob-section">${esc(groupTitle(group))}</h3>${toolGrid(shown, ` data-ob-group="${group}"`)}` : "";
    }).join("") +
    (providers.state === "failed" ? alert(st("err", t("providers.error"))) : "");
}

export function toolsHTML(accounts: CliBrainsView, key: KeyView, accountError: string, providers: ProvidersView = emptyProvidersView(), query = ""): string {
  return (
    head(t("onboarding.toolsTitle"), "tools") +
    `<div class="ob-main"><div class="ob-find">${fieldHTML(t("conn.search"), query, { icon: "search", id: "ob-tools-find" })}</div>` +
    (accountError ? alert(st("err", accountError)) : "") +
    `<div data-ob-tools>${toolsListHTML(accounts, key, providers, query)}</div>` +
    `</div>` + providersAddHTML(providers)
  );
}

// ---------- 2. the services ----------

/** Composio, as the services step knows it. The key itself is never held here. */
export interface ComposioView {
  /** Whether a key is set; null until the core has said, and then the card is not drawn. */
  configured: boolean | null;
  /** The key's field is open. */
  entering: boolean;
  busy: boolean;
  error: string | null;
}

export const emptyComposioView = (): ComposioView => ({ configured: null, entering: false, busy: false, error: null });

/** The own-server app (n8n) whose address and key are being typed in its tile. */
export interface ServerEntry { id: string; busy: boolean; error: string | null }

export interface ServicesState {
  /** Every app the guide can add (mergeServices): what is shown before a search is the popular sign-in ones. */
  services: StoreService[] | "loading" | "failed";
  /** The service whose login is open in the browser. */
  waiting: string | null;
  /** A login that did not come through. */
  failed: string | null;
  /** What the search box holds. */
  query?: string;
  composio?: ComposioView;
  server?: ServerEntry | null;
}

/** The most a search shows: the nearest matches, the rest of the store being in 「連接」 afterwards. */
const FOUND_SHOWN = 30;

/**
 * The services whose name or id the search finds: as typed (by letters, not by case or spacing), or, when none is,
 * the names it nearly spells, nearest first (typos forgiven, R-FIND-01).
 */
export function matchServices(services: readonly StoreService[], query: string): StoreService[] {
  const text = (value: string): string => value.toLowerCase().replace(/\s+/g, "");
  const wanted = text(query.trim());
  if (!wanted) return [...services];
  const exact = services.filter((s) => text(s.name).includes(wanted) || text(s.id).includes(wanted));
  if (exact.length) return exact;
  return services.map((s) => ({ s, score: nameScore([s.name, s.id], query.trim()) }))
    .filter((hit) => hit.score < Infinity).sort((a, b) => a.score - b.score).map((hit) => hit.s);
}

const summaryOf = (s: StoreService): string => s.summary[getLocale()] ?? s.summary.en ?? "";

/**
 * One app's tile. An app that asks only a sign-in is one button: pressing the tile opens its login. One that asks for
 * the owner's own key or developer app has 「加入」, which opens the store's own form; an app on the owner's own server
 * (n8n) has 「加入」 too, and its address and key are then typed across its row.
 */
function serviceTile(s: StoreService, v: ServicesState): string {
  const mark = entryIcon(s, "md");
  const own = ownServerForm(s.id);
  if (s.server_id !== null) return tile({ id: s.id, mark, name: s.name, line: summaryOf(s), on: t("onboarding.connConnected") });
  if (v.waiting === s.id) {
    return tile({ id: s.id, mark, name: s.name, lineHTML: st("idle", t("onboarding.connWaiting")), control: btn(esc(t("common.cancel")), "sm", ' data-ob="conn-cancel"') });
  }
  if (own && v.server?.id === s.id) return serverTile(s, mark, own, v.server);
  const need = own ? t("store.needsOwnServer") : s.needs === "key" ? t("setup.needsKey") : s.needs === "own_app" ? t("setup.needsOwnApp") : "";
  if (need) {
    const act = own ? "server-open" : "conn-setup";
    return tile({ id: s.id, mark, name: s.name, line: need, control: btn(esc(t("conn.join")), "sm", ` data-ob="${act}" data-service="${esc(s.id)}" aria-label="${esc(`${t("conn.join")} ${s.name}`)}"${v.waiting || v.server?.busy ? " disabled" : ""}`) });
  }
  // The whole tile is the sign-in button; the word on its right says what pressing it does.
  return (
    `<button type="button" class="btn ob-tile pick" data-item="${esc(s.id)}" data-ob="conn-login" data-id="${esc(s.id)}" data-service="${esc(s.id)}"` +
    ` aria-label="${esc(`${t("onboarding.connLogin")} ${s.name}`)}"${v.waiting ? " disabled" : ""}>` +
    `<span class="ob-ic">${mark}</span><span class="ob-tx"><span class="nm">${esc(s.name)}</span><span class="ds">${esc(summaryOf(s))}</span></span>` +
    `<span class="ob-ctl"><span class="ob-get" aria-hidden="true">${esc(t("onboarding.connLogin"))}</span></span></button>`
  );
}

/** An own-server app being added: its address and its key across its row, then 「取消」 and 「連接」. */
function serverTile(s: StoreService, mark: string, own: NonNullable<ReturnType<typeof ownServerForm>>, entry: ServerEntry): string {
  const off = entry.busy ? " disabled" : "";
  const control =
    fieldHTML(own.urlHint, "", { label: `${s.name} ${t("conn.form.url")}`, id: "ob-server-url", invalid: entry.error !== null, disabled: entry.busy }) +
    fieldHTML(t("onboarding.serverToken"), "", { label: `${s.name} ${t("onboarding.serverToken")}`, id: "ob-server-token", type: "password", disabled: entry.busy }) +
    btn(esc(t("common.cancel")), "sm", ` data-ob="server-cancel"${off}`) +
    btn(esc(entry.busy ? t("conn.form.connecting") : t("providers.connect")), "sm", ` data-ob="server-add"${off}`);
  return tile({ id: s.id, mark, name: s.name, line: t("store.leadOwnServer", { p0: s.name }), control, entry: true }) + (entry.error ? alert(st("err", entry.error)) : "");
}

/**
 * Composio, before its key is set: one card across the step that unlocks the store's other apps (owner, 2026-11-09:
 * 「要讓他們先連上 Composio」). Its key is typed in the card, as OpenRouter's is on the first step.
 */
function composioTile(c: ComposioView): string {
  const entering = c.entering || c.busy || c.error !== null;
  const control = entering
    ? keyEntry({ id: "ob-composio-input", placeholder: "ak_…", label: t("plugins.keyPrompt"), busy: c.busy, invalid: c.error !== null, cancel: "composio-cancel", paste: "composio-paste" })
    : btn(esc(t("providers.connect")), "sm", ` data-ob="composio-open" aria-label="${esc(`${t("providers.connect")} Composio`)}"`);
  const mark = `<span class="mono md" aria-hidden="true">${COMPOSIO_SVG}</span>`;
  return (
    `<div class="ob-composio">` +
    tile({ id: "composio", mark, name: "Composio", line: t(entering ? "onboarding.composioKeyLine" : "onboarding.composioLine"), control, wide: true, entry: entering }) +
    (c.error ? alert(st("err", c.error)) : "") +
    `</div>`
  );
}

/**
 * What the grid holds: before a search, the popular apps that ask only a sign-in; with one, every app it finds,
 * whatever it asks, or a word that none does.
 */
export function serviceTilesHTML(v: ServicesState): string {
  if (!Array.isArray(v.services)) return "";
  const shown = v.query?.trim()
    ? matchServices(v.services, v.query).slice(0, FOUND_SHOWN)
    : popularServices(v.services.filter((s) => !ownServerForm(s.id)));
  return shown.length ? shown.map((s) => serviceTile(s, v)).join("") : `<p class="ob-state">${esc(t("onboarding.connNone"))}</p>`;
}

/** The heading over the grid: what it is, so without Composio it says these need none. */
const servicesHeading = (v: ServicesState): string =>
  v.query?.trim() ? "" : `<h3 class="ob-section" data-ob-services-title>${esc(t(v.composio?.configured === false ? "onboarding.connBuiltin" : "onboarding.popular"))}</h3>`;

export function servicesHTML(v: ServicesState): string {
  let body: string;
  if (v.services === "loading") body = `<div class="ob-state"><span class="spin" role="status" aria-label="${esc(t("conn.loading"))}"></span></div>`;
  else if (v.services === "failed") body = alert(st("err", t("onboarding.connLoadFailed")) + btn(esc(t("onboarding.retry")), "sm", ' data-ob="conn-reload"'));
  else {
    body =
      `<div class="ob-find">${fieldHTML(t("conn.search"), v.query ?? "", { icon: "search", id: "ob-find" })}</div>` +
      (v.composio?.configured === false ? composioTile(v.composio) : "") +
      `<div data-ob-services-list>${servicesListHTML(v)}</div>`;
  }
  return head(t("onboarding.connTitle"), "services") + `<div class="ob-main" id="ob-conn">${body}</div>`;
}

/** The heading, the grid and a login's failure: what a search or a login redraws, leaving the field and Composio's card be. */
export function servicesListHTML(v: ServicesState): string {
  return servicesHeading(v) + `<div class="ob-grid" data-ob-services>${serviceTilesHTML(v)}</div>` + (v.failed ? alert(st("err", v.failed)) : "");
}

// ---------- 3. the abilities ----------

/**
 * The abilities the members share, as the same rows and dialogs as Settings › 工具 (services.ts): each says what it
 * uses now and opens the choice of service, its key and its model (owner, 2026-11-07: a switch alone did not say
 * whether Brave or OpenRouter would search).
 */
export function abilitiesHTML(services: string): string {
  return head(t("onboarding.abilitiesTitle"), "abilities") + `<div class="ob-main" data-ob-abilities>${services}</div>`;
}
