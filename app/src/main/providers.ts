// Settings > Models: provider metadata is public; credentials live only in the input until sent.
import { rememberLayerBack } from "./nav-history";
import { keepEditedField } from "./nav-layers";
import * as api from "./api";
import { isTopLayer, registerDismissal } from "./dismissals";
import { t } from "./i18n";
import { confirmDelete } from "./member-dialogs";
import { providerMark } from "./provider-marks";
import type { MainEvent, ModelProvider, ProviderKind, ProviderField, ProviderPatch, ProviderModel, ProviderTest } from "./types";
import { btn, esc, fieldHTML, ico, backButton, headerCloseButton, openMenu, sel } from "./ui";
import { findsName } from "./find-match";

export interface ProvidersView {
  providers: ModelProvider[];
  kinds: ProviderKind[];
  state: "loading" | "ready" | "failed";
  busy: boolean;
  open: { kind: string; id: string | null; replacing: boolean } | null;
  error: "error" | "required" | "account" | null;
  result: ProviderTest | null;
  models: ProviderModel[] | "loading" | "failed";
  query: string;
  kindQuery?: string;
  adding?: boolean;
  /** The feature the directory was opened for from a model's choice (cleanup, stt, image, video): only kinds that can do it. */
  role?: string;
  accountSet?: boolean;
  fieldValues?: Partial<Record<"region" | "location", string>>;
  dirty: boolean;
  canSave?: boolean;
  /** The form can be sent as it stands: a saved provider needs no change to be tested. */
  canTest?: boolean;
  testing?: boolean;
}
export const emptyProvidersView = (): ProvidersView => ({ providers: [], kinds: [], state: "loading", busy: false, open: null, error: null, result: null, models: [], query: "", dirty: false });

const kindOf = (v: ProvidersView): ProviderKind | undefined => v.kinds.find((k) => k.kind === v.open?.kind);
const providerOf = (v: ProvidersView): ModelProvider | undefined => v.providers.find((p) => p.id === v.open?.id);
const inputId = (v: ProvidersView, field: string): string => `pv-${v.open?.id ?? v.open?.kind}-${field}`;
const secret = (field: string): boolean => ["key", "key_id", "secret", "service_account"].includes(field);
const FIELD_TITLES = {
  name: () => t("providers.name"), key: () => t("providers.key"), base_url: () => t("providers.base_url"),
  api_version: () => t("providers.api_version"), region: () => t("providers.region"), key_id: () => t("providers.key_id"),
  secret: () => t("providers.secret"), service_account: () => t("providers.service_account"), project: () => t("providers.project"), location: () => t("providers.location"),
};
const FIELD_CHOICES = {
  region: ["us-east-1", "us-east-2", "us-west-2", "ca-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2", "eu-north-1", "ap-northeast-1", "ap-northeast-2", "ap-south-1", "ap-southeast-1", "ap-southeast-2", "sa-east-1"],
  location: ["global", "us-central1", "us-east1", "us-east4", "us-west1", "us-west4", "northamerica-northeast1", "europe-west1", "europe-west2", "europe-west3", "europe-west4", "europe-west9", "asia-east1", "asia-northeast1", "asia-northeast3", "asia-south1", "asia-southeast1", "australia-southeast1"],
};
const choicesFor = (field: "region" | "location") => FIELD_CHOICES[field].map((value) => ({ value, label: value }));
const GROUP_TITLES = { official: () => t("providers.official"), gateway: () => t("providers.gateway"), local: () => t("providers.local") };
/** What a kind must do for the feature the directory is for; the answer, quick questions and anything else take every kind. */
const ROLE_NEEDS: Record<string, "text" | "stt" | "image" | "video"> = { cleanup: "text", stt: "stt", image: "image", video: "video" };
const ROLE_LABELS: Record<string, () => string> = { quick: () => t("settings.quickModel"), cleanup: () => t("settings.035"), stt: () => t("settings.031"), image: () => t("media.image"), video: () => t("media.video") };
const ROLE_NOTES: Record<string, () => string> = { cleanup: () => t("providers.forCleanup"), stt: () => t("providers.forStt"), image: () => t("providers.forImage"), video: () => t("providers.forVideo") };
const fitsRole = (kind: ProviderKind, role = ""): boolean => !ROLE_NEEDS[role] || (kind.features ?? ["text"]).includes(ROLE_NEEDS[role]);
const GROUP_NOTES = { official: () => t("providers.officialNote"), gateway: () => t("providers.gatewayNote"), local: () => t("providers.localNote") };
const POPULAR = ["openrouter", "litellm", "portkey", "vercel"];
const allowsMultiple = (kind: ProviderKind): boolean => kind.group === "local" || ["openai_compatible", "litellm", "bifrost"].includes(kind.kind);
/** The kinds the core connects without a key (OPTIONAL_KEY_KINDS): a server on this computer and the self-hosted gateways. */
const keyOptional = allowsMultiple;
/** The field that holds the credential, beside which the page for getting one is offered. */
const credentialField = (kind: ProviderKind): ProviderField | undefined => kind.fields.find(secret);
/** What a provider is, in one line: its official API, a model gateway, a cloud host or a server on this computer. */
export function description(kind: ProviderKind): string {
  if (kind.kind === "openai_compatible") return t("providers.compatibleNote");
  if (kind.group === "official") return t("providers.officialAPI", { p0: kind.name });
  if (kind.group === "local") return t("providers.localServer");
  return t(POPULAR.includes(kind.kind) || kind.kind === "bifrost" ? "providers.modelGateway" : "providers.cloudInference");
}

