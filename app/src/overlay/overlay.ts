// The overlay page: the emblem in the bottom-right corner and Raphael's subtitles.
//
// Rust (overlay.rs) sends events on a channel that this page opens once. The window itself is
// transparent, click-through and never hidden: "hidden" here means the page draws nothing and
// the animation loop (see emblem.ts) is stopped. A question shows its confirmation card; stopping the
// work is done in the app, and two Escapes still cancel it here. Only the measured live controls take the
// mouse (overlay/mouse.rs).
//
// The controller below holds all the logic and takes the emblem and the DOM through small
// interfaces, so the tests run it in Node.

import { reportMouseRegions } from "./mouse-regions";
export { reportMouseRegions } from "./mouse-regions";
import { Channel, invoke } from "@tauri-apps/api/core";
import { cancelGesture } from "../shared/cancel-gesture";
import "../shared/cancel-gesture.css";
import "../shared/task-action.css";
import { ico } from "../main/ui";
import { catalogs, isUiLocale, type UiLocale } from "../main/i18n";
import { replyLine } from "../shared/anime";
import { captionLines } from "./caption";
import { Emblem, canvasSize, loadGlyphTexture, pictureStyle, type Mode, type Mood, type Phase, type PictureCrop } from "./emblem";
import { noticeDurationMs } from "./notice";
import type { ProgressReport, Stage } from "./progress";
import { ProgressArc } from "./progress";
import { COMPLETION_MS, formatProgress, progressPercent } from "./progress-caption";
import { WAITING_LINE_MS, nextWaitingLine } from "./waiting-lines";
import { EntranceTimer, FrameWatch, describeError, guardHandler, subscribeWithRetry, type LogLevel, type PageLog } from "./diagnostics";

/** The language of every subtitle: the interface language of the app. */
export type UiLanguage = UiLocale;

const isLanguage = isUiLocale;

/** The words of an event, which come over the IPC: a field that is not text is no words. */
const words = (value: unknown): string => (typeof value === "string" ? value : "");

/** The lines of an event, likewise: whatever is not a text is no line. */
const wordList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((line): line is string => typeof line === "string" && line !== "") : [];

/** Whether reports (notices, learned words) are written next to the emblem. Answers and questions always are. */
type SubtitleMode = "on" | "off";

/** T2 asks for a click; T3 (what cannot be undone) for a click that was first held. */
export type AskTier = "T2" | "T3";

/** The events overlay.rs sends (`OverlayEvent`). */
export type OverlayEvent =
  | { type: "mouse"; revision: number }
  | { type: "cancelkey"; reset: boolean }
  /** `line`: Raphael's greeting to a question, beside the emblem while he listens. A dictation has none. */
  | { type: "show"; mode: Mode; line?: string }
  /**
   * `quiet`: thinking about a question, which has no progress to show. Its `lines` (Raphael's
   * reports on the analysis, a phrase book in the interface language) change beside the emblem, in
   * the percentage's place, so that the wait does not look like a hang.
   */
  | { type: "mode"; mode: Mode; quiet?: boolean; lines?: string[] }
  | { type: "level"; value: number }
  | { type: "progress"; stage: Stage; done: number; total: number; audio_seconds: number }
  | { type: "step"; text: string; language: string }
  | { type: "notice"; text: string }
  | { type: "learned"; text: string }
  | { type: "say"; prefix: string; text: string }
  /**
   * `always`: the label of a third answer, 「一律允許」, in the interface language. Only a question
   * about letting Raphael operate an app has it (the other questions have two answers); such a
   * question is always T2.
   */
  | { type: "ask"; id: string; tier: AskTier; prefix: string; text: string; yes: string; no: string; always?: string; timeout_ms: number }
  /**
   * Raphael operates an app on the owner's PC. `line` is complete and already wrapped in 《》 in the
   * interface language (《告。操作中：點擊「七」》): it stands in the caption's place, still, until
   * another event replaces it. An open question goes from the screen without an answer (the app
   * already has it).
   */
  | { type: "operate"; line: string }
  | { type: "complete" }
  | { type: "hide" }
  | { type: "settings"; px: number; subtitles: string; language: string }
  /** Raphael's picture changed: the page asks for it again (`avatar_get`). */
  | { type: "avatar" };

/** What the controller needs from the emblem. */
export interface EmblemControl {
  readonly phase: Phase;
  /** Seconds of the appear animation still to play. */
  readonly appearLeft: number;
  level: number;
  appear(): void;
  vanish(): void;
  set(mode: Mode): void;
  speak(seconds: number): void;
  size(px: number): void;
  /** Gold, or red while Raphael refuses (a 否 line). */
  mood?: Mood;
}

