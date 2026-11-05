import * as api from "./api";
import { cardHTML } from "./card";
import { avatarHTML } from "./avatar";
import { getLocale, onLocaleChange, t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { missingHTML } from "./missing";
import { defaultSlimeAvatar, parseSlime, slimeSVG } from "./slime";
import { btn, closeMenu, esc, ico, openMenu, openPopover, patchHTML, row, sel, type Choice } from "./ui";
import type { AgentTurn } from "./types";
import "./voice-chat.css";

export interface CallTranscript { id: number; question: string; text: string; status: string }
export interface VoiceCall {
  id: string;
  member_id: number;
  conversation_id: number;
  started_at_ms: number;
  ended_at_ms?: number;
  summary_id?: number;
  state: "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended";
  muted: boolean;
  name: string;
  avatar: string | null;
  voice: string;
  member_voice?: string;
  speed: number;
  language: string;
  failure?: string | null;
  rating?: "good" | "bad" | null;
  transcript: CallTranscript[];
}

const duration = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const transcriptHTML = (turns: CallTranscript[], name: string): string => turns.map(turn =>
  `<div class="vc-turn" data-call-turn="${turn.id}"><p><b>${esc(t("chat.you"))}</b><span class="message-text">${esc(turn.question)}</span></p>` +
  (turn.text ? `<p><b>${esc(name)}</b><span class="message-text">${esc(turn.text)}</span></p>` : "") + `</div>`).join("");

export function voiceCallCardHTML(call: VoiceCall, name: string): string {
  const length = duration(Math.max(0, (call.ended_at_ms ?? call.started_at_ms) - call.started_at_ms));
  return `<li class="tn vc-receipt" data-id="${call.summary_id ?? ""}" data-call-card="${esc(call.id)}">` + cardHTML({
    title: t("call.title"), status: "done", statusText: t("call.ended"), mark: ico("voice"), cls: "vc-card",
    content: `<details><summary><span>${esc(t("call.transcript"))}</span><time>${length}</time>${ico("down")}</summary>` +
      `<div class="vc-transcript">${transcriptHTML(call.transcript, name) || `<p>${esc(t("call.empty"))}</p>`}</div></details>` +
      (call.failure ? failureNoticeHTML(call.failure) : ""),
    actions: `<div class="vc-rating"><span>${esc(t("call.feedback"))}</span>` +
      btn(esc(t("call.good")), "sm", ` data-call-rating="good" aria-pressed="${call.rating === "good"}"`) +
      btn(esc(t("call.bad")), "sm", ` data-call-rating="bad" aria-pressed="${call.rating === "bad"}"`) + `</div>`,
  }) + `</li>`;
}

export function foldCallTurns(turns: readonly AgentTurn[]): AgentTurn[] {
  // Owner decisions stay actionable through the ordinary renderer until they settle.
  return turns.filter(turn => !turn.voice_call_id || turn.status === "confirm" ||
    turn.owner_questions?.some(card => card.state === "asked") ||
    turn.permissions?.some(card => card.state === "pending") ||
    turn.connectors?.some(card => ["pending", "authorizing", "failed"].includes(card.state)) ||
    turn.secrets?.some(card => ["pending", "failed", "saved", "resuming"].includes(card.state)) ||
    turn.computers?.some(card => ["control", "returning", "failed"].includes(card.state)) ||
    turn.connection_proposals?.some(card => !["enabled", "cancelled"].includes(card.state)) ||
    turn.drafts?.some(card => card.mode === "card" && !["sent", "discarded"].includes(card.state)));
}

function failureText(kind: string): string {
  return t(kind === "microphone" ? "call.noMic" : kind === "model" ? "call.noModel" : kind === "voice" ? "call.noVoice" :
    kind === "busy" ? "call.micBusy" : kind === "interrupted" ? "call.interrupted" : "call.network");
}

function failureNoticeHTML(kind: string): string {
  const repair = kind === "voice" ? "voice" : ["microphone", "model", "busy"].includes(kind) ? "dictation" : null;
  return missingHTML({resource: repair === "voice" ? "fish" : "dictation", requirement: "setup", state: "missing", repair}, failureText(kind));
}

export function mountVoiceChat(options: {
  composer: HTMLFormElement;
  button: HTMLButtonElement;
  target(): { member: number; conversation?: number; name: string };
  eligible(): boolean;
  changed(): void;
  refresh(): void;
  root: HTMLElement;
}) {
  const panel = document.createElement("section");
  panel.className = "voice-call";
  panel.hidden = true;
  panel.setAttribute("aria-label", t("call.title"));
  const failure = document.createElement("div");
  failure.className = "vc-failure";
  failure.hidden = true;
  let current: VoiceCall | null = null, transcript = false, pending = false, pollBusy = false;
  let settings: HTMLElement | null = null;
  let knownEnd = "", disposed = false, revision = 0, lostCall: string | null = null;
  const showFailure = (kind: string): void => {
    failure.hidden = false;
    failure.innerHTML = failureNoticeHTML(kind);
  };
  const draw = (): void => {
    const target = options.target();
    const here = current && current.member_id === target.member && current.conversation_id === target.conversation;
    if (options.composer.parentElement) {
      options.composer.after(panel);
      options.composer.before(failure);
    }
    panel.hidden = !here;
    options.root.classList.toggle("has-member-call", !!here);
    options.composer.classList.toggle("has-voice-call", !!here);
    const offered = options.button.dataset.voiceCallStart === "true", eligible = options.eligible();
    options.button.dataset.voiceCallStart = String(eligible);
    if (eligible) {
      patchHTML(options.button, ico("voice"));
      options.button.setAttribute("aria-label", t("call.start"));
      options.button.dataset.tooltip = t("call.start");
    } else if (offered && options.composer.dataset.taskState === "idle") {
      patchHTML(options.button, avatarHTML({size:32,avatar:null}));
      options.button.setAttribute("aria-label", t("agent.voice"));
      options.button.dataset.tooltip = t("agent.voice");
    }
    if (!here || !current) return;
    const call = current;
    const state = call.muted ? "muted" : call.state;
    const label = t(state === "connecting" ? "call.connecting" : state === "thinking" ? "call.thinking" : state === "speaking" ? "call.speaking" : state === "muted" ? "call.muted" : "call.listening");
    const slime = parseSlime(call.avatar) ?? parseSlime(defaultSlimeAvatar(call.member_id))!;
    const face = slimeSVG(slime, { state: state === "speaking" ? "working" : state === "thinking" ? "thinking" : state === "muted" ? "idle" : "waiting" });
    patchHTML(panel, `<div class="vc-main" data-call-state="${esc(state)}"><span class="vc-face">${face}</span>` +
      `<div class="vc-identity"><b>${esc(call.name)}</b><span role="status">${esc(label)}</span></div>` +
      `<div class="vc-actions">${btn(`${ico(call.muted ? "voice" : "pause")}<span>${esc(t(call.muted ? "call.unmute" : "call.mute"))}</span>`, "sm", ` data-call-act="mute" aria-pressed="${call.muted}"`)}${btn(esc(t("call.hangUp")), "sm danger", ' data-call-act="end"')}</div></div>` +
      `<div class="vc-tools">${btn(esc(t(transcript ? "call.hideTranscript" : "call.transcript")), "sm", ` data-call-act="transcript" aria-expanded="${transcript}"`)}${btn(`${ico("gear")}<span>${esc(t("call.settings"))}</span>`, "sm", ' data-call-act="settings" aria-haspopup="dialog"')}</div>` +
      (transcript ? `<div class="vc-transcript">${transcriptHTML(call.transcript, call.name) || `<p>${esc(t("call.empty"))}</p>`}</div>` : ""));
  };
  const apply = (call: VoiceCall | null): void => {
    const was = current;
    current = call;
    if (was && !call) { closeMenu(); settings = null; options.refresh(); }
    draw(); options.changed();
  };
  const poll = async (): Promise<void> => {
    if (pollBusy || pending || disposed) return;
    pollBusy = true;
    const mine = revision;
    try {
      if (lostCall) { await api.voiceCallEnd(lostCall); lostCall = null; }
      const result = await api.voiceCallStatus();
      if (disposed || mine !== revision) return;
      if (result.ended && knownEnd !== result.ended.id) {
        knownEnd = result.ended.id;
        if (result.ended.failure && !result.ended.summary_id) showFailure(result.ended.failure);
        else failure.hidden = true;
        options.refresh();
      }
      if (JSON.stringify(result.call) !== JSON.stringify(current)) apply(result.call);
    } catch {
      if (current) { lostCall = current.id; showFailure("network"); apply(null); }
    } finally { pollBusy = false; }
  };
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (pending) return;
    revision++;
    pending = true;
    try { await work(); }
    catch { if (current) { lostCall = current.id; apply(null); } showFailure("network"); }
    finally { pending = false; draw(); }
  };
  const begin = async (): Promise<void> => {
    const target = options.target();
    if (!options.eligible() || target.conversation === undefined) return;
    failure.hidden = true;
    const result = await api.voiceCallStart(target.member, target.conversation, getLocale());
    if (result.failure) return showFailure(result.failure);
    if (result.busy) {
      apply(result.busy);
      openDialog({ title: t("call.endCurrent"), body: `<p>${esc(result.busy.name)}</p>`, cls: "mb-confirm vc-confirm",
        actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("call.endAndStart")), attrs: ' data-dlg="replace"' } },
        onAct(action, button, dialog) {
          if (action !== "replace") return dialog.close();
          button.setAttribute("disabled", "");
          void run(async () => {
            await api.voiceCallEnd(result.busy!.id);
            dialog.close();
            // Revalidate the captured destination; navigation never redirects a call.
            const next = await api.voiceCallStart(target.member, target.conversation!, getLocale());
            if (next.failure) showFailure(next.failure);
            if (next.call) apply(next.call);
            options.refresh();
          });
        },
      });
    } else if (result.call) apply(result.call);
  };
  const choices = (key: string): Choice[] => key === "voice" ? [
    { value: current?.member_voice ?? current?.voice ?? "", label: t("call.memberVoice") },
    ...((current?.member_voice ?? current?.voice) ? [{ value: "", label: t("members.profile.defaultVoice") }] : []),
  ] : key === "speed" ? [0.75, 1, 1.25, 1.5].map(value => ({ value: String(value), label: `${value}×` })) :
    [{ value: "auto", label: t("call.auto") }, { value: "zh", label: t("call.chinese") }, { value: "en", label: t("call.english") }, { value: "ja", label: t("call.japanese") }];
  const settingsHTML = (): string => ["voice", "speed", "language"].map(key => {
    const label = t(key === "voice" ? "call.voice" : key === "speed" ? "call.speed" : "call.language");
    const value = key === "voice" ? current!.voice : key === "speed" ? String(current!.speed) : current!.language;
    return row(esc(label), "", sel(choices(key), value, label, ` data-call-setting="${key}"`));
  }).join("");
  panel.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-call-act]");
    if (!button || !current) return;
    const call = current;
    switch (button.dataset.callAct) {
      case "mute": void run(async () => apply((await api.voiceCallMute(call.id, !call.muted)).call)); break;
      case "end": void run(async () => { await api.voiceCallEnd(call.id); apply(null); options.refresh(); }); break;
      case "transcript": transcript = !transcript; draw(); break;
      case "settings":
        if (settings?.isConnected) { closeMenu(); settings = null; break; }
        settings = openPopover(button, `<div class="vc-settings">${settingsHTML()}</div>`, { className: "menu", role: "dialog", label: t("call.settings"), placement: "above", onClose: () => { settings = null; } });
        settings.addEventListener("click", picked => {
          const select = (picked.target as Element).closest<HTMLElement>("[data-call-setting]");
          if (!select || !current) return;
          const key = select.dataset.callSetting!;
          const value = key === "voice" ? current.voice : key === "speed" ? String(current.speed) : current.language;
          openMenu(select, choices(key), value, next => void run(async () => {
            const changed = { [key]: key === "speed" ? Number(next) : next };
            apply((await api.voiceCallSettings(call.id, changed)).call);
          }));
        });
        break;
    }
  });
  options.root.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-call-rating]");
    const card = button?.closest<HTMLElement>("[data-call-card]");
    if (!button || !card) return;
    void run(async () => {
      await api.voiceCallFeedback(card.dataset.callCard!, button.dataset.callRating as "good" | "bad");
      options.refresh();
    });
  });
  options.button.addEventListener("click", () => { if (options.eligible()) void run(begin); });
  const timer = setInterval(() => { if (current || lostCall) void poll(); }, 500);
  window.addEventListener("pagehide", () => { disposed = true; clearInterval(timer); });
  onLocaleChange(draw);
  void poll().then(draw);
  return { draw, active: () => current, panel };
}
