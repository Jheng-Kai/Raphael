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

type EditorView = "setup" | "models" | "settings";

export interface ProvidersView {
  providers: ModelProvider[];
  kinds: ProviderKind[];
  state: "loading" | "ready" | "failed";
  busy: boolean;
  open: { kind: string; id: string | null; view: EditorView; replacing: boolean } | null;
  error: "error" | "account" | null;
  result: ProviderTest | null;
  formResult?: ProviderTest;
  models: ProviderModel[];
  query: string;
  kindQuery?: string;
  adding?: boolean;
  /** The feature the directory was opened for from a model's choice (cleanup, stt, image, video): only kinds that can do it. */
  role?: string;
  accountSet?: boolean;
  fieldValues?: Partial<Record<"region" | "location", string>>;
  dirty: boolean;
  canSave?: boolean;
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
const editorFields = (kind: ProviderKind): (ProviderField | "name")[] =>
  [...(allowsMultiple(kind) ? ["name" as const] : []), ...kind.fields.filter(field => kind.group !== "local" || field !== "key")];

function fieldValue(v: ProvidersView, kind: ProviderKind, field: ProviderField | "name"): string {
  const provider = providerOf(v);
  if (field === "name") return provider?.name ?? kind.name;
  if (field === "base_url") return provider?.base_url ?? kind.default_base_url ?? "";
  if (field === "region" || field === "location") return v.fieldValues?.[field] ?? (v.open?.id ? "" : field === "region" ? "us-east-1" : "us-central1");
  return "";
}

function editorChoices(field: "region" | "location", saved: boolean) {
  const choices = choicesFor(field);
  return saved ? [{ value: "", label: t("providers.unchanged") }, ...choices] : choices;
}
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
const errorText = (error: ProvidersView["error"]): string => t(error === "account" ? "providers.invalidAccount" : "providers.error");
function validAccount(value: string): boolean {
  try {
    const data: unknown = JSON.parse(value);
    return typeof data === "object" && data !== null && "client_email" in data && "private_key" in data &&
      typeof data.client_email === "string" && !!data.client_email.trim() && typeof data.private_key === "string" && !!data.private_key.trim();
  } catch { return false; }
}

function fieldsHTML(v: ProvidersView, kind: ProviderKind): string {
  const provider = providerOf(v);
  const disabled = v.busy ? " disabled" : "";
  return editorFields(kind).map((field) => {
    const title = field === "key" && kind.kind === "bedrock" ? t("providers.secret") : field === "key" && keyOptional(kind) ? t("providers.keyOptional") : FIELD_TITLES[field]();
    const value = fieldValue(v, kind, field);
    const control = secret(field) && (provider?.has_key && !v.open!.replacing || field === "service_account" && v.accountSet)
      ? `<span class="val">${esc(t("providers.set"))}</span>${btn(esc(t("providers.replace")), "sm", ` data-pv="replace" data-k="pv-replace-${field}"${disabled}`)}`
      : field === "service_account"
        ? `<div class="pv-account">${btn(esc(t("providers.chooseFile")), "", ` data-pv="file" data-k="pv-file"${disabled}`)}<input type="file" class="pv-file" accept=".json,application/json" hidden${disabled}>` +
          `<label class="field"><textarea id="${esc(inputId(v, field))}" rows="3" autocomplete="off" spellcheck="false" aria-label="${esc(t("providers.pasteAccount"))}" placeholder="${esc(t("providers.pasteAccount"))}"${disabled}></textarea></label></div>`
      : field === "region" || field === "location"
        ? sel(editorChoices(field, !!v.open?.id), value, title, ` id="${esc(inputId(v, field))}" data-pv="field" data-pv-field="${field}" data-value="${esc(value)}"${disabled}`)
        // The label above the field says what it is: a placeholder that repeats it says nothing twice.
        : fieldHTML("", value, { id: inputId(v, field), label: title, type: secret(field) ? "password" : "text", disabled: v.busy });
    const getKey = v.open?.view === "setup" && !provider?.has_key && field !== "service_account" && field === credentialField(kind) && kind.docs_url ? btn(esc(t("providers.getKey")), "pv-link", ` data-pv="docs" data-k="pv-docs"${disabled}`) : "";
    return `<div class="pv-field"><div class="pv-label-row"><label class="pv-label" for="${esc(inputId(v, field))}">${esc(title)}</label>${getKey}</div><div class="svc-line">${control}</div></div>`;
  }).join("");
}

function formActionHTML(v: ProvidersView): string {
  const setup = v.open?.view === "setup";
  if (!setup && !v.dirty) return "";
  const action = setup ? "connect" : "save";
  const disabled = v.busy || !v.canSave ? " disabled" : "";
  return btn(esc(t(setup ? "providers.connect" : "providers.save")), "pri", ` data-pv="${action}" data-k="pv-${action}"${disabled}`);
}

function dialogHTML(v: ProvidersView, lead = ""): string {
  const kind = kindOf(v), open = v.open;
  if (!open) return v.adding ? directoryHTML(v, lead) : "";
  if (!kind) return "";
  const name = providerOf(v)?.name ?? kind.name;
  const disabled = v.busy ? " disabled" : "";
  const back = open.view === "settings" || open.view === "setup" && v.adding
    ? backButton(t(open.view === "settings" ? "providers.backToModels" : "providers.back"), ` data-pv="back" data-k="pv-back"${disabled}`) : "";
  const action = open.view === "models"
    ? btn(ico("gear"), "icon", ` data-pv="settings" data-k="pv-settings" aria-label="${esc(t("providers.settings", { p0: name }))}"`)
    : open.view === "settings"
      ? btn(ico("trash"), "icon", ` data-pv="remove" data-k="pv-remove" aria-label="${esc(t("providers.removeNamed", { p0: name }))}"${disabled}`)
      : "";
  return `<div class="cs-scrim" data-pv="scrim" data-dialog="provider:${esc(v.adding ? "add" : open.id ?? kind.kind)}"><div class="cs-dialog pv-dialog pv-editor" id="pv-dialog" data-pv-view="${open.view}" role="dialog" aria-modal="true" aria-labelledby="pv-title" tabindex="-1" data-trap>` +
    `<div class="cs-dlg-head">${back}<span class="ic">${providerMark(kind.kind)}</span><h2 id="pv-title">${esc(name)}</h2><span class="sp"></span>${action}${headerCloseButton(t("providers.close"), ` data-pv="close" data-k="pv-close"${open.view === "settings" ? "" : " data-nav-back"}${disabled}`)}</div>` +
    (open.view === "models" ? modelsHTML(v, kind) :
      `<div class="pv-body"><div class="pv-setup">${fieldsHTML(v, kind)}<div class="pv-feedback">${feedbackHTML(v, kind)}</div></div></div>` +
      `<div class="pv-footer">${formActionHTML(v)}</div>`) + "</div></div>";
}

function feedbackHTML(v: ProvidersView, kind: ProviderKind): string {
  const models = v.open?.view === "models";
  const result = models ? v.result : v.formResult;
  if (models && v.testing) return `<p class="pv-test-status note" role="status">${esc(t("providers.connecting"))}</p>`;
  if (!result && !v.error) return "";
  if (result?.ok && !v.error) return `<p class="pv-test-status note is-ok" role="status">${esc(t("providers.modelCount", { p0: result.models }))}</p>`;
  const credential = credentialField(kind);
  const errorKey = result?.kind === "auth" ? (credential === "service_account" ? "providers.authAccount" : "providers.auth") :
    result?.kind === "offline" ? "providers.offline" : "providers.error";
  const text = v.error ? errorText(v.error) : t(errorKey);
  const repair = kind.group === "local" || !credential ? "providers.settings" :
    credential === "service_account" ? "providers.changeAccount" : "providers.changeKey";
  const action = models ? " " + btn(esc(t(repair, { p0: providerOf(v)?.name ?? kind.name })), "sm", ' data-pv="settings" data-k="pv-repair"') : "";
  return `<p class="pv-test-status note is-error" role="${models ? "status" : "alert"}">${esc(text)}${action}</p>`;
}

function modelsHTML(v: ProvidersView, kind: ProviderKind): string {
  const another = allowsMultiple(kind) ? btn(esc(t("providers.another")), "", ' data-pv="another" data-k="pv-another"') : "";
  return `<div class="pv-body pv-models"><div class="pv-feedback">${feedbackHTML(v, kind)}</div>` +
    fieldHTML(t("providers.search"), v.query, { id: "pv-model-search", icon: "search" }) +
    `<div class="pv-model-scroll"><div class="pv-model-list">${modelListHTML(v)}</div>${another}</div></div>`;
}
function modelListHTML(v: ProvidersView): string {
  if (!v.models.length) return "";
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
  // provider's models. A provider turned off in an earlier version says so and offers 啟用.
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
  function syncForm(): ProviderPatch {
    const kind = kindOf(state), open = state.open;
    const patch: ProviderPatch = {};
    if (!kind || !open || open.view === "models") return patch;
    const provider = providerOf(state);
    let valid = true, changed = false;
    for (const field of editorFields(kind)) {
      const input = host.root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(`#${CSS.escape(inputId(state, field))}`);
      if (field === "service_account") {
        const value = accountDraft ?? input?.value.trim() ?? "";
        if (validAccount(value)) { patch.service_account = value; changed = true; }
        else if (input) { valid = false; changed ||= !!value; }
        continue;
      }
      if (!input) continue;
      const value = (input.dataset.pvField ? input.dataset.value ?? "" : input.value).trim();
      const required = field === "name" || field === "base_url" || !open.id || open.replacing && secret(field) && !provider?.has_key;
      if (required && !value && !(field === "key" && keyOptional(kind))) valid = false;
      if (field === "base_url" && value) {
        try { if (!["http:", "https:"].includes(new URL(value).protocol)) valid = false; } catch { valid = false; }
      }
      if (field === "name" || field === "base_url") {
        changed ||= value !== (provider?.[field] ?? (field === "name" ? kind.name : kind.default_base_url ?? ""));
      } else changed ||= !!value;
      if (value || field === "base_url") patch[field] = value;
    }
    state.dirty = changed;
    state.canSave = valid && (!open.id || changed);
    const footer = host.root.querySelector(".pv-footer");
    const submit = footer?.querySelector("button");
    if (submit && (open.view === "setup" || changed)) submit.disabled = state.busy || !state.canSave;
    else if (footer) footer.innerHTML = formActionHTML(state);
    const feedback = host.root.querySelector(".pv-setup .pv-feedback");
    if (feedback) feedback.innerHTML = feedbackHTML(state, kind);
    return patch;
  }

  function clearCredentials(): void {
    accountDraft = null; accountReads++; state.accountSet = false;
    for (const input of host.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.pv-field input[type="password"], .pv-field textarea')) input.value = "";
  }
  const redraw = (carryForm = true) => {
    if (!host.visible()) return;
    // Carry input drafts between DOM drawings, never into page state or HTML attributes.
    const inputs = [...host.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.pv-field input:not([type="file"]), .pv-field textarea')];
    const drafts = new Map((carryForm ? inputs : []).map((input) => [input.id, input.value]));
    const active = document.activeElement as HTMLElement | null;
    const scroll = carryForm ? host.root.querySelector(".pv-body")?.scrollTop : undefined;
    const modelScroll = carryForm ? host.root.querySelector(".pv-model-scroll")?.scrollTop : undefined;
    const selection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;
    host.redraw();
    if ((state.open || state.adding) && !stopOutside) {
      stopOutside = registerDismissal(() => host.root.querySelector<HTMLElement>("#pv-dialog"), close, () => !state.busy, undefined,
        {
          step: direction => {
            if (state.busy) return true;
            if (direction !== "back") return false;
            return back();
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
    if (modelScroll !== undefined) { const list = host.root.querySelector(".pv-model-scroll"); if (list) list.scrollTop = modelScroll; }
    if (active && host.root.querySelector("#pv-dialog")) {
      const fresh = [...host.root.querySelectorAll<HTMLElement>("[id], [data-k]")].find((el) => active.id ? el.id === active.id : active.dataset.k && el.dataset.k === active.dataset.k);
      (fresh && !(fresh instanceof HTMLButtonElement && fresh.disabled) ? fresh : host.root.querySelector<HTMLElement>("#pv-dialog"))?.focus();
      if (fresh?.id === "pv-model-search" && fresh instanceof HTMLInputElement && selection) fresh.setSelectionRange(selection[0], selection[1]);
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
  function focusModels(): void {
    host.root.querySelector<HTMLElement>("#pv-model-search")?.focus();
  }

  function show(kind: string, id: string | null, fromDirectory = false) {
    clearCredentials();
    modelLoads++;
    const provider = state.providers.find(p => p.id === id);
    const preset = state.kinds.find(k => k.kind === kind);
    const needsCredential = preset && preset.group !== "local" && credentialField(preset) &&
      (provider?.status === "auth" || !provider?.has_key && !keyOptional(preset));
    const view = provider && !needsCredential ? "models" : "setup";
    state = { ...state, adding: fromDirectory, open: { kind, id, view, replacing: !!needsCredential }, error: null, result: null,
      formResult: undefined, testing: view === "models", canSave: false, models: [], query: "", dirty: false, fieldValues: {} };
    redraw(false);
    if (view === "models" && id) {
      focusModels();
      void testSaved(id);
    } else host.root.querySelector<HTMLElement>("#pv-dialog")?.focus();
  }

  function close() {
    const from = state.open;
    const adding = state.adding;
    clearCredentials();
    modelLoads++; state.open = null; state.adding = false; state.kindQuery = ""; state.role = ""; redraw();
    const opener = [...host.root.querySelectorAll<HTMLElement>('[data-pv="open"], [data-pv="add"]')]
      .find(el => el.dataset.id === (el.dataset.pv === "open" ? from?.id : from?.kind));
    ((adding ? host.root.querySelector<HTMLElement>('[data-pv="directory"]') : null) ??
      opener ?? host.root.querySelector<HTMLElement>('[data-pv="directory"]'))?.focus();
  }

  function directory(role = state.role ?? "") {
    const from = state.open?.kind;
    clearCredentials();
    modelLoads++;
    state = { ...state, adding: true, open: null, error: null, result: null, models: [], fieldValues: {}, dirty: false, role };
    redraw(false);
    const previous = [...host.root.querySelectorAll<HTMLElement>('[data-pv="add"]')].find((el) => el.dataset.id === from);
    (previous ?? host.root.querySelector<HTMLElement>("#pv-kind-search"))?.focus();
  }

  function showSettings(): void {
    if (state.open?.view !== "models") return;
    state.open.view = "settings";
    redraw(false);
    host.root.querySelector<HTMLElement>('[data-pv="back"]')?.focus();
  }

  function showModels(): void {
    if (!state.open) return;
    clearCredentials();
    state.open.view = "models";
    state.open.replacing = false;
    state.error = null; state.formResult = undefined; state.dirty = false; state.fieldValues = {};
    redraw(false); focusModels();
  }

  function back(): boolean {
    if (state.busy) return true;
    if (state.open?.view === "settings") {
      rememberLayerBack(showModels, showSettings);
      return true;
    }
    if (state.open?.view !== "setup" || !state.adding) return false;
    const panel = host.root.querySelector("#pv-dialog")!;
    if (keepEditedField(panel, ".pv-field input, .pv-field textarea") || state.dirty) return true;
    const key = navView();
    rememberLayerBack(() => directory(), () => showNavView(key));
    return true;
  }
  async function remove() {
    const open = state.open;
    const id = open?.id;
    if (!id || state.busy || open.view !== "settings") return;
    const name = providerOf(state)?.name ?? kindOf(state)?.name ?? "";
    // The red dialog asks (R-UI-56); the provider is removed only by its red button.
    if (!(await confirmDelete(name, { words: { title: t("confirm.deleteTitle", { p0: name }), hint: t("providers.removeHint"), action: t("members.delete") }, quiet: true }))) return;
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
  async function refreshModels(id: string) {
    const mine = ++modelLoads;
    try {
      const { models } = await api.providersModels(id);
      if (mine === modelLoads && state.open?.id === id) { state.models = models; redraw(); }
    } catch { /* Keep the current result if a refresh fails. */ }
  }

  async function testSaved(id: string) {
    const open = state.open;
    let result: ProviderTest;
    try {
      result = await api.providersTest({ id });
      if (state.open !== open) return;
      if (result.ok) {
        const { models } = await api.providersModels(id);
        if (state.open !== open) return;
        state.models = models;
      }
    } catch { result = { ok: false, kind: "error", models: 0 }; }
    if (state.open !== open) return;
    state.result = result; state.testing = false;
    const provider = providerOf(state);
    if (provider) state.providers = state.providers.map(p => p.id === id ? {
      ...p, status: result.ok ? "ok" : result.kind === "auth" || result.kind === "offline" ? result.kind : "unknown",
      models: result.ok ? result.models : p.models,
    } : p);
    redraw();
  }

  async function save() {
    const open = state.open;
    if (!open || open.view === "models" || state.busy) return;
    const patch = syncForm();
    if (!state.canSave) return;
    const params = open.id ? { id: open.id, ...patch } : { kind: open.kind, ...patch };
    state.busy = true; state.error = null; state.formResult = undefined; redraw();
    try {
      const tested = await api.providersTest(params);
      if (state.open !== open) return;
      if (!tested.ok) { state.formResult = tested; return; }
      clearCredentials();
      const saved = "id" in params ? await api.providersUpdate(params) : await api.providersAdd(params);
      if (state.open !== open) return;
      loads++; modelLoads++;
      const provider: ModelProvider = { ...saved.provider, status: "ok", models: tested.models };
      const exists = state.providers.some(p => p.id === provider.id);
      state.providers = exists ? state.providers.map(p => p.id === provider.id ? provider : p) : [...state.providers, provider];
      state.open = { ...open, id: provider.id };
      state.testing = false; state.result = tested; state.models = tested.found ?? []; state.query = "";
      showModels();
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
    if (state.open?.kind !== found[1] || state.open.id !== id) show(found[1], id, state.adding);
  }
  return {
    view: () => state, load,
    openRepair(id: string): void {
      // `connect` opens the directory; `connect:<feature>` opens it for one feature, with only the kinds that can do it.
      if (id === "connect" || id.startsWith("connect:")) { directory(id.slice("connect:".length)); return; }
      const provider = state.providers.find(p => p.id === id);
      if (provider) {
        show(provider.kind, provider.id);
        showSettings();
        (host.root.querySelector<HTMLElement>('[data-pv="replace"]') ?? host.root.querySelector<HTMLElement>('#pv-dialog input, #pv-dialog textarea'))?.focus();
      } else directory();
    },
    click(target: Element): boolean {
      const button = target.closest<HTMLElement>("[data-pv]");
      if (!button) return false;
      if (state.busy || button instanceof HTMLButtonElement && button.disabled) return true;
      if (button.dataset.pv === "directory") directory();
      if (button.dataset.pv === "back") back();
      if (button.dataset.pv === "enable") void enable(button.dataset.id!);
      if (button.dataset.pv === "add") {
        const existing = state.providers.find((p) => p.kind === button.dataset.id);
        if (existing || state.kinds.some((k) => k.kind === button.dataset.id && k.available)) show(button.dataset.id!, existing?.id ?? null, state.adding);
      }
      if (button.dataset.pv === "another" && kindOf(state) && allowsMultiple(kindOf(state)!)) show(state.open!.kind, null, true);
      if (button.dataset.pv === "open") {
        const provider = state.providers.find((p) => p.id === button.dataset.id);
        if (provider) show(provider.kind, provider.id);
      }
      if (button.dataset.pv === "settings") showSettings();
      if (button.dataset.pv === "replace" && state.open) {
        accountDraft = null; accountReads++; state.accountSet = false; state.open.replacing = true; state.formResult = undefined; state.error = null; redraw();
        host.root.querySelector<HTMLElement>('.pv-field input[type="password"], .pv-account textarea')?.focus();
      }
      if (button.dataset.pv === "file") host.root.querySelector<HTMLInputElement>(".pv-file")?.click();
      if (button.dataset.pv === "save" || button.dataset.pv === "connect") void save();
      if (button.dataset.pv === "remove") void remove();
      if (button.dataset.pv === "retry") void load();
      if (button.dataset.pv === "docs") {
        const url = kindOf(state)?.docs_url;
        const open = state.open;
        if (url) void api.openLink(url).catch(() => { if (state.open === open) { state.error = "error"; redraw(); } });
      }
      if (button.dataset.pv === "field") {
        const field = button.dataset.pvField as "region" | "location";
        openMenu(button, editorChoices(field, !!state.open?.id), button.dataset.value ?? "", (value) => {
          state.fieldValues = { ...state.fieldValues, [field]: value };
          state.formResult = undefined; state.error = null; redraw();
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
          state.accountSet = true; state.error = null; state.formResult = undefined; redraw(); return;
        }
        state.formResult = undefined; state.error = null;
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
        accountDraft = value.trim(); state.accountSet = true; state.formResult = undefined; state.error = null;
      } catch {
        if (state.open !== open || mine !== accountReads) return;
        accountDraft = null; state.accountSet = false; state.error = "account";
      }
      redraw();
    },
    followEvent(event: MainEvent): void {
      if (event.type !== "ProvidersChanged" || !host.visible() || state.busy) return;
      const open = state.open;
      void load().then(() => {
        if (open?.id && state.open === open && open.view !== "setup" && !state.testing && !state.busy) void refreshModels(open.id);
      });
    },
    key(event: KeyboardEvent): boolean {
      if (!state.open && !state.adding) return false;
      const panel = host.root.querySelector<HTMLElement>("#pv-dialog");
      if (event.key === "Escape" && panel && !isTopLayer(panel)) return false;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!state.busy) {
          if (state.open?.view === "settings") back();
          else close();
        }
        return true;
      }
      if (event.key === "Enter" && !event.isComposing && event.target instanceof HTMLInputElement && event.target.closest(".pv-field")) {
        event.preventDefault(); void save(); return true;
      }
      return false;
    },
    navView, showNavView,
    reset(): void {
      stopOutside?.(); stopOutside = null;
      clearCredentials();
      loads++; modelLoads++; state.open = null; state.adding = false; state.kindQuery = ""; state.error = null; state.result = null;
    },
  };
}