/**
 * Whether a line is one of Raphael's refusals: his notices and answers start with 告 (report) or 否 (refusal) in Chinese
 * and Japanese and `Notice.` or `Negative.` in English (notices.rs). A refusal is when he is angry.
 */
export const isRefusal = (text: string): boolean => /^\s*《?\s*(?:否|Negative|No|거절|Non|Nein|Não|Нет|Không|ไม่|Tidak|Hayır)[。.]/u.test(text);

/** What the buttons of a question say, and how strict the question is. */
export interface AskButtons {
  yes: string;
  no: string;
  /** The label of the third button (the answer YES, always); absent when the question has two answers. */
  always?: string;
  tier: AskTier;
  language: UiLanguage;
}

/** What the controller needs from the page. */
export interface OverlayView {
  showQuestion?(text: string, language: UiLanguage): void;
  /** The emblem is `px` wide now: move the subtitles to match. */
  layout(px: number): void;
  /** Shows one line of subtitles, in the language it is written in. */
  showLine(text: string, language: UiLanguage): void;
  clearLine(): void;
  /** Processing progress is separate from spoken subtitles; null hides it. */
  showProgress(percent: number | null): void;
  /** The waiting line of a question being thought about, in the progress caption's place; null hides it. */
  showWaiting(text: string | null, language: UiLanguage): void;
  /** The buttons (two, or three with `always`) come in under the line. */
  showAsk(buttons: AskButtons): void;
  /** An answer was sent: the buttons stop taking clicks and the chosen one stays pressed; null takes it back. */
  setChoice(choice: "yes" | "no" | "always" | null): void;
  hideAsk(): void;
}

/** The app answers a question that ran out itself; the page lets go of it this long after. */
const ASK_GRACE_MS = 1500;
/** Used when a question does not say how long it waits. */
const DEFAULT_ASK_TIMEOUT_MS = 30_000;

interface Notice {
  text: string;
  /**
   * Learned words never interrupt a dictation, and a later show, complete or hide keeps them. Raphael's
   * own answers (`say`) are written whatever the subtitles setting says.
   */
  kind: "notice" | "learned" | "say";
  /** A refusal (《否。…》 / 《Negative. …》): Raphael's emblem is red while it shows (owner, 2026-11-07). */
  angry?: boolean;
}

/** A question that is on screen, or about to be. */
interface Ask {
  id: string;
  tier: AskTier;
  /** 《問。…》, as it is written. */
  line: string;
  yes: string;
  no: string;
  /** The label of the third answer, or null for a question with two. */
  always: string | null;
  timeoutMs: number;
  /** The words and the buttons are on screen (the appear animation has played). */
  shown: boolean;
  /** The question's own words, to show the card again if the answer could not be sent. */
  text: string;
  /** The answer that was sent while the app has not yet replaced the question.*/
  chosen: "yes" | "no" | "always" | null;
}

export interface ControllerOptions {
  /**
   * Sends the person's answer to the app (the `overlay_confirm` command). `always` is passed only
   * with the third answer (YES, and keep allowing); the other two answers leave it out.
   */
  confirm?: (id: string, approved: boolean, always?: boolean) => Promise<unknown>;
  /** Where a problem is reported (the app's log). It never gets the words on screen. */
  log?: PageLog;
  /** Picks the waiting lines: a number from 0 up to but not including 1. Math.random if left out. */
  random?: () => number;
}

export class OverlayController {
  private subtitles: SubtitleMode = "on";
  private language: UiLanguage = "zh-TW";
  private mode: Mode = "steady";
  /** Lines that wait for the one on screen. */
  private readonly queue: Notice[] = [];
  /** A line is on screen, or about to be (or a question is). */
  private busy = false;
  /** A show owns the emblem until a hide or notice takes over, regardless of renderer state. */
  private activeShow = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ask: Ask | null = null;
  private askTimer: ReturnType<typeof setTimeout> | undefined;
  /** Raphael's greeting is on screen (or about to be) while he listens for a question. */
  private greeting = false;
  private greetTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly progress = new ProgressArc();
  private progressTimer: ReturnType<typeof setInterval> | undefined;
  private progressClock = 0;
  private lastProgress: number | null = null;
  /** The waiting lines are rotating beside the emblem: Raphael is thinking about a question. */
  private waitingTimer: ReturnType<typeof setInterval> | undefined;
  private waitingLines: string[] = [];
  /** The line on screen now, so that the next one is another. */
  private waitingLine: string | null = null;
  /** Raphael's `operate` line is in the caption's place (static, with no rotation) until something replaces it. */
  private operating = false;

