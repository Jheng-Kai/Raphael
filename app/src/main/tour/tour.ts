// Raphael's guided tour of the main window (R-TOUR-01..04). Once, right after the first-run guide, Raphael springs out of
// the account button at the bottom left and asks whether you want a short tour; then it walks the window step by step,
// pointing at one part at a time with a dim, a cut-out and one plain line. The account menu's 導覽 starts it again.
//
// This file is the state of the tour; tour/view.ts draws it and tour/steps.ts says what it points at.

import { onLocaleChange, t } from "../i18n";
import type { MessageKey } from "../i18n/zh-TW";
import type { AppContext, DeviceSettings, PageId, PageArgument, SettingsPane } from "../types";
import { reducedMotion } from "../ui";
import { createView, type ButtonId, type Pressed, type TourView, type ViewModel } from "./view";
import { STEPS, askKeys, firstShown, shown, spotOf, tourMinutes, type TourStep } from "./steps";

/** A catalogue line by a key the steps name, with the values it takes. */
const say = t as unknown as (key: MessageKey, values?: Record<string, string | number>) => string;

/** What the tour needs of the window: the app context, and nothing more. */
export type TourHost = Pick<AppContext, "closeSettings"> & {
  go(page: PageId, arg?: PageArgument): void;
  device(): DeviceSettings;
  setDevice(patch: Partial<DeviceSettings>): Promise<unknown>;
};

export interface Tour {
  /** After the first-run guide: offers the tour, once. Never again on its own. */
  offerOnce(): void;
  /** Starts the tour at its first step (the offer's 開始, the account menu's 導覽). */
  start(): void;
  /** Whether the offer, a step or the goodbye is on screen. */
  active(): boolean;
  /** Takes everything down at once (the window is closing, a test ends). */
  stop(): void;
}

type Phase = "idle" | "offer" | "step" | "bye";

/** Raphael waits this long after the guide before it appears: the window has just changed size and drawn its first page. */
export const OFFER_DELAY_MS = 700;
/** How long the goodbye stays when nobody presses anything. */
export const BYE_MS = 4500;
/** How long Settings takes to open before the cut-out measures it. */
const SETTLE_MS = 240;
const SETTLE_AGAIN_MS = [160, 420];
const POLL_MS = 40;
const OPEN_TIMEOUT_MS = 2500;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(ready: () => boolean, timeout = OPEN_TIMEOUT_MS): Promise<boolean> {
  for (let waited = 0; waited <= timeout; waited += POLL_MS) {
    if (ready()) return true;
    await sleep(POLL_MS);
  }
  return ready();
}

const account = (): HTMLElement | null => firstShown("#nav .sidebar-account");
const paneShown = (pane: SettingsPane): boolean => !!document.querySelector(`.modal-scrim[data-page="settings"] [data-pane="${pane}"][aria-current="page"]`);

