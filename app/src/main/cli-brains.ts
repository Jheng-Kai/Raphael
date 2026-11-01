// Subscription metadata only; authentication is handled by each CLI's own terminal.
import { knownClis, rememberClis } from "./brain-lists";
import * as api from "./api";
import { getLocale, t } from "./i18n";
import { providerMark } from "./provider-marks";
import { openActions } from "./member-column";
import { openDialog } from "./member-dialogs";
import type { CatalogModel, ChatGptStatus, CliBrain, CliBrainId, MainEvent } from "./types";
import { btn, esc, iconButton } from "./ui";

export const CLIS = [
  { id: "claude", name: "Claude Code", mark: "anthropic", install: "https://code.claude.com/docs/en/setup" },
  { id: "codex", name: "Codex", mark: "openai", install: "https://developers.openai.com/codex/cli/" },
  { id: "gemini", name: "Antigravity", mark: "google", install: "https://antigravity.google/download" },
] as const;
export interface CliBrainsView {
  clis: readonly CliBrain[];
  state: "loading" | "ready" | "failed";
  busy: CliBrainId | null;
  error: boolean;
  chatgpt: ChatGptStatus | null;
  /** What stopped the last sign-in, in the owner's words: empty when nothing did. */
  chatgptError: string;
}
export const emptyCliBrainsView = (): CliBrainsView => ({ clis: [], state: "loading", busy: null, error: false, chatgpt: null, chatgptError: "" });
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** The core's reason for a sign-in that stopped, as something to do about it. Its messages are its own and carry no one's words. */
const SIGN_IN_FAILURES = [
  [/declined/i, "brains.failDeclined"],
  [/timed out/i, "brains.failTimeout"],
  [/could not connect/i, "brains.failNetwork"],
  [/saved/i, "brains.failVault"],
  [/browser/i, "brains.failBrowser"],
  [/identity|registration|token response/i, "brains.failCheck"],
] as const;
export function signInFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/cancel/i.test(text)) return "";
  return t(SIGN_IN_FAILURES.find(([words]) => words.test(text))?.[1] ?? "brains.chatgptFailed");
}
export function cliBrainLine(ref: string): string {
  const cli = CLIS.find((c) => ref === `cli:${c.id}` || ref.startsWith(`cli:${c.id}:`));
  return cli ? `<span class="mb-brain">${providerMark(cli.mark)}<span>${esc(cli.name)} · ${esc(t("brains.subscription"))}</span></span>` : "";
}
export function cliModels(clis: readonly CliBrain[], availableOnly = true): CatalogModel[] {
  return clis.filter((c) => !availableOnly || c.available).flatMap((c) => {
    const models = c.models.filter((m) => m.id !== `cli:${c.id}`).map((m) => ({ ...m, id: m.id.startsWith(`cli:${c.id}:`) ? m.id : `cli:${c.id}:${m.id}` }));
    return models.map((m) => ({
      ...m, provider: m.provider ?? { claude: "Anthropic", codex: "OpenAI", gemini: "Google" }[c.id],
      provider_id: `cli:${c.id}`, provider_name: `${CLIS.find((known) => known.id === c.id)!.name} ${t("brains.subscription")}`,
      input_per_mtok: null, output_per_mtok: null, per_minute: null, free: false, variable_price: false,
      context_length: null, created_at_ms: null, capabilities: {}, input_modalities: ["text"], roles: { answer: { usable: true, reason: null } },
    }));
  });
}
function chatgptCardHTML(v: CliBrainsView): string {
  const account = v.chatgpt;
  const signing = !!account?.signing_in;
  const signedIn = !!account?.signed_in && !signing;
  const status = v.state !== "ready" ? t(v.state === "loading" ? "common.loading" : "missing.cli") :
    signing ? t("brains.chatgptSigning") : !signedIn ? t("brains.signedOut") :
    account?.plan_scope_granted === false ? t("brains.chatgptNoPlan") : [t("brains.usingPlan"), account?.email].filter(Boolean).join(" · ");
  const action = v.state !== "ready" ? "" : signing ?
    btn(esc(t("common.cancel")), "", ' data-chatgpt="cancel" data-k="chatgpt:cancel"') : signedIn && account?.plan_scope_granted !== false ?
    iconButton("more", t("members.more", { p0: "ChatGPT" }), ' data-chatgpt-menu data-k="chatgpt-menu" aria-haspopup="menu" aria-expanded="false"') :
    btn(esc(t("brains.chatgptSignIn")), "", ' data-chatgpt="sign-in" data-k="chatgpt:sign-in"');
  return `<div class="pv-card cli-card" data-chatgpt-card><span class="ic">${providerMark("openai")}</span><span class="tx"><span class="nm">ChatGPT</span><span class="ds">${esc(status)}</span></span>${action}</div>`;
}
export function cliBrainsHTML(v: CliBrainsView): string {
  return `<section class="sgroup cli-accounts"><h2>${esc(t("brains.accounts"))}</h2><div class="pv-grid">` + chatgptCardHTML(v) + CLIS.map((known) => {
    const cli = v.clis.find((c) => c.id === known.id);
    const status = v.state !== "ready" ? t(v.state === "loading" ? "common.loading" : "missing.cli") :
      t(cli?.disconnected ? "brains.disconnected" : !cli?.installed ? "brains.missing" : cli.available ? "brains.ready" : "brains.signedOut");
    const version = cli?.available ? cli.version?.match(/\d+(?:\.\d+)+(?:[-+][\w.-]+)?/)?.[0] : null;
    const label = t(cli?.installed ? "brains.connect" : "brains.install");
    const action = v.state !== "ready" ? "" : cli?.available ?
      iconButton("more", t("members.more", { p0: known.name }), ` data-cli-menu="${known.id}" data-k="cli-menu:${known.id}" aria-haspopup="menu" aria-expanded="false"${v.busy ? " disabled" : ""}`) :
      btn(esc(label), "", ` data-cli="${known.id}" data-k="cli:${known.id}" aria-label="${esc(label + " " + known.name)}"${v.busy ? " disabled" : ""}`);
    return `<div class="pv-card cli-card"><span class="ic">${providerMark(known.mark)}</span><span class="tx"><span class="nm">${esc(known.name)}</span><span class="ds">${esc(status)}${version ? ` · v${esc(version)}` : ""}</span></span>${action}</div>`;
  }).join("") + `</div>${v.error ? `<p class="note" role="alert">${esc(t("missing.cli"))}</p>` : ""}${v.chatgptError ? `<p class="note" role="alert">${esc(v.chatgptError)}</p>` : ""}</section>`;
}