  constructor(
    private readonly emblem: EmblemControl,
    private readonly view: OverlayView,
    private readonly options: ControllerOptions = {},
  ) {}

  /** Visibility intent for diagnostics, independent of a possibly broken renderer phase. */
  get expectsPaint(): boolean {
    return this.activeShow || this.busy;
  }

  handle(event: OverlayEvent): void {
    switch (event.type) {
      case "show":
        // Dictation (and anything else that shows the emblem) takes over from a notice, and
        // starts without the last dictation's progress.
        this.cancelNotices();
        this.activeShow = true;
        this.appearIfHidden();
        this.setMode(event.mode);
        this.greet(words(event.line));
        break;
      case "mode":
        this.setMode(event.mode, event.quiet === true, wordList(event.lines));
        break;
      case "level":
        this.emblem.level = event.value;
        break;
      case "step":
        if (!this.activeShow || this.mode !== "thinking" || !words(event.text).trim()) break;
        this.dropGreeting();
        this.stopProgress();
        this.stopWaiting();
        this.operating = true;
        this.view.showWaiting(event.text, isLanguage(event.language) ? event.language : this.language);
        break;
      case "progress":
        // How far the dictation has come is a percentage beside the whole ring.
        this.updateProgress({
          stage: event.stage,
          done: event.done,
          total: event.total,
          audioSeconds: event.audio_seconds,
        });
        break;
      case "complete":
        if (!this.activeShow) break;
        this.activeShow = false;
        this.cancelNotices();
        this.busy = true;
        this.appearIfHidden();
        this.emblem.set("steady");
        this.view.showProgress(100);
        this.lastProgress = 100;
        this.timer = setTimeout(() => {
          this.view.showProgress(null);
          this.lastProgress = null;
          this.next();
        }, COMPLETION_MS);
        break;
      case "learned":
        // A dictation or a question on screen owns the emblem: the words wait for its end.
        if (words(event.text) === "") break;
        this.queue.push({ text: words(event.text), kind: "learned" });
        if (!this.activeShow && !this.busy) this.next();
        break;
      case "notice":
        // an event without words (an app that speaks the older pair of lines, say) shows nothing
        if (words(event.text) !== "") this.speak({ text: words(event.text), kind: "notice" });
        break;
      case "say":
        // Raphael's answer comes before the learned words that wait: it is what was asked for.
        if (words(event.prefix) !== "" || words(event.text) !== "") {
          this.speak({ text: replyLine(words(event.prefix), words(event.text)), kind: "say" }, true);
        }
        break;
      case "ask":
        this.startAsk(event);
        break;
      case "operate":
        this.operate(words(event.line));
        break;
      case "hide":
        this.activeShow = false;
        this.cancelNotices();
        // Learned words that waited for the dictation take the emblem as it is, instead of a vanish.
        if (this.queue.length > 0) this.next();
        else this.emblem.vanish();
        break;
      case "settings":
        this.subtitles = event.subtitles === "off" ? "off" : "on";
        if (isLanguage(event.language)) this.language = event.language;
        if (Number.isFinite(event.px) && event.px > 0) {
          this.emblem.size(event.px);
          this.view.layout(event.px);
        }
        break;
    }
  }

  // ---------- the buttons of a question ----------

  /** The question on screen, if it takes an answer now. */
  private open(): Ask | null {
    const ask = this.ask;
    return ask && ask.shown && ask.chosen === null ? ask : null;
  }

  /**
   * A click on a button: one press answers, for every tier (owner, 2026-11-11: 「長按才會繼續，點一下就可以了，不用這麼複雜」;
   * it was a press held for 0.6 s on the YES of a T3 question until then). The `always` button exists only on a question
   * that has the label (always T2); without it a click on it is ignored. A second press finds the question answered.
   */
  clickAsk(button: "yes" | "no" | "always"): void {
    const ask = this.open();
    if (!ask) return;
    if (button === "always" && ask.always === null) return;
    this.choose(ask, button !== "no", button === "always");
  }

