// Raphael's guided tour. The spotlight admits one of the window's own controls at a time.

import { onLocaleChange, t } from "../i18n";
import { confirmDelete } from "../member-dialogs";
import type { NavStep } from "../nav-history";
import type { AppContext, DeviceSettings } from "../types";
import { closeMenu, holdMenuOpen } from "../ui";
import { CAPTION_CONTROLS, createView, type Pressed, type TourView, type ViewModel } from "./view";
import { COMPOSER, STEPS, askKeys, boxOf, firstShown, spotOf, type TourStep } from "./steps";

export type TourHost = Pick<AppContext, "closeSettings"> & {
  device(): DeviceSettings;
  setDevice(patch: Partial<DeviceSettings>): Promise<unknown>;
};

export interface Tour {
  offerOnce(): void;
  active(): boolean;
  navigate(direction: NavStep): boolean;
  stop(): void;
}

type Phase = "idle" | "offer" | "step" | "bye";

export const OFFER_DELAY_MS = 700;
export const BYE_MS = 4500;
const ACTION_WAIT_MS = 4000;

const account = (): HTMLElement | null => firstShown("#nav .sidebar-account");

export function createTour(host: TourHost): Tour {
  let phase: Phase = "idle";
  let view: TourView | null = null;
  let list: TourStep[] = [];
  let at = 0;
  let answered = false;
  let state: NonNullable<ViewModel["state"]> = "ask";
  let openedAtEntry: HTMLElement | null = null;
  let completedField: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let actionWait: ReturnType<typeof setTimeout> | undefined;
  let actionDeadline = 0;
  let confirmation: { scrim: HTMLElement; releaseMenu: () => void } | null = null;
  let unlisten: (() => void) | undefined;

  const sidebarFoot = () => firstShown("#nav .side-foot", { includeInert: true });
  const anchorSpot = () => {
    const foot = sidebarFoot() ?? account();
    return foot ? { ...spotOf(foot, 0), dim: false } : null;
  };
  const origin = () => {
    const button = account();
    return button ? spotOf(button, 0).box : anchorSpot()?.box ?? null;
  };
  // The composer and sidebar foot still occupy space when a modal makes the window inert.
  const keepControlsClear = () => [sidebarFoot(), firstShown(COMPOSER, { includeInert: true })]
    .flatMap(element => element ? [boxOf(element)] : []);
  const keepClear = () => [stepNow()?.target?.(), opened()]
    .flatMap(element => element ? [boxOf(element)] : []);
  const stepNow = () => list[at];
  const operable = () => state === "ask" || stepNow()?.id === "composer" ? stepNow()?.target?.() ?? null : null;
  const opened = (): HTMLElement | null => {
    const panel = stepNow()?.opened?.() ?? null;
    if (!panel) openedAtEntry = null;
    return panel === openedAtEntry ? null : panel;
  };

  function model(): ViewModel {
    const label = t("tour.label");
    if (phase === "offer") {
      return {
        mode: "offer", text: t("tour.offer"), label,
        buttons: [{ id: "skip", label: t("tour.skip") }, { id: "start", label: t("tour.start"), primary: true }],
        locate: anchorSpot, prefer: ["above"], align: "start", origin, keepControlsClear,
      };
    }
    if (phase === "bye") return { mode: "bye", text: t("tour.bye"), label, buttons: [], celebrate: true, locate: anchorSpot, prefer: ["above"], align: "start", origin, keepControlsClear };
    const step = stepNow()!;
    const last = at === list.length - 1;
    const buttons: ViewModel["buttons"] = [];
    if (at > 0) buttons.push({ id: "back", label: t("tour.back") });
    if (state !== "ask") buttons.push({ id: last ? "done" : "next", label: t(last ? "tour.done" : "tour.next"), primary: true });
    const line = state === "done" && step.followup ? step.followup : step.text;
    return {
      mode: "step", step: step.id, state, label, title: t(step.title), closeLabel: t("tour.close"),
      text: line === "tour.permissionDone" ? t(line, { ask: t("chat.modeAsk") }) : t(line),
      ...(step.keys ? { keys: askKeys(host.device()) } : {}),
      progress: { current: at + 1, total: list.length, label: t("tour.progress", { current: at + 1, total: list.length }) },
      buttons, control: operable,
      locate: () => {
        const panel = opened();
        const target = panel ?? step.target?.();
        return target ? { ...spotOf(target, panel ? 0 : step.pad ?? 0), dim: true } : null;
      },
      ...(step.id === "account" ? { anchor: () => anchorSpot()?.box ?? null } : {}),
      prefer: step.prefer, align: step.id === "account" ? "start" : "center", origin, keepClear, keepControlsClear, slimeFirst: step.id === "model",
    };
  }

  function draw(hop: boolean): number {
    view ??= createView(pressed, watchAction);
    const delay = view.render(model(), { hop });
    clearTimeout(settle);
    if (phase === "step") settle = setTimeout(check, 260);
    return delay;
  }

  function check(): void {
    if (confirmation) return;
    if (phase === "step") {
      const step = stepNow()!;
      const target = step.target?.() ?? null;
      if (step.id === "composer") {
        if (target && document.activeElement === target) completedField = target;
        if (completedField !== target) completedField = null;
      }
      const next = !step.followup ? "look" : completedField || opened() ? "done" : !target || state === "fallback" ? "fallback" : "ask";
      if (next !== state) {
        clearActionWait();
        state = next;
        draw(next === "done" || next === "ask");
        view?.keepFocus(operable());
        return;
      }
      view?.keepFocus(operable());
    }
    view?.reflow();
  }

  function offerOnce(): void {
    if (timer !== undefined || phase !== "idle" || answered || host.device().tour_offered) return;
    timer = setTimeout(() => show(0), OFFER_DELAY_MS);
    function show(tries: number): void {
      timer = undefined;
      if (phase !== "idle" || host.device().tour_offered) return;
      if (!account()) {
        if (tries < 20) timer = setTimeout(() => show(tries + 1), 300);
        return;
      }
      phase = "offer";
      draw(true);
      listen();
    }
  }

  function clearActionWait(): void {
    clearTimeout(actionWait);
    actionWait = undefined;
  }

  function watchAction(delay = ACTION_WAIT_MS): void {
    if (state !== "ask" || actionWait !== undefined) return;
    actionDeadline = Date.now() + delay;
    actionWait = setTimeout(() => {
      actionWait = undefined;
      check();
      if (state !== "ask") return;
      state = "fallback";
      draw(false);
      view?.keepFocus(operable());
    }, delay);
  }

  function arrive(): void {
    const step = stepNow()!;
    clearActionWait();
    state = !step.followup ? "look" : step.target?.() ? "ask" : "fallback";
    completedField = null;
    openedAtEntry = step.opened?.() ?? null;
    draw(true);
    view?.keepFocus(operable());
  }

  function closeOpened(): void {
    const panel = opened();
    if (!panel) return;
    switch (stepNow()?.id) {
      case "account":
      case "permission":
      case "model": closeMenu(); break;
      case "apps": host.closeSettings(); break;
    }
  }

  function move(direction: NavStep): void {
    if (direction === "back" ? at === 0 : at === list.length - 1) return;
    closeOpened();
    const delta = direction === "back" ? -1 : 1;
    at += delta;
    arrive();
  }

  function rememberAnswer(): void {
    answered = true;
    void host.setDevice({ tour_offered: true }).catch(error => console.warn("tour: the answer could not be remembered", error));
  }

  async function askToLeave(button: "skip" | "close"): Promise<void> {
    const skip = button === "skip";
    const remaining = actionWait === undefined ? undefined : Math.max(0, actionDeadline - Date.now());
    clearActionWait();
    const words = {
      title: t(skip ? "tour.skipTitle" : "tour.closeTitle"),
      hint: t(skip ? "tour.skipHint" : "tour.closeHint"),
      action: t(skip ? "tour.skip" : "tour.close"),
    };
    const releaseMenu = holdMenuOpen();
    const answer = confirmDelete("", { words, quiet: true });
    // The shared confirmation mounts synchronously and focuses Cancel.
    const scrims = document.querySelectorAll<HTMLElement>(".mb-scrim:has(> .mb-confirm.mb-delete.is-quiet)");
    const scrim = scrims[scrims.length - 1]!;
    scrim.classList.add("tour-confirm");
    const pending = { scrim, releaseMenu };
    confirmation = pending;
    view?.setConfirmation(scrim);
    const confirmed = await answer;
    if (confirmation !== pending) return;
    confirmation = null;
    releaseMenu();
    view?.setConfirmation(null);
    if (confirmed) {
      if (skip) rememberAnswer();
      stop();
      return;
    }
    view?.focusButton(button);
    if (remaining !== undefined) watchAction(remaining);
    check();
  }

  function pressed(button: Pressed): void {
    if (confirmation) return;
    if (phase === "offer" && button === "start") {
      rememberAnswer();
      list = STEPS.filter(step => !step.keys || askKeys(host.device()).length > 0);
      at = 0;
      phase = "step";
      arrive();
      return;
    }
    if (phase === "offer" && button === "skip" || phase === "step" && button === "close") void askToLeave(button);
    else if (button === "dismiss") close();
    else if (phase === "step" && button === "back") move("back");
    else if (phase === "step" && state !== "ask") {
      if (button === "done") finish();
      else if (button === "next") move("forward");
    }
  }

  function finish(): void {
    closeOpened();
    clearActionWait();
    phase = "bye";
    timer = setTimeout(close, BYE_MS + draw(true));
  }

  function clear(): TourView | null {
    clearTimeout(timer);
    clearTimeout(settle);
    clearActionWait();
    timer = undefined;
    unlisten?.();
    unlisten = undefined;
    phase = "idle";
    const leaving = view;
    view = null;
    return leaving;
  }

  function close(): void {
    const leaving = clear();
    leaving?.leave(() => leaving.destroy());
  }

  function stop(): void {
    if (confirmation) {
      confirmation.scrim.querySelector<HTMLElement>('[data-dlg="cancel"]')?.click();
      confirmation.releaseMenu();
      confirmation = null;
    }
    if (phase === "step") closeOpened();
    clear()?.destroy();
  }

  function walkKey(event: KeyboardEvent): void {
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    if (confirmation) {
      if (event.type === "keydown" && (event.key === "Escape" || event.key === "Tab" && !modified)) return;
      const activatesButton = !modified && (event.key === "Enter" || event.key === " ") &&
        event.target instanceof Node && confirmation.scrim.contains(event.target);
      if (!activatesButton) event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (phase !== "step" || event.isComposing) return;
    const target = operable();
    if (event.key === "Tab" && event.type === "keydown" && !modified) {
      view?.tab(target, event.shiftKey);
    } else if (event.key !== "Escape" && event.key !== "Tab" && event.target instanceof Element) {
      if (target?.contains(event.target)) return;
      if (view?.contains(event.target) || event.target.closest(CAPTION_CONTROLS)) {
        // Keep native button activation while keeping keys out of other open surfaces.
        event.stopImmediatePropagation();
        return;
      }
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** The window's own layer handlers get the key first. */
  function quietKey(event: KeyboardEvent): void {
    if (confirmation || event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
    if (phase === "offer" || phase === "bye") close();
  }

  function listen(): void {
    let frame = 0;
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; check(); });
    };
    const observer = new MutationObserver(records => {
      if (records.some(record => !view?.contains(record.target))) schedule();
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
    document.addEventListener("focusin", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("keydown", walkKey, true);
    window.addEventListener("keyup", walkKey, true);
    window.addEventListener("keydown", quietKey);
    const language = onLocaleChange(() => draw(false));
    unlisten = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("focusin", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("keydown", walkKey, true);
      window.removeEventListener("keyup", walkKey, true);
      window.removeEventListener("keydown", quietKey);
      language();
    };
  }

  return { offerOnce, active: () => phase !== "idle", navigate: () => phase === "step" || !!confirmation, stop };
}
