import { missingHTML, missingRepairHTML, missingText, type Missing } from "./missing";
import { fileKind, sentFileHTML } from "./attachments";
import { computerCardsHTML, computerResumedLineHTML } from "./computer-card";
import { connectorCardsHTML, resumedLineHTML } from "./connector-card";
import { NAME, eventLineHTML, eventPeopleHTML } from "./event-line";
import { handoffGroupHTML } from "./handoff-line";
import { reactionControlHTML, withReactions } from "./message-metadata";
import { mailCardsHTML, mailHandedLinesHTML } from "./mail-card";
import { pageCardsHTML } from "./page-card";
import { ownerQuestionsHTML, permissionCardsHTML, settledQuestions } from "./permission-card";
import { chatCardsHTML } from "./chat-cards";
import { secretCardsHTML, secretResumedLineHTML } from "./secret-card";
import { mcpProposalsHTML } from "./mcp-proposal";
import { liveAction, pastStep, workActions } from "./work-actions";
// Shared conversation rendering and message controls.
// A turn of the conversation as the 拉斐爾 page shows it: the person's words on the right, with a
// their actions below each bubble; Raphael on the left, with his face and each public message
// in order. Receipts fold into reply detail, questions mount inline, and pending work shares the live work line.
// Raw steps remain available to older detail callers, outside the main conversation flow.
//
// The functions make HTML from plain data; `TimelineState` says what is open and which steps are new,
// so that the page can draw again at any time and only what changed moves. Every word that came from
// the core goes through `esc`.

import { getLocale, t } from "./i18n";
import { composioAction, composioText, isComposioTool } from "./composio-result";
import type { MessageKey } from "./i18n/zh-TW";

import { plainReplies } from "../shared/anime";
import { messageExpandHTML } from "./message-preview";
import { TYPED, VOICE, delegatedTurn, exchangeTurn, hasDetail, highlightHTML, sourceOf } from "./conversation";
import { receivedLineHTML } from "./exchange-line";
import { isBotRename, isSettledDraftTurn, settledDraftHTML } from "./member-draft";
import { fileLinkStamp, messageHTML, replyContentHTML, type KnownFiles } from "./message-content";
import type { MentionTarget } from "./mention-text";
import { quoteHTML } from "./message-quote";
import { ownerEditorHTML, type OwnerEditing } from "./message-edit";
import { formatUsd } from "./format";
import { formatPerMtok } from "./pricing";
import { SERVICE_ICONS, brandStyle, hasLogo, serviceIconOf, serviceIconSVG, serviceLogoHTML } from "./service-icons";
import type { AgentStep, AgentTask, AgentTurn, CliBrainId, MainEvent, MediaPayload, MessageQuote, TurnAttachment } from "./types";
import { btn, esc, ico, iconBtn } from "./ui";

/** The small turning ring of something under way. */
const SPINNER = `<span class="spin" aria-hidden="true"></span>`;

// ---------- words ----------

/** A message of the tables below, none of which takes a value. */
const plain = (key: MessageKey): string => (t as (key: MessageKey) => string)(key);

/** The server the core gives Raphael's own lookups. */
const RAPHAEL = "Raphael";

const BUILTIN_TITLES: Record<string, MessageKey> = {
  weather: "agent.tool.weather",
  web_search: "agent.tool.webSearch",
  local_time: "agent.tool.time",
  find_tools: "agent.tool.findTools",
  ask_member: "agent.tool.askMember",
};
const COMMAND_TITLES: Record<string, MessageKey> = {
  open: "agent.cmd.open",
  volume_up: "agent.cmd.volumeUp",
  volume_down: "agent.cmd.volumeDown",
  volume_mute: "agent.cmd.volumeMute",
  media_play_pause: "agent.cmd.playPause",
  media_next: "agent.cmd.next",
  media_previous: "agent.cmd.previous",
  lock_screen: "agent.cmd.lock",
  copy_text: "agent.cmd.copy",
};
/** The titles of what Raphael did on the owner's PC (a step of kind `computer`, its `tool`). */
const COMPUTER_TITLES: Record<string, MessageKey> = {
  apps: "agent.computer.apps",
  look: "agent.computer.look",
  open: "agent.computer.open",
  focus: "agent.computer.focus",
  click: "agent.computer.click",
  type: "agent.computer.type",
  keys: "agent.computer.keys",
  scroll: "agent.computer.scroll",
};
const REASONS: Record<string, MessageKey> = {
  password: "agent.reason.password",
  handoff: "agent.reason.handoff",
  refused_app: "agent.reason.refused_app",
  interrupted: "agent.reason.interrupted",
  forbidden: "agent.reason.forbidden",
  bad_arguments: "agent.reason.bad_arguments",
  auth_expired: "agent.reason.auth",
  permission_denied: "agent.reason.denied",
  tool_broken: "agent.reason.protocol",
  unknown: "agent.reason.error",
  auth: "agent.reason.auth",
  missing_secret: "agent.reason.missing_secret",
  denied: "agent.reason.denied",
  timeout: "agent.reason.timeout",
  network: "agent.reason.network",
  cli_stopped: "agent.reason.cliStopped",
  not_found: "agent.reason.not_found",
  blocked: "agent.reason.blocked",
  approval_required: "agent.reason.approval_required",
  memory_refused: "agent.reason.memory_refused",
  secret_store: "agent.reason.secret_store",
  url_not_seen: "agent.reason.url_not_seen",
  gone: "agent.reason.gone",
  tool_error: "agent.reason.tool_error",
  protocol: "agent.reason.protocol",
  cancelled: "agent.reason.cancelled",
  not_made: "agent.reason.not_made",
  credits: "agent.reason.credits",
  budget: "agent.reason.budget",
  no_key: "agent.reason.no_key",
  error: "agent.reason.error",
};
/** The states of a task that did not finish: it can be run again. */
const RERUNNABLE: ReadonlySet<string> = new Set(["interrupted", "cancelled", "limit", "failed"]);
const TASK_ENDS: Record<string, MessageKey> = {
  cancelled: "agent.taskCancelled",
  limit: "agent.taskLimit",
  failed: "agent.taskFailed",
  interrupted: "agent.taskInterrupted",
};

/**
 * The words that, first in a tool's name, mean it only looks: `_READ_WORDS` of the core's
 * `integrations/toolsets.py`, which groups the tools of 「連接」 the same way (a test of the core keeps
 * the two lists one).
 */
export const READ_WORDS: ReadonlySet<string> = new Set([
  "get", "list", "search", "find", "read", "fetch", "query", "lookup", "describe", "show",
  "view", "check", "count", "retrieve", "browse", "inspect", "export", "download", "preview",
  "summarize", "who", "whoami", "status", "info", "history", "resolve", "explain", "analyze",
]);
/** A word of a tool's name: split at `_`, `-`, `.` and a change of case, as toolsets.py splits it. */
const WORD = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g;

/**
 * Whether a service's tool only reads or may change something, by its name as toolsets.py guesses
 * when a server says nothing: `read` when its first word is one of `READ_WORDS`, `write` for any
 * other. The service's own name at the start (`notion-search`) is passed over first. A step keeps no
 * more than the tool's name, so this is a guess for its words only: it decides nothing.
 */
export function toolAccess(name: string, service = ""): "read" | "write" {
  let rest = name;
  const prefix = service.trim().toLowerCase();
  if (prefix) {
    for (const sep of ["-", "_", "."]) if (rest.toLowerCase().startsWith(prefix + sep) && rest.length > prefix.length + 1) rest = rest.slice(prefix.length + 1);
  }
  const first = rest.match(WORD)?.[0]?.toLowerCase();
  return first !== undefined && READ_WORDS.has(first) ? "read" : "write";
}

const BUILTIN_READS: ReadonlySet<string> = new Set([...READ_WORDS, "help", "overview"]);
/**
 * Whether one of the app's own tools (the server the core calls "Raphael") only reads, by the words of
 * its name at either end: `session_search` and `self_check` read, `routine_update` changes. A guess for
 * its words alone, like `toolAccess`.
 */
function builtinAccess(name: string): "read" | "write" {
  const words = (name.match(WORD) ?? []).map((word) => word.toLowerCase());
  return words.length > 0 && (BUILTIN_READS.has(words[0]) || BUILTIN_READS.has(words[words.length - 1])) ? "read" : "write";
}

/**
 * What a step did, in the language of the window. Raphael's own lookups and the commands for this PC
 * have words of their own; a service's tool, whose name is the server's and in its language, is
 * 「Notion：讀取」 or 「Notion：修改」 by whether it only reads (`toolAccess`). Its name is the step's
 * tooltip (`stepToolTip`). A tool of the app's own, which every member has as much as Raphael, names
 * nobody: 「修改」 alone, so that a member's turn never looks like Raphael's doing.
 */
export function stepTitle(step: AgentStep): string {
  if (step.kind === "model") return t("agent.stepThinking");
  if (!step.tool) return t("agent.stepUnknown");
  if (step.kind === "command") return plain(COMMAND_TITLES[step.tool] ?? "agent.cmd.other");
  if (step.kind === "computer") return plain(COMPUTER_TITLES[step.tool] ?? "agent.computer.other");
  if (step.server === "media" && step.tool === "image_generate") return t("media.image");
  if (step.server === "media" && step.tool === "video_generate") return t("media.video");
  if (!step.server || step.server === RAPHAEL) {
    return plain(BUILTIN_TITLES[step.tool] ?? (builtinAccess(step.tool) === "read" ? "agent.tool.readOnly" : "agent.tool.changeOnly"));
  }
  return t(toolAccess(step.tool, step.server) === "read" ? "agent.tool.read" : "agent.tool.write", { p0: step.server });
}