export function createCliBrains(host: { visible(): boolean; redraw(): void }) {
  let value = emptyCliBrainsView();
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  async function load(): Promise<void> {
    const mine = ++generation;
    try {
      const [{ clis }, chatgpt] = await Promise.all([api.brainsCli(), api.chatgptStatus().catch(() => null)]);
      if (mine !== generation) return;
      rememberClis(clis);
      value = { ...value, clis, chatgpt, state: "ready" };
    } catch {
      if (mine !== generation) return;
      value = { ...value, state: "failed" };
    }
    if (host.visible()) host.redraw();
  }
  async function disconnect(id: CliBrainId): Promise<void> {
    if (value.busy) return;
    value = { ...value, busy: id, error: false }; host.redraw();
    try { await api.brainsCliDisconnect(id); await load(); }
    catch { value = { ...value, error: true }; }
    finally { value = { ...value, busy: null }; if (host.visible()) host.redraw(); }
  }
  async function signIn(): Promise<void> {
    value = { ...value, chatgpt: { signed_in: false, ...value.chatgpt, signing_in: true }, chatgptError: "" }; host.redraw();
    try {
      const status = await api.chatgptSignIn(getLocale());
      // The plan's models join the picker as soon as the owner is signed in.
      await api.chatgptModels().catch(() => undefined);
      void api.mainWindowForward().catch(() => undefined);
      if (status?.first_sign_in) welcome();
    } catch (error) {
      void api.mainWindowForward().catch(() => undefined);
      if (value.chatgpt?.signing_in) value = { ...value, chatgptError: signInFailure(error) };
    }
    await load();
  }
  /** OpenAI's own requirement: said once, the first time. */
  function welcome(): void {
    const dialog = openDialog({
      title: t("brains.welcomeTitle"), cls: "mb-confirm",
      body: `<p>${esc(t("brains.welcomeBody"))}</p>`,
      actions: { secondary: btn(esc(t("brains.manageUsage")), "", ' data-dlg="usage"'), primary: { label: esc(t("brains.welcomeDone")), attrs: ' data-dlg="close"' } },
      onAct: (act) => {
        if (act !== "usage") return;
        void api.openExternalUrl(CHATGPT_USAGE_URL).catch(() => undefined);
        dialog.close();
      },
    });
  }
  async function chatgptClick(button: HTMLButtonElement): Promise<void> {
    if (button.dataset.chatgptMenu !== undefined) {
      openActions(button, [{ id: "sign-out", label: t("brains.disconnect"), icon: "plug" }], () => {
        void api.chatgptSignOut().catch(() => undefined).then(load);
      });
    } else if (button.dataset.chatgpt === "cancel") {
      await api.chatgptCancel().catch(() => undefined);
      value = { ...value, chatgpt: value.chatgpt && { ...value.chatgpt, signing_in: false }, chatgptError: "" };
      host.redraw();
    } else if (button.dataset.chatgpt === "sign-in") {
      await signIn();
    }
  }
  return {
    // Before its own first read, what another reader was told: a model is never shown by its bare id for a moment.
    view: () => (value.state === "ready" ? value : { ...value, clis: knownClis() }),
    load,
    start() {
      if (timer) clearInterval(timer);
      void load();
      timer = setInterval(() => { if (host.visible()) void load(); }, 120_000);
    },
    stop() { if (timer) clearInterval(timer); timer = null; generation++; },
    followEvent(event: MainEvent) { if (event.type === "BrainsChanged" && host.visible()) void load(); },
    async click(target: Element): Promise<boolean> {
      const account = target.closest<HTMLButtonElement>("button[data-chatgpt], button[data-chatgpt-menu]");
      if (account) { await chatgptClick(account); return true; }
      const button = target.closest<HTMLButtonElement>("button[data-cli], button[data-cli-menu]");
      const known = CLIS.find((c) => c.id === (button?.dataset.cli ?? button?.dataset.cliMenu));
      if (!known) return false;
      if (value.busy || value.state !== "ready") return true;
      const cli = value.clis.find((c) => c.id === known.id);
      if (button?.dataset.cliMenu) {
        if (cli?.available) openActions(button, [{ id: "disconnect", label: t("brains.disconnect"), icon: "plug" }], () => void disconnect(known.id));
        return true;
      }
      if (cli?.available) return true;
      value = { ...value, busy: known.id, error: false }; host.redraw();
      try {
        if (cli?.installed) { await api.brainsCliLogin(known.id); await load(); }
        else await api.openExternalUrl(known.install);
      } catch { value = { ...value, error: true }; }
      finally { value = { ...value, busy: null }; if (host.visible()) host.redraw(); }
      return true;
    },
  };
}