  /** Sends the answer, and the card goes at once: waiting for the app to replace it left a pressed card on screen. */
  private choose(ask: Ask, approved: boolean, always = false): void {
    ask.chosen = always ? "always" : approved ? "yes" : "no";
    this.view.setChoice(ask.chosen);
    this.view.hideAsk();
    this.view.clearLine();
    let sent: Promise<unknown>;
    try {
      sent = Promise.resolve(always ? this.options.confirm?.(ask.id, true, true) : this.options.confirm?.(ask.id, approved));
    } catch (err) {
      sent = Promise.reject(err);
    }
    sent.catch((err) => {
      this.options.log?.("warn", `could not send the answer to a question: ${describeError(err)}`);
      // The question is still there for another try, unless something replaced it meanwhile.
      if (this.ask === ask) {
        ask.chosen = null;
        this.view.showLine(ask.line, this.language);
        this.view.showQuestion?.(ask.text, this.language);
        this.view.showAsk({ yes: ask.yes, no: ask.no, ...(ask.always !== null ? { always: ask.always } : {}), tier: ask.tier, language: this.language });
      }
    });
  }

  private startAsk(event: Extract<OverlayEvent, { type: "ask" }>): void {
    if (typeof event.id !== "string" || event.id === "") {
      this.options.log?.("warn", "a question without an id was ignored");
      return;
    }
    this.activeShow = false;
    // The words, buttons and progress of before go; learned words that wait stay.
    this.cancelNotices();
    const always = words(event.always) || null;
    const ask: Ask = {
      id: event.id,
      // What is not plainly a T2 question is asked the strict way; a question with the third
      // answer (letting Raphael operate an app) is never held.
      tier: event.tier === "T2" || always !== null ? "T2" : "T3",
      line: replyLine(words(event.prefix), words(event.text)),
      text: words(event.text),
      yes: words(event.yes) || "✓",
      no: words(event.no) || "✕",
      always,
      timeoutMs: Number.isFinite(event.timeout_ms) && event.timeout_ms > 0 ? event.timeout_ms : DEFAULT_ASK_TIMEOUT_MS,
      shown: false,
      chosen: null,
    };
    this.ask = ask;
    this.busy = true;
    this.appearIfHidden();
    this.emblem.set("steady");
    // The words and the buttons come when the appear animation has played (at once if already visible).
    this.timer = setTimeout(() => {
      ask.shown = true;
      this.view.showLine(ask.line, this.language);
      this.view.showQuestion?.(words(event.text), this.language);
      this.view.showAsk({
        yes: ask.yes,
        no: ask.no,
        ...(ask.always !== null ? { always: ask.always } : {}),
        tier: ask.tier,
        language: this.language,
      });
      this.emblem.speak(noticeDurationMs(ask.line) / 1000);
    }, this.emblem.appearLeft * 1000);
    // The app answers a question that was not answered in time. If it does not, the page lets go.
    this.askTimer = setTimeout(() => this.expire(ask), ask.timeoutMs + ASK_GRACE_MS);
  }

  private expire(ask: Ask): void {
    if (this.ask !== ask) return;
    this.cancelNotices();
    if (this.queue.length > 0) this.next();
    else this.emblem.vanish();
  }

  /** The question goes: its words, its buttons and the timers that belong to it. */
  private dropAsk(): void {
    clearTimeout(this.askTimer);
    this.askTimer = undefined;
    if (this.ask) {
      this.ask = null;
      this.view.hideAsk();
    }
  }

  // ---------- the emblem and the words ----------

  private appearIfHidden(): void {
    if (this.emblem.phase === "hidden" || this.emblem.phase === "vanish") this.emblem.appear();
  }

  /**
   * Raphael greets a question: the line stays beside the listening emblem until he has heard it.
   * It is written whatever the subtitles setting says, like his answers: it is what tells a
   * question from a dictation.
   */
  private greet(line: string): void {
    if (line === "") return;
    this.greeting = true;
    // The words come when the appear animation has played (at once if already visible).
    this.greetTimer = setTimeout(() => {
      this.greetTimer = undefined;
      this.view.showLine(line, this.language);
    }, this.emblem.appearLeft * 1000);
  }

  /** The greeting goes: the question has been heard, or something else takes the stage. */
  private dropGreeting(): void {
    clearTimeout(this.greetTimer);
    this.greetTimer = undefined;
    if (!this.greeting) return;
    this.greeting = false;
    this.view.clearLine();
  }

  private setMode(mode: Mode, quiet = false, lines: string[] = []): void {
    this.mode = mode;
    if (mode !== "listening") this.dropGreeting();
    this.emblem.set(mode);
    if (this.activeShow && mode === "thinking" && quiet) this.startWaiting(lines);
    else this.stopWaiting();
    if (this.activeShow && mode === "thinking" && !quiet && !this.progress.active) {
      this.progress.report({ stage: "transcribing", done: 0, total: 1, audioSeconds: 0 });
      this.renderProgress();
      this.startProgressTimer();
    }
  }

  private updateProgress(report: ProgressReport): void {
    if (!this.activeShow) return;
    // The percentage takes the caption from the waiting lines.
    this.stopWaiting();
    this.progress.report(report);
    this.renderProgress();
    this.startProgressTimer();
  }

