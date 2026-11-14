// Shared search, reading, vision and PDF services are configured in Settings > Tools.
// Each capability uses the existing connection rows and service dialog. Keys are sent once to
// services.set_key and never retained in view state. The core returns configuration status only.
// servicesHTML draws snapshots; createServices owns actions.

import { noticeHTML } from "./missing";
import * as api from "./api";
import { isTopLayer, registerDismissal } from "./dismissals";
import { iconHTML } from "./connections";
import { describeError } from "./format";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import type { ServiceIconId } from "./service-icons";
import type { BrainSettings, ServiceOption, ServicesStatus } from "./types";
import { type IconName, actionRow, btn, esc, fieldHTML, ico, iconButton, leave, st, tg, toaster } from "./ui";

/** The capabilities, in the order of the list. */
export const CAPABILITIES = [
  { kind: "search", icon: "search", enabled: "web_search_enabled", setting: "web_search_service", on: true, label: () => t("services.search"), about: () => t("services.searchAbout") },
  { kind: "read", icon: "globe", enabled: "web_read_enabled", setting: "web_read_service", on: true, label: () => t("services.read"), about: () => t("services.readAbout") },
  { kind: "vision", icon: "image", enabled: "vision_enabled", setting: "vision_model", on: true, label: () => t("services.vision"), about: () => t("services.visionAbout") },
  { kind: "pdf", icon: "file", enabled: "pdf_enabled", setting: "pdf_service", on: true, label: () => t("services.pdf"), about: () => t("services.pdfAbout") },
] as const satisfies readonly {
  kind: keyof ServicesStatus;
  icon: IconName;
  enabled: keyof BrainSettings;
  setting: keyof BrainSettings;
  /** Whether the capability is on until the owner turns it off (the core's default). */
  on: boolean;
  label: () => string;
  about: () => string;
}[];

export type Capability = (typeof CAPABILITIES)[number]["kind"];

const capability = (kind: string): (typeof CAPABILITIES)[number] | undefined => CAPABILITIES.find((c) => c.kind === kind);

/** The longest key the core takes (`services.set_key`). */
export const SERVICE_KEY_MAX = 512;
/** How long the dialog takes to go (connections.css: the way out of `.cs-scrim`). */
const DIALOG_OUT_MS = 140;

/** The services by their names: brands, the same in every language. `builtin` is said in the window's language. */
const NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  brave: "Brave",
  tavily: "Tavily",
  exa: "Exa",
  searxng: "SearXNG",
  jina: "Jina",
  firecrawl: "Firecrawl",
};

/** Each named service uses its own brand mark from service-icons.ts. */
const MARKS: Record<string, ServiceIconId> = {
  openrouter: "openrouter", brave: "brave", tavily: "tavily", exa: "exa",
  searxng: "searxng", jina: "jina", firecrawl: "firecrawl",
};

/** App-owned pictures for local reading and the two model choices. */
const LOCAL_ICONS: Record<string, IconName> = { builtin: "monitor", same: "sparkle", model: "bot" };

/**
 * What choosing a service means, in one line: what it costs and what it needs. Shown under the service in the list and at the top of its page.
 */
const WHY: Record<string, MessageKey> = {
  "search.openrouter": "services.why.searchOpenrouter", "search.brave": "services.why.searchBrave", "search.tavily": "services.why.searchTavily",
  "search.exa": "services.why.searchExa", "search.searxng": "services.why.searchSearxng",
  "read.builtin": "services.why.readBuiltin", "read.jina": "services.why.readJina", "read.firecrawl": "services.why.readFirecrawl", "read.tavily": "services.why.readTavily",
  "pdf.builtin": "services.why.pdfBuiltin", "pdf.openrouter": "services.why.pdfOpenrouter",
  "vision.same": "services.why.visionSame", "vision.model": "services.why.visionModel",
};
const tr = t as unknown as (key: MessageKey) => string;
const whyOf = (kind: Capability, id: string): string => (WHY[`${kind}.${id}`] ? tr(WHY[`${kind}.${id}`]!) : "");

/** The name of a service: 內建 for this computer's own, its brand for the others, its id for one this app does not know yet. */
export const serviceName = (id: string): string => (id === "builtin" ? t("services.builtin") : (NAMES[id] ?? id));

/** The vision "services": the model that answers, or one chosen to look at images (the picker's). */
export const VISION_SAME = "same";
export const VISION_MODEL = "model";