/** The tool's own name, for the tooltip of a step whose words do not name it (a service's tool); blank for one that has words of its own. */
export function stepToolTip(step: AgentStep): string {
  if (step.kind === "model" || !step.tool) return "";
  if (step.kind === "command") return COMMAND_TITLES[step.tool] ? "" : step.tool;
  // an app Raphael operated: the app's name, which the title leaves out
  if (step.kind === "computer") return step.server ?? "";
  return step.server === RAPHAEL && BUILTIN_TITLES[step.tool] ? "" : step.tool;
}

/** Where a step happened: the service, or this PC. The app's own tools and model calls happened nowhere named: they are every member's. */
export function stepPlace(step: AgentStep): string {
  if (step.kind === "command" || step.kind === "computer") return t("agent.thisPc");
  if (step.kind === "model" || step.server === RAPHAEL || !step.server) return "";
  return step.server;
}

/** Why a step failed, in a few words; empty for one that went well. */
export function reasonText(step: AgentStep): string {
  if (step.missing) return missingText(step.missing);
  if (step.outcome === "ok") return "";
  if (["encrypted", "bad_pdf", "no_text"].includes(step.reason ?? "")) return (t as (key: MessageKey) => string)(`missing.${step.reason}` as MessageKey);
  if (["bad_url", "blocked_address", "redirects", "unsupported_type"].includes(step.reason ?? "")) return t("missing.urlRead");
  // On the owner's PC a refusal is Raphael not being allowed to touch an app; `denied` elsewhere is a login that was refused.
  if (step.kind === "computer" && step.reason === "denied") return t("agent.reason.notAllowed");
  const key = REASONS[step.reason ?? ""] ?? (step.outcome === "timeout" ? REASONS.timeout : step.outcome === "blocked" ? REASONS.blocked : REASONS.error);
  return plain(key);
}

/** `0.4 秒`, `12 秒`, `1 分 05 秒`. */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 50) return t("agent.seconds", { p0: "<0.1" }); // a key press or a lookup in memory: no 0.0
  if (safe < 10_000) return t("agent.seconds", { p0: (Math.round(safe / 100) / 10).toFixed(1) });
  const seconds = Math.round(safe / 1000);
  if (seconds < 60) return t("agent.seconds", { p0: seconds });
  return t("agent.minutes", { p0: Math.floor(seconds / 60), p1: String(seconds % 60).padStart(2, "0") });
}

/** A model's name without its maker: `openai/gpt-6-luna` -> `gpt-6-luna`. */
export const shortModel = (model: string): string => model.slice(model.lastIndexOf("/") + 1);

// ---------- what a turn did ----------

/** The steps a reader is shown: everything but the model calls that went well, which are the thinking between them. */
export const shownSteps = (turn: AgentTurn): AgentStep[] => (turn.steps ?? []).filter((step) => (step.kind !== "model" || step.outcome !== "ok") && !bookkeeping(step));

/**
 * Steps that are no step to the reader: a background task looking through the tools it was given (no
 * service is called), and Raphael looking at the windows or the screen of the PC (nothing is done to
 * them). Only when they went well: a failed one is shown.
 */
const bookkeeping = (step: AgentStep): boolean =>
  step.outcome === "ok" &&
  ((step.server === RAPHAEL && step.tool === "find_tools") ||
    // looking at the windows or at the screen of an app is not something Raphael did to it
    (step.kind === "computer" && (step.tool === "apps" || step.tool === "look")));

export const isLive = (task: AgentTask | null | undefined): boolean => task?.state === "running" || task?.state === "queued";

/** How long a turn's work took: a task from its start to its end (or to now), else the span of its steps. */
export function workMs(turn: AgentTurn, nowMs: number): number {
  const task = turn.task;
  if (task?.started_at_ms) return (task.finished_at_ms ?? nowMs) - task.started_at_ms;
  const steps = turn.steps ?? [];
  if (steps.length === 0) return 0;
  const start = Math.min(...steps.map((step) => step.at_ms - step.ms));
  const end = Math.max(...steps.map((step) => step.at_ms));
  return Math.max(end - start, 0);
}

/** A step's own key, by which the page knows which steps it has drawn before. */
export const stepKey = (turn: AgentTurn, index: number): string => `${turn.id}:${index}`;

const STORED_FILE = /^[a-f0-9]{32}\.[a-z0-9]{1,12}$/;
const filesOfTurn = new WeakMap<AgentTurn, TurnAttachment[]>();
/** The stored files a turn holds: what the owner sent with it, and what the member delivered in it (its media messages). */
function turnFiles(turn: AgentTurn): TurnAttachment[] {
  let files = filesOfTurn.get(turn);
  if (!files) {
    files = (turn.attachments ?? []).filter(file => typeof file.id === "string" && STORED_FILE.test(file.id) && typeof file.name === "string");
    for (const message of turn.messages ?? []) {
      if (message.kind !== "media") continue;
      try {
        const file = JSON.parse(message.text)?.attachment as TurnAttachment | undefined;
        if (file && typeof file.id === "string" && STORED_FILE.test(file.id) && typeof file.name === "string") files.push(file);
      } catch { /* Not a delivered file. */ }
    }
    filesOfTurn.set(turn, files);
  }
  return files;
}

/** The files of a conversation by stored id: an `attachment:<id>` link opens one of these and nothing else (R-MSG-LINK-01). */
export function knownFiles(turns: readonly AgentTurn[]): KnownFiles {
  const known = new Map<string, TurnAttachment>();
  for (const turn of turns) for (const file of turnFiles(turn)) known.set(file.id!, file);
  return known;
}

/** What a turn's words say of the conversation's files, for the identity of its drawing. */
export function fileLinks(turn: AgentTurn, files: KnownFiles | undefined): string {
  if (!files?.size) return "";
  return [turn.text, ...(turn.messages ?? []).filter(message => message.kind === "reply").map(message => message.text)].map(text => fileLinkStamp(text, files)).filter(Boolean).join(";");
}

/** What the page keeps between draws. */
export interface TimelineState {
  /** Turns whose steps the reader opened or closed: their choice beats the default. */
  open: Map<number, boolean>;
  /** Turns whose thinking block the reader opened or closed: their choice beats the default. */
  thinkingOpen: Map<number, boolean>;
  /** The owner's send time, retained when a pending request becomes a history turn. */
  workStartedAt: Map<number, number>;
  /** The steps drawn before; any other is new and comes in with a movement. */
  seen: Set<string>;
  /** Tasks the reader asked to stop, which have not stopped yet. */
  stopping: Set<number>;
  /** Tasks the reader asked to run again; each is run again once. */
  rerunning: Set<number>;
  /** Failed replies whose subscription CLI is being signed in from their button (cli-signin.ts), and how that stands. */
  signin: Map<number, SigninPhase>;
  /** Tasks that were seen under way: the draw that finds one ended shows its check coming in. */
  live: Set<number>;
  /** Tasks whose end this draw shows for the first time (`noteTaskEnds`): their check pops in. */
  ended: Set<number>;
  nowMs: number;
  expandedMessages: Set<string>;
  /** The owner's message open as an editor in its place, if any (message-edit.ts). */
  editing: OwnerEditing | null;
  /** The files of the open conversation by stored id (`knownFiles`): what an `attachment:<id>` link in a reply may open. Left out, none. */
  files?: KnownFiles;
}

export const emptyTimelineState = (): TimelineState => ({
  open: new Map(),
  thinkingOpen: new Map(),
  workStartedAt: new Map(),
  seen: new Set(),
  stopping: new Set(),
  rerunning: new Set(),
  signin: new Map(),
  live: new Set(),
  ended: new Set(),
  nowMs: Date.now(),
  expandedMessages: new Set(),
  editing: null,
});

/** Whether a turn's steps are open: as the reader left them, else open while its task runs and closed once it is done. */
export const stepsOpen = (turn: AgentTurn, state: TimelineState): boolean => state.open.get(turn.id) ?? isLive(turn.task);

/**
 * Before a draw: a task seen under way that has ended since is `ended` for this draw (its check
 * comes in with a small pop), and the ones under way now are remembered for the next.
 */
export function noteTaskEnds(turns: readonly AgentTurn[], state: TimelineState): void {
  state.ended.clear();
  for (const turn of turns) {
    const task = turn.task;
    if (!task) continue;
    if (isLive(task)) state.live.add(task.id);
    else if (state.live.delete(task.id)) state.ended.add(task.id);
  }
}

/** The picture of a step: the service's mark, a plain one for the app's own tool, the PC for a command. A service or the PC is named in its label and tooltip. */
function stepIcon(step: AgentStep): string {
  const place = esc(stepPlace(step));
  const named = place ? `role="img" aria-label="${place}" title="${place}"` : `aria-hidden="true"`;
  if (step.kind === "command" || step.kind === "computer") return `<span class="step-ic" ${named}>${ico("monitor")}</span>`;
  if (step.kind === "model") return `<span class="step-ic" ${named}>${ico("sparkle")}</span>`;
  if (!step.server || step.server === RAPHAEL) {
    const own = step.tool === "weather" ? ico("cloud") : step.tool === "web_search" ? ico("globe") : step.tool === "local_time" ? ico("clock")
      : step.tool === "ask_member" ? ico("chat") : builtinAccess(step.tool ?? "") === "write" ? ico("pencil") : ico("search");
    return `<span class="step-ic" ${named}>${own}</span>`;
  }
  const mark = serviceIconOf({ name: step.server });
  if (mark && hasLogo(mark)) return `<span class="step-ic logo-art" ${named}>${serviceLogoHTML(mark)}</span>`;
  return mark
    ? `<span class="step-ic logo-mono"${brandStyle(mark)} ${named}>${serviceIconSVG(mark)}</span>`
    : `<span class="step-ic" ${named}>${ico("plug")}</span>`;
}