  private startProgressTimer(): void {
    if (this.progressTimer !== undefined) return;
    this.progressClock = Date.now();
    this.progressTimer = setInterval(() => {
      const now = Date.now();
      this.progress.advance(Math.max(0, now - this.progressClock) / 1000);
      this.progressClock = now;
      this.renderProgress();
    }, 100);
  }

  private renderProgress(): void {
    const stage = this.progress.currentStage;
    if (!stage || !this.activeShow) return;
    const percent = progressPercent(stage, this.progress.fraction);
    if (percent === this.lastProgress) return;
    this.lastProgress = percent;
    this.view.showProgress(percent);
  }

  private stopProgress(): void {
    clearInterval(this.progressTimer);
    this.progressTimer = undefined;
    this.progress.reset();
    this.lastProgress = null;
    this.view.showProgress(null);
  }

  /**
   * A question is being thought about, and nothing reports how far it has come: a waiting line
   * beside the emblem, in the caption's place, shows that Raphael is at work. It belongs to the
   * question, like his greeting and his answer, so like the percentage it is written whatever the
   * subtitles setting says.
   */
  private startWaiting(lines: string[]): void {
    // Already going, or an app that sent no lines (an older one, say): the thinking stays quiet.
    if (this.waitingTimer !== undefined || lines.length === 0) return;
    this.waitingLines = lines;
    this.changeWaitingLine();
    this.waitingTimer = setInterval(() => this.changeWaitingLine(), WAITING_LINE_MS);
  }

  private changeWaitingLine(): void {
    this.waitingLine = nextWaitingLine(this.waitingLines, this.waitingLine, this.options.random);
    this.view.showWaiting(this.waitingLine, this.language);
  }

  /**
   * Raphael operates an app: the emblem shows (it appears if hidden) in the `operating` mode and
   * `line` stands in the caption's place, still. Like his answers it is written whatever the
   * subtitles setting says. A question on screen goes without an answer being sent, and the
   * reports that waited go too, as with a dictation that starts.
   */
  private operate(line: string): void {
    if (line === "") return;
    this.cancelNotices();
    this.activeShow = true;
    this.appearIfHidden();
    this.setMode("operating");
    this.operating = true;
    this.view.showWaiting(line, this.language);
  }

  /** The waiting lines go: the thinking is over, or something else takes the caption. */
  private stopWaiting(): void {
    if (this.waitingTimer === undefined && !this.operating) return;
    clearInterval(this.waitingTimer);
    this.waitingTimer = undefined;
    this.operating = false;
    this.waitingLine = null;
    this.waitingLines = [];
    this.view.showWaiting(null, this.language);
  }

  /** Raphael speaks: the dictation's progress has said what it had to, and a question is answered. */
  private speak(notice: Notice, first = false): void {
    this.activeShow = false;
    this.dropGreeting();
    this.stopWaiting();
    if (this.progress.active) this.stopProgress();
    if (this.ask) this.cancelNotices();
    // Told in pages without addresses (`captionLines`).
    const lines = captionLines(notice.text, this.language);
    const angry = isRefusal(notice.text);
    const pages = lines.map((text) => ({ ...notice, text, angry }));
    // Before the learned words that wait, but behind the lines of Raphael's that came earlier.
    const at = first ? this.queue.findIndex((queued) => queued.kind === "learned") : -1;
    if (at >= 0) this.queue.splice(at, 0, ...pages);
    else this.queue.push(...pages);
    if (!this.busy) this.next();
  }

  /** Shows the next line, or lets the emblem vanish when none is left. */
  private next(): void {
    const notice = this.queue.shift();
    if (!notice) {
      this.busy = false;
      this.emblem.vanish();
      return;
    }
    this.busy = true;
    // Red for a refusal from its first frame, gold again for any other line.
    this.emblem.mood = notice.angry ? "angry" : "calm";
    this.appearIfHidden();
    this.emblem.set("steady");
    // The words come when the appear animation has played (at once if already visible).
    const lead = this.emblem.appearLeft * 1000;
    const duration = noticeDurationMs(notice.text);
    this.timer = setTimeout(() => {
      this.showLine(notice);
      this.emblem.speak(duration / 1000);
      this.timer = setTimeout(() => {
        this.view.clearLine();
        this.next();
      }, duration);
    }, lead);
  }

  private showLine({ text, kind }: Notice): void {
    if (kind !== "say" && this.subtitles === "off") return;
    if (text !== "") this.view.showLine(text, this.language);
  }