export interface ServicesView {
  status: ServicesStatus | "loading" | "failed";
  /** The service whose key or address is on its way to the core, or being removed; "switch" while a switch is being turned. */
  busy: string | null;
  /** The dialog that is open: the capability, and the service whose settings are shown in place of the list (null: the list). */
  open: { kind: Capability; service: string | null } | null;
  /** Which way the dialog's view is moving, for the one drawing that follows a change of view. */
  slide: "in" | "out" | null;
}

export const emptyServicesView = (): ServicesView => ({ status: "loading", busy: null, open: null, slide: null });

/** The id of the field of `service`'s key on the page. */
export const keyInputId = (service: string): string => `svc-key-${service}`;
/** The id of SearXNG's address field. */
export const URL_INPUT_ID = "svc-url";

/** Whether `text` may be SearXNG's address: blank (none), or an http(s) URL. */
export function isServiceUrl(text: string): boolean {
  const value = text.trim();
  if (value === "") return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

// ---------- what is on, what is chosen, what can be used ----------

const loaded = (v: ServicesView): ServicesStatus | null => (typeof v.status === "object" ? v.status : null);

/** The last part of a model's id: what the small muted words say of it (`anthropic/claude-haiku-5.5` is `claude-haiku-5.5`). */
const shortModel = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

/**
 * Whether the owner has `kind` on. The settings the window holds are the freshest (they change the
 * moment a switch is turned, while the status is read again a moment later); the core's status
 * says it when the settings are not there yet, and the default (on) before that.
 */
export function isOn(kind: Capability, status: ServicesStatus | null, brain: BrainSettings | null): boolean {
  const entry = capability(kind)!;
  const saved = brain?.[entry.enabled];
  if (typeof saved === "boolean") return saved;
  return status ? status[kind].enabled : entry.on;
}

/** The id of the service in use for `kind` (for the vision: `VISION_SAME` or `VISION_MODEL`). */
export function chosenOf(kind: Capability, status: ServicesStatus | null, brain: BrainSettings | null): string {
  if (kind === "vision") return (status?.vision.model ?? brain?.vision_model ?? "") === "" ? VISION_SAME : VISION_MODEL;
  const entry = capability(kind)!;
  return status?.[kind].service ?? String(brain?.[entry.setting] ?? "");
}

/** What the open dialog lists for one service. */
export interface ServiceRow {
  id: string;
  name: string;
  /** The muted words under the name. */
  note: string;
  /** In use: the one the capability stands on. */
  chosen: boolean;
  /** It can be used now: it has what it needs (a key, an address). */
  usable: boolean;
  /** It has a mark of its own in the app. */
  mark: ServiceIconId | null;
}

/** What a service says of itself under its name. */
function noteOf(option: ServiceOption): string {
  if (option.id === "searxng") return t(option.url_set ? "services.keySet" : "services.needUrl");
  if (option.needs_key) return t(option.has_key ? "services.keySet" : "services.needKey");
  if (option.key_optional) return t(option.has_key ? "services.keySet" : "services.noKey");
  if (option.id === "builtin") return t("services.local");
  if (option.id === "openrouter") return t("services.shared");
  return "";
}

/** Whether `option` can be used now: its key is stored (when it needs one), SearXNG's address is set. */
export function usableOption(option: ServiceOption): boolean {
  if (option.needs_key && !option.has_key) return false;
  if (option.id === "searxng" && !option.url_set) return false;
  return true;
}

/** The services of `kind` as the dialog lists them; none until the core has said. */
export function serviceRows(kind: Capability, status: ServicesStatus | null, brain: BrainSettings | null): ServiceRow[] {
  if (!status) return [];
  const chosen = chosenOf(kind, status, brain);
  if (kind === "vision") {
    const model = status.vision.model;
    const sees = status.vision.supports_images !== false;
    // The model that really reads the images: a command-line brain never does, so the core names the one it falls back to.
    const resolved = shortModel(status.vision.resolved_model ?? "");
    return [
      { id: VISION_SAME, name: t("services.sameAsAnswer"), note: chosen === VISION_SAME ? resolved : "", chosen: chosen === VISION_SAME, usable: chosen !== VISION_SAME || sees, mark: null },
      { id: VISION_MODEL, name: t("services.visionModel"), note: shortModel(model), chosen: chosen === VISION_MODEL, usable: model !== "" && sees, mark: null },
    ];
  }
  return status[kind].options.map((option) => ({
    id: option.id,
    name: serviceName(option.id),
    note: noteOf(option),
    chosen: option.id === chosen,
    usable: usableOption(option),
    mark: MARKS[option.id] ?? null,
  }));
}

/** The words that say which service is in use, whole, under a row's name: never a cut name or a raw model id. */
function nowLabel(kind: Capability, status: ServicesStatus | null, brain: BrainSettings | null): string {
  const chosen = chosenOf(kind, status, brain);
  if (kind === "vision") return shortModel(status?.vision.resolved_model || status?.vision.model || brain?.vision_model || "") || t("services.sameAsAnswer");
  return serviceName(chosen);
}

/** Whether the service in use for `kind` can be used now (a status the core has not given: no). */
export function canTurnOn(kind: Capability, status: ServicesStatus | null, brain: BrainSettings | null): boolean {
  const chosen = chosenOf(kind, status, brain);
  return serviceRows(kind, status, brain).some((row) => row.id === chosen && row.usable);
}

// ---------- drawing ----------

/** A capability's picture: its icon, bare. */
const capIcon = (icon: IconName, size = ""): string => `<span class="ic svc-ic${size ? " " + size : ""}" aria-hidden="true">${ico(icon)}</span>`;

/** The dialog's close button, the same in both of its views. */
const closeButton = (): string => iconButton("x", t("common.close"), ' data-svc="close" data-k="svc-close" data-nav-back');

/** One row of the list, the same markup as 「連接」: the name opens the capability's dialog, the switch is its own. */
function itemHTML(entry: (typeof CAPABILITIES)[number], v: ServicesView, brain: BrainSettings | null): string {
  const status = loaded(v);
  const on = isOn(entry.kind, status, brain);
  const name = entry.label();
  const id = entry.kind;
  return (
    `<div class="cs-item svc-item${on ? "" : " off"}" data-svc="open" data-id="${id}">` +
    btn(
      `${capIcon(entry.icon)}<span class="tx"><span class="nm">${esc(name)}</span><span class="ds">${esc(entry.about())}</span>` +
        `<span class="svc-now">${esc(t("services.nowUsing", { p0: nowLabel(entry.kind, status, brain) }))}</span></span>`,
      "cs-open",
      ` data-svc="open" data-id="${id}" data-k="svc-open:${id}" aria-haspopup="dialog"`,
    ) +
    tg(on, t("services.switch", { p0: name }), ` data-svc="toggle" data-id="${id}" data-k="svc-toggle:${id}"${status && v.busy === null ? "" : " disabled"}`) +
    `<span class="chev" aria-hidden="true">${ico("right")}</span></div>`
  );
}

/** The line of a service's key: paste and save, or 「已設定」 and 「移除」. Jina's key is optional: its field says so. */
function keyLineHTML(option: ServiceOption, v: ServicesView): string {
  const name = serviceName(option.id);
  const off = v.busy === option.id ? " disabled" : "";
  if (option.has_key) {
    return `<div data-svc-line="${esc(option.id)}">` + actionRow({
      cls: "svc-line",
      secondary: `<span class="val">${esc(t("services.keySet"))}</span>`,
      destructive: { label: esc(t("services.remove")), attrs: ` data-svc="clear" data-service="${esc(option.id)}"${off}` },
    }) + `</div>`;
  }
  const placeholder = option.needs_key ? t("services.key") : t("services.keyOptional");
  return (
    `<div class="svc-line" data-svc-line="${esc(option.id)}">` +
    fieldHTML(placeholder, "", { id: keyInputId(option.id), type: "password", label: t("services.keyLabel", { p0: name }), disabled: v.busy === option.id }) +
    actionRow({ primary: { label: esc(t("services.save")), attrs: ` data-svc="save" data-service="${esc(option.id)}"${off}` } }) +
    `</div>`
  );
}

/** SearXNG's address, as the settings have it (no secret: it is shown in its field to be changed). */
function urlLineHTML(option: ServiceOption, v: ServicesView, url: string): string {
  const name = serviceName(option.id);
  const off = v.busy === option.id ? " disabled" : "";
  return (
    `<div class="svc-line" data-svc-line="${esc(option.id)}">` +
    fieldHTML("https://…", url, { id: URL_INPUT_ID, label: t("services.url", { p0: name }), disabled: v.busy === option.id }) +
    actionRow({ primary: { label: esc(t("services.save")), attrs: ` data-svc="url" data-service="${esc(option.id)}"${off}` } }) +
    `</div>`
  );
}

/** The dialog's first view: the services of the capability, under 「已安裝」. */
function listViewHTML(entry: (typeof CAPABILITIES)[number], v: ServicesView, brain: BrainSettings | null): string {
  const status = loaded(v);
  const name = entry.label();
  const on = isOn(entry.kind, status, brain);
  const head =
    `<div class="cs-dlg-head">${capIcon(entry.icon, "xl")}<h2 class="cs-dlg-name" id="svc-dlg-title">${esc(name)}</h2><span class="sp"></span>` +
    tg(on, t("services.switch", { p0: name }), ` data-svc="toggle" data-id="${entry.kind}" data-k="svc-dlg-toggle"${status && v.busy === null ? "" : " disabled"}`) +
    closeButton() +
    `</div>`;
  if (!status) {
    const body = v.status === "failed" ? `<div class="alert core-note" role="alert">${st("err", t("services.loadFailed"))}</div>` : `<p class="settings-loading" role="status">${esc(t("conn.loading"))}</p>`;
    return head + body;
  }
  const rows = serviceRows(entry.kind, status, brain)
    .map((row) => {
      const mark = row.mark ? iconHTML(row.name, row.mark, "md") : `<span class="mono md" aria-hidden="true">${ico(LOCAL_ICONS[row.id] ?? "plug")}</span>`;
      const why = whyOf(entry.kind, row.id);
      return (
        `<div class="cs-item svc-srv" data-svc="service" data-service="${esc(row.id)}">` +
        btn(
          `<span class="ic">${mark}</span><span class="tx"><span class="nm">${esc(row.name)}${row.note ? `<span class="svc-tag">${esc(row.note)}</span>` : ""}</span>${why ? `<span class="ds">${esc(why)}</span>` : ""}</span>`,
          "cs-open",
          ` data-svc="service" data-service="${esc(row.id)}" data-k="svc-svc:${esc(row.id)}"`,
        ) +
        `<span class="svc-chk"${row.chosen ? ` role="img" aria-label="${esc(t("services.inUse"))}">${ico("check")}` : ' aria-hidden="true">'}</span>` +
        `<span class="chev" aria-hidden="true">${ico("right")}</span></div>`
      );
    })
    .join("");
  return head + `<h3 class="svc-h">${esc(t("services.installed"))}</h3><div class="cs-list" data-stagger="svc:${entry.kind}">${rows}</div>`;
}

/** The service setup page owns its shared key/address and Use action. */
function subViewHTML(entry: (typeof CAPABILITIES)[number], service: string, v: ServicesView, visionPicker: string, brain: BrainSettings | null): string {
  const status = loaded(v);
  const row = serviceRows(entry.kind, status, brain).find((r) => r.id === service);
  const option = entry.kind === "vision" ? undefined : status?.[entry.kind].options.find((o) => o.id === service);
  const name = row?.name ?? (service === VISION_SAME ? t("services.sameAsAnswer") : service === VISION_MODEL ? t("services.visionModel") : serviceName(service));
  const on = isOn(entry.kind, status, brain);
  const head =
    `<div class="cs-dlg-head sub">` +
    iconButton("left", t("conn.back"), ' data-svc="back" data-k="svc-back" data-nav-back') +
    `<h2 class="cs-dlg-name" id="svc-dlg-title">${esc(name)}</h2>` +
    closeButton() +
    `</div>`;
  let fields = "";
  if (entry.kind === "vision") {
    if (service === VISION_MODEL) fields = `<div class="svc-pick">${visionPicker}</div>`;
  } else if (option) {
    if (option.id === "searxng") fields = urlLineHTML(option, v, brain?.searxng_url ?? "");
    else if (option.needs_key || option.key_optional) fields = keyLineHTML(option, v);
  }
  const inUse = !!row?.chosen && on;
  const idle = v.busy !== null;
  const why = whyOf(entry.kind, service);
  // The button says what it does: 「改用 Brave」, or 「使用中」 once it is the one.
  const acts = actionRow({
    cls: "svc-acts", sticky: true,
    primary: { label: esc(inUse ? t("services.inUse") : t("services.useThis", { p0: name })), attrs: ` data-svc="use" data-service="${esc(service)}" data-k="svc-use"${inUse || !row?.usable || idle ? " disabled" : ""}` },
  });
  return head + (why ? `<p class="cs-desc svc-why">${esc(why)}</p>` : "") + fields + (entry.kind === "vision" && service === VISION_SAME && !row?.usable ? noticeHTML("sameVision") : "") + acts;
}

/**
 * The dialog of a capability, over the settings with the page under it dimmed. It grows in when it
 * opens (`data-dialog`, ui.ts `swapHTML`), not each time it is drawn again; a click on the dimmed
 * part closes it, as Esc and its × do.
 */
function dialogHTML(v: ServicesView, visionPicker: string, brain: BrainSettings | null): string {
  const open = v.open;
  const entry = open ? capability(open.kind) : undefined;
  if (!open || !entry) return "";
  const inner = open.service === null ? listViewHTML(entry, v, brain) : subViewHTML(entry, open.service, v, visionPicker, brain);
  const slide = v.slide === "in" ? " slide-in" : v.slide === "out" ? " slide-out" : "";
  return (
    `<div class="cs-scrim" data-svc="scrim" data-dialog="svc:${entry.kind}">` +
    `<div class="cs-dialog" id="svc-dialog" role="dialog" aria-modal="true" aria-labelledby="svc-dlg-title" tabindex="-1" data-trap>` +
    `<div class="svc-view${slide}">${inner}</div></div></div>`
  );
}

/**
 * The section and, when one is open, the dialog of a capability. `visionPicker` is the button of the
 * 看圖片 picker (`modelPickerHTML`), which the settings draw with the catalog they hold; it is in the
 * dialog's page for 「指定模型」 only. `brain` gives what is chosen while the core has not said
 * (`status` is loading or failed).
 */
export function servicesHTML(v: ServicesView, visionPicker: string, brain: BrainSettings | null): string {
  const rows = CAPABILITIES.map((entry) => itemHTML(entry, v, brain)).join("");
  const failed = v.status === "failed" && !v.open ? `<div class="note" role="alert">${st("err", t("services.loadFailed"))}</div>` : "";
  return (
    `<section class="sgroup svc" data-svc-section><h2>${esc(t("services.title"))}</h2><div class="cs-list" data-stagger="svc">${rows}</div>${failed}</section>` +
    dialogHTML(v, visionPicker, brain)
  );
}

// ---------- state ----------

export interface ServicesHost {
  root?: HTMLElement;
  visible(): boolean;
  redraw(): void;
  /** The settings of the brain as the window holds them now (null before they are read). */
  brain(): BrainSettings | null;
  /** Changes a setting of the brain (`settings.set`) the way the rest of the panel does; tells a refusal itself. */
  changeSetting(key: keyof BrainSettings, value: string | boolean): Promise<void>;
}

export interface ServicesPanel {
  openRepair(kind: Capability, service?: string | null): void;
  view(): ServicesView;
  load(): Promise<void>;
  /** A click on the page: whether it was the section's. */
  click(target: Element): boolean;
  /** Enter in one of the dialog's fields sends it; Esc with the dialog open closes it. */
  key(e: KeyboardEvent): boolean;
  /** The 看圖片 picker chose `id` ("" is 「與回答相同」). */
  chooseVision(id: string): Promise<void>;
  reset(): void;
  /** The dialog on screen in words the way back keeps: its capability, and the service shown in it (`search:brave`); "" for none. */
  navView(): string;
  /** Shows the dialog `navView` named, or closes it for "". */
  showNavView(key: string): void;
}

/** Focuses the element `selector` names, if the page is there (not in a test without one). */
const focusOn = (selector: string): void => {
  if (typeof document !== "undefined") document.querySelector<HTMLElement>(selector)?.focus();
};

export function createServices(host: ServicesHost): ServicesPanel {
  let status: ServicesView["status"] = "loading";
  let busy: string | null = null;
  let open: ServicesView["open"] = null;
  let slide: ServicesView["slide"] = null;
  let loads = 0;
  /** The dialog is on its way out (140 ms): a second close waits for the first. */
  let closing = false;
  let stopOutside: (() => void) | null = null;

  const redraw = (): void => {
    if (host.visible()) host.redraw();
    if (open && !stopOutside && typeof document !== "undefined") {
      const root = host.root ?? document.querySelector("#svc-dialog")?.parentElement?.parentElement;
      if (root) stopOutside = registerDismissal(() => root.querySelector<HTMLElement>("#svc-dialog"), closeDialog);
    } else if (!open) { stopOutside?.(); stopOutside = null; }
  };
  const view = (): ServicesView => ({ status, busy, open, slide });
  const current = (): ServicesStatus | null => (typeof status === "object" ? status : null);

  /** Draws once with the movement of the dialog's view, which only that drawing has. */
  function move(direction: "in" | "out"): void {
    slide = direction;
    redraw();
    slide = null;
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    try {
      const next = await api.servicesStatus();
      if (mine !== loads) return;
      status = next;
    } catch {
      if (mine !== loads) return;
      if (typeof status !== "object") status = "failed";
    }
    redraw();
  }

  async function set(key: keyof BrainSettings, value: string | boolean): Promise<void> {
    await host.changeSetting(key, value);
    await load();
  }

  // ----- the dialog -----

  /** Opens the dialog of `kind` at its list, or at one service's settings, with the focus in it. */
  function openDialog(kind: Capability, service: string | null = null): void {
    open = { kind, service };
    closing = false;
    redraw();
    focusOn("#svc-dialog");
  }

  /**
   * Closes the dialog: it shrinks and fades away (140 ms), then the page is drawn without it and
   * the focus goes back to the row it was opened from.
   */
  function closeDialog(): void {
    if (!open || closing) return;
    const kind = open.kind;
    closing = true;
    const scrim = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".cs-scrim[data-svc]") : null;
    leave(scrim, DIALOG_OUT_MS, () => {
      closing = false;
      if (open?.kind !== kind) return;
      open = null;
      redraw();
      focusOn(`[data-k="svc-open:${kind}"]`);
    });
  }

  /** Shows one service's settings in place of the list. */
  function showService(service: string): void {
    if (!open) return;
    open = { kind: open.kind, service };
    move("in");
    focusOn("#svc-dialog");
  }

  /** Back to the list, the focus on the service it came from. */
  function showList(): void {
    if (!open) return;
    const from = open.service;
    open = { kind: open.kind, service: null };
    move("out");
    if (from) focusOn(`[data-k="svc-svc:${typeof CSS !== "undefined" ? CSS.escape(from) : from}"]`);
  }

  // ----- the switch and 「使用」 -----

  /**
   * The switch of `kind`: off turns it off; on turns it on when the service in use can be used, and
   * otherwise opens that service's settings (there is a key or an address to give).
   */
  async function toggle(kind: Capability): Promise<void> {
    const entry = capability(kind);
    const now = current();
    if (!entry || !now || busy !== null) return;
    const brain = host.brain();
    if (isOn(kind, now, brain)) {
      busy = "switch";
      redraw();
      await set(entry.enabled, false);
      busy = null;
      redraw();
      return;
    }
    if (!canTurnOn(kind, now, brain)) {
      const chosen = chosenOf(kind, now, brain);
      if (open?.kind === kind) showService(chosen);
      else openDialog(kind, chosen);
      return;
    }
    busy = "switch";
    redraw();
    await set(entry.enabled, true);
    busy = null;
    redraw();
  }

  /** 「使用」: the service becomes the one in use, and the capability is turned on if it was off. */
  async function use(service: string): Promise<void> {
    const kind = open?.kind;
    const entry = kind ? capability(kind) : undefined;
    const now = current();
    if (!kind || !entry || !now || busy !== null) return;
    const brain = host.brain();
    const row = serviceRows(kind, now, brain).find((r) => r.id === service);
    if (!row?.usable || (row.chosen && isOn(kind, now, brain))) return;
    busy = "switch";
    redraw();
    if (kind === "vision") {
      if (service === VISION_SAME) await host.changeSetting("vision_model", "");
    } else if (!row.chosen) await host.changeSetting(entry.setting, service);
    if (!isOn(kind, now, host.brain())) await host.changeSetting(entry.enabled, true);
    busy = null;
    await load();
  }

  // ----- keys and the address -----

  /**
   * Sends the key typed for `service` to the vault. The field is emptied first, so that the key is
   * on the page no longer than the press that sent it; a key that is refused is typed again.
   */
  async function saveKey(service: string): Promise<void> {
    if (busy !== null || typeof document === "undefined") return;
    const input = document.getElementById(keyInputId(service)) as HTMLInputElement | null;
    if (!input) return;
    const key = input.value.trim();
    input.value = "";
    if (key === "" || key.length > SERVICE_KEY_MAX) return;
    busy = service;
    redraw();
    try {
      await api.servicesSetKey(service, key);
      toaster.info(t("services.keySaved"));
    } catch (err) {
      toaster.info(describeError(err));
    }
    busy = null;
    await load();
  }

  async function clearKey(service: string): Promise<void> {
    if (busy !== null) return;
    busy = service;
    redraw();
    try {
      await api.servicesClearKey(service);
      toaster.info(t("services.keyRemoved", { p0: serviceName(service) }));
    } catch (err) {
      toaster.info(describeError(err));
    }
    busy = null;
    await load();
  }

  async function saveUrl(): Promise<void> {
    if (busy !== null || typeof document === "undefined") return;
    const input = document.getElementById(URL_INPUT_ID) as HTMLInputElement | null;
    if (!input) return;
    const url = input.value.trim();
    if (!isServiceUrl(url)) {
      toaster.info(t("services.urlInvalid"));
      return;
    }
    busy = "searxng";
    redraw();
    await host.changeSetting("searxng_url", url);
    busy = null;
    await load();
    if (url !== "") toaster.info(t("services.urlSaved"));
  }

  // ----- the page's events -----

  function click(target: Element): boolean {
    const button = target.closest<HTMLElement>("[data-svc]");
    if (!button || (button as HTMLButtonElement).disabled) return false;
    const id = button.dataset.id ?? "";
    const service = button.dataset.service ?? "";
    switch (button.dataset.svc) {
      case "open":
        if (capability(id)) openDialog(id as Capability);
        return true;
      case "toggle":
        void toggle(id as Capability);
        return true;
      case "scrim":
        // Outside gestures are handled by the shared dismissal layer.
        return true;
      case "close":
        closeDialog();
        return true;
      case "service":
        showService(service);
        return true;
      case "back":
        showList();
        return true;
      case "use":
        void use(service);
        return true;
      case "save":
        void saveKey(service);
        return true;
      case "clear":
        void clearKey(service);
        return true;
      case "url":
        void saveUrl();
        return true;
    }
    return false;
  }

  /** Esc closes the dialog; Enter in a key's field sends it, as 「儲存」 does; Enter in the address saves it. */
  function key(e: KeyboardEvent): boolean {
    const panel = typeof document !== "undefined" ? (host.root ?? document).querySelector<HTMLElement>("#svc-dialog") : null;
    if (e.key === "Escape" && panel && !isTopLayer(panel)) return false;
    if (e.key === "Escape" && open && !e.defaultPrevented) {
      e.preventDefault();
      closeDialog();
      return true;
    }
    const input = e.target as HTMLInputElement | null;
    if (e.key !== "Enter" || e.isComposing || !input?.id) return false;
    if (input.id === URL_INPUT_ID) {
      e.preventDefault();
      void saveUrl();
      return true;
    }
    if (!input.id.startsWith("svc-key-")) return false;
    e.preventDefault();
    void saveKey(input.id.slice("svc-key-".length));
    return true;
  }

  /** The picker chose a model (or 「與回答相同」, ""): it is the one chosen; 「使用」 turns the capability on if it is off. */
  async function chooseVision(id: string): Promise<void> {
    await host.changeSetting("vision_model", id);
    await load();
  }

  function reset(): void {
    stopOutside?.(); stopOutside = null;
    loads++;
    busy = null;
    open = null;
    slide = null;
    closing = false;
  }

  /** A dialog on its way out is gone already, as the press that closed it meant. */
  const navView = (): string => (open && !closing ? `${open.kind}${open.service ? `:${open.service}` : ""}` : "");
  function showNavView(key: string): void {
    if (!key) { closeDialog(); return; }
    const at = key.indexOf(":");
    const kind = (at < 0 ? key : key.slice(0, at)) as Capability, service = at < 0 ? null : key.slice(at + 1);
    if (!open || closing || open.kind !== kind) openDialog(kind, service);
    else if (service !== open.service) { if (service) showService(service); else showList(); }
  }

  return { view, load, click, key, chooseVision, reset, openRepair: openDialog, navView, showNavView };
}
