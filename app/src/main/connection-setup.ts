// The small window that asks for what an app of the store needs before it can be added: the owner's own API
// key, or the id and secret of a developer app of their own (`connectors.toolkit` says which, field by field,
// and where the owner finds it). Store setup uses a window; conversation setup stays in its originating card.
//
// What is typed goes to the core in one call (`hooks.connect`) and to nothing else: the secret fields are
// emptied the moment they are read, a value is never kept in a variable of this file past that call, and the
// window says in a plain line that Composio keeps it. Every word of what is needed comes from the core.

import "./connection-setup.css";
import { cardDisclosureHTML, cardFailure } from "./card";
import * as api from "./api";
import { getLocale, t } from "./i18n";
import { type Dialog, openDialog } from "./member-dialogs";
import type { ToolkitPlan } from "./plugins-data";
import type { AppNeeds } from "./types";
import { btn, copyButton, copyLabel, esc, ico, st, toaster } from "./ui";

export interface SetupTarget {
  /** The Composio toolkit's slug. */
  slug: string;
  name: string;
  needs: Exclude<AppNeeds, "sign_in">;
}

export interface SetupHooks {
  /** Hands the form's values to the core; resolves with how it went (`error` is the core's word for what failed). */
  connect(fields: Record<string, string>): Promise<{ connected: boolean; error?: string }>;
  /** The Composio key is missing or was refused: opens the place to add it. */
  composioKey?(): void;
}

/** Move an already loaded inline form before its old reply is removed. Its secrets stay in its own fields. */
export function carryInlineSetup(before: Element, after: Element): () => void {
  const pairs = [...before.querySelectorAll<HTMLElement>("[data-inline-setup]")].flatMap(old => {
    const fresh = [...after.querySelectorAll<HTMLElement>("[data-inline-setup]")].find(slot => slot.dataset.inlineSetup === old.dataset.inlineSetup &&
      slot.dataset.toolkit === old.dataset.toolkit && slot.dataset.needs === old.dataset.needs);
    return fresh && old.querySelector("[data-setup-field]") ? [{old, fresh}] : [];
  });
  return () => { for (const {old, fresh} of pairs) {
    const parent = fresh.parentElement!;
    if (parent.moveBefore && old.isConnected) parent.moveBefore(old, fresh); else parent.insertBefore(old, fresh);
    fresh.remove();
    const trigger = parent.querySelector<HTMLElement>('[data-act="card-setup"]'); if (trigger) trigger.hidden = true;
  } };
}

