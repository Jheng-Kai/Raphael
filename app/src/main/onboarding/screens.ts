// What each screen of the guide looks like, as HTML for a given state. A screen is one title and
// the choice it is about, drawn as items (a mark, a name with one quiet line, and the control on the
// right); the one main button and the way back are drawn by mount.ts. Nothing here reads the window
// or the core, so a screen can be drawn from made-up data (the browser check does).

import { t } from "../i18n";

import { CLIS, type CliBrainsView } from "../cli-brains";
import { entryIcon } from "../connections";
import { providerMark } from "../provider-marks";
import type { StoreService } from "../types";
import { btn, esc, fieldHTML, ico, iconButton, st, tg } from "../ui";
import type { AbilityRow } from "./helpers";

/** The title of a screen. */
export const head = (title: string): string => `<h2 tabindex="-1">${esc(title)}</h2>`;

/** One item of a choice: the mark, the name with its quiet line, and the control. */
function item(o: { id: string; mark: string; name: string; line?: string; control: string; wide?: boolean }): string {
  return (
    `<div class="ob-item${o.wide ? " wide" : ""}" data-item="${esc(o.id)}">` +
    `<span class="ob-ic">${o.mark}</span>` +
    `<span class="ob-tx"><span class="nm">${esc(o.name)}</span>${o.line ? `<span class="ds">${esc(o.line)}</span>` : ""}</span>` +
    `<span class="ob-ctl">${o.control}</span></div>`
  );
}

const alert = (html: string): string => `<div class="ob-alert" role="alert">${html}</div>`;

// ---------- the bar and the way back ----------

export interface Top {
  segments: { total: number; current: number };
  /** The way back: false on the first screen of a first run. */
  back: boolean;
}

export function topHTML(top: Top): string {
  const bar = Array.from({ length: top.segments.total }, (_, i) => `<i class="${i < top.segments.current ? "done" : i === top.segments.current ? "now" : ""}"></i>`).join("");
  return (
    (top.back ? iconButton("left", t("onboarding.back"), ' data-ob="back"') : `<span class="ob-gap"></span>`) +
    `<div class="ob-bar-steps" role="img" aria-label="${esc(t("onboarding.progress", { p0: Math.max(1, top.segments.current + 1), p1: Math.max(1, top.segments.total) }))}">${bar}</div>` +
    `<span class="ob-gap"></span>`
  );
}

// ---------- welcome ----------