function directoryHTML(v: ProvidersView, lead = ""): string {
  let count = 0;
  const groups = (["official", "gateway", "local"] as const).map((group) => {
    const kinds = v.kinds.filter((k) => k.group === group && fitsRole(k, v.role) && k.name.toLowerCase().includes((v.kindQuery ?? "").trim().toLowerCase()));
    if (group === "gateway") kinds.sort((a, b) => {
      const rank = (id: string) => POPULAR.includes(id) ? POPULAR.indexOf(id) : POPULAR.length;
      return rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name, "en");
    });
    count += kinds.length;
    return kinds.length ? `<section class="sgroup"><h3>${esc(GROUP_TITLES[group]())}</h3><p class="note pv-group-note">${esc(GROUP_NOTES[group]())}</p><div class="pv-grid">` + kinds.map((k) => {
      const note = k.available ? description(k) : t("providers.soon");
      const connected = v.providers.some((p) => p.kind === k.kind);
      const action = t(connected ? "providers.manage" : "providers.connect");
      return `<div class="pv-card pv-add"><span class="ic">${providerMark(k.kind, true) || (k.group === "local" ? `<span class="mono md" aria-hidden="true">${ico("monitor")}</span>` : providerMark(k.kind))}</span><span class="tx"><span class="pv-kind-title"><span class="nm">${esc(k.name)}</span>${connected ? `<span class="pv-connected">${esc(t("providers.connected"))}</span>` : ""}</span><span class="ds" title="${esc(note)}">${esc(note)}</span></span>` +
        btn(esc(action), "", ` data-pv="add" data-id="${esc(k.kind)}" data-k="pv-add:${esc(k.kind)}" aria-label="${esc(action + " " + k.name)}"${(k.available || connected) && !v.busy ? "" : " disabled"}`) + `</div>`;
    }).join("") + `</div></section>` : "";
  }).join("");
  return `<div class="cs-scrim" data-pv="scrim" data-dialog="provider:add"><div class="cs-dialog pv-dialog pv-catalog pv-dir" id="pv-dialog" role="dialog" aria-modal="true" aria-labelledby="pv-title" tabindex="-1" data-trap>` +
    `<div class="cs-dlg-head"><h2 id="pv-title">${esc(t("providers.add"))}</h2>${ROLE_LABELS[v.role ?? ""] ? `<span class="pv-for">${esc(t("chooser.slot", { name: ROLE_LABELS[v.role!]() }))}</span>` : ""}<span class="sp"></span>${headerCloseButton(t("providers.close"), ' data-pv="close" data-k="pv-close" data-nav-back')}</div>` +
    `<div class="pv-scroll"><p class="note">${esc(ROLE_NOTES[v.role ?? ""]?.() ?? t("providers.choose"))}</p>${fieldHTML(t("providers.searchKinds"), v.kindQuery ?? "", { id: "pv-kind-search", icon: "search" })}` +
    `<div class="pv-directory">${(v.kindQuery ?? "").trim() ? "" : lead}${groups || `<p class="note" role="status">${esc(t("providers.noMatches"))}</p>`}</div><p class="pv-results note" role="status">${esc(t("providers.results", { p0: count }))}</p></div></div></div>`;
}
const errorText = (error: ProvidersView["error"]): string => t(error === "account" ? "providers.invalidAccount" : error === "required" ? "providers.required" : "providers.error");
function validAccount(value: string): boolean {
  try {
    const data: unknown = JSON.parse(value);
    return typeof data === "object" && data !== null && "client_email" in data && "private_key" in data &&
      typeof data.client_email === "string" && !!data.client_email.trim() && typeof data.private_key === "string" && !!data.private_key.trim();
  } catch { return false; }
}