/** Conversation credentials use the catalog's existing fields inside their originating card. */
export function mountInlineConnectionSetup(thread: HTMLElement,
  connect: (id: string, fields: Record<string, string>) => Promise<{ connected: boolean; error?: string }>): { disconnect(): void } {
  const loaded = new WeakSet<Element>();
  const plans = new WeakMap<Element, ToolkitPlan>();
  let active = true;
  const act = (slot: HTMLElement, action: () => Promise<unknown>): void => {
    void Promise.resolve(action()).catch(() => cardFailure(slot.closest(".conversation-card"), () => act(slot, action)));
  };
  const load = async (slot: HTMLElement): Promise<void> => {
    if (loaded.has(slot)) return;
    loaded.add(slot);
    try {
      const plan = await api.connectorsToolkit(slot.dataset.toolkit ?? "");
      if (!active || !slot.isConnected) return;
      plans.set(slot, plan);
      // The form arrives after the card: a reader at the latest line stays there, so the card's foot never hides under the composer.
      const scroller = slot.closest<HTMLElement>(".ra-scroll");
      const pinned = !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 80;
      slot.classList.add("inline-connection-setup");
      slot.innerHTML = fieldsHTML(plan) + `<div class="card-actions">${btn(esc(t("card.keySave")), "sm pri", " data-inline-submit")}</div>` +
        `<p class="card-shield">${ico("lock")}<span>${esc(t(plan.needs === "own_app" ? "setup.keepApp" : "setup.keepKey"))}</span></p>` +
        cardDisclosureHTML(`setup-${slot.dataset.inlineSetup}`, whereHTML(plan, true) + stepsHTML(plan, true) + redirectHTML(plan), t("setup.where"));
      const old = slot.closest("[data-connector]")?.querySelector<HTMLElement>('[data-act="card-setup"]');
      if (old) old.hidden = true;
      if (pinned) scroller.scrollTop = scroller.scrollHeight;
    } catch {
      if (active && slot.isConnected) cardFailure(slot.closest(".conversation-card"), () => { loaded.delete(slot); void load(slot); });
    }
  };
  const guide = async (slot: HTMLElement): Promise<void> => {
    if (loaded.has(slot)) return;
    loaded.add(slot);
    const name = slot.dataset.secretGuide ?? "";
    try {
      const direct = /^https:\/\//.test(name) ? name : undefined;
      const plan = direct ? undefined : await api.connectorsToolkit(name.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
      if (!active || !slot.isConnected) return;
      const url = direct ?? plan?.guide_url ?? plan?.app_url;
      if (url && /^https:\/\//.test(url)) {
        slot.innerHTML = btn(`${ico("external")}${esc(t("setup.guideOpen", { p0: plan?.name ?? name }))}`, "sm", " data-secret-guide-open");
        slot.querySelector("button")!.addEventListener("click", () => act(slot, () => api.openExternalUrl(url)));
      }
    } catch { /* Some private connections have no catalog entry; their declared field remains visible. */ }
  };
  const scan = (): void => {
    for (const slot of thread.querySelectorAll<HTMLElement>("[data-inline-setup]")) void load(slot);
    for (const slot of thread.querySelectorAll<HTMLElement>("[data-secret-guide]")) void guide(slot);
  };
  const clicked = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-inline-submit],[data-dlg]");
    const slot = button?.closest<HTMLElement>("[data-inline-setup]");
    const plan = slot && plans.get(slot);
    if (!button || !slot || !plan || button.disabled) return;
    if (!button.hasAttribute("data-inline-submit")) {
      const url = button.dataset.dlg === "guide" ? plan.guide_url : button.dataset.dlg === "home" ? plan.app_url : null;
      if (url && /^https:\/\//.test(url)) act(slot, () => api.openExternalUrl(url));
      if (button.dataset.dlg === "copy" && plan.redirect_url) act(slot, () => copyButton(button, plan.redirect_url!));
      return;
    }
    const inputs = [...slot.querySelectorAll<HTMLInputElement>("[data-setup-field]")];
    const missing = inputs.find(input => plan.fields.find(field => field.name === input.dataset.setupField)?.required && !input.value.trim());
    if (missing) { missing.focus(); return; }
    const values = Object.fromEntries(inputs.map(input => [input.dataset.setupField!, input.value]));
    inputs.forEach(input => { if (input.type === "password") input.value = ""; input.disabled = true; });
    button.disabled = true;
    void connect(slot.dataset.inlineSetup!, values).then(result => {
      if (!result.connected) throw new Error("Connection incomplete");
    }).catch(() => {
      inputs.forEach(input => { input.disabled = false; }); button.disabled = false;
      cardFailure(slot.closest(".conversation-card"), () => { inputs.find(input => input.type === "password")?.focus(); });
    });
  };
  thread.addEventListener("click", clicked);
  const observer = new MutationObserver(scan); observer.observe(thread, { childList: true, subtree: true }); scan();
  return { disconnect() { active = false; observer.disconnect(); thread.removeEventListener("click", clicked); } };
}

/** The words of the one plain line under a form that failed, by what the core called the failure. */
function failureText(name: string, kind: string): string {
  switch (kind) {
    case "needs_key":
    case "needs_own_app": return t("setup.errMissing");
    case "key_rejected": return t("setup.errKey", { p0: name });
    case "missing_key":
    case "auth": return t("setup.errComposio");
    case "busy": return t("card.busy");
    case "denied": return t("conn.loginFail.denied");
    case "timeout": return t("conn.loginFail.timeout");
    default: return t("plugins.connectFailed");
  }
}

const linkRow = (label: string, act: string): string =>
  `<p class="cn-link">${btn(`${ico("external")}${esc(label)}`, "sm", ` data-dlg="${act}"`)}</p>`;

