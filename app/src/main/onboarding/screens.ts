// What each screen of the guide looks like, as HTML for a given state. A screen is one title and
// the choice it is about, drawn as items (a mark, a name with one quiet line, and the control on the
// right); the one main button and the way back are drawn by mount.ts. Nothing here reads the window
// or the core, so a screen can be drawn from made-up data (the browser check does).

import { t } from "../i18n";
import type { MessageKey } from "../i18n/zh-TW";

import { CLIS, type CliBrainsView } from "../cli-brains";
import { entryIcon } from "../connections";
import { providerMark } from "../provider-marks";
import { type ProvidersView, description, emptyProvidersView, providersAddHTML } from "../providers";
import type { ProviderKind, StoreService } from "../types";
import { RAPHAEL_SLIME } from "../members";
import { slimeFaceHTML } from "../slime";
import { btn, esc, fieldHTML, iconButton, st } from "../ui";

/** The title of a screen; what the step is for is Raphael's sentence beside it, never a line under it. */
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

// ---------- the way back, and Raphael's side ----------

/** The way back (none on the first screen of a first run). No progress bar (owner, 2026-11-07). */
export function topHTML(o: { back: boolean }): string {
  return o.back ? iconButton("left", t("onboarding.back"), ' data-ob="back"') : `<span class="ob-gap"></span>`;
}

export type GuideStep = "welcome" | "tools" | "services" | "abilities";

const SAY: Record<GuideStep, MessageKey> = { welcome: "onboarding.sayWelcome", tools: "onboarding.sayTools", services: "onboarding.sayConn", abilities: "onboarding.sayAbilities" };

/** Raphael's side of the card: his first blue slime and one sentence about the step. */
export function asideHTML(step: GuideStep): string {
  return slimeFaceHTML({ id: 0, avatar: RAPHAEL_SLIME }, 112) + `<p class="ob-say">${esc(tr(SAY[step]))}</p>`;
}

// ---------- welcome ----------

export function welcomeHTML(o: { rerun: boolean; languageSelect: string }): string {
  return (
    `<div class="ob-face" aria-hidden="true">${slimeFaceHTML({ id: 0, avatar: RAPHAEL_SLIME }, 88)}</div>` +
    head(o.rerun ? t("onboarding.rerunTitle") : t("onboarding.welcomeTitle")) +
    // The dropdown says what it is by itself; its name is only its accessible label (owner, 2026-11-07).
    `<div class="ob-main ob-lang">${o.languageSelect}</div>`
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

/**
 * Every provider the app can connect, one per row, from the core's catalog (the same as Settings › 模型與用量's 新增供應商):
 * the guide is for everyone, not only the providers one owner uses (owner, 2026-11-07). A row's button opens the same
 * editor as Settings. OpenRouter keeps its own key row above them; ChatGPT is a sign-in among the accounts.
 */
const GROUP_TITLE: Record<ProviderKind["group"], MessageKey> = { official: "providers.official", gateway: "providers.gateway", local: "providers.local" };

function providerItem(kind: ProviderKind, v: ProvidersView): string {
  const provider = v.providers.find((p) => p.kind === kind.kind);
  const control = provider
    ? st("ok", t("providers.connected")) + btn(esc(t("providers.manage")), "sm", ` data-pv="open" data-id="${esc(provider.id)}" aria-label="${esc(`${t("providers.manage")} ${kind.name}`)}"${v.busy ? " disabled" : ""}`)
    : btn(esc(t("providers.connect")), "sm", ` data-pv="add" data-id="${esc(kind.kind)}" aria-label="${esc(`${t("providers.connect")} ${kind.name}`)}"${kind.available && !v.busy ? "" : " disabled"}`);
  return item({ id: `provider:${kind.kind}`, mark: providerMark(kind.kind), name: kind.name, line: kind.available ? description(kind) : t("providers.soon"), control });
}

/** The catalog's providers by group (official, gateways and clouds, this computer), each group under its own label. */
export function providerGroupsHTML(v: ProvidersView): string {
  if (v.state !== "ready") return v.state === "failed" ? alert(st("err", t("providers.error"))) : "";
  const kinds = v.kinds.filter((kind) => kind.kind !== "openrouter" && kind.kind !== "chatgpt");
  return (["official", "gateway", "local"] as const).map((group) => {
    const rows = kinds.filter((kind) => kind.group === group).sort((a, b) => a.name.localeCompare(b.name, "en"));
    return rows.length ? `<h4 class="ob-subsection">${esc(tr(GROUP_TITLE[group]))}</h4><div class="ob-list" data-ob-providers="${group}">${rows.map((kind) => providerItem(kind, v)).join("")}</div>` : "";
  }).join("");
}
const tr = t as unknown as (key: MessageKey) => string;

export function toolsHTML(accounts: CliBrainsView, key: KeyView, accountError: string, providers: ProvidersView = emptyProvidersView()): string {
  return (
    head(t("onboarding.toolsTitle")) +
    `<div class="ob-main"><h3 class="ob-section">${esc(t("brains.accounts"))}</h3><div class="ob-list" data-ob-tools>${toolCards(accounts).map(toolItem).join("")}</div>` +
    (accountError ? alert(st("err", accountError)) : "") +
    `<h3 class="ob-section">${esc(t("models.providers"))}</h3><div class="ob-list" data-ob-key>${keyItem(key)}</div>${providerGroupsHTML(providers)}` +
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
  else body = `<div class="ob-list" data-ob-services>${v.services.map((s) => serviceItem(s, v)).join("")}</div>` + (v.failed ? alert(st("err", v.failed)) : "");
  return head(t("onboarding.connTitle")) + `<div class="ob-main" id="ob-conn">${body}</div>`;
}

// ---------- 3. the abilities ----------

/**
 * The abilities the members share, as the same rows and dialogs as Settings › 工具 (services.ts): each says what it
 * uses now and opens the choice of service, its key and its model (owner, 2026-11-07: a switch alone did not say
 * whether Brave or OpenRouter would search).
 */
export function abilitiesHTML(services: string): string {
  return head(t("onboarding.abilitiesTitle")) + `<div class="ob-main" data-ob-abilities>${services}</div>`;
}