function dialogHTML(v: ProvidersView, lead = ""): string {
  const kind = kindOf(v);
  if (!v.open) return v.adding ? directoryHTML(v, lead) : "";
  if (!kind) return "";
  const provider = providerOf(v);
  const disabled = v.busy ? " disabled" : "";
  const fields = (["name", ...kind.fields] as (ProviderField | "name")[]).map((field) => {
    const title = field === "key" && kind.kind === "bedrock" ? t("providers.secret") : field === "key" && keyOptional(kind) ? t("providers.keyOptional") : FIELD_TITLES[field]();
    const value = field === "name" ? provider?.name ?? kind.name : field === "base_url" ? provider?.base_url ?? kind.default_base_url ?? "" : field === "region" || field === "location" ? v.fieldValues?.[field] ?? (v.open!.id ? "" : field === "region" ? "us-east-1" : "us-central1") : "";
    const control = secret(field) && (provider?.has_key && !v.open!.replacing || field === "service_account" && v.accountSet)
      ? `<span class="val">${esc(t("providers.set"))}</span>${btn(esc(t("providers.replace")), "", ` data-pv="replace" data-k="pv-replace-${field}"${disabled}`)}`
      : field === "service_account"
        ? `<div class="pv-account">${btn(esc(t("providers.chooseFile")), "", ` data-pv="file" data-k="pv-file"${disabled}`)}<input type="file" class="pv-file" accept=".json,application/json" hidden${disabled}>` +
          `<label class="field"><textarea id="${esc(inputId(v, field))}" rows="3" autocomplete="off" spellcheck="false" aria-label="${esc(t("providers.pasteAccount"))}" placeholder="${esc(t("providers.pasteAccount"))}"${disabled}></textarea></label></div>`
      : field === "region" || field === "location"
        ? sel(value ? choicesFor(field) : [{ value: "", label: t("providers.unchanged") }, ...choicesFor(field)], value, title, ` id="${esc(inputId(v, field))}" data-pv="field" data-pv-field="${field}" data-value="${esc(value)}"${disabled}`)
        : fieldHTML(title, value, { id: inputId(v, field), type: secret(field) ? "password" : "text", disabled: v.busy });
    const getKey = field === credentialField(kind) && kind.docs_url && kind.group !== "local" ? btn(esc(t("providers.getKey")), "pv-link", ` data-pv="docs" data-k="pv-docs"${disabled}`) : "";
    return `<div class="pv-field"><div class="pv-label-row"><label class="pv-label" for="${esc(inputId(v, field))}">${esc(title)}</label>${getKey}</div><div class="svc-line">${control}</div></div>`;
  }).join("");
  return `<div class="cs-scrim" data-pv="scrim" data-dialog="provider:${esc(v.adding ? "add" : v.open.id ?? kind.kind)}"><div class="cs-dialog pv-dialog pv-editor" id="pv-dialog" role="dialog" aria-modal="true" aria-labelledby="pv-title" tabindex="-1" data-trap>` +
    `<div class="cs-dlg-head">${v.open.id ? "" : backButton(t("providers.back"), ` data-pv="back" data-k="pv-back"${disabled}`)}<span class="ic">${providerMark(kind.kind)}</span><h2 id="pv-title">${esc(provider?.name ?? kind.name)}</h2><span class="sp"></span>${headerCloseButton(t("providers.close"), ' data-pv="close" data-k="pv-close" data-nav-back')}</div>` +
    // One column: the fields, what the test found right under them, then the way to add another. The actions are in the foot.
    `<div class="pv-body"><div class="pv-setup">` + fields + (v.error ? `<p class="note" role="alert">${esc(errorText(v.error))}</p>` : "") +
    `<div class="pv-feedback">${feedbackHTML(v)}</div><div class="pv-models-host">${modelsHTML(v)}</div>` +
    (provider && allowsMultiple(kind) ? btn(esc(t("providers.another")), "", ` data-pv="another" data-k="pv-another"${disabled}`) : "") +
    `</div></div>` +
    `<div class="pv-footer">` +
    (v.open.id ? btn(esc(t("providers.remove")), "danger", ` data-pv="remove" data-k="pv-remove"${disabled}`) : "") +
    `<div class="pv-footer-actions">${btn(esc(t("providers.test")), "", ` data-pv="test" data-k="pv-test"${v.busy || !v.canTest ? " disabled" : ""}`)}` +
    btn(esc(t("providers.save")), "pri", ` data-pv="save" data-k="pv-save"${v.busy || !v.canSave ? " disabled" : ""}`) + `</div></div></div></div>`;
}