/** One step: what, where, how long, and whether it worked (a mark and a word, never the colour alone). */
export function stepHTML(step: AgentStep, isNew: boolean): string {
  const ok = step.outcome === "ok";
  const why = reasonText(step);
  const tip = stepToolTip(step);
  return (
    `<li class="step ${ok ? "is-ok" : "is-bad"}${isNew ? " is-new" : ""}">` +
    stepIcon(step) +
    `<span class="step-main"><span class="step-t"${tip ? ` title="${esc(tip)}"` : ""}>${esc(stepTitle(step))}</span>` +
    mediaBillHTML(step) +
    (step.detail && isComposioTool(step.server, step.tool) ? `<span class="step-detail">${esc(composioText(step.detail, step.tool ?? "Composio", "tool"))}</span>` : "") +
    (step.missing ? missingHTML(step.missing) : ok ? "" : `<span class="step-why">${esc(why)}</span>`) +
    `</span>` +
    `<span class="step-end"><span class="step-ms num">${esc(formatDuration(step.ms))}</span>` +
    `<span class="step-mark" role="img" aria-label="${esc(ok ? t("agent.ok") : why)}">${ok ? ico("check") : ico("x")}</span></span>` +
    `</li>`
  );
}

function mediaBillHTML(step: AgentStep): string {
  if (step.server !== "media" || !step.detail) return "";
  try {
    const bill = JSON.parse(step.detail);
    if (typeof bill.model !== "string" || !bill.model) return "";
    const cost = typeof bill.cost_usd === "number" && Number.isFinite(bill.cost_usd) && bill.cost_usd >= 0 ? formatPerMtok(bill.cost_usd) : t("media.costUnknown");
    return `<span class="step-detail">${esc(t("media.bill", { p0: bill.model, p1: cost }))}</span>`;
  } catch { return ""; }
}

/** The step a task is at now: its words with light passing over them, the time since it began. */
function liveStepHTML(task: AgentTask): string {
  const since = task.started_at_ms;
  const words = task.state === "queued" ? t("agent.queued") : t("agent.thinking");
  return (
    `<li class="step is-live">` +
    `<span class="step-ic">${SPINNER}</span>` +
    `<span class="step-main"><span class="step-t shimmer">${esc(words)}</span></span>` +
    `<span class="step-end">${since ? `<span class="step-ms num" data-since="${since}"></span>` : ""}</span>` +
    `</li>`
  );
}

/** How many things a turn did, in words: 「1 個動作」, 「3 個動作」. */
const actionsText = (count: number): string => (count === 1 ? t("agent.stepsDoneOne") : t("agent.stepsDone", { p0: count }));

/** The same conversation cards and controls are used in private and room replies. */
export function conversationCardsHTML(turn: AgentTurn, memberName?: string): string {
  return (turn.task?.state === "done" ? `<div data-task-result-slot="${turn.id}" data-task-member="${turn.member_id ?? 0}"></div>` : "") + connectorCardsHTML(turn) + mcpProposalsHTML(turn) + secretCardsHTML(turn) + chatCardsHTML(turn) + permissionCardsHTML(turn, undefined, false, memberName) +
    mailCardsHTML(turn) + pageCardsHTML(turn) + ownerQuestionsHTML(turn) +
    (turn.messages ?? []).filter(message => message.kind === "media").map(message => artifactHTML(message.text, message.seq, replySpeaks(turn))).join("");
}

/** Whether the member said something in the turn: then a missing setup under it needs only its repair, not its sentence. */
const replySpeaks = (turn: AgentTurn): boolean => !!turn.text?.trim() || (turn.messages ?? []).some(message => message.kind === "reply" && message.text.trim());

/** The words of a summary: how many things were done, how long it took, how many failed; or that a task is under way. */
export function summaryText(turn: AgentTurn, nowMs: number): { lead: string; time: string; failed: number } {
  const steps = shownSteps(turn).filter((step) => step.kind !== "model");
  const failed = shownSteps(turn).filter((step) => step.outcome !== "ok").length;
  const task = turn.task;
  const done = actionsText(steps.length);
  let lead = done;
  if (isLive(task)) lead = task!.state === "queued" ? t("agent.queued") : t("agent.working");
  else if (task?.state === "waiting") lead = task.waiting_owner ? t("ownerQuestion.waiting", { p0: task.waiting_owner }) : t("agent.taskWaiting");
  else if (task && TASK_ENDS[task.state]) lead = `${plain(TASK_ENDS[task.state])} · ${done}`;
  const ms = task?.state === "waiting" ? 0 : workMs(turn, nowMs); // the time it waits is not its own
  return { lead, time: ms > 0 || isLive(task) ? formatDuration(ms) : "", failed };
}

/** The list of steps under a summary, which slides open; with the step a task is at last. */
function stepsBodyHTML(turn: AgentTurn, state: TimelineState, open: boolean): string {
  const live = isLive(turn.task);
  const rows = shownSteps(turn).map((step, index) => stepHTML(step, !state.seen.has(stepKey(turn, index)))).join("") + (live ? liveStepHTML(turn.task!) : "");
  return (
    `<div class="steps-body" id="steps-${esc(turn.id)}"${open ? "" : " inert"}><div class="steps-clip">` +
    `<ol class="steps-list" aria-label="${esc(t("agent.stepsList"))}">${rows}</ol>` +
    `</div></div>`
  );
}

/** The one line of a turn that did something: 「› 3 個動作 · 2.4 秒」, and the steps when it is opened. */
function stepsLineHTML(turn: AgentTurn, state: TimelineState): string {
  const open = stepsOpen(turn, state);
  const { lead, time, failed } = summaryText(turn, state.nowMs);
  const bad = failed ? t("agent.stepsFailed", { p0: failed }) : "";
  const words = [lead, time, bad].filter(Boolean).join(" · ");
  const summary = btn(
    `<span class="steps-chev">${ico("right")}</span><span>${esc(lead)}</span>` +
      (time ? `<span class="num">· ${esc(time)}</span>` : "") +
      (bad ? `<span class="steps-bad">· ${esc(bad)}</span>` : ""),
    "steps-sum",
    ` data-act="steps" aria-expanded="${open}" aria-controls="steps-${esc(turn.id)}" aria-label="${esc(words)}"`,
  );
  return `<div class="steps" data-open="${open}">${summary}${stepsBodyHTML(turn, state, open)}</div>`;
}

/**
 * A background task: a card whose head says how it stands (a turning ring and the time while it
 * runs, a check once it is done) and opens its steps, with 「停止」 while it runs and 「重新執行」 for
 * one that did not finish.
 */
function taskCardHTML(turn: AgentTurn, state: TimelineState): string {
  const task = turn.task!;
  const live = isLive(task);
  const open = stepsOpen(turn, state);
  const { lead, time, failed } = summaryText(turn, state.nowMs);
  const bad = failed ? t("agent.stepsFailed", { p0: failed }) : "";
  const words = [lead, live ? "" : time, bad].filter(Boolean).join(" · ");
  const ended = state.ended.has(task.id);
  // A task that waits for the owner's yes is not under way, but not over either: it can be stopped.
  const waiting = task.state === "waiting";
  const mark = live
    ? task.state === "queued" ? ico("clock") : SPINNER
    : waiting ? ico("clock")
    : task.state === "done" ? `<span class="task-check${ended ? " is-pop" : ""}">${ico("check")}</span>` : ico("stop");
  const since = live ? task.started_at_ms ? ` data-since="${task.started_at_ms}"` : ` data-duration="${workMs(turn, 0)}"` : "";
  const summary = btn(
    `<span class="task-mark">${mark}</span><span class="task-lead">${esc(lead)}</span>` +
      (time ? `<span class="task-time num"${since}>${live ? "" : esc(time)}</span>` : "") +
      (bad ? `<span class="steps-bad">${esc(bad)}</span>` : "") +
      `<span class="steps-chev">${ico("down")}</span>`,
    "task-sum",
    ` data-act="steps" aria-expanded="${open}" aria-controls="steps-${esc(turn.id)}" aria-label="${esc(words)}"`,
  );
  const stopping = (live || waiting) && state.stopping.has(task.id);
  const stop = live || waiting
    ? `<button type="button" class="btn sm stop" data-act="stop" data-task="${esc(task.id)}"${stopping ? " disabled" : ""}>${esc(stopping ? t("agent.stopping") : t("agent.stop"))}</button>`
    : "";
  const again = RERUNNABLE.has(task.state)
    ? `<button type="button" class="btn sm rerun" data-act="rerun" data-task="${esc(task.id)}"${state.rerunning.has(task.id) ? " disabled" : ""}>${esc(t("agent.rerun"))}</button>`
    : "";
  return (
    `<div class="steps task${live ? " is-live" : ""}" data-open="${open}">` +
    `<div class="task-head">${summary}${stop}${again}</div>` +
    stepsBodyHTML(turn, state, open) +
    `</div>`
  );
}

/** What Raphael did for a turn: the card of its task, the line of its steps, or nothing for a turn that did nothing. */
export function stepsHTML(turn: AgentTurn, state: TimelineState): string {
  if (turn.task) return taskCardHTML(turn, state);
  return shownSteps(turn).length === 0 ? "" : stepsLineHTML(turn, state);
}

