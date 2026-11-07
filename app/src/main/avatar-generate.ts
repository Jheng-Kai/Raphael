// The face picker's 生成 tab (owner, 2026-11-07 night, as Grok Bot's picker): a few words, one press, one picture from
// the image model the owner chose, then 使用 or another try. One picture per press and nothing behind the owner's back:
// the core never retries or switches model, and the window only says what happened and where it is fixed.
import * as api from "./api";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import type { WireAttachment } from "./types";
import { btn, esc } from "./ui";

/** What the core said went wrong, read from the window's error text (`window_error` in commands.rs). */
export interface GenerateFailure {
  kind: string;
  /** The Settings pane that fixes it and what in it (missing.ts's `data-missing-repair` route), when there is one. */
  repair: string | null;
  resource: string;
}

/** The kind and fix after a failed `members.avatar_generate`; anything else is an unknown failure. */
export function generateFailure(error: unknown): GenerateFailure {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const json = text.slice(text.indexOf("{"));
  try {
    const data = JSON.parse(json) as { kind?: unknown; repair?: unknown; resource?: unknown };
    const kind = typeof data.kind === "string" ? data.kind : "unknown";
    if (kind === "image_model_missing") return { kind, repair: "models", resource: "image" };
    return { kind, repair: typeof data.repair === "string" ? data.repair : null, resource: typeof data.resource === "string" ? data.resource : "app" };
  } catch {
    return { kind: /^\[1003\]/.test(text) ? "busy" : "unknown", repair: null, resource: "app" };
  }
}

/** The button that opens the place a failure is fixed (missing.ts navigates it from anywhere in the window). */
const fixButton = (label: string, repair: string, resource: string): string =>
  btn(esc(label), "sm", ` data-avg="fix" data-missing-repair="${esc(repair)}" data-missing-resource="${esc(resource)}"`);

const WORDS: Record<string, Extract<MessageKey, `avatarGen.${string}`>> = {
  image_model_missing: "avatarGen.noModel",
  missing_secret: "avatarGen.needsKey", auth_expired: "avatarGen.needsSignIn", auth: "avatarGen.needsSignIn",
  content_policy: "avatarGen.refused", credits: "avatarGen.credits", rate_limit: "avatarGen.busyProvider",
  network: "avatarGen.offline", timeout: "avatarGen.offline", busy: "avatarGen.inFlight",
  unsupported_type: "avatarGen.badPicture", too_large: "avatarGen.badPicture", bad_response: "avatarGen.badPicture",
};
export const failureWords = (failure: GenerateFailure): string => t(WORDS[failure.kind] ?? "avatarGen.failed");

export type GenerateState =
  | { step: "checking" }
  | { step: "off" }
  | { step: "ready"; failure?: GenerateFailure }
  | { step: "busy" }
  | { step: "candidate"; candidate: WireAttachment };

const pictureURL = (file: WireAttachment): string => `data:${file.mime};base64,${file.data}`;

/** The tab's body for `state`; `face` is the member's face as it is now (shown until a candidate stands there). */
export function generateHTML(state: GenerateState, face: string, prompt = ""): string {
  if (state.step === "checking") return `<div class="avg avg-wait"><span class="spin" role="status" aria-label="${esc(t("conn.loading"))}"></span></div>`;
  // Off by default: the owner has chosen no image model. Say so and open the very row that chooses one.
  if (state.step === "off")
    return `<div class="avg avg-off"><p class="avg-note">${esc(t("avatarGen.off"))}</p>${fixButton(t("avatarGen.chooseModel"), "models", "image")}</div>`;
  const busy = state.step === "busy";
  const preview = state.step === "candidate"
    ? `<span class="av avg-candidate" style="--av:88px" aria-hidden="true"><img src="${esc(pictureURL(state.candidate))}" alt="" draggable="false"></span>`
    : face;
  const failure = state.step === "ready" && state.failure ? state.failure : null;
  const note = failure ? `<p class="avg-note is-failure" role="alert">${esc(failureWords(failure))}` +
    (failure.repair ? fixButton(t("avatarGen.fix"), failure.repair, failure.resource) : "") + `</p>` : "";
  const go = btn((busy ? `<span class="spin" aria-hidden="true"></span>` : "") + esc(t(state.step === "candidate" ? "avatarGen.again" : "avatarGen.go")),
    `sm${state.step === "candidate" ? "" : " pri"}`, ` data-avg="go"${busy ? ' disabled aria-busy="true"' : ""}`);
  const use = state.step === "candidate" ? btn(esc(t("avatarGen.use")), "sm pri", ' data-avg="use"') : "";
  return `<div class="avg"><div class="avg-preview">${preview}</div>` +
    `<input class="field avg-prompt" data-avg="prompt" maxlength="400" placeholder="${esc(t("avatarGen.placeholder"))}" aria-label="${esc(t("avatarGen.placeholder"))}" value="${esc(prompt)}"${busy ? " disabled" : ""}>` +
    note + `<div class="avg-actions">${go}${use}</div></div>`;
}

export interface GenerateOptions {
  memberId: number;
  /** The member's face as it is now. */
  face: string;
  /** Saves the chosen picture as the member's (`members.set_avatar`). */
  apply(file: WireAttachment): Promise<void>;
  /** Settings is opening at a place that fixes a failure (missing.ts navigates): close what stands in front. */
  leave(): void;
  /** The tab's body changed size. */
  resized(): void;
  /** The picture was used: the picker closes. */
  done(): void;
}

/** Runs the tab inside `pane`: reads whether an image model is chosen, then draws and answers its presses. */
export function mountGenerate(pane: HTMLElement, o: GenerateOptions): { focus(): void } {
  let state: GenerateState = { step: "checking" };
  let prompt = "";
  const draw = (): void => {
    pane.innerHTML = generateHTML(state, o.face, prompt);
    o.resized();
  };
  const focus = (): void => { pane.querySelector<HTMLElement>('[data-avg="prompt"]:not(:disabled), [data-avg="fix"]')?.focus(); };
  const generate = async (): Promise<void> => {
    if (state.step === "busy") return;
    state = { step: "busy" };
    draw();
    try {
      const { candidate } = await api.membersAvatarGenerate(o.memberId, prompt.trim() || t("avatarGen.defaultPrompt"));
      state = { step: "candidate", candidate };
    } catch (error) {
      const failure = generateFailure(error);
      state = failure.kind === "image_model_missing" ? { step: "off" } : { step: "ready", failure };
    }
    if (!pane.isConnected) return;
    draw();
    focus();
  };
  pane.addEventListener("input", (e) => {
    const field = (e.target as HTMLElement).closest<HTMLInputElement>('[data-avg="prompt"]');
    if (field) prompt = field.value;
  });
  pane.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && (e.target as HTMLElement).matches('[data-avg="prompt"]')) { e.preventDefault(); void generate(); }
  });
  pane.addEventListener("click", (e) => {
    const target = (e.target as Element).closest<HTMLElement>("[data-avg]");
    if (!target || (target as HTMLButtonElement).disabled) return;
    const what = target.dataset.avg;
    if (what === "go") void generate();
    else if (what === "fix") o.leave();
    else if (what === "use" && state.step === "candidate") {
      const file = state.candidate;
      void o.apply(file).then(o.done, () => { state = { step: "ready", failure: { kind: "unknown", repair: null, resource: "app" } }; draw(); });
    }
  });
  draw();
  void api.settingsGet().then(({ settings }) => {
    state = settings.image_model ? { step: "ready" } : { step: "off" };
  }, () => { state = { step: "ready" }; }).then(() => { if (pane.isConnected) { draw(); focus(); } });
  return { focus };
}