/** What the test said, right under the fields: one line, and nothing before a test has been made. */
function feedbackHTML(v: ProvidersView): string {
  if (!v.testing && !v.result) return "";
  const text = v.testing ? t("providers.testing") : v.result!.ok ? t("providers.testConnected", { p0: v.result!.models }) :
    t(v.result!.kind === "auth" ? "providers.auth" : v.result!.kind === "offline" ? "providers.offline" : "providers.error");
  return `<p class="pv-test-status note${v.testing ? "" : v.result!.ok ? " is-ok" : " is-error"}" role="status">${ico(v.testing ? "refresh" : v.result!.ok ? "check" : "x")}<span title="${esc(text)}">${esc(text)}</span></p>`;
}

/** The models found: nothing at all while there are none, and never a word about saving first. */
function modelsHTML(v: ProvidersView): string {
  if (v.models === "failed") return `<p class="note">${esc(t("providers.error"))}</p>`;
  if (!Array.isArray(v.models) || !v.models.length) return "";
  return `<section class="pv-models"><h3>${esc(t("providers.models"))}</h3>` +
    (v.models.length > 10 ? fieldHTML(t("providers.search"), v.query, { id: "pv-model-search", icon: "search" }) : "") +
    `<div class="pv-model-list">${modelListHTML(v)}</div></section>`;
}

function modelListHTML(v: ProvidersView): string {
  if (!Array.isArray(v.models)) return "";
  const query = v.query.toLowerCase();
  return `<ul>` + v.models.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(query) || findsName([m.name, m.id], query)).map((m) =>
    `<li><span class="pv-model-name">${esc(m.name)}</span><span class="pv-model-id">${esc(m.id)}</span>${m.context_warning ? `<span class="pv-context-warning">${esc(t("providers.contextWarning"))}</span>` : ""}</li>`).join("") + `</ul>`;
}

function statusNote(provider: ModelProvider): string {
  if (!provider.enabled) return t("providers.off");
  if (provider.status === "ok") return t("providers.count", { p0: provider.models });
  return t(provider.status === "auth" ? "providers.auth" : provider.status === "offline" ? "providers.offline" : "providers.unknown");
}

export function providersHTML(v: ProvidersView): string {
  // ChatGPT is a sign-in, shown with the subscription accounts rather than as an API key. A card has no switch: it opens the
  // provider's editor (test, replace the key, remove). A provider turned off in an earlier version says so and offers 啟用.
  const rows = v.providers.filter((p) => p.id !== "chatgpt").map((p) => `<div class="pv-card pv-item">` +
    btn(`<span class="ic">${providerMark(p.kind)}</span><span class="tx"><span class="nm">${esc(p.name)}</span><span class="ds">${esc(statusNote(p))}</span></span><span class="chev" aria-hidden="true">${ico("right")}</span>`, "cs-open", ` data-pv="open" data-id="${esc(p.id)}" data-k="pv-open:${esc(p.id)}" aria-haspopup="dialog"`) +
    (p.enabled ? "" : btn(esc(t("providers.enable")), "sm", ` data-pv="enable" data-id="${esc(p.id)}" data-k="pv-enable:${esc(p.id)}" aria-label="${esc(t("providers.switch", { p0: p.name }))}"${v.busy ? " disabled" : ""}`)) +
    `</div>`).join("");
  const add = btn(`<span class="ic">${ico("plus")}</span><span class="tx"><span class="nm">${esc(t("providers.add"))}</span><span class="ds">${esc(t("providers.addNote"))}</span></span>`, "pv-card pv-create", ` data-pv="directory" data-k="pv-directory" aria-haspopup="dialog"${v.state === "ready" && !v.busy ? "" : " disabled"}`);
  return `<section class="sgroup pv"><h2>${esc(t("models.providers"))}</h2>` +
    (v.state === "ready" ? "" : `<p class="note" role="status">${esc(t(v.state === "failed" ? "providers.error" : "providers.loading"))}</p>`) +
    `<div class="pv-grid">${v.state === "ready" ? rows : ""}${add}</div>` +
    (v.error && !v.open && !v.adding ? `<p class="note" role="alert">${esc(errorText(v.error))}</p>` : "") +
    (v.state === "failed" ? btn(esc(t("providers.retry")), "", ' data-pv="retry" data-k="pv-retry"') : "") +
    `</section>`;
}

/** `lead`: what comes before the providers in the directory, the subscription sign-ins (cli-brains.ts cliDirectoryHTML). */
export function providersAddHTML(v: ProvidersView, lead = ""): string {
  return dialogHTML(v, lead);
}