  /** Stops what is on screen and drops the reports that wait; learned words stay queued. */
  private cancelNotices(): void {
    this.dropGreeting();
    this.dropAsk();
    this.stopWaiting();
    this.stopProgress();
    clearTimeout(this.timer);
    this.timer = undefined;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].kind !== "learned") this.queue.splice(i, 1);
    }
    this.busy = false;
    this.view.clearLine();
    // Whatever takes the emblem next (a dictation, a question) starts in his gold.
    this.emblem.mood = "calm";
  }
}

/** The page's elements. */
class DomView implements OverlayView {
  constructor(
    /** Carries the emblem size for the style sheet (`--e`, `--c`). */
    private readonly root: HTMLElement,
    private readonly box: HTMLElement,
    private readonly line: HTMLElement,
    private readonly progress: HTMLElement,
    private readonly question: HTMLElement,
    private readonly yes: HTMLButtonElement,
    private readonly no: HTMLButtonElement,
    private readonly always: HTMLButtonElement,
  ) {}

  layout(px: number): void {
    this.root.style.setProperty("--e", `${px}px`);
    this.root.style.setProperty("--c", `${canvasSize(px)}px`);
  }

  showLine(text: string, language: UiLanguage): void {
    this.line.textContent = text;
    this.line.lang = language;
    void this.box.offsetWidth; // so that the fade-in starts from the cleared state
    this.box.classList.add("on");
  }

  clearLine(): void {
    this.box.classList.remove("on");
    this.line.textContent = "";
  }

  showProgress(percent: number | null): void {
    this.progress.hidden = percent === null;
    this.progress.textContent = percent === null ? "" : formatProgress(percent);
    // Digits are set as the page is, whatever language the waiting lines were in.
    this.progress.removeAttribute("lang");
  }

  /** The same caption as the percentage, set in the language of its words. */
  showWaiting(text: string | null, language: UiLanguage): void {
    this.progress.hidden = text === null;
    this.progress.textContent = text ?? "";
    this.progress.lang = language;
  }

  showAsk({ yes, no, always, tier, language }: AskButtons): void {
    this.yes.querySelector(".ask-label")!.textContent = yes;
    this.no.textContent = no;
    this.always.textContent = always ?? "";
    this.always.hidden = always === undefined;
    this.question.lang = language;
    this.question.dataset.tier = tier;
    this.setChoice(null);
    this.question.hidden = false;
    this.box.classList.add("asking");
    void this.question.offsetWidth;
    this.question.classList.add("on");
  }

  showQuestion(text: string, language: UiLanguage): void {
    const title = this.question.querySelector<HTMLElement>("#ask-title")!;
    const details = this.question.querySelector<HTMLElement>("#ask-details")!;
    const expand = this.question.querySelector<HTMLButtonElement>("#ask-expand")!;
    const parts = confirmationParts(text);
    title.textContent = parts.title;
    details.textContent = parts.details;
    details.hidden = !parts.details;
    delete this.question.dataset.expanded;
    expand.setAttribute("aria-expanded", "false");
    const labels = questionLabels(language);
    expand.textContent = labels.more;
    expand.onclick = () => {
      const expanded = expand.getAttribute("aria-expanded") !== "true";
      this.question.dataset.expanded = String(expanded);
      expand.setAttribute("aria-expanded", String(expanded));
      expand.textContent = expanded ? labels.less : labels.more;
    };
    requestAnimationFrame(() => { expand.hidden = details.scrollHeight <= details.clientHeight + 1; });
  }

  setChoice(choice: "yes" | "no" | "always" | null): void {
    this.question.dataset.choice = choice ?? "";
    this.yes.disabled = this.no.disabled = this.always.disabled = choice !== null;
  }

  hideAsk(): void {
    this.question.classList.remove("on");
    this.question.hidden = true;
    this.box.classList.remove("asking");
    this.setChoice(null);
  }
}

/** A supplied first line or first sentence names the intent; every remaining word stays available. */
export function confirmationParts(text: string): { title: string; details: string } {
  const body = text.trim();
  const boundary = body.search(/[\n。！？!?]/u);
  if (boundary >= 0 && boundary < 80) return { title: body.slice(0, boundary + 1).trim(), details: body.slice(boundary + 1).trim() };
  if (body.length <= 60) return { title: body, details: "" };
  const word = body.lastIndexOf(" ", 48);
  const end = word > 0 ? word : 48;
  return { title: body.slice(0, end).trimEnd() + "…", details: body.slice(end).trimStart() };
}

const questionLabels = (language: UiLanguage) => {
  const messages = catalogs[language];
  return {more:messages["common.showAll"],less:messages["common.showLess"],stop:messages["rooms.stop"],hint:messages["common.cancelAgain"]};
};