/** Whether an event of the app changes what the conversations show: a turn, or a task's step. */
export const wantsRefresh = (event: MainEvent): boolean => event.type === "AgentTurn" || event.type === "WorkerChanged";

/**
 * 「停止」: the task is marked as stopping at once, so its button says so, and the core is asked to
 * stop it. When that fails, or there was nothing to stop, the mark comes off again; otherwise it stays
 * until the task is seen to have ended.
 */
export async function requestStop(
  state: TimelineState,
  taskId: number,
  cancel: (taskId: number) => Promise<{ cancelled: boolean }>,
): Promise<{ cancelled: boolean; error?: unknown }> {
  state.stopping.add(taskId);
  try {
    const { cancelled } = await cancel(taskId);
    if (!cancelled) state.stopping.delete(taskId);
    return { cancelled };
  } catch (error) {
    state.stopping.delete(taskId);
    return { cancelled: false, error };
  }
}

/**
 * Takes the mark off the tasks that are not among `turns` any more: after the history is cleared
 * the core numbers tasks from 1 again, and a new task must not be taken for the old one.
 */
export function forgetReruns(state: TimelineState, turns: readonly AgentTurn[]): void {
  const shown = new Set(turns.flatMap((turn) => (turn.task ? [turn.task.id] : [])));
  for (const id of [...state.rerunning]) if (!shown.has(id)) state.rerunning.delete(id);
}

/**
 * 「重新執行」: the task is marked at once, so its button is off, and the core starts it again as a
 * new task. When that fails the mark comes off; otherwise it stays, so that one task is not started
 * twice.
 */
export async function requestRerun(
  state: TimelineState,
  taskId: number,
  rerun: (taskId: number) => Promise<{ task_id: number }>,
): Promise<{ started: boolean; error?: unknown }> {
  state.rerunning.add(taskId);
  try {
    await rerun(taskId);
    return { started: true };
  } catch (error) {
    state.rerunning.delete(taskId);
    return { started: false, error };
  }
}

/** Marks every step of `turns` as drawn, so that the next draw moves only the ones that come after. */
export function markSeen(turns: readonly AgentTurn[], state: TimelineState): void {
  for (const turn of turns) shownSteps(turn).forEach((_, index) => state.seen.add(stepKey(turn, index)));
}

// ---------- a turn ----------

/** The picture of where a turn came from: a microphone, Telegram's mark, or a keyboard for one typed here. */
export const sourceIcon = (source: string): string =>
  source === VOICE
    ? ico("mic")
    : source === "telegram"
      ? `<svg class="i tg-i" viewBox="0 0 24 24" aria-hidden="true"><path d="${SERVICE_ICONS.telegram.path}"/></svg>`
      : source === TYPED
        ? ico("keyboard")
        : ico("send");

/** Where a turn came from, in words. */
export function sourceName(source: string): string {
  if (source === VOICE) return t("agent.sourceVoice");
  if (source === "telegram") return t("agent.sourceTelegram");
  if (source === TYPED) return t("agent.sourceTyped");
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/** What a turn cost and what worded it, for the tooltip of Raphael's face: whether it waits, the model and the cost. */
export function answerMeta(turn: AgentTurn): string {
  const parts: string[] = [];
  if (turn.status === "confirm") parts.push(t("agent.waiting"));
  if (turn.model) parts.push(shortModel(turn.model));
  if (turn.cost_usd && turn.cost_usd > 0) parts.push(formatUsd(turn.cost_usd));
  return parts.join(" · ");
}

/** How a turn is drawn besides its data. */
export interface TurnLook {
  /** The earlier exchanges with the same colleague in a row (conversation.ts threadItems), counted in this turn's line. */
  exchangeTogether?: readonly AgentTurn[];
  deferPresence?: boolean;
  /**
   * Which turn of the thread draws the member's one working slime (standingPresence): the others draw none, `null` for none at all
   * (the tail of the thread stands for it). Left out, every turn that wants a presence draws its own, as a turn shown alone does.
   */
  presenceTurnId?: number | null;
  revealing?: (turnId: number) => boolean;
  waitingForOwner?: (turnId: number) => boolean;
  regenerateTurnId?: number;
  latestFailedTurnId?: number;
  /** The newest answered turn of the thread: only a failed reply that is this one carries a sign-in button. */
  signinTurnId?: number;
  /** The face of who answers (Raphael's, avatar.ts, or the member's): `loop` while at work on it. */
  face: (loop: boolean) => string;
  liveFace?: () => string;
  activityLabel?: string;
  /** The words being looked for, marked wherever they are; blank for none. */
  query?: string;
  /** The name of member `id` (0 is Raphael), for the lines of colleague events. */
  memberName?: (id: number) => string;
  /** The small face of member `id` on those lines (Raphael's bare emblem for 0), at `size` px where the line wants another. */
  memberFace?: (id: number, size?: number) => string;
  /** Whether the window can answer the question of permission card `id` now (it holds that question and is not answering it). */
  answerable?: (cardId: string) => boolean;
  /** Whom the owner's words may address: each `@Name` among them is drawn as a chip. */
  mentions?: readonly MentionTarget[];
}

/**
 * The line of a routine's run above its answer: 「例行任務 <title>」, the title being the run's
 * `question` (the core writes the routine's title there).
 */
export function routineLineHTML(turn: AgentTurn): string {
  const title = turn.question.trim();
  if (turn.routine) return `<div class="routine-origin">${btn(ico("repeat") + `<span>${esc(title || t("members.routineLine"))}</span>`, "sm routine-run-link", ` data-act="open-routine" data-routine="${turn.routine.id}" data-tooltip="${esc(title)}"`)}</div>`;
  return `<div class="routine-origin">${ico("repeat")}<span>${esc(t("members.routineLine"))}${title ? ` · ${esc(title)}` : ""}</span></div>`;
}

/**
 * Visual media share a grid; audio and documents stack underneath it.
 */
export function filesHTML(files: readonly TurnAttachment[] | undefined): string {
  if (!files || files.length === 0) return "";
  const visual = files.filter(file => ["image", "video"].includes(fileKind(file.mime)) && (file.id || file.preview));
  const rest = files.filter(file => !visual.includes(file));
  return `<div class="me-files">${visual.length ? `<div class="attachment-grid${visual.length > 1 ? " is-multiple" : ""}">${visual.map(sentFileHTML).join("")}</div>` : ""}${rest.map(sentFileHTML).join("")}</div>`;
}

/** Background task controls without raw tool labels or a collapsed steps box. */
export function waitsAtCard(turn: AgentTurn): boolean {
  return !!(turn.permissions?.some(card => card.state === "pending") || turn.secrets?.some(card => card.state === "pending" || card.state === "failed") || turn.connectors?.some(card => card.state === "pending" || card.state === "authorizing") || turn.computers?.some(card => card.state === "control") || turn.owner_questions?.some(question => question.state === "asked"));
}

/** Media stands above the owner's bubble, whose quote precedes the words. */
function bubbleHTML(words: string, files: readonly TurnAttachment[] | undefined, quote?: MessageQuote | null, expand = ""): string {
  const bubble = words || quote ? `<div class="bubble">${quote ? quoteHTML(quote, true) : ""}<div class="message-text">${words}</div>${expand}</div>` : "";
  return files?.length ? `<div class="owner-content">${filesHTML(files)}${bubble}</div>` : bubble;
}

/**
 * Beside the bubble, under the pointer, only react, reply and ⋯; Copy, the work, Edit and Cancel live in
 * the ⋯ menu and the right-click menu (agent.ts messageMenu), and the time lives in the thread's dividers. `extra` holds
 * the few controls a message needs in sight: a failed reply's Run again and a voice memo's play. A message with no menu
 * (a group's or a side thread's) keeps Copy in sight instead.
 */
export function messageActionsHTML(_time: number, regenerate = false, owner?: "edit" | "cancel", actionable = true, extra = "", queued = false): string {
  const action = (icon: Parameters<typeof iconBtn>[0], label: string, act: string): string =>
    iconBtn(icon, label, ` data-act="${act}"`).replace(" title=", " data-tooltip=");
  // A message that waits its turn says so and offers 立即送出 in sight, as Claude Code does: it is the exception, not a menu item
  // (owner, 2026-11-14: 「那個立即送出不要放在點點點裡面，你要把它放在外面，跟 Claude Code 一樣，因為它這個是例外」).
  const waiting = queued ? `<span class="queued-mark">${esc(t("agent.queued"))}</span>${btn(esc(t("chat.sendNow")), "sm queued-send-now", ' data-act="send-now"')}` : "";
  return `<div class="message-actions">${waiting}` + extra +
    (actionable ? reactionControlHTML() : "") +
    (actionable ? action("reply", t("chat.reply"), "reply-message") : "") +
    (actionable ? "" : action("copy", t("chat.copy"), "copy-message")) +
    (actionable ? action("more", t("chat.more"), "more-message").replace('data-act="more-message"', `data-act="more-message" data-regenerate="${regenerate}"${owner ? ` data-owner-act="${owner}"` : ""}${queued ? ' data-queued="true"' : ""} aria-haspopup="menu"`) : "") + `</div>`;
}

/**
 * The actions beside a bubble take their share of the message's width, so a bubble is as wide as that share allows. While the message is
 * edited they are not there to press, but their room is held (hidden, inert), so opening the editor changes neither the bubble's width nor
 * the size of a picture above it.
 */
function heldActionsHTML(time: number): string {
  return messageActionsHTML(time).replace('class="message-actions"', 'class="message-actions is-held" inert aria-hidden="true"');
}

function messageBlockHTML(turn: AgentTurn, key: string, text: string, time: number, query: string, state: TimelineState, reply: boolean, regenerate = false, origin = true, last = true, latestFailure = false): string {
  if (reply) text = plainReplies([text])[0];
  text = composioText(text, composioAction(turn));
  const expanded = state.expandedMessages.has(`${turn.id}:${key}`);
  const retry = reply && last ? rerunActionHTML(turn, state, regenerate) : "";
  return `<div class="chat-message${expanded ? " is-expanded" : ""}" data-message="${esc(key)}"${reply ? ' data-reply="true"' : ""}>` +
    (reply && origin && sourceOf(turn) === "routine" ? routineLineHTML(turn) : "") +
    withReactions(reply ? replyContentHTML(text, query, turn.status === "running", undefined, state.files) : `<div class="ans progress"><div class="message-text">${messageHTML(text, query)}</div></div>`, turn.reactions?.[key]) +
    (reply && last ? usageActionHTML(turn) + signinActionHTML(turn, state, latestFailure) : "") +
    // Its links are chips in its words, with no row of cards under it.
    messageActionsHTML(time, regenerate, undefined, reply, reply ? retry : "") + `</div>`;
}

/** The plans whose usage page the app knows: ChatGPT's, which Codex signs in with too. */
const USAGE_PROVIDERS = new Set(["chatgpt", "cli:codex"]);

/** A reply that failed on a plan's usage limit leads with Manage usage, the plan's own page (OpenAI's guidance). */
function usageActionHTML(turn: AgentTurn): string {
  const failure = turn.failure;
  if (turn.status !== "error" || failure?.kind !== "usage_limit" || !USAGE_PROVIDERS.has(failure.provider)) return "";
  return `<div class="turn-usage">${btn(esc(t("brains.manageUsage")), "sm", ` data-act="manage-usage" data-provider="${esc(failure.provider)}"`)}</div>`;
}

/** Where a failed reply's sign-in stands: its console is open (`waiting`), it ended and the question goes again (`done`), or it closed first (`stopped`). */
export type SigninPhase = "waiting" | "done" | "stopped";

/**
 * The subscription CLI a failed reply names and why it could not take the turn, or null for any other reply: the
 * core says it in the turn's failure (`cause`), so the button follows the true cause and nothing is guessed here.
 */
export function signinOf(turn: AgentTurn): { cli: CliBrainId; cause: NonNullable<NonNullable<AgentTurn["failure"]>["cause"]> } | null {
  const failure = turn.failure, cli = /^cli:(claude|codex|gemini)$/.exec(failure?.provider ?? "")?.[1] as CliBrainId | undefined;
  return turn.status === "error" && cli && failure?.cause ? { cli, cause: failure.cause } : null;
}

/**
 * Under a reply that names a CLI's sign-in or install as its whole cause, the one button that mends it, where the
 * owner is: 重新登入 for a session that ran out, 登入 for none, the install guide for a CLI that is not there. The
 * sentence above already says why. While the CLI's own window is open it says to finish there, with 取消; a closed window
 * says so and leaves the button; a finished sign-in says that the question goes again.
 */
function signinActionHTML(turn: AgentTurn, state: TimelineState, latest: boolean): string {
  const need = signinOf(turn), phase = state.signin.get(turn.id);
  if (!need || !latest && !phase) return "";
  const act = (name: string, label: string, cause = ""): string => btn(esc(label), "sm", ` data-act="${name}" data-cli="${need.cli}"${cause ? ` data-cause="${cause}"` : ""}`);
  const note = (key: "brains.signinWaiting" | "brains.signinDone" | "brains.signinFailed"): string => `<span class="signin-note" role="status">${esc(t(key))}</span>`;
  if (need.cause === "not_installed") return `<div class="turn-signin">${act("cli-install", t("brains.install"))}</div>`;
  const label = t(need.cause === "expired" ? "conn.relogin" : "brains.signinFirst");
  const body = phase === "waiting" ? note("brains.signinWaiting") + act("cli-signin-cancel", t("common.cancel"))
    : phase === "done" ? note("brains.signinDone")
    : (phase === "stopped" ? note("brains.signinFailed") : "") + act("cli-signin", label, need.cause);
  return `<div class="turn-signin" data-phase="${phase ?? "idle"}">${body}</div>`;
}

/** A failed reply's Run again: a bare icon first among its actions, which stay in sight on the latest failure. */
function rerunActionHTML(turn: AgentTurn, state: TimelineState, regenerate: boolean): string {
  const rerun = (attrs: string): string => iconBtn("refresh", t("agent.rerun"), attrs, "rerun").replace(" title=", " data-tooltip=");
  if (turn.task && RERUNNABLE.has(turn.task.state)) return rerun(` data-act="rerun" data-task="${turn.task.id}"${state.rerunning.has(turn.task.id) ? " disabled" : ""}`);
  return turn.status === "error" && regenerate ? rerun(' data-act="regenerate"') : "";
}


export function livePresenceHTML(look: TurnLook, progress?: string, showAction = true): string {
  const face = look.liveFace?.() ?? look.face(true);
  const current = face.replace(/\sdata-(?:tooltip|presence-member)="[^"]*"/g, "");
  if (!showAction) return `<div class="live-presence" role="status">${face}</div>`;
  const text = progress?.trim() || look.activityLabel?.trim() || t("work.thinking");
  return `<div class="live-presence" role="status" data-tooltip="${esc(text)}">${current}<span class="live-action">${esc(text)}</span></div>`;
}

/** Validates an http(s) URL; returns null for any other scheme or invalid URL. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch {
    // not a valid URL
  }
  return null;
}

/** Validates an image/thumbnail source: http(s) or a safe data:image URI. */
export function safeMediaSrc(raw: unknown, allowDataImage = false): string | null {
  const http = safeHttpUrl(raw);
  if (http) return http;
  if (allowDataImage && typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);/i.test(trimmed)) return trimmed;
  }
  return null;
}