export function welcomeHTML(o: { rerun: boolean; languageSelect: string }): string {
  return (
    `<div class="stage onboarding-stage"><canvas class="emb" aria-hidden="true"></canvas><div class="subs" aria-live="polite"></div></div>` +
    head(o.rerun ? t("onboarding.rerunTitle") : t("onboarding.welcomeTitle")) +
    `<div class="ob-main ob-lang"><span class="ob-lang-label">${esc(t("settings.059"))}</span>${o.languageSelect}</div>`
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

const toolItem = (card: ToolCard): string =>
  item({ id: card.id, mark: card.mark, name: card.name, line: card.line, control: card.ready ? st("ok", t("brains.ready")) : card.action ? btn(esc(card.action.label), "sm", card.action.attrs) : "" });

/** The OpenRouter card: a field and 「貼上」 until there is a key, then 「已設定」 and 「更換」. */
function keyItem(k: KeyView): string {
  const entering = !k.has || k.replacing;
  const control = entering
    ? fieldHTML("sk-or-v1-…", "", { w: 220, get label() { return t("common.apiKeyField"); }, id: "ob-key-input", type: "password", invalid: k.error !== null, disabled: k.busy }) +
      (k.has ? btn(esc(t("common.cancel")), "sm", ` data-ob="key-cancel"${k.busy ? " disabled" : ""}`) : "") +
      btn(esc(k.busy ? t("common.checking") : t("common.paste")), "sm", ` data-ob="key-paste"${k.busy ? " disabled" : ""}`)
    : st("ok", t("onboarding.keyIsSet")) + btn(esc(t("onboarding.keyReplace")), "sm", ' data-ob="key-replace"');
  const line = k.has && !entering ? (k.name === null ? t("onboarding.keyStored") : t("onboarding.keyNamed", { p0: k.name })) : t("common.apiKey");
  return item({ id: "openrouter", mark: providerMark("openrouter"), name: "OpenRouter", line, control, wide: true }) + (k.error ? alert(st("err", k.error)) : "");
}

export function toolsHTML(accounts: CliBrainsView, key: KeyView, accountError: string): string {
  return (
    head(t("onboarding.toolsTitle")) +
    `<div class="ob-main"><div class="ob-grid" data-ob-tools>${toolCards(accounts).map(toolItem).join("")}${keyItem(key)}</div>` +
    (accountError ? alert(st("err", accountError)) : "") +
    `</div>`
  );
}

// ---------- 2. the services ----------

export interface ServicesState {
  services: StoreService[] | "loading" | "failed";
  /** The service whose login is open in the browser. */
  waiting: string | null;
  /** A login that did not come through. */
  failed: string | null;
}

function serviceItem(s: StoreService, v: ServicesState): string {
  const waiting = v.waiting === s.id;
  const control = s.server_id !== null
    ? st("ok", t("onboarding.connConnected"))
    : waiting
      ? st("idle", t("onboarding.connWaiting")) + btn(esc(t("common.cancel")), "sm", ` data-ob="conn-cancel"${s.source ? " disabled" : ""}`)
      : btn(esc(t("onboarding.connLogin")), "sm", ` data-ob="conn-login" data-service="${esc(s.id)}" aria-label="${esc(`${t("onboarding.connLogin")} ${s.name}`)}"${v.waiting ? " disabled" : ""}`);
  return item({ id: s.id, mark: entryIcon(s, "md"), name: s.name, control });
}

export function servicesHTML(v: ServicesState): string {
  let body: string;
  if (v.services === "loading") body = `<div class="ob-state"><span class="spin" role="status" aria-label="${esc(t("conn.loading"))}"></span></div>`;
  else if (v.services === "failed") body = alert(st("err", t("onboarding.connLoadFailed")) + btn(esc(t("onboarding.retry")), "sm", ' data-ob="conn-reload"'));
  else body = `<div class="ob-grid" data-ob-services>${v.services.map((s) => serviceItem(s, v)).join("")}</div>` + (v.failed ? alert(st("err", v.failed)) : "");
  return head(t("onboarding.connTitle")) + `<div class="ob-main" id="ob-conn">${body}</div>`;
}

// ---------- 3. the abilities ----------

export interface AbilitiesState {
  rows: AbilityRow[] | "loading" | "failed";
  /** The ability whose switch is being turned. */
  busy: string | null;
}

function abilityItem(row: AbilityRow, busy: string | null): string {
  const locked = !row.on && row.note !== null;
  return item({
    id: row.kind,
    mark: `<span class="ob-tile" aria-hidden="true">${ico(row.icon)}</span>`,
    name: row.label,
    line: locked ? row.note! : row.about,
    control: tg(row.on, row.label, ` data-ob="ability" data-id="${esc(row.kind)}"${busy !== null || locked ? " disabled" : ""}`),
  });
}

export function abilitiesHTML(v: AbilitiesState): string {
  let body: string;
  if (v.rows === "loading") body = `<div class="ob-state"><span class="spin" role="status" aria-label="${esc(t("common.loading"))}"></span></div>`;
  else if (v.rows === "failed") body = alert(st("err", t("services.loadFailed")) + btn(esc(t("onboarding.retry")), "sm", ' data-ob="abilities-reload"'));
  else body = `<div class="ob-grid" data-ob-abilities>${v.rows.map((r) => abilityItem(r, v.busy)).join("")}</div>`;
  return head(t("onboarding.abilitiesTitle")) + `<div class="ob-main">${body}</div>`;
}
