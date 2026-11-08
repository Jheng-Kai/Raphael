// What each screen of the guide looks like, as HTML for a given state. Each screen is one calm centred column, as Grok
// Bot's first run is (owner, 2026-11-07): a title, the choice it is about (tiles in a grid, or rows), and, drawn by
// mount.ts, one wide black pill under it with a grey pill for the way back. Nothing here reads the window or the core,
// so a screen can be drawn from made-up data (the browser check does).

import { t } from "../i18n";
import type { MessageKey } from "../i18n/zh-TW";

import { CLIS, type CliBrainsView } from "../cli-brains";
import { entryIcon } from "../connections";
import { nameScore } from "../find-match";
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

/** A check in a small black square, on a tile that is chosen or ready (as Grok Bot's chosen tiles). */
const tick = `<span class="ob-tick" aria-hidden="true">${ico("check")}</span>`;

/**
 * One tile of a choice: the mark, the name with one quiet line, and the control under them; a tile that is on has the
 * check. A `wide` tile stands alone on a row with its control on the right (the OpenRouter key).
 */
function tile(o: { id: string; mark: string; name: string; line?: string; control?: string; on?: boolean; wide?: boolean }): string {
  return (
    `<div class="ob-tile${o.wide ? " wide" : ""}${o.on ? " on" : ""}" data-item="${esc(o.id)}">` +
    `<span class="ob-ic">${o.mark}</span>` +
    `<span class="ob-tx"><span class="nm">${esc(o.name)}</span>${o.line ? `<span class="ds">${esc(o.line)}</span>` : ""}</span>` +
    (o.control ? `<span class="ob-ctl">${o.control}</span>` : "") +
    (o.on ? tick : "") +
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
      line: waiting ? waitLine : signing ? t("brains.chatgptSigning") : signedIn ? [t("brains.usingPlan"), chatgpt?.email].filter(Boolean).join(" · ") : chatgpt?.signed_in ? t("brains.chatgptNoPlan") : t("brains.signedOut"),
      ready: !waiting && signedIn,
      action: waiting || signedIn ? null : signing ? { label: t("common.cancel"), attrs: ' data-chatgpt="cancel" data-k="chatgpt:cancel"' } : { label: t("brains.connect"), attrs: ' data-chatgpt="sign-in" data-k="chatgpt:sign-in"' },
    },
  ];
  for (const known of CLIS) {
    const cli = v.clis.find((c) => c.id === known.id);
    const ready = !waiting && !!cli?.available;
    const label = t(cli?.installed ? "brains.connect" : "brains.install");
    cards.push({
      id: known.id,
      mark: providerMark(known.mark),
      name: known.name,
      line: waiting ? waitLine : ready ? versionOf(cli?.version) : t(cli?.disconnected ? "brains.disconnected" : !cli?.installed ? "brains.missing" : "brains.signedOut"),
      ready,
      action: waiting || ready ? null : { label, attrs: ` data-cli="${known.id}" data-k="cli:${known.id}" aria-label="${esc(`${label} ${known.name}`)}"${v.busy ? " disabled" : ""}` },
    });
  }
  return cards;
}

const toolTile = (card: ToolCard): string =>
  tile({ id: card.id, mark: card.mark, name: card.name, line: card.line, on: card.ready, control: card.ready ? st("ok", t("brains.ready")) : card.action ? btn(esc(card.action.label), "sm", card.action.attrs) : "" });

/**
 * The OpenRouter tile, one tile like the others: 「連線」 (or 「已設定」 and 「更換」) until it is pressed, then it spans its row
 * with the masked field, 「取消」 and 「貼上」 while the key is typed. A refused key keeps the field open with its alert.
 */