/** Extracts or validates a YouTube embed URL for an inline iframe player. */
export function safeYoutubeEmbedUrl(embed: unknown, fallbackUrl?: unknown): string | null {
  for (const candidate of [embed, fallbackUrl]) {
    const valid = safeHttpUrl(candidate);
    if (!valid) continue;
    try {
      const u = new URL(valid);
      const host = u.hostname.toLowerCase();
      if (
        (host === "www.youtube.com" || host === "youtube.com" || host === "www.youtube-nocookie.com" || host === "youtube-nocookie.com") &&
        u.pathname.startsWith("/embed/")
      ) {
        return valid;
      }
      if (host === "youtu.be" && u.pathname.length > 1) {
        const id = u.pathname.slice(1).split("/")[0];
        if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
      }
      if ((host === "www.youtube.com" || host === "youtube.com") && u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/** A media message that says what a step was missing (`{missing}`), or null. */
function mediaMissing(text: string): Missing | null {
  try {
    const prerequisite = JSON.parse(text)?.missing;
    return prerequisite && typeof prerequisite.resource === "string" && typeof prerequisite.requirement === "string" && ["missing", "broken", "unknown", "off"].includes(prerequisite.state) && (prerequisite.repair === null || typeof prerequisite.repair === "string") ? prerequisite as Missing : null;
  } catch { return null; }
}

function artifactHTML(text: string, seq: number, replied = false): string {
  const prerequisite = mediaMissing(text);
  if (prerequisite) return `<div class="chat-message" data-message="${seq}">${replied ? missingRepairHTML(prerequisite) : missingHTML(prerequisite)}</div>`;
  try {
    const payload = JSON.parse(text);
    const file = payload?.attachment as TurnAttachment | undefined;
    if (file && typeof file.id === "string" && /^[a-f0-9]{32}\.[a-z0-9]{1,12}$/.test(file.id) && typeof file.name === "string" && typeof file.mime === "string") {
      return `<div class="chat-message" data-message="${seq}">${sentFileHTML({ id: file.id, name: file.name, mime: file.mime, size: typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0 ? file.size : undefined })}</div>`;
    }
  } catch { /* Older media messages use the URL payload below. */ }
  return "";
}

function missingKey(text: string): string {
  try {
    const missing = JSON.parse(text)?.missing;
    return typeof missing?.resource === "string" && typeof missing?.requirement === "string" ? `${missing.resource}:${missing.requirement}` : "";
  } catch { return ""; }
}

/** Parses a `media` message's JSON string; returns null when malformed. */
export function parseMediaPayload(raw: string): MediaPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MediaPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.type !== "link" && parsed.type !== "image" && parsed.type !== "video" && parsed.type !== "pdf") return null;
    if (typeof parsed.url !== "string" || !parsed.url.trim()) return null;
    return {
      type: parsed.type,
      url: parsed.url.trim(),
      title: typeof parsed.title === "string" ? parsed.title.trim() : "",
      site: typeof parsed.site === "string" ? parsed.site.trim() : "",
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
      thumbnail: typeof parsed.thumbnail === "string" && parsed.thumbnail.trim() ? parsed.thumbnail.trim() : null,
      embed: typeof parsed.embed === "string" && parsed.embed.trim() ? parsed.embed.trim() : null,
    };
  } catch {
    return null;
  }
}

function meetingEvent(text: string): { room_id: number; name: string } | null {
  try {
    const event = JSON.parse(text);
    return event?.type === "meeting" && Number.isSafeInteger(event.room_id) && event.room_id > 0 && typeof event.name === "string" ? event : null;
  } catch { return null; }
}

/** One public line of Raphael's work (《告。…》 on the desktop) as the window shows it: plain. */
const plainLine = (text: string): string => plainReplies([text])[0];

export function latestProgress(turn: AgentTurn): string | undefined {
  const action = liveAction(turn);
  if (action) return composioText(action, composioAction(turn));
  const text = [...(turn.messages ?? [])].reverse().find(m => m.kind === "progress")?.text;
  const progress = turn.task?.progress ? plainLine(turn.task.progress) : text && plainLine(text);
  return progress && composioText(progress, composioAction(turn));
}

/** Work and public receipts share the reply's collapsed detail. */
function workSectionHTML(turn: AgentTurn, state: TimelineState, query: string, revealing = false, waitingForOwner = false): string {
  const messages = (turn.messages ?? []).filter(m => m.kind !== "reply" && m.kind !== "media" && m.kind !== "event" && m.text.trim())
    .map(m => ({ ...m, text: composioText(plainLine(m.text), composioAction(turn)) }));
  // The work itself is never shown (owner, 2026-11-10: 「不用有查看過程」): what a step was missing stands in sight with its
  // repair, live or not, and the closed body stays only for a search that finds words in it.
  const prerequisites = prerequisitesHTML(turn);
  const live = !waitingForOwner && !waitsAtCard(turn) && turn.task?.state !== "waiting" && (turn.status === "running" || isLive(turn.task));
  if (live) return prerequisites;
  const events = [...publicEventsHTML(turn, false).values()].join("");
  if (!messages.length && !events && !hasDetail(turn) && !workActions(turn).length && !(turn.steps?.length) && !turn.model && !revealing) return prerequisites;
  const open = state.thinkingOpen.get(turn.id) ?? false;
  const actions = workActions(turn).filter(action => action.state === "done").map(action => ({ ...action, past: composioText(action.past, composioAction(turn)) }));
  const steps = shownSteps(turn).filter(step => step.kind !== "model");
  const rows = actions.length ? actions.map(action => `<li>${esc(action.past)}${action.outcome && action.outcome !== "ok" ? ` · ${esc(reasonText({kind:"tool", tool:"", server:null, ms:0, at_ms:0, outcome:action.outcome, reason:action.reason ?? null}))}` : ""}</li>`).join("") : steps.length ? steps.map(step => `<li>${esc(pastStep(step))}${!step.missing && step.outcome !== "ok" ? ` · ${esc(reasonText(step))}` : ""}</li>`).join("") : messages.map(message => `<li class="work-progress">${messageHTML(message.text, query)}</li>`).join("");
  const meta = [esc(answerMeta(turn)), ...shownSteps(turn).map(mediaBillHTML)].filter(Boolean).join(" · ");
  const detail = hasDetail(turn) && (!turn.messages?.length || turn.status === "error" || turn.task?.state === "failed");
  const body = (rows ? `<ol class="work-sentences">${rows}</ol>` : "") + events + (detail ? `<pre class="failure-detail">${highlightHTML(turn.detail, query)}</pre>` : "") + (meta ? `<p class="work-meta">${meta}</p>` : "");
  if (!body) return prerequisites;
  return prerequisites + `<div class="work-section think-box${open ? " is-open" : ""}" data-thinking-turn="${turn.id}">` +
    `<div class="work-body think-body" id="work-${turn.id}"${open ? "" : " hidden"}>${body}</div></div>`;
}

/**
 * What a step of the turn was missing, each with its one repair, unless a message of the turn already carries it (then it
 * is there once). Under a reply that speaks, only the repair: the reply says what is missing.
 */
function prerequisitesHTML(turn: AgentTurn): string {
  const media = (turn.messages ?? []).filter(m => m.kind === "media");
  const stated = new Set(media.map(m => missingKey(m.text)).filter(Boolean));
  const replied = replySpeaks(turn);
  const note = replied ? missingRepairHTML : missingHTML;
  // A spoken turn's own missing message moves here, under the reply, as its repair (turnMessagesHTML leaves it out).
  const said = replied ? media.map(m => mediaMissing(m.text)).filter((value): value is Missing => value !== null).map(missingRepairHTML) : [];
  const notes = said.join("") + shownSteps(turn).map(step => step.missing && !stated.has(`${step.missing.resource}:${step.missing.requirement}`) ? note(step.missing) : "").join("");
  return notes ? `<div class="turn-prerequisites">${notes}</div>` : "";
}

/** An inline media card (`link`, `image`, `video`, or `pdf`) with a safe `在網站開啟` action button. */
export function mediaCardHTML(payload: MediaPayload, query: string, seq?: number): string {
  const safeUrl = safeHttpUrl(payload.url);
  const thumb = safeMediaSrc(payload.thumbnail, true);
  const title = payload.title ?? "";
  const site = payload.site ?? "";
  const desc = payload.description ?? "";
  const seqAttr = seq !== undefined ? ` data-seq="${esc(seq)}"` : "";
  const openBtn = safeUrl
    ? `<button type="button" class="btn sm media-open" data-act="open-url" data-url="${esc(safeUrl)}">${ico("link")}<span>${esc(t("agent.openInSite"))}</span></button>`
    : "";
  const metaHTML =
    (site ? `<span class="media-site">${highlightHTML(site, query)}</span>` : "") +
    (title ? `<div class="media-title">${highlightHTML(title, query)}</div>` : "") +
    (desc ? `<div class="media-desc">${highlightHTML(desc, query)}</div>` : "");

  if (payload.type === "image") {
    const imgSrc = safeMediaSrc(payload.url, true) ?? thumb;
    const pic = imgSrc
      ? `<button type="button" class="btn media-img-btn" data-act="lightbox" data-src="${esc(imgSrc)}" data-title="${esc(title || site)}" aria-label="${esc(title || t("agent.viewImage"))}">` +
        `<img class="media-img" src="${esc(imgSrc)}" alt="${esc(title)}" loading="lazy"></button>`
      : "";
    return (
      `<div class="media-card media-image" data-media-type="image"${seqAttr}>` +
      pic +
      `<div class="media-bar"><div class="media-meta">${metaHTML}</div><div class="media-foot">${openBtn}</div></div>` +
      `</div>`
    );
  }

  if (payload.type === "video") {
    const ytEmbed = safeYoutubeEmbedUrl(payload.embed, payload.url);
    const player = ytEmbed
      ? `<div class="media-player"><iframe class="media-iframe" src="${esc(ytEmbed)}" title="${esc(title || site || "Video")}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
      : safeUrl
        ? `<div class="media-player"><video class="media-video" controls preload="${thumb ? "none" : "metadata"}"${thumb ? ` poster="${esc(thumb)}"` : ""} src="${esc(safeUrl)}"></video></div>`
        : "";
    return (
      `<div class="media-card media-video-card" data-media-type="video"${seqAttr}>` +
      player +
      `<div class="media-bar"><div class="media-meta">${metaHTML}</div><div class="media-foot">${openBtn}</div></div>` +
      `</div>`
    );
  }

  if (payload.type === "pdf") {
    const frame = safeUrl
      ? `<div class="media-pdf-wrap"><iframe class="media-pdf-frame" src="${esc(safeUrl)}" title="${esc(title || "PDF")}" loading="lazy"></iframe></div>`
      : "";
    const expandBtn = `<button type="button" class="btn sm media-expand" data-act="pdf-expand" aria-expanded="false">${esc(t("agent.expandPdf"))}</button>`;
    return (
      `<div class="media-card media-pdf" data-media-type="pdf"${seqAttr}>` +
      frame +
      `<div class="media-bar"><div class="media-meta">${metaHTML}</div><div class="media-foot">${expandBtn}${openBtn}</div></div>` +
      `</div>`
    );
  }

  return (
    `<div class="media-card media-link" data-media-type="link"${seqAttr}>` +
    `<div class="media-link-main">` +
    (thumb ? `<img class="media-thumb" src="${esc(thumb)}" alt="${esc(title || site)}" loading="lazy">` : "") +
    `<div class="media-meta">${metaHTML}</div>` +
    `<div class="media-foot">${openBtn}</div>` +
    `</div>` +
    `</div>`
  );
}

/** Renders all ordered items in `turn.messages` (thinking block, progress, media cards, event chips, replies). */
function turnMessagesHTML(turn: AgentTurn, state: TimelineState, query: string, regenerate: boolean, revealing: boolean, settled = "", fallback = "", waitingForOwner = false, latestFailure = false): string {
  const ordered = [...(turn.messages ?? [])].sort((a, b) => a.seq - b.seq);
  const replies = ordered.filter(m => m.kind === "reply");
  const said = new Map(plainReplies(replies.map(m => m.text)).map((text, index) => [replies[index].seq, text.trim()]));
  const lastReply = [...replies].reverse().find(m => said.get(m.seq))?.seq;
  const work = workSectionHTML(turn, state, query, revealing, waitingForOwner);
  const settledDraft = isSettledDraftTurn(turn);
  // A question the owner has settled stands where it was asked, among the replies (permission-card.ts settledQuestions).
  const asked = settledQuestions(turn);
  const inline = publicEventsHTML(turn, true, "inline");
  return settled + ordered.filter(message => (message.kind === "reply" && !(settledDraft && said.get(message.seq) === turn.text.trim())) || message.kind === "media" || (message.kind === "event" && inline.has(message.seq))).map(message => {
    if (message.kind === "event") return inline.get(message.seq) ?? "";
    const text = message.kind === "reply" ? said.get(message.seq) ?? "" : message.text.trim();
    if (!text) return "";
    if (message.kind === "media") {
      // Under a reply that speaks, a missing setup is only its repair, drawn below the reply (prerequisitesHTML).
      if (replySpeaks(turn) && mediaMissing(text)) return "";
      const artifact = artifactHTML(text, message.seq);
      if (artifact) return artifact;
      const media = parseMediaPayload(text);
      return media ? `<div class="chat-message" data-message="${message.seq}">${mediaCardHTML(media, query, message.seq)}</div>` : "";
    }
    // A card asked in the same millisecond as a reply (the words that come with it) stands after it.
    return asked(message.at_ms - 1) + `<div data-seq="${message.seq}">${messageBlockHTML(turn, String(message.seq), text, message.at_ms, query, state, true, regenerate && message.seq === lastReply, message.seq === replies.find(reply => said.get(reply.seq))?.seq, message.seq === lastReply, latestFailure)}</div>`;
  }).join("") + asked(Infinity) + (replies.length ? "" : fallback) + work;
}

/**
 * The centred event lines of a turn, outside Raphael's messages: what it sent colleagues (one line that opens
 * their conversation, peer-chat.ts) and the meetings it opened, whose line opens the room.
 */
function learnedSkillEvent(text: string): string | null {
  try { const event = JSON.parse(text); return event?.type === "skill_learned" && typeof event.name === "string" ? event.name : null; }
  catch { return null; }
}

/** The role a new member saved as its job (the core's `job_set` event), or null: one quiet line in the conversation. */
function jobSetEvent(text: string): string | null {
  try { const event = JSON.parse(text); return event?.type === "job_set" && typeof event.name === "string" && event.name.trim() ? event.name.trim() : null; }
  catch { return null; }
}

/** The words of a member's own rename (the core's `renamed` event), or null: the line the first Bot's rename has (`bot-renamed`). */
function renamedEvent(text: string): { name: string; words: string } | null {
  try { const event = JSON.parse(text); return event?.type === "renamed" && typeof event.name === "string" && typeof event.text === "string" ? { name: event.name, words: event.text.trim() } : null; }
  catch { return null; }
}

function turnEventsHTML(turn: AgentTurn, look: TurnLook): string {
  return handoffGroupHTML((turn.handoffs ?? []).map(task => ({ task, face: look.memberFace?.(task.member_id) ?? "",
    name: look.memberName?.(task.member_id) || task.member_name })));
}

/**
 * `conversation` picks the lines that stay in the conversation: a meeting this turn opened (an exchange
 * with colleagues, shown on one line) and a skill the member learned (it changes what the member
 * does next). Every other public event is work and folds into the reply.
 */
function publicEventsHTML(turn: AgentTurn, conversation: boolean, place: "inline" | "after" = "after"): Map<number, string> {
  const labels = {
    "routine.created": "event.routine.created", "routine.updated": "event.routine.updated", "routine.deleted": "event.routine.deleted",
    "calendar.created": "event.calendar.created", "calendar.updated": "event.calendar.updated", "calendar.deleted": "event.calendar.deleted",
  } as const satisfies Record<string, MessageKey>;
  const groups: { kind: string; lines: string[]; names: Map<string, {name: string; face: string}>; seq: number }[] = [];
  for (const message of [...(turn.messages ?? [])].sort((a,b) => a.seq - b.seq)) {
    if (message.kind !== "event") { groups.push({kind: "break", lines: [], names: new Map(), seq: message.seq}); continue; }
    let event: {type?: string; action?: string; id?: number; name?: string; date?: string; member_id?: number} = {};
    try { event = JSON.parse(message.text); } catch { /* Historical events remain readable without a guessed target. */ }
    if (event?.type === "action") continue;
    // Older CLI failures wrote the final sentence as an event too. Keep one public sentence.
    if (plainLine(message.text) === plainLine(turn.text) || turn.messages?.some(reply => reply.kind === "reply" && plainLine(reply.text) === plainLine(message.text))) continue;
    const known = ["routine", "calendar"].includes(event?.type ?? "") && ["created", "updated", "deleted"].includes(event?.action ?? "") && typeof event.name === "string" && Number.isSafeInteger(event.id) && event.id! > 0;
    const meeting = meetingEvent(message.text), skill = learnedSkillEvent(message.text), job = jobSetEvent(message.text), renamed = renamedEvent(message.text);
    if ((!!meeting || !!skill || !!job || !!renamed) !== conversation) continue;
    // A new member's job and its new name stand among the replies where they happened; the rest follow the reply.
    if (conversation && (!!job || !!renamed) !== (place === "inline")) continue;
    if (renamed) {
      const line = `<div class="conversation-event-line timeline-event" data-timeline-event="${turn.id}:${message.seq}"><p class="bot-renamed" role="status">${esc(renamed.words)}</p></div>`;
      groups.push({kind: `renamed:${message.seq}`, lines: [line], names: new Map(), seq: message.seq});
      continue;
    }
    const kind = known ? `${event.type}.${event.action}` : meeting ? "meeting" : skill ? "skill" : job ? "job" : `notice:${plainLine(message.text)}`;
    const words = job ? eventLineHTML(t("members.jobSetNotice", {p0: NAME}), ico("check"), job) : known ? eventLineHTML(t(labels[`${event.type}.${event.action}` as keyof typeof labels], {p0: NAME}), ico(event.type === "routine" ? "clock" : "calendar"), event.name!) : meeting ? eventLineHTML(t("rooms.meetingOpened", {p0: NAME}), ico("chat"), meeting.name) : skill ? eventLineHTML(t(event?.action === "updated" ? "skills.updatedNotice" : "skills.learnedNotice", {p0: NAME}), ico(event?.action === "updated" ? "pencil" : "check"), skill) : `<span class="sys event-line">${esc(plainLine(message.text.trim().startsWith("{") || message.text.trim().startsWith("[") ? t("event.changed") : message.text))}</span>`;
    const attrs = meeting ? `data-meeting-room="${meeting.room_id}"` : event?.type === "routine" ? `data-act="open-routine" data-routine="${event.id}"${Number.isSafeInteger(event.member_id) && event.member_id! >= 0 ? ` data-routine-member="${event.member_id}"` : ""}` : `data-act="open-calendar-event" data-event="${event?.id}" data-date="${esc(event?.date ?? "")}"`;
    const openable = meeting || known && event?.action !== "deleted" && (event.type === "routine" || /^\d{4}-\d{2}-\d{2}$/.test(event.date ?? ""));
    const line = `<div class="conversation-event-line timeline-event" data-timeline-event="${turn.id}:${message.seq}">${openable ? btn(words, "event-open", ` ${attrs}`) : words}</div>`;
    const target = job ? {key: "job", name: job, face: ico("check")} : known ? {key: `${event.type}:${event.id}`, name: event.name!, face: ico(event.type === "routine" ? "clock" : "calendar")} : meeting ? {key: `meeting:${meeting.room_id}`, name: meeting.name, face: ico("chat")} : {key: kind, name: skill || t("event.changed"), face: ico("check")};
    let group = groups[groups.length - 1];
    if (group?.kind !== kind) { group = {kind, lines: [], names: new Map(), seq: message.seq}; groups.push(group); }
    group.lines.push(line);
    group.names.set(target.key, {name: target.name, face: target.face});
  }
  return new Map(groups.map(group => {
    if (group.lines.length < 2) return [group.seq, group.lines.join("")];
    const people = [...group.names.values()].slice(0, 3);
    const slots = people.map((_, index) => `\u0000${index}\u0000`);
    if (group.names.size > 3) slots.push(t("event.groupOthers", {p0: group.names.size - 3}));
    const names = new Intl.ListFormat(getLocale(), {style: "long", type: "conjunction"}).format(slots);
    return [group.seq, `<details class="handoff-event event-group" data-event-group="${turn.id}:${group.seq}"><summary>${eventPeopleHTML(t("event.group", {p0: group.lines.length, p1: names}), people)}</summary><div class="handoff-detail">${group.lines.join("")}</div></details>`];
  }));
}

/**
 * What a turn asks of its member's working slime: `words` while it is at work (or its replies are being read in), a `bare` face
 * while it waits for the owner (a card, a question, a yes), nothing for a turn that is over.
 */
export type PresenceWant = "words" | "bare" | null;
export function presenceWant(turn: AgentTurn, look: Pick<TurnLook, "revealing" | "waitingForOwner"> = {}): PresenceWant {
  const waitingForOwner = look.waitingForOwner?.(turn.id) ?? false;
  const live = !waitingForOwner && !waitsAtCard(turn) && turn.task?.state !== "waiting" && (turn.status === "running" || isLive(turn.task));
  if (live || look.revealing?.(turn.id)) return "words";
  return waitingForOwner || waitsAtCard(turn) || turn.task?.state === "waiting" || turn.status === "confirm" ? "bare" : null;
}

/**
 * The one turn whose line carries a member's working slime in a conversation (owner, 2026-11-14: 「理論上它不管怎麼樣都只會有一個史萊姆在運作才對」).
 * Of the turns that want one, the newest that is at work stands (a background task's line with its progress words); a face
 * that only waits stands for nobody while another turn works. `turns` run from the oldest to the newest.
 */
export function standingPresence(turns: readonly AgentTurn[], look: Pick<TurnLook, "revealing" | "waitingForOwner"> = {}): AgentTurn | undefined {
  let bare: AgentTurn | undefined;
  for (let i = turns.length - 1; i >= 0; i--) {
    const want = presenceWant(turns[i]!, look);
    if (want === "words") return turns[i];
    if (want === "bare" && !bare) bare = turns[i];
  }
  return bare;
}

/** One question and its answer, with what was done in between. */
export function turnHTML(turn: AgentTurn, state: TimelineState, detailOpen: boolean, look: TurnLook): string {
  const id = esc(turn.id);
  const query = look.query ?? "";
  const hasMsgs = (turn.messages?.length ?? 0) > 0;
  const settledDraft = isSettledDraftTurn(turn);
  // a routine's run says its routine in a line of its own, in place of the owner's words; so does a task
  // resumed once its connector cards were connected
  const routine = sourceOf(turn) === "routine";
  const resumed = sourceOf(turn) === "connector";
  // what a colleague handed this member says who from, in place of the owner's words
  const handed = exchangeTurn(turn);
  // The answer to a new member's first card is the card's (it stands in it), not a message of the owner's.
  const said = turn.question.trim() !== "" && !routine && !resumed && !handed && !delegatedTurn(turn) && !turn.setup;
  const asked = said || (turn.attachments?.length ?? 0) > 0;
  const waitingForOwner = look.waitingForOwner?.(turn.id) ?? false;
  const live = !waitingForOwner && !waitsAtCard(turn) && turn.task?.state !== "waiting" && (turn.status === "running" || isLive(turn.task));
  const revealing = look.revealing?.(turn.id) ?? false;
  const want = presenceWant(turn, look);
  // What a colleague said to this member is one line that opens the two members' conversation (exchange-line.ts):
  // the request and the answer are read there, not under the line. Only a card that waits for the owner stays here.
  if (handed) {
    const name = turn.member_id ? look.memberName?.(turn.member_id) : t("agent.title");
    const cards = permissionCardsHTML(turn, look.answerable, true, name) + ownerQuestionsHTML(turn, true) + connectorCardsHTML(turn) + secretCardsHTML(turn) + chatCardsHTML(turn) + computerCardsHTML(turn) +
      permissionCardsHTML(turn, look.answerable, false, name) + ownerQuestionsHTML(turn, false);
    return `<li class="tn" data-id="${id}" data-status="${esc(turn.status)}"${live ? ' data-live="true"' : ""}>` + receivedLineHTML(turn, look) +
      (cards ? `<div class="ra"><div class="ra-body">${cards}</div></div>` : "") + `</li>`;
  }
  // A greeting has no words of the owner's, yet a failed one is written again (the core's members.greet).
  const regenerate = !live && (said || turn.route === "greeting") && turn.id === look.regenerateTurnId;
  // A turn without reply messages answers in its text: a question spoken to Raphael with public progress has no other.
  // A draft handed to this chat (`route` "draft") is a card, and what it is told is for the model, not for the page.
  const textAnswer = turn.status === "confirm" || settledDraft || turn.route === "draft" || !turn.text.trim()
    ? "" : messageBlockHTML(turn, "reply", turn.text, turn.created_at_ms, query, state, true, regenerate, true, true, turn.id === look.signinTurnId);
  return (
    `<li class="tn${turn.id === look.latestFailedTurnId ? " is-latest-failure" : ""}${turn.status === "queued" || turn.route === "owner_input" || (live && !hasMsgs) ? " is-owner-only" : ""}" data-id="${id}" data-status="${esc(turn.status)}"${live ? ' data-live="true"' : ""}>` +
    (resumed ? resumedLineHTML(turn) + secretResumedLineHTML(turn) + computerResumedLineHTML(turn) : "") +
    // A brief another member handed over says who from, in place of the owner's bubble.
    (delegatedTurn(turn) && turn.question.trim() ? receivedLineHTML(turn, look) : "") +
    (asked && state.editing?.turnId === turn.id
      ? `<div class="me"><div class="chat-message owner-message is-editing" data-message="question" data-msg-editor>${ownerEditorHTML(state.editing, filesHTML(turn.attachments), turn.quote ? quoteHTML(turn.quote, true) : "")}${heldActionsHTML(turn.created_at_ms)}</div></div>`
      : asked
      ? `<div class="me">` +
        `<div class="chat-message owner-message${state.expandedMessages.has(`${id}:question`) ? " is-expanded" : ""}" data-message="question" data-expandable="true">` +
        withReactions(bubbleHTML(said ? messageHTML(turn.question.trim(), query, false, look.mentions) : "", turn.attachments, turn.quote, messageExpandHTML(turn.question, state.expandedMessages.has(`${id}:question`))), turn.reactions?.owner) + messageActionsHTML(turn.created_at_ms, false, live || turn.status === "queued" || turn.status === "confirm" || turn.task?.state === "waiting" ? "cancel" : "edit", true, "", turn.status === "queued") + `</div>` +
        `</div>`
      : "") +
    turnEventsHTML(turn, look) + mailHandedLinesHTML(turn, look) +
    (turn.route === "owner_input" || turn.status === "queued" ? "" : `<div class="ra${isBotRename(turn) ? " is-system-result" : ""}">` +
    `<div class="ra-body">` +
    // A question already answered came before the answer: it reads in that order, under the work and above the reply.
    (hasMsgs
      ? turnMessagesHTML(turn, state, query, regenerate, revealing, permissionCardsHTML(turn, look.answerable, true, turn.member_id ? look.memberName?.(turn.member_id) : t("agent.title")), textAnswer, waitingForOwner, turn.id === look.signinTurnId)
      : permissionCardsHTML(turn, look.answerable, true, turn.member_id ? look.memberName?.(turn.member_id) : t("agent.title")) + ownerQuestionsHTML(turn, true) + textAnswer + workSectionHTML(turn, state, query, revealing, waitingForOwner)) +
    (settledDraft ? settledDraftHTML(turn, detailOpen, query) : "") +
    connectorCardsHTML(turn) + mcpProposalsHTML(turn) + secretCardsHTML(turn) + chatCardsHTML(turn) + computerCardsHTML(turn) +
    `<div data-desktop-slot="${id}"></div>` +
    permissionCardsHTML(turn, look.answerable, false, turn.member_id ? look.memberName?.(turn.member_id) : t("agent.title")) + mailCardsHTML(turn, look) + pageCardsHTML(turn) +
    ownerQuestionsHTML(turn, false) +
    (turn.status === "confirm" ? `<div class="turn-question" data-question-turn="${id}"></div>` : "") +
    (turn.task?.state === "done" ? `<div data-task-result-slot="${id}" data-task-member="${turn.member_id ?? 0}"></div>` : "") +
    (want && !look.deferPresence && (look.presenceTurnId === undefined || look.presenceTurnId === turn.id) ? livePresenceHTML(look, latestProgress(turn), want === "words") : "") +
    `</div></div>`) +
    // What the reply led to (a meeting opened, a skill learned) follows it as one quiet line.
    [...publicEventsHTML(turn, true).values()].join("") + `</li>`
  );
}

/** The heading of a day in the thread. */
export const dayHTML = (label: string): string => `<li class="day"><span>${esc(label)}</span></li>`;

/**
 * A turn that is not in the history yet: what the person typed (or, for a question said aloud,
 * a bubble with light passing over it until the words arrive) and Raphael thinking. A typed
 * question shows the chips of the files it was sent with.
 */
export function pendingTurnHTML(question: string | null, _source: string, look: TurnLook, files: readonly TurnAttachment[] = [], request?: { id?: string; time: number; quote?: MessageQuote }, nowMs = Date.now(), expanded = false, showPresence = true, tail?: { progress?: string; words?: boolean }): string {
  void nowMs;
  const words =
    question === null ? `<span class="shimmer">${esc(t("agent.hearing"))}</span>` : question.trim() === "" ? "" : messageHTML(question.trim(), "", false, look.mentions);
  return (
    `<li class="tn is-pending is-owner-only"${request?.id ? ` data-session="${esc(request.id)}"` : ""}>` +
    `<div class="me"><div class="chat-message owner-message${expanded ? " is-expanded" : ""}" data-message="question" data-expandable="true">${bubbleHTML(words, files, request?.quote, messageExpandHTML(question ?? "", expanded))}${request?.id ? messageActionsHTML(request.time, false, "cancel") : ""}</div></div>` +
    (showPresence ? `<div class="ra"><div class="ra-body">${livePresenceHTML(look, tail?.progress, tail?.words ?? true)}</div></div>` : "") + `</li>`
  );
}

/** Paint clocks in the same task as the markup, without making time part of a line's identity. */
export function updateLiveTimes(root: ParentNode, nowMs = Date.now()): void {
  const write = (label: HTMLElement, text: string): void => { if (label.textContent !== text) label.textContent = text; };
  for (const line of root.querySelectorAll<HTMLElement>(".work-section.is-live[data-work-start]")) {
    const label = line.querySelector<HTMLElement>(".work-time");
    if (label) write(label, t("chat.workingFor", { p0: Math.max(0, Math.round((nowMs - Number(line.dataset.workStart)) / 1000)) }));
  }
  for (const label of root.querySelectorAll<HTMLElement>("[data-since]")) write(label, formatDuration(nowMs - Number(label.dataset.since)));
  for (const label of root.querySelectorAll<HTMLElement>("[data-duration]")) write(label, formatDuration(Number(label.dataset.duration)));
}

/** A loaded task or handoff belongs to this thread; unknown tasks are polled more slowly. */
export function hasWorkerTask(turns: readonly AgentTurn[], taskId: number): boolean {
  return turns.some(turn => turn.task?.id === taskId || turn.handoffs?.some(task => task.task_id === taskId));
}