/** Where the owner gets what is asked: the guide the catalog gives, else the service's own page, else a plain "look it up". */
function whereHTML(plan: ToolkitPlan, inline = false): string {
  const name = plan.name;
  const body = plan.guide_url ? linkRow(t("setup.guideOpen", { p0: name }), "guide")
    : plan.app_url ? `<p>${esc(t("setup.noGuide", { p0: name }))}</p>${linkRow(t("setup.homeOpen", { p0: name }), "home")}`
    : `<p>${esc(t("setup.noLink", { p0: name }))}</p>`;
  return `<section class="cn-where">${inline ? "" : `<h3>${esc(t("setup.where"))}</h3>`}${body}</section>`;
}

function stepsHTML(plan: ToolkitPlan, inline = false): string {
  const labels = plan.fields.filter(field => field.required).map(field => field.label).join(", ");
  const steps = plan.needs === "own_app"
    ? [t("setup.appStep1", { p0: plan.name }), t("setup.appStep2"), t(inline ? "setup.appStepInline" : "setup.appStep3", { p0: labels })]
    : [t("setup.keyStep1", { p0: plan.name }), t("setup.keyStep2", { p0: labels }), t(inline ? "setup.keyStepInline" : "setup.keyStep3")];
  return `<ol class="cn-steps">${steps.map(step => `<li>${esc(step)}</li>`).join("")}</ol>`;
}

const redirectHTML = (plan: ToolkitPlan): string => plan.needs === "own_app" && plan.redirect_url
  ? `<div class="cn-redirect"><span class="cn-label">${esc(t("setup.redirect"))}</span>` +
    // A read-only field: the address is selected whole with one click and copied with the button beside it.
    `<div class="cn-redirect-row"><input class="field code" readonly spellcheck="false" aria-label="${esc(t("setup.redirect"))}" value="${esc(plan.redirect_url)}" data-setup-redirect>` +
    btn(copyLabel(t("setup.copy"), true), "sm", ' data-dlg="copy"') + `</div></div>` : "";

function fieldsHTML(plan: ToolkitPlan): string {
  // A field's description is the provider's own English: it shows in an English window only (one language, R-UI-14);
  // elsewhere the steps above and the guide say where the value is.
  const hints = getLocale().startsWith("en");
  return `<div class="cn-fields">${plan.fields.map((field, index) =>
    `<label class="cn-field"><span class="cn-label">${esc(field.label)}${field.required ? "" : ` <i>(${esc(t("setup.optional"))})</i>`}</span>` +
    (hints && field.description ? `<span class="cn-hint" title="${esc(field.description)}">${esc(field.description)}</span>` : "") +
    `<input class="field" type="${field.secret ? "password" : "text"}" data-setup-field="${esc(field.name)}"` +
    `${field.default ? ` placeholder="${esc(field.default)}"` : ""} autocomplete="${field.secret ? "new-password" : "off"}"` +
    ` spellcheck="false" autocapitalize="off"${index === 0 ? " data-setup-first" : ""}></label>`).join("")}</div>`;
}

function formHTML(plan: ToolkitPlan): string {
  const own = plan.needs === "own_app";
  return `<div class="cn-setup">` +
    `<p class="cn-lead">${esc(t(own ? "setup.leadOwnApp" : "setup.leadKey", { p0: plan.name }))}</p>` +
    whereHTML(plan) + stepsHTML(plan) + redirectHTML(plan) + fieldsHTML(plan) +
    `<p class="cn-keep">${ico("lock")}<span>${esc(t(own ? "setup.keepApp" : "setup.keepKey"))}</span></p>` +
    `<div data-setup-status aria-live="polite"></div></div>`;
}

/**
 * Opens the window for an app that needs the owner's own key or developer app. Resolves true once `hooks.connect`
 * says it connected (or, for a chat's card, started); false when the owner left without adding it.
 */
