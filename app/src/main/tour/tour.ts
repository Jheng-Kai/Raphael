// Raphael's guided tour. The tour observes the window while the person uses its ordinary controls.

import { hasOpenLayer, stepOpenLayer } from "../dismissals";
import { onLocaleChange, t } from "../i18n";
import type { MessageKey } from "../i18n/zh-TW";
import type { NavStep } from "../nav-history";
import type { AppContext, DeviceSettings } from "../types";
import { closeMenu } from "../ui";
import { createView, type Pressed, type TourView, type ViewModel } from "./view";
import { COMPOSER, COMPOSER_FIELD, STEPS, askKeys, boxOf, firstShown, spotOf, tourMinutes, type TourStep } from "./steps";

const say = t as unknown as (key: MessageKey, values?: Record<string, string | number>) => string;

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

const account = (): HTMLElement | null => firstShown("#nav .sidebar-account");

export function createTour(host: TourHost): Tour {
  let phase: Phase = "idle";
  let view: TourView | null = null;
  let list: TourStep[] = [];
  let at = 0;
  let answered = false;
  let done = false;
  let openedAtEntry: HTMLElement | null = null;
  let completedField: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
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
  const opened = (): HTMLElement | null => {
    const panel = stepNow()?.opened?.() ?? null;
    if (!panel) openedAtEntry = null;
    return panel === openedAtEntry ? null : panel;
  };

  function model(): ViewModel {
    const label = t("tour.label");
    if (phase === "offer") {
      return {
        mode: "offer", text: t("tour.offer", { minutes: tourMinutes(STEPS.length) }), label,
        buttons: [{ id: "skip", label: t("tour.skip") }, { id: "start", label: t("tour.start"), primary: true }],
        locate: anchorSpot, prefer: ["above"], align: "start", origin, keepControlsClear,
      };
    }
    if (phase === "bye") return { mode: "bye", text: t("tour.bye"), label, buttons: [], locate: anchorSpot, prefer: ["above"], align: "start", origin, keepControlsClear };
    const step = stepNow()!;
    const last = at === list.length - 1;
    const buttons: ViewModel["buttons"] = [];
    if (at > 0) buttons.push({ id: "back", label: t("tour.back") });
    const state = step.followup ? (done ? "done" : "ask") : "look";
    const readyToFinish = last && state !== "ask";
    buttons.push({ id: readyToFinish ? "done" : "next", label: t(readyToFinish ? "tour.done" : "tour.next"), primary: state !== "ask" });
    return {
      mode: "step", step: step.id, state, label,
      text: say(done && step.followup ? step.followup : step.text, { ask: t("chat.modeAsk") }),
      ...(step.keys ? { keys: askKeys(host.device()) } : {}),
      progress: { shown: (at + 1) + "/" + list.length, label: t("tour.progress", { current: at + 1, total: list.length }) },
      buttons, closeLabel: t("tour.close"),
      locate: () => {
        const panel = opened();
        const target = panel ?? step.target?.();
        return target ? { ...spotOf(target, panel ? 0 : step.pad ?? 0), dim: true } : null;
      },
      ...(step.id === "account" ? { anchor: () => anchorSpot()?.box ?? null } : {}),
      prefer: step.prefer, align: step.id === "account" ? "start" : "center", origin, keepClear, keepControlsClear, slimeFirst: step.id === "model",
    };
  }

  function draw(hop: boolean): void {
    view ??= createView(pressed, move);
    view.render(model(), { hop });
    clearTimeout(settle);
    if (phase === "step") settle = setTimeout(check, 260);
  }

  function check(): void {
    if (phase === "step") {
      const step = stepNow();
      if (step?.id === "composer") {
        if (document.activeElement?.matches(COMPOSER_FIELD)) completedField = document.activeElement;
        if (!completedField?.isConnected || !step.target?.()?.contains(completedField)) completedField = null;
      }
      const complete = !!completedField || !!opened();
      if (complete !== done) {
        done = complete;
        draw(true);
        return;
      }
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

  function arrive(direction: 1 | -1): void {
    while (list[at]?.target && !list[at]!.target!()) {
      list.splice(at, 1);
      if (direction < 0) at = Math.max(0, at - 1);
    }
    const step = stepNow();
    if (!step) { finish(); return; }
    done = false;
    completedField = null;
    openedAtEntry = step.opened?.() ?? null;
    draw(true);
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
    arrive(delta);
  }

  function pressed(button: Pressed): void {
    if (phase === "offer" && (button === "start" || button === "skip")) {
      answered = true;
      void host.setDevice({ tour_offered: true }).catch(error => console.warn("tour: the answer could not be remembered", error));
      if (button === "skip") { finish(); return; }
      list = STEPS.filter(step => (!step.target || !!step.target()) && (!step.keys || askKeys(host.device()).length > 0));
      at = 0;
      phase = "step";
      arrive(1);
      return;
    }
    if (button === "dismiss") close();
    else if (button === "close" || button === "done" || button === "next" && at === list.length - 1) finish();
    else if (button === "back" || button === "next") move(button === "back" ? "back" : "forward");
  }

  function finish(): void {
    if (phase === "step") closeOpened();
    phase = "bye";
    draw(true);
    timer = setTimeout(close, BYE_MS);
  }

  function clear(): TourView | null {
    clearTimeout(timer);
    clearTimeout(settle);
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
    if (phase === "step") closeOpened();
    clear()?.destroy();
  }

  function walkKey(event: KeyboardEvent): void {
    if (phase !== "step" || event.isComposing || event.defaultPrevented) return;
    if (event.key === "Escape" && !hasOpenLayer()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish();
      return;
    }
    if (!(event.target instanceof Node) || !view?.contains(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    move(event.key === "ArrowLeft" ? "back" : "forward");
  }

  /** The window's own layer handlers get the key first. */
  function quietKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
    if (phase === "step" && opened() && stepOpenLayer("back")) return;
    if (phase === "offer" || phase === "step") finish();
    else if (phase === "bye") close();
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
    window.addEventListener("keydown", quietKey);
    const language = onLocaleChange(() => draw(false));
    unlisten = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("focusin", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("keydown", walkKey, true);
      window.removeEventListener("keydown", quietKey);
      language();
    };
  }

  function navigate(direction: NavStep): boolean {
    if (phase !== "step") return false;
    if (opened()) return stepOpenLayer("back");
    if (hasOpenLayer() && stepOpenLayer(direction)) return true;
    move(direction);
    return true;
  }

  return { offerOnce, active: () => phase !== "idle", navigate, stop };
}