export function createTour(host: TourHost): Tour {
  let phase: Phase = "idle";
  let view: TourView | null = null;
  let list: TourStep[] = [];
  let at = 0;
  /** Settings is open because of the tour. */
  let settingsOpen = false;
  /** A step is being entered (its Settings tab opening): a press on a button waits for it. */
  let entering = false;
  let run = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let focusBefore: HTMLElement | null = null;
  let unlisten: (() => void)[] = [];
  const inertHosts = (): HTMLElement[] => ["nav", "main"].map(id => document.getElementById(id)).filter((el): el is HTMLElement => !!el);

  const clearTimers = (): void => { for (const timer of timers) clearTimeout(timer); timers = []; };
  const later = (ms: number, run: () => void): void => { timers.push(setTimeout(run, ms)); };

  // ---------- what is drawn ----------

  const anchorSpot = () => {
    const button = account();
    return button ? { ...spotOf(button, 4), dim: false } : null;
  };
  const origin = () => anchorSpot()?.box ?? null;

  function model(): ViewModel {
    const label = t("tour.menu");
    if (phase === "offer") {
      return {
        mode: "offer", text: t("tour.offer", { minutes: tourMinutes(STEPS.length) }), label,
        buttons: [{ id: "later", label: t("tour.later") }, { id: "start", label: t("tour.start"), primary: true }],
        locate: anchorSpot, prefer: ["above"], align: "start", origin,
      };
    }
    if (phase === "bye") return { mode: "bye", text: t("tour.bye"), label, buttons: [], locate: anchorSpot, prefer: ["above"], align: "start", origin };
    const step = list[at]!;
    const last = at === list.length - 1;
    const buttons: ViewModel["buttons"] = [];
    if (at > 0) buttons.push({ id: "back", label: t("tour.back") });
    buttons.push(last ? { id: "done", label: t("tour.done"), primary: true } : { id: "next", label: t("tour.next"), primary: true });
    const target = step.target;
    return {
      mode: "step", label,
      text: say(step.text, { ask: t("chat.modeAsk") }),
      ...(step.keys ? { keys: askKeys(host.device()) } : {}),
      progress: { shown: `${at + 1}/${list.length}`, label: t("tour.progress", { current: at + 1, total: list.length }) },
      buttons, closeLabel: t("tour.close"),
      locate: target ? () => { const el = target(); return el ? { ...spotOf(el, step.pad ?? 0), dim: true } : null; } : () => null,
      prefer: step.prefer, align: "center", origin,
    };
  }

  function draw(hop: boolean): void {
    view ??= createView(pressed);
    view.render(model(), { hop });
    if (phase === "step") {
      view.focusPrimary();
      // A dialog still opening, a composer still growing: measure again once they have settled.
      clearTimers();
      for (const ms of SETTLE_AGAIN_MS) later(ms, () => view?.reflow());
    }
  }

  // ---------- the offer ----------

  function offerOnce(): void {
    if (phase !== "idle" || host.device().tour_offered) return;
    later(OFFER_DELAY_MS, () => void show(0));
    async function show(tries: number): Promise<void> {
      if (phase !== "idle") return;
      // The account button is drawn with the sidebar; a window that is not ready yet is asked again for a few seconds.
      if (!account()) { if (tries < 20) later(300, () => void show(tries + 1)); return; }
      phase = "offer";
      void Promise.resolve(host.setDevice({ tour_offered: true })).catch(error => console.warn("tour: the offer could not be remembered", error));
      listen();
      draw(true);
    }
  }

  // ---------- the walk ----------

  function start(): void {
    if (phase === "step") return;
    void begin();
  }

  async function begin(): Promise<void> {
    const mine = ++run;
    clearTimers();
    phase = "step";
    entering = true;
    focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (settingsOpen) { host.closeSettings(); settingsOpen = false; }
    // The composer's steps need the conversation on screen.
    if (!firstShown(".page-agent:not([hidden]) .composer")) {
      host.go("agent");
      await waitFor(() => !!firstShown(".page-agent:not([hidden]) .composer"), 1500);
      if (mine !== run) return;
    }
    list = STEPS.filter(step => step.pane || (step.keys ? askKeys(host.device()).length > 0 : !!step.target?.()));
    if (!list.length) { finish(); return; }
    at = 0;
    for (const element of inertHosts()) element.inert = true;
    listen();
    await arrive(1, true);
  }

  /** Shows step `at`, going `direction`; a step whose target is not on screen is dropped and the next one is tried. */
  async function arrive(direction: 1 | -1, hop: boolean): Promise<void> {
    const mine = ++run;
    entering = true;
    for (;;) {
      const step = list[at];
      if (!step) { finish(); return; }
      if (step.pane) {
        if (!settingsOpen) { host.go("settings", step.pane); settingsOpen = true; }
        else document.querySelector<HTMLElement>(`.modal-scrim[data-page="settings"] [data-pane="${step.pane}"]`)?.click();
        await waitFor(() => paneShown(step.pane!));
        if (!reducedMotion()) await sleep(SETTLE_MS);
      } else if (settingsOpen) {
        host.closeSettings(); settingsOpen = false;
        if (!reducedMotion()) await sleep(SETTLE_MS / 2);
      }
      if (mine !== run) return;
      if (!step.target || shown(step.target())) break;
      // Nothing to point at at this width: never point at nothing.
      list.splice(at, 1);
      if (direction < 0) at = Math.max(0, at - 1);
      else if (at >= list.length) { finish(); return; }
    }
    entering = false;
    draw(hop);
  }

  function press(id: ButtonId | "close"): void {
    if (id === "start") { start(); return; }
    if (id === "later" || id === "close" || id === "done") { finish(); return; }
    if (entering) return;
    if (id === "next") { at += 1; void arrive(1, true); }
    else if (id === "back" && at > 0) { at -= 1; void arrive(-1, true); }
  }

  function pressed(button: Pressed): void {
    if (button === "dismiss") { close(); return; }
    press(button);
  }

  // ---------- the way out ----------

  /** Raphael hops back to the account button and says where to find the tour again; then it fades. */
  function finish(): void {
    if (phase === "idle" || phase === "bye") return;
    run += 1;
    entering = false;
    clearTimers();
    for (const element of inertHosts()) element.inert = false;
    if (settingsOpen) { host.closeSettings(); settingsOpen = false; }
    if (focusBefore?.isConnected && !focusBefore.closest("[inert]")) focusBefore.focus({ preventScroll: true });
    focusBefore = null;
    phase = "bye";
    draw(true);
    later(BYE_MS, close);
  }

  function close(): void {
    clearTimers();
    const leaving = view;
    phase = "idle";
    view = null;
    for (const stop of unlisten) stop();
    unlisten = [];
    for (const element of inertHosts()) element.inert = false;
    leaving?.leave(() => leaving.destroy());
  }

  function stop(): void {
    run += 1;
    clearTimers();
    if (settingsOpen) { host.closeSettings(); settingsOpen = false; }
    const old = view;
    phase = "idle"; view = null;
    for (const off of unlisten) off();
    unlisten = [];
    for (const element of inertHosts()) element.inert = false;
    old?.destroy();
  }

  // ---------- the keyboard, the window and the language ----------

  /** The walk keeps the keyboard: arrows go between steps, Esc ends, Tab stays in the bubble. */
  function walkKey(event: KeyboardEvent): void {
    if (phase !== "step" || !view) return;
    const take = (): void => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (event.key === "Escape") { take(); finish(); }
    else if (event.key === "ArrowRight" && !event.altKey) { take(); if (!entering && at < list.length - 1) press("next"); }
    else if (event.key === "ArrowLeft" && !event.altKey) { take(); press("back"); }
    else if (event.key === "Tab") {
      take();
      const stops = view.stops();
      if (!stops.length) return;
      const index = stops.indexOf(document.activeElement as HTMLElement);
      stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]!.focus({ preventScroll: true });
    }
  }

  /** The offer and the goodbye are not modal: Esc closes them only when nothing else took the key. */
  function quietKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (phase === "offer") finish();
    else if (phase === "bye") close();
  }

  function listen(): void {
    if (unlisten.length) return;
    window.addEventListener("keydown", walkKey, true);
    window.addEventListener("keydown", quietKey);
    let frame = 0;
    const reflow = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => view?.reflow()); };
    window.addEventListener("resize", reflow);
    const language = onLocaleChange(() => { if (phase !== "idle" && view && !entering) draw(false); });
    unlisten = [
      () => window.removeEventListener("keydown", walkKey, true),
      () => window.removeEventListener("keydown", quietKey),
      () => { cancelAnimationFrame(frame); window.removeEventListener("resize", reflow); },
      language,
    ];
  }

  return { offerOnce, start, active: () => phase !== "idle", stop };
}