/** The glyph ring texture (app/public/brand/glyph-ring.png). */
const GLYPH_URL = "/brand/glyph-ring.png";
/** Until the first Settings event arrives. */
const DEFAULT_PX = 150;
/** The texture is a local file; if it takes longer than this, start without it. */
const TEXTURE_WAIT_MS = 2000;

/**
 * Writes `message` to the app's log (raphael.log, as "overlay page: ..."). Never throws and never
 * reports its own failure, so that it cannot loop.
 */
function pageLog(level: LogLevel, message: string): void {
  invoke("overlay_log", { level, message }).catch(() => {});
}

/** Uncaught errors anywhere in the page go to the app's log too. */
function reportUncaught(): void {
  window.addEventListener("error", (event) => {
    const where = event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : "";
    pageLog("error", `uncaught error${where}: ${describeError(event.error ?? event.message)}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    pageLog("error", `unhandled rejection: ${describeError(event.reason)}`);
  });
  // A webview that thinks its window cannot be seen stops the animation frames.
  document.addEventListener("visibilitychange", () => {
    pageLog("info", `document ${document.visibilityState}`);
  });
}

/** The buttons of a question, handed to the controller: one click answers. */
function wireQuestion(
  controller: OverlayController,
  yes: HTMLButtonElement,
  no: HTMLButtonElement,
  always: HTMLButtonElement,
): void {
  yes.addEventListener("click", () => controller.clickAsk("yes"));
  no.addEventListener("click", () => controller.clickAsk("no"));
  always.addEventListener("click", () => controller.clickAsk("always"));
}

async function start(): Promise<void> {
  reportUncaught();
  pageLog("info", `loaded (document ${document.visibilityState}, ${window.innerWidth}x${window.innerHeight} at ${window.devicePixelRatio})`);

  const canvas = document.getElementById("emblem");
  const box = document.getElementById("subtitles");
  const line = box?.querySelector<HTMLElement>(".sub-line");
  const progress = document.getElementById("progress");
  const question = document.getElementById("ask");
  const yes = document.getElementById("ask-yes");
  const no = document.getElementById("ask-no");
  const always = document.getElementById("ask-always");
  if (
    !(canvas instanceof HTMLCanvasElement) || !box || !line || !progress || !question ||
    !(yes instanceof HTMLButtonElement) || !(no instanceof HTMLButtonElement) || !(always instanceof HTMLButtonElement)
  ) {
    throw new Error("overlay.html is missing the emblem canvas, subtitles, progress, or question");
  }

  // The window takes the mouse while a question is up: no menu of the browser (Back, Refresh...) over it.
  document.addEventListener("contextmenu", (event) => event.preventDefault());

  const view = new DomView(document.documentElement, box, line, progress, question, yes, no, always);
  view.layout(DEFAULT_PX);
  const emblem = new Emblem(canvas, DEFAULT_PX, { surface: "transparent" });
  const controller = new OverlayController(emblem, view, {
    // `always` goes only with the third answer; the other two are sent as they have always been.
    confirm: (id, approved, always) =>
      invoke("overlay_confirm", always ? { id, approved, always: true } : { id, approved }),
    log: pageLog,
  });
  wireQuestion(controller, yes, no, always);
  const mouse = reportMouseRegions(document.body, report => invoke("floating_controls", { ...report }));
  const stop = document.getElementById("overlay-stop") as HTMLButtonElement;
  stop.innerHTML = ico("stop") + '<span class="task-action-label overlay-stop-label"></span>';
  const stopLabel = stop.querySelector<HTMLElement>(".overlay-stop-label")!;
  const labelStop = (language: UiLanguage) => {
    stopLabel.textContent = questionLabels(language).stop;
    stop.setAttribute("aria-label", stopLabel.textContent);
  };
  labelStop("zh-TW");
  let taskRun = 0, taskActive = false, language: UiLanguage = "zh-TW";
  const gesture = cancelGesture();
  gesture.register(() => taskActive ? {key:`overlay:${taskRun}`,button:stop.hidden ? canvas : stop,hint:questionLabels(language).hint,cancel:()=>stop.click()} : null);
  stop.onclick = () => { void invoke("overlay_cancel").catch(error => pageLog("warn", describeError(error))); };
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const theme = () => { document.documentElement.dataset.theme = scheme.matches ? "dark" : "light"; };
  theme(); scheme.addEventListener("change", theme);
  const frames = new FrameWatch(() => emblem.frames, () => document.visibilityState, pageLog, {
    canvas,
    expected: () => controller.expectsPaint,
  });
  const entrance = new EntranceTimer(pageLog, () => document.visibilityState);

  // The texture comes first, so that no event meets a half-ready emblem. Without the file the
  // load fails and the plain vector ring is drawn.
  await Promise.race([
    loadGlyphTexture(GLYPH_URL),
    new Promise((resolve) => setTimeout(resolve, TEXTURE_WAIT_MS)),
  ]);

  // Raphael's picture, when the person chose one: it is drawn in the emblem's place.
  const picture = (): Promise<void> => showPicture(emblem);
  await picture();

  // Subscribe once (again if that fails). Events that came before this point wait on the Rust
  // side. An event that fails is reported and the channel goes on.
  // Read afresh each time: the controller changes the phase while it handles an event.
  const phase = (): string => emblem.phase;
  const handle = guardHandler((event) => {
    if (event.type === "mouse") { mouse.reset(event.revision); return; }
    if (event.type === "cancelkey") { if(event.reset)gesture.clear();else gesture.press();return; }
    if (event.type === "settings" && isLanguage(event.language)) { language=event.language; document.documentElement.lang=language; labelStop(language); }
    if (event.type === "show" || event.type === "mode") { taskRun++;taskActive=true;stop.hidden=true; }
    if (["hide","complete","notice","operate"].includes(event.type) || event.type === "say") { taskActive=false;stop.hidden=true; }
    // A question answers yes or no here; stopping the work is done in the app.
    if (event.type === "ask") { taskRun++;taskActive=true;stop.hidden=true; }
    gesture.sync();
    if (event.type === "avatar") {
      void picture();
      return;
    }
    const away = phase() === "hidden" || phase() === "vanish";
    controller.handle(event);
    if (away && phase() === "appear") entrance.start();
    if (
      event.type === "show" || event.type === "notice" || event.type === "learned" || event.type === "complete" ||
      event.type === "say" || event.type === "ask" || event.type === "operate"
    ) {
      frames.expectFrames(event.type);
    }
  }, pageLog);
  await subscribeWithRetry(() => {
    const channel = new Channel<OverlayEvent>(handle);
    return invoke("overlay_subscribe", { channel });
  }, pageLog);
}

/** The only addresses the picture may have: a data URL of one of the four kinds the app takes. */
const PICTURE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/** What `avatar_get` answered, if it is a picture to draw: its address and its crop. */
export function pictureOf(value: unknown): { url: string; crop: PictureCrop } | null {
  if (!value || typeof value !== "object") return null;
  const { url, crop } = value as { url?: unknown; crop?: Partial<PictureCrop> };
  if (typeof url !== "string" || !PICTURE_URL.test(url)) return null;
  const num = (v: unknown, fallback: number, low: number, high: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : fallback;
  return { url, crop: { x: num(crop?.x, 0.5, 0, 1), y: num(crop?.y, 0.5, 0, 1), zoom: num(crop?.zoom, 1, 1, 4) } };
}

/**
 * Asks the app for Raphael's picture and draws it in the emblem's place; the emblem when there is
 * none. The picture goes both to the canvas (its first frame, under reduced motion) and to the
 * `#picture` layer over it, whose `<img>` plays a GIF or WebP that moves (see `Emblem.setPicture`).
 */
async function showPicture(emblem: Emblem): Promise<void> {
  let chosen: { url: string; crop: PictureCrop } | null = null;
  try {
    chosen = pictureOf(await invoke("avatar_get"));
  } catch (err) {
    pageLog("warn", `the picture could not be read: ${describeError(err)}`);
  }
  const layer = document.getElementById("picture");
  const layerImage = layer?.querySelector("img") ?? null;
  if (!chosen) {
    emblem.setPicture(null);
    layerImage?.removeAttribute("src");
    return;
  }
  const image = new Image();
  image.decoding = "async";
  image.src = chosen.url;
  try {
    await image.decode();
  } catch {
    pageLog("warn", "the picture could not be decoded; the emblem stays");
    emblem.setPicture(null);
    layerImage?.removeAttribute("src");
    return;
  }
  if (layer && layerImage) {
    layerImage.src = chosen.url;
    layerImage.setAttribute("style", pictureStyle(chosen.crop));
  }
  emblem.setPicture(image, chosen.crop, layer && layerImage ? layer : null);
}

// Only in the overlay page (the tests import this file in Node).
if (typeof document !== "undefined" && document.getElementById("emblem")) {
  start().catch((err) => {
    console.error("overlay: could not start", err);
    pageLog("error", `could not start: ${describeError(err)}`);
  });
}