export interface ProvidersHost { root: HTMLElement; visible(): boolean; redraw(): void; }
export function createProviders(host: ProvidersHost) {
  let state = emptyProvidersView();
  let stopOutside: (() => void) | null = null;
  let loads = 0;
  let modelLoads = 0;
  let accountDraft: string | null = null;
  let accountReads = 0;
  /** The models on screen came from a test of the form, so they say nothing once a field changes. */
  let testedModels = false;
  function syncForm() {
    const kind = kindOf(state), open = state.open;
    if (!kind || !open) return;
    const provider = providerOf(state);
    let valid = true, changed = open.replacing;
    for (const field of ["name", ...kind.fields] as (ProviderField | "name")[]) {
      const input = host.root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(`#${CSS.escape(inputId(state, field))}`);
      if (!input) {
        if (field === "service_account" && state.accountSet) changed = true;
        continue;
      }
      const value = (input.dataset.pvField ? input.dataset.value ?? "" : input.value).trim();
      if (field === "service_account") {
        if (!validAccount(value)) valid = false;
        if (value) changed = true;
        continue;
      }
      const required = field === "name" || field === "base_url" || !open.id || open.replacing && secret(field);
      if (required && !value && !(field === "key" && keyOptional(kind))) valid = false;
      if (field === "base_url" && value) {
        try { if (!["http:", "https:"].includes(new URL(value).protocol)) valid = false; } catch { valid = false; }
      }
      if (field === "name" || field === "base_url") {
        if (value !== (provider?.[field] ?? (field === "name" ? kind.name : kind.default_base_url ?? ""))) changed = true;
      } else if (value) changed = true;
    }
    state.dirty = changed;
    state.canSave = valid && (!open.id || changed);
    state.canTest = valid;
    const save = host.root.querySelector<HTMLButtonElement>('[data-pv="save"]');
    if (save) save.disabled = state.busy || !state.canSave;
    const test = host.root.querySelector<HTMLButtonElement>('[data-pv="test"]');
    if (test) test.disabled = state.busy || !state.canTest;
    const feedback = host.root.querySelector(".pv-feedback");
    if (feedback) feedback.innerHTML = feedbackHTML(state);
  }
  const redraw = () => {
    if (!host.visible()) return;
    // Carry input drafts between DOM drawings, never into page state or HTML attributes.
    const inputs = [...host.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.pv-field input:not([type="file"]), .pv-field textarea')];
    const drafts = new Map(inputs.map((input) => [input.id, input.value]));
    const active = document.activeElement as HTMLElement | null;
    const scroll = host.root.querySelector(".pv-body")?.scrollTop;
    const selection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;
    host.redraw();
    if ((state.open || state.adding) && !stopOutside) {
      stopOutside = registerDismissal(() => host.root.querySelector<HTMLElement>("#pv-dialog"), close, () => !state.busy, undefined,
        {
          step: direction => {
            if (state.busy) return true;
            if (direction !== "back") return false;
            const panel = host.root.querySelector("#pv-dialog")!;
            if (keepEditedField(panel, ".pv-field input, .pv-field textarea") || state.dirty) return true;
            if (!state.open || state.open.id) return false;
            backToDirectory(panel);
            return true;
          },
          restore: () => {
            const key = navView(), role = state.role;
            return () => { if (key === "pv:dir") directory(role); else showNavView(key); };
          },
        });
    } else if (!state.open && !state.adding) { stopOutside?.(); stopOutside = null; }
    for (const input of host.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.pv-field input:not([type="file"]), .pv-field textarea')) {
      if (drafts.has(input.id)) input.value = drafts.get(input.id)!;
      if (active?.id === input.id) { input.focus(); if (selection) input.setSelectionRange(selection[0], selection[1]); }
    }
    syncForm();
    if (scroll !== undefined) { const body = host.root.querySelector(".pv-body"); if (body) body.scrollTop = scroll; }
    if (active && host.root.querySelector("#pv-dialog")) {
      const fresh = [...host.root.querySelectorAll<HTMLElement>("[id], [data-k]")].find((el) => active.id ? el.id === active.id : active.dataset.k && el.dataset.k === active.dataset.k);
      (fresh && !(fresh instanceof HTMLButtonElement && fresh.disabled) ? fresh : host.root.querySelector<HTMLElement>("#pv-dialog"))?.focus();
    }
  };
  async function load() {
    const mine = ++loads;
    try {
      const [providers, kinds] = await Promise.all([api.providersList(), api.providersKinds()]);
      if (mine !== loads) return;
      state = { ...state, providers: providers.providers, kinds: kinds.kinds, state: "ready" };
      if (state.open?.id && !state.providers.some((p) => p.id === state.open?.id)) close();
    } catch { if (mine !== loads) return; state = { ...state, state: "failed" }; }
    redraw();
  }
  function show(kind: string, id: string | null) {
    accountDraft = null; accountReads++;
    modelLoads++; testedModels = false;
    state = { ...state, adding: id === null, open: { kind, id, replacing: false }, error: null, result: null, testing: false, canSave: false, models: [], query: "", dirty: false, accountSet: false, fieldValues: {} };
    redraw(); host.root.querySelector<HTMLElement>("#pv-dialog")?.focus();
    if (id) void loadModels(id);
  }
  function close() {
    const from = state.open;
    const adding = state.adding;
    accountDraft = null; accountReads++; state.accountSet = false;
    modelLoads++; state.open = null; state.adding = false; state.kindQuery = ""; state.role = ""; redraw();
    if (adding) host.root.querySelector<HTMLElement>('[data-pv="directory"]')?.focus();
    else [...host.root.querySelectorAll<HTMLElement>('button[data-pv="open"]')].find((el) => el.dataset.id === from?.id)?.focus();
  }
  function directory(role = state.role ?? "") {
    const from = state.open?.kind;
    accountDraft = null; accountReads++; modelLoads++;
    state = { ...state, adding: true, open: null, error: null, result: null, models: [], accountSet: false, fieldValues: {}, dirty: false, role };
    redraw();
    const previous = [...host.root.querySelectorAll<HTMLElement>('[data-pv="add"]')].find((el) => el.dataset.id === from);
    (previous ?? host.root.querySelector<HTMLElement>("#pv-kind-search"))?.focus();
  }
  function backToDirectory(panel: ParentNode): void {
    if (state.busy || keepEditedField(panel, ".pv-field input, .pv-field textarea") || state.dirty) return;
    const key = navView();
    rememberLayerBack(() => directory(), () => showNavView(key));
  }
  async function remove() {
    const open = state.open;
    const id = open?.id;
    if (!id || state.busy) return;
    const name = providerOf(state)?.name ?? kindOf(state)?.name ?? "";
    // The red dialog asks (R-UI-56); the provider is removed only by its red button.
    if (!(await confirmDelete(name, { words: { title: t("confirm.removeTitle", { p0: name }), hint: t("providers.removeHint"), action: t("providers.remove") } }))) return;
    if (state.open !== open || state.busy) return;
    state.busy = true; state.error = null; redraw();
    try {
      const result = await api.providersRemove(id);
      if (!result.removed) throw new Error("not_removed");
      if (state.open === open) close();
      await load();
    } catch { if (state.open === open) state.error = "error"; }
    finally { state.busy = false; redraw(); }
  }
  async function loadModels(id: string) {
    const mine = ++modelLoads;
    state.models = "loading"; redraw();
    try {
      const result = await api.providersModels(id);
      if (mine !== modelLoads || state.open?.id !== id) return;
      state.models = result.models;
    } catch { if (mine !== modelLoads || state.open?.id !== id) return; state.models = "failed"; }
    redraw();
  }
  /** What the form says, as the core takes it. `consume` empties the secret fields (a save); a test leaves them to be saved after. */
  function gather(consume: boolean): { patch: ProviderPatch; valid: boolean; accountError: boolean } {
    const open = state.open!, kind = kindOf(state)!;
    const patch: ProviderPatch = {};
    let valid = true;
    for (const field of ["name", ...kind.fields] as (ProviderField | "name")[]) {
      if (field === "service_account") {
        const area = host.root.querySelector<HTMLTextAreaElement>(".pv-account textarea");
        const value = accountDraft ?? area?.value.trim() ?? "";
        if (consume) {
          if (area) area.value = "";
          accountDraft = null; state.accountSet = false; accountReads++;
        }
        if (value && validAccount(value)) patch.service_account = value;
        else if (value || !open.id || open.replacing) return { patch, valid: false, accountError: true };
        continue;
      }
      const input = [...host.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>(".pv-field input, .pv-field [data-pv-field]")].find((el) => el.id === inputId(state, field));
      if (!input) continue;
      const value = (input.dataset.pvField ? input.dataset.value ?? "" : input.value).trim();
      if (consume && secret(field) && input instanceof HTMLInputElement) input.value = "";
      if (field === "base_url" && value) {
        try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) valid = false; }
        catch { valid = false; }
      }
      const optionalKey = field === "key" && keyOptional(kind);
      if (!value && !optionalKey && (!open.id || field === "name" || field === "base_url" || open.replacing && secret(field))) valid = false;
      if (value || field === "base_url") patch[field] = value;
    }
    return { patch, valid, accountError: false };
  }
  /** Tests the connection on what the form says now, saved or not: the core keeps nothing of it. A saved provider that was not changed is tested by its id. */
  async function testConnection() {
    const open = state.open;
    const kind = kindOf(state);
    if (!open || !kind || state.busy) return;
    syncForm();
    if (!state.canTest) return;
    const draft = !open.id || state.dirty;
    let params: Parameters<typeof api.providersTest>[0] = { id: open.id ?? "" };
    if (draft) {
      const form = gather(false);
      if (form.accountError || !form.valid) { state.error = form.accountError ? "account" : "required"; redraw(); return; }
      params = open.id ? { id: open.id, ...form.patch } : { kind: kind.kind, ...form.patch };
    }
    state.busy = true; state.testing = true; state.result = null; state.error = null; redraw();
    try {
      const result = await api.providersTest(params);
      if (state.open === open) state.result = result;
      if (draft) {
        if (state.open === open) { state.models = result.ok ? result.found ?? [] : []; testedModels = true; }
      } else {
        await load();
        if (state.open === open && open.id) await loadModels(open.id);
      }
    } catch { if (state.open === open) state.result = { ok: false, kind: "error", models: 0 }; }
    finally { state.busy = false; state.testing = false; redraw(); }
  }
  async function save() {
    const open = state.open;
    const kind = kindOf(state);
    if (!open || !kind || state.busy) return;
    syncForm();
    if (!state.canSave) return;
    const { patch, valid, accountError } = gather(true);
    if (accountError) { state.error = "account"; redraw(); return; }
    if (!valid) { state.error = "required"; redraw(); return; }
    state.busy = true; state.error = null; redraw();
    try {
      const result = open.id ? await api.providersUpdate({ id: open.id, ...patch }) : await api.providersAdd({ kind: kind.kind, ...patch });
      if (state.open === open) { state.open = { ...open, id: result.provider.id, replacing: false }; state.dirty = false; state.result = null; testedModels = false; }
      state.providers = [...state.providers.filter((p) => p.id !== result.provider.id), result.provider];
      await load();
      if (state.open?.id === result.provider.id) await loadModels(result.provider.id);
    } catch { if (state.open === open) state.error = "error"; }
    finally { state.busy = false; redraw(); }
  }
  async function enable(id: string) {
    const provider = state.providers.find((p) => p.id === id);
    if (!provider || provider.enabled || state.busy) return;
    state.busy = true; state.error = null; redraw();
    try { await api.providersUpdate({ id, enabled: true }); await load(); }
    catch { state.error = "error"; }
    finally { state.busy = false; redraw(); }
  }
  /** The dialog on screen in words the way back keeps: the list of kinds (`pv:dir`) or one provider (`pv:openai:4`, `pv:openai:new`). */
  function navView(): string {
    if (state.open) return `pv:${state.open.kind}:${state.open.id ?? "new"}`;
    return state.adding ? "pv:dir" : "";
  }
  /** Shows the dialog `navView` named, or closes it for "". */
  function showNavView(key: string): void {
    if (!key) { if (state.open || state.adding) close(); return; }
    if (key === "pv:dir") { if (!state.adding || state.open) directory(); return; }
    const found = /^pv:([^:]+):(.+)$/.exec(key);
    if (!found) return;
    const id = found[2] === "new" ? null : found[2];
    if (state.open?.kind !== found[1] || state.open.id !== id) show(found[1], id);
  }
  return {
    view: () => state, load,
    openRepair(id: string): void {
      // `connect` opens the directory; `connect:<feature>` opens it for one feature, with only the kinds that can do it.
      if (id === "connect" || id.startsWith("connect:")) { directory(id.slice("connect:".length)); return; }
      const provider = state.providers.find(p => p.id === id);
      if (provider) {
        show(provider.kind, provider.id);
        (host.root.querySelector<HTMLElement>('[data-pv="replace"]') ?? host.root.querySelector<HTMLElement>('#pv-dialog input, #pv-dialog textarea'))?.focus();
      } else directory();
    },
    click(target: Element): boolean {
      const button = target.closest<HTMLElement>("[data-pv]");
      if (!button) return false;
      if (button instanceof HTMLButtonElement && button.disabled) return true;
      if (button.dataset.pv === "directory") directory();
      if (button.dataset.pv === "back") backToDirectory(button.closest("#pv-dialog")!);
      if (button.dataset.pv === "enable") void enable(button.dataset.id!);
      if (button.dataset.pv === "add") {
        const existing = state.providers.find((p) => p.kind === button.dataset.id);
        if (existing || state.kinds.some((k) => k.kind === button.dataset.id && k.available)) show(button.dataset.id!, existing?.id ?? null);
      }
      if (button.dataset.pv === "another" && kindOf(state) && allowsMultiple(kindOf(state)!)) show(state.open!.kind, null);
      if (button.dataset.pv === "open") {
        const provider = state.providers.find((p) => p.id === button.dataset.id);
        if (provider) show(provider.kind, provider.id);
      }
      if (button.dataset.pv === "replace" && state.open) { accountDraft = null; accountReads++; state.accountSet = false; state.open.replacing = true; state.dirty = true; state.result = null; redraw(); }
      if (button.dataset.pv === "file") host.root.querySelector<HTMLInputElement>(".pv-file")?.click();
      if (button.dataset.pv === "save") void save();
      if (button.dataset.pv === "test") void testConnection();
      if (button.dataset.pv === "remove") void remove();
      if (button.dataset.pv === "retry") void load();
      if (button.dataset.pv === "docs") {
        const url = kindOf(state)?.docs_url;
        const open = state.open;
        if (url) void api.openLink(url).catch(() => { if (state.open === open) { state.error = "error"; redraw(); } });
      }
      if (button.dataset.pv === "field") {
        const field = button.dataset.pvField as "region" | "location";
        openMenu(button, choicesFor(field), button.dataset.value ?? "", (value) => {
          state.fieldValues = { ...state.fieldValues, [field]: value };
          state.dirty = true; state.result = null; redraw();
        });
      }
      if (button.dataset.pv === "close") close();
      return true;
    },
    input(target: Element): void {
      if (target instanceof HTMLInputElement && target.id === "pv-kind-search") {
        state.kindQuery = target.value;
        const selection = [target.selectionStart, target.selectionEnd] as const;
        redraw();
        const fresh = host.root.querySelector<HTMLInputElement>("#pv-kind-search");
        fresh?.focus(); fresh?.setSelectionRange(...selection);
        return;
      }
      if (target.closest(".pv-field") && state.open) {
        if (target instanceof HTMLTextAreaElement && validAccount(target.value)) {
          accountDraft = target.value.trim(); accountReads++; target.value = "";
          state.accountSet = true; state.dirty = true; state.error = null; state.result = null; redraw(); return;
        }
        state.result = null; state.error = null;
        if (testedModels) { testedModels = false; state.models = []; const found = host.root.querySelector(".pv-models-host"); if (found) found.innerHTML = ""; }
        host.root.querySelector('.pv-body [role="alert"]')?.remove();
        syncForm();
        return;
      }
      if (!(target instanceof HTMLInputElement) || target.id !== "pv-model-search") return;
      state.query = target.value;
      const list = host.root.querySelector(".pv-model-list");
      if (list) list.innerHTML = modelListHTML(state);
    },
    async change(target: Element): Promise<void> {
      if (!(target instanceof HTMLInputElement) || !target.matches(".pv-file") || state.busy) return;
      const file = target.files?.[0]; target.value = "";
      if (!file || !state.open) return;
      const open = state.open, mine = ++accountReads;
      try {
        const value = await file.text();
        if (state.open !== open || mine !== accountReads) return;
        if (!validAccount(value)) throw new Error("invalid_account");
        accountDraft = value.trim(); state.accountSet = true; state.dirty = true; state.result = null; state.error = null;
      } catch {
        if (state.open !== open || mine !== accountReads) return;
        accountDraft = null; state.accountSet = false; state.error = "account";
      }
      redraw();
    },
    followEvent(event: MainEvent): void {
      if (event.type !== "ProvidersChanged" || !host.visible()) return;
      void load().then(() => { if (state.open?.id) void loadModels(state.open.id); });
    },
    key(event: KeyboardEvent): boolean {
      if (!state.open && !state.adding) return false;
      const panel = host.root.querySelector<HTMLElement>("#pv-dialog");
      if (event.key === "Escape" && panel && !isTopLayer(panel)) return false;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return true; }
      if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.closest(".pv-field")) {
        event.preventDefault(); void save(); return true;
      }
      return false;
    },
    navView, showNavView,
    reset(): void {
      stopOutside?.(); stopOutside = null;
      accountDraft = null; accountReads++; state.accountSet = false;
      loads++; modelLoads++; state.open = null; state.adding = false; state.kindQuery = ""; state.error = null; state.result = null;
      for (const input of host.root.querySelectorAll<HTMLInputElement>('.pv-field input[type="password"]')) input.value = "";
      for (const area of host.root.querySelectorAll<HTMLTextAreaElement>(".pv-field textarea")) area.value = "";
    },
  };
}