export function openConnectionSetup(target: SetupTarget, hooks: SetupHooks): Promise<boolean> {
  return new Promise((resolve) => {
    let plan: ToolkitPlan | null = null;
    let busy = false;
    let done = false;
    const status = (dialog: Dialog): HTMLElement | null => dialog.el.querySelector<HTMLElement>("[data-setup-status]");
    const add = (dialog: Dialog): HTMLButtonElement | null => dialog.el.querySelector<HTMLButtonElement>('[data-dlg="add"]');
    const say = (dialog: Dialog, html: string): void => {
      const slot = status(dialog);
      if (slot) slot.innerHTML = html;
    };
    const note = (kind: "err" | "idle", text: string, action = ""): string => `<div class="note" role="${kind === "err" ? "alert" : "status"}">${st(kind, text)}${action}</div>`;

    const load = async (dialog: Dialog): Promise<void> => {
      const body = dialog.el.querySelector<HTMLElement>(".mb-dlg-body")!;
      body.innerHTML = `<p class="cn-wait" role="status">${esc(t("setup.loading", { p0: target.name }))}</p>`;
      if (add(dialog)) add(dialog)!.disabled = true;
      try {
        plan = await api.connectorsToolkit(target.slug);
      } catch {
        plan = null;
        if (dialog.el.isConnected) body.innerHTML = `<div class="cn-setup"><div class="note" role="alert">${st("err", t("setup.loadFailed", { p0: target.name }))}` +
          `${btn(esc(t("plugins.retry")), "sm", ' data-dlg="retry"')}</div></div>`;
        return;
      }
      if (!dialog.el.isConnected) return;
      body.innerHTML = formHTML(plan);
      if (add(dialog)) add(dialog)!.disabled = false;
      body.querySelector<HTMLInputElement>("[data-setup-first]")?.focus();
    };

    const submit = async (dialog: Dialog): Promise<void> => {
      if (busy || !plan) return;
      const inputs = [...dialog.el.querySelectorAll<HTMLInputElement>("[data-setup-field]")];
      let values: Record<string, string> | null = Object.fromEntries(inputs.map(input => [input.dataset.setupField ?? "", input.value.trim()]));
      const empty = plan.fields.find(field => field.required && !values![field.name]);
      if (empty) {
        values = null;
        say(dialog, note("err", t("setup.errMissing")));
        inputs.find(input => input.dataset.setupField === empty.name)?.focus();
        return;
      }
      // The secrets leave the page the moment they are read; only what is not secret stays for a second try.
      for (const input of inputs) {
        if (input.type === "password") input.value = "";
        input.disabled = true;
      }
      busy = true;
      const own = plan.needs === "own_app";
      if (add(dialog)) { add(dialog)!.disabled = true; add(dialog)!.textContent = t("setup.adding"); }
      say(dialog, note("idle", t(own ? "setup.browser" : "setup.adding")));
      let result: { connected: boolean; error?: string };
      try {
        result = await hooks.connect(values);
      } catch (error) {
        result = { connected: false, error: error instanceof Error ? error.message : "error" };
      }
      values = null;
      busy = false;
      if (result.connected) {
        done = true;
        dialog.close();
        return;
      }
      if (!dialog.el.isConnected) return;
      for (const input of inputs) input.disabled = false;
      if (add(dialog)) { add(dialog)!.disabled = false; add(dialog)!.textContent = t("conn.join"); }
      const kind = result.error ?? "error";
      const composio = (kind === "missing_key" || kind === "auth") && hooks.composioKey;
      say(dialog, note("err", failureText(target.name, kind), composio ? btn(esc(t("plugins.configure")), "sm", ' data-dlg="composio"') : ""));
      inputs.find(input => input.type === "password")?.focus();
    };

    const open = (url: string | null): void => {
      if (url) void api.openExternalUrl(url).catch(() => toaster.info(t("plugins.connectFailed")));
    };

    const dialog = openDialog({
      title: t("setup.title", { p0: target.name }),
      cls: "cn-setup-dialog",
      body: `<p class="cn-wait" role="status">${esc(t("setup.loading", { p0: target.name }))}</p>`,
      actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("conn.join")), attrs: ' data-dlg="add" disabled' } },
      canClose: () => !busy,
      onEnter: (dialog) => { void submit(dialog); },
      onAct(act, _target, dialog) {
        if (act === "add") void submit(dialog);
        else if (act === "guide") open(plan?.guide_url ?? null);
        else if (act === "home") open(plan?.app_url ?? null);
        else if (act === "copy" && plan?.redirect_url) void copyButton(_target, plan.redirect_url);
        else if (act === "retry") void load(dialog);
        else if (act === "composio") { dialog.close(); hooks.composioKey?.(); }
        else if (act === "cancel" && !busy) dialog.close();
      },
      onClose: () => resolve(done),
    });
    // The window opens at once and fills in when the core has said what the app needs.
    void load(dialog);
  });
}