function keyTile(k: KeyView): string {
  const entering = k.replacing || k.busy || k.error !== null;
  const control = entering
    ? fieldHTML("sk-or-v1-…", "", { w: 220, get label() { return t("common.apiKeyField"); }, id: "ob-key-input", type: "password", invalid: k.error !== null, disabled: k.busy }) +
      btn(esc(t("common.cancel")), "sm", ` data-ob="key-cancel"${k.busy ? " disabled" : ""}`) +
      btn(esc(k.busy ? t("common.checking") : t("common.paste")), "sm", ` data-ob="key-paste"${k.busy ? " disabled" : ""}`)
    : k.has
      ? st("ok", t("onboarding.keyIsSet")) + btn(esc(t("onboarding.keyReplace")), "sm", ' data-ob="key-replace"')
      : btn(esc(t("providers.connect")), "sm", ` data-ob="key-replace" aria-label="${esc(`${t("providers.connect")} OpenRouter`)}"`);
  // One short line like every other tile's: the key's own name once it is known, otherwise what it is.
  const line = k.has && !entering && k.name !== null ? t("onboarding.keyNamed", { p0: k.name }) : t("common.apiKey");
  return tile({ id: "openrouter", mark: providerMark("openrouter"), name: "OpenRouter", line, control, wide: entering, on: k.has && !entering }) + (k.error ? alert(st("err", k.error)) : "");
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
    ? st("ok", t("providers.connected")) + btn(esc(t("providers.manage")), "sm", ` data-pv="open" data-id="${esc(provider.id)}" aria-label="${esc(`${t("providers.manage")} ${kind.name}`)}"${v.busy ? " disabled" : ""}`)
    : btn(esc(t("providers.connect")), "sm", ` data-pv="add" data-id="${esc(kind.kind)}" aria-label="${esc(`${t("providers.connect")} ${kind.name}`)}"${kind.available && !v.busy ? "" : " disabled"}`);
  return tile({ id: `provider:${kind.kind}`, mark: providerMark(kind.kind), name: kind.name, line: kind.available ? description(kind) : t("providers.soon"), on: !!provider, control });
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

export interface ServicesState {
  services: StoreService[] | "loading" | "failed";
  /** The service whose login is open in the browser. */
  waiting: string | null;
  /** A login that did not come through. */
  failed: string | null;
  /** What the search box holds. */
  query?: string;
}

/** The services whose name or id holds what was typed (a search is by letters, not by case or spacing). */
export function matchServices(services: readonly StoreService[], query: string): StoreService[] {
  const text = (value: string): string => value.toLowerCase().replace(/\s+/g, "");
  const wanted = text(query.trim());
  return wanted ? services.filter((s) => text(s.name).includes(wanted) || text(s.id).includes(wanted)) : [...services];
}

function serviceTile(s: StoreService, v: ServicesState): string {
  const mark = entryIcon(s, "md");
  const body = (line: string, extra = ""): string =>
    `<span class="ob-ic">${mark}</span><span class="ob-tx"><span class="nm">${esc(s.name)}</span><span class="ds">${line}</span></span>${extra}`;
  if (s.server_id !== null) return `<div class="ob-tile on" data-item="${esc(s.id)}">${body(st("ok", t("onboarding.connConnected")), tick)}</div>`;
  if (v.waiting === s.id) {
    const cancel = `<span class="ob-ctl">${btn(esc(t("common.cancel")), "sm", ' data-ob="conn-cancel"')}</span>`;
    return `<div class="ob-tile" data-item="${esc(s.id)}">${body(st("idle", t("onboarding.connWaiting")), cancel)}</div>`;
  }
  // The whole tile is the sign-in button: pressing it opens the service's login, as the row's button did.
  return (
    `<button type="button" class="btn ob-tile pick" data-item="${esc(s.id)}" data-ob="conn-login" data-id="${esc(s.id)}" data-service="${esc(s.id)}"` +
    ` aria-label="${esc(`${t("onboarding.connLogin")} ${s.name}`)}"${v.waiting ? " disabled" : ""}>${body(esc(t("onboarding.connLogin")))}</button>`
  );
}

/** What the grid holds: the tiles of the services that match the search, or a word that none do. */
export function serviceTilesHTML(v: ServicesState): string {
  if (!Array.isArray(v.services)) return "";
  const shown = matchServices(v.services, v.query ?? "");
  return shown.length ? shown.map((s) => serviceTile(s, v)).join("") : `<p class="ob-state">${esc(t("onboarding.connNone"))}</p>`;
}

export function servicesHTML(v: ServicesState): string {
  let body: string;
  if (v.services === "loading") body = `<div class="ob-state"><span class="spin" role="status" aria-label="${esc(t("conn.loading"))}"></span></div>`;
  else if (v.services === "failed") body = alert(st("err", t("onboarding.connLoadFailed")) + btn(esc(t("onboarding.retry")), "sm", ' data-ob="conn-reload"'));
  else {
    body =
      `<div class="ob-find">${fieldHTML(t("conn.search"), v.query ?? "", { icon: "search", id: "ob-find" })}</div>` +
      `<div class="ob-grid" data-ob-services>${serviceTilesHTML(v)}</div>` + (v.failed ? alert(st("err", v.failed)) : "");
  }
  return head(t("onboarding.connTitle"), "services") + `<div class="ob-main" id="ob-conn">${body}</div>`;
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
