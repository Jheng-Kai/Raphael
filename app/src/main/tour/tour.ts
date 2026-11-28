// Raphael's guided tour. The spotlight admits one of the window's own controls at a time.

import { onLocaleChange, t } from "../i18n";
import { confirmDelete } from "../member-dialogs";
import { canonicalKey } from "../keys";
import type { NavStep } from "../nav-history";
import { raphaelName } from "../raphael";
import type { AppContext, DeviceSettings } from "../types";
import { closeMenu, holdMenuOpen } from "../ui";
import { CAPTION_CONTROLS, createView, type Pressed, type TourView, type ViewModel } from "./view";
import { COMPOSER, LAYERS, MODEL_TRIGGER, STEPS, askKeys, boxOf, firstShown, pressableBoxes, spotOf, type Layer } from "./steps";

export type TourHost = Pick<AppContext, "closeSettings" | "onEvent" | "go"> & {
  device(): DeviceSettings;
  setDevice(patch: Partial<DeviceSettings>): Promise<unknown>;
  isConversation(): boolean;
  /** Raphael's keys only report that they went down or up (`Hotkey` events) and start nothing: the last step's practice. */
  practiseKeys(on: boolean): void;
  /** The real quick ask's corner answers 《`prefix`。`text`》 and vanishes by itself, recording nothing. */
  rehearse(prefix: string, text: string): void;
};

export interface Tour {
  offerOnce(): void;
  conversationChanged(): void;
  active(): boolean;
  navigate(direction: NavStep): boolean;
  stop(): void;
}

type Phase = "idle" | "waiting" | "offer" | "covered" | "step" | "bye";

export const OFFER_DELAY_MS = 700;
export const BYE_MS = 4500;
/** How long a press stays watched for the app's reaction (a menu opening). It never moves the walk on by itself. */
const ACTION_WAIT_MS = 4000;
const REACTION_MS = 500;
const COVERING_SCRIMS = ".modal-scrim, .mb-scrim:not(.tour-confirm), .cs-scrim";

const account = (): HTMLElement | null => firstShown("#nav .sidebar-account");
/** The controls that open the menus a step works in or shows. */
const MENU_OPENERS: Partial<Record<Layer, () => HTMLElement | null>> = {
  model: () => firstShown(MODEL_TRIGGER),
  account,
};
/**
 * What is lit, with room round it; what reaches the window's edges (a page, the slime's panel, its settings) is framed just inside
 * instead, so the whole ring shows and the window's corners stay dimmed.
 */
function framed(el: HTMLElement, pad: number): ReturnType<typeof spotOf> {
  const box = boxOf(el), width = document.documentElement.clientWidth || innerWidth, height = document.documentElement.clientHeight || innerHeight;
  const edge = box.left < pad || box.top < pad || box.left + box.width > width - pad || box.top + box.height > height - pad;
  return spotOf(el, edge ? -6 : pad);
}
/** A menu opened while the window is in the background would close again at once (ui.ts closes menus of an unfocused window). */
const windowFocused = (): boolean => typeof document.hasFocus !== "function" || document.hasFocus();

export function createTour(host: TourHost): Tour {
  let phase: Phase = "idle";
  let view: TourView | null = null;
  let at = 0;
  /** The step's action is done and what it opened is lit and explained, until the person presses 好的. */
  let seeing = false;
  /** The person pressed something in what is lit: when that closes it (a pick, its own close), the walk goes on. */
  let used = false;
  let answered = false;
  let finishReady = false;
  let priorLayer: HTMLElement | null = null;
  /** A control the tour presses itself (the maker's Cancel, the account button that opens the menu again). */
  let pressing: HTMLElement | null = null;
  const ownedLayers = new Map<Layer, HTMLElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let actionWait: ReturnType<typeof setTimeout> | undefined;
  let wait: { kind: "action" | "advance" | "see"; deadline: number } | null = null;
  let confirmation: { scrim: HTMLElement; releaseMenu: () => void } | null = null;
  let unlisten: (() => void) | undefined;
  let frame = 0;

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
  const stepNow = () => STEPS[at];
  const layer = (id?: Layer) => id ? firstShown(LAYERS[id], { includeInert: true }) : null;
  const target = (includeInert = false) => {
    const selector = stepNow().target;
    return selector ? firstShown(selector, { includeInert }) : null;
  };
  // While what a step opened is looked at, it can be used as well: the person tries it while Raphael explains it.
  const controls = () => pressing ? [pressing] : wait?.kind === "advance" || wait?.kind === "see" ? [] :
    [seeing ? lookAt() : target()].flatMap(el => el ? [el] : []);
  const openLayer = () => layer(stepNow().opens) ?? layer(stepNow().layer);
  /** What the person looks at once the step's action is done: the page it went to, or what it opened. */
  const lookAt = (): HTMLElement | null => {
    const step = stepNow();
    return step.look ? firstShown(step.look, { includeInert: true }) : openLayer();
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
    const progress = { current: at + 1, total: STEPS.length, label: t("tour.progress", { current: at + 1, total: STEPS.length }) };
    if (seeing && step.seen) {
      const looked = () => { const el = lookAt(); return el ? framed(el, 6) : null; };
      return {
        mode: "step", step: step.id, label, title: t(step.title), closeLabel: t("tour.close"),
        text: t(step.seen), progress, seeing: true,
        buttons: [{ id: "gotIt", label: t("tour.gotIt"), primary: true }],
        controls,
        locate: () => { const spot = looked(); return spot ? { ...spot, dim: true } : null; },
        lit: looked,
        lookArea: lookAt,
        layer: lookAt,
        prefer: step.prefer, align: "center", origin,
        // Raphael never stands on what is looked at; a page that fills the window keeps at least its composer clear.
        keepControlsClear: () => {
          const el = lookAt(), composer = step.page ? firstShown(COMPOSER) : null;
          return el ? [boxOf(el), ...(composer ? [boxOf(composer)] : [])] : keepControlsClear();
        },
      };
    }
    return {
      mode: "step", step: step.id, label, title: t(step.title), closeLabel: t("tour.close"),
      text: t(step.text, { name: raphaelName() }),
      ...(step.keys ? { keys: askKeys(host.device()), keysDown: askCodes().map((_, at) => held.has(at)) } : {}),
      progress,
      buttons: step.keys && finishReady ? [{ id: "done", label: t("tour.done"), primary: true }] : [],
      controls,
      locate: () => {
        const el = target(true);
        return el ? { ...spotOf(el, step.pad ?? 0), dim: true } : null;
      },
      // Inside a menu the whole menu stays lit, so the person sees where the framed row is.
      ...(step.layer ? { lit: () => { const el = layer(step.layer); return el ? framed(el, 4) : null; } } : {}),
      layer: openLayer,
      ...(step.id === "account" ? { anchor: () => anchorSpot()?.box ?? null } : {}),
      prefer: step.prefer, align: step.id === "account" ? "start" : "center", origin,
      keepControlsClear: () => {
        const panel = openLayer();
        return panel ? pressableBoxes(panel) : keepControlsClear();
      },
      slimeFirst: step.id === "model",
    };
  }

  function draw(hop: boolean): number {
    view ??= createView(pressed, targetPressed);
    const delay = view.render(model(), { hop });
    clearTimeout(settle);
    if (phase === "step") settle = setTimeout(check, 260);
    return delay;
  }

  function conversationUncovered(): boolean {
    return host.isConversation() && ![...document.querySelectorAll(COVERING_SCRIMS)]
      .some(scrim => !scrim.closest("[hidden]") && scrim.checkVisibility({ visibilityProperty: true }));
  }

  function check(): void {
    if (phase === "waiting") {
      if (!conversationUncovered()) {
        clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined) timer = setTimeout(() => showFirstOffer(0), OFFER_DELAY_MS);
      return;
    }
    if (phase === "offer" || phase === "covered") {
      if (!conversationUncovered()) {
        if (phase === "offer") {
          phase = "covered";
          view?.hideOffer();
        }
        return;
      }
      if (phase === "covered") {
        if (!account()) return;
        phase = "offer";
        draw(true);
        return;
      }
    }
    if (confirmation) return;
    if (phase === "step") {
      const step = stepNow();
      if (wait?.kind === "action") {
        const opened = layer(step.opens);
        if (opened && step.opens && opened !== priorLayer) ownedLayers.set(step.opens, opened);
        const reacted = (opened !== null && opened !== priorLayer) || step.reacted?.();
        // The instruction is done with: its words fade at once instead of lingering until Raphael moves on.
        if (reacted) view?.hush();
        if (reacted && step.seen) setWait("see", REACTION_MS);
        else if (reacted) setWait("advance", REACTION_MS);
      } else if (!wait && !pressing) {
        if (seeing && used && !lookAt()) {
          advance();
          return;
        }
        // A resize, or a switch to another window, closes the app's menus: the step's own menu comes back where it now belongs.
        if (windowFocused()) reopenMenu();
        if (!seeing && step.target && !target()) {
          advance();
          return;
        }
      }
      view?.keepFocus(controls());
    }
    // Between the press and what comes next, Raphael stays put: the pressed row may be gone already (a page took the conversation's
    // place), and placing it again then would send it somewhere it then has to hop back from.
    if (wait?.kind !== "see" && wait?.kind !== "advance") view?.reflow();
  }

  function offerOnce(): void {
    if (phase !== "idle" || answered || host.device().tour_offered) return;
    phase = "waiting";
    listen();
    check();
  }

  function showFirstOffer(tries: number): void {
    timer = undefined;
    if (phase !== "waiting") return;
    if (host.device().tour_offered) { stop(); return; }
    if (!conversationUncovered()) return;
    if (!account()) {
      if (tries < 20) timer = setTimeout(() => showFirstOffer(tries + 1), 300);
      else stop();
      return;
    }
    phase = "offer";
    draw(true);
  }

  function clearWait(): void {
    clearTimeout(actionWait);
    wait = null;
  }

  function setWait(kind: NonNullable<typeof wait>["kind"], delay: number): void {
    clearWait();
    wait = { kind, deadline: Date.now() + delay };
    actionWait = setTimeout(() => {
      if (kind === "action") {
        check();
        // Nothing moves on by the clock: a press the app did not react to leaves the step as it was, ready for another press.
        if (wait?.kind === "action") clearWait();
        return;
      }
      clearWait();
      if (kind === "see") see();
      else advance();
    }, delay);
  }

  /** The keys that ask Raphael, as the settings name them (`AltRight+Space`). */
  const askCodes = (): string[] => host.device().agent_keys[0]?.split("+").map(part => part.trim()).filter(Boolean) ?? [];
  /** Which of those keys is held now: each lights up on screen, and all of them down together brings Finish. */
  const held = new Set<number>();
  let practising = false;
  function showHeld(): void {
    const codes = askCodes();
    view?.pressKeys(codes.map((_, at) => held.has(at)));
    if (codes.length && held.size === codes.length) summon();
  }
  /** The keys worked: the real quick ask's corner answers with one playful line and goes by itself (nothing listens), and Finish shows. */
  function summon(): void {
    if (finishReady) return;
    host.rehearse(t("tour.summonPrefix"), t("tour.summon"));
    showFinish();
  }
  /** A key the window itself sees (the hook takes Raphael's keys first, and reports them as `Hotkey` events instead). */
  function trackKeys(event: KeyboardEvent): void {
    if (phase !== "step" || !stepNow().keys || confirmation) return;
    const index = askCodes().findIndex(code => canonicalKey(code) === canonicalKey(event.code) || canonicalKey(code) === canonicalKey(event.key));
    if (index < 0) return;
    if (event.type === "keydown") held.add(index); else held.delete(index);
    showHeld();
  }
  /** What the hook says while the keys are practised: the dictation key alone lights its cap, the whole question lights them all. */
  function hookKey(kind: string): void {
    const codes = askCodes();
    const dictation = new Set((host.device().dictation_keys ?? []).flatMap(binding => binding.split("+")).map(canonicalKey));
    const ofDictation = codes.flatMap((code, at) => dictation.has(canonicalKey(code)) ? [at] : []);
    if (kind === "agent_down") codes.forEach((_, at) => held.add(at));
    else if (kind === "agent_up") held.clear();
    else if (kind === "dictation_down") ofDictation.forEach(at => held.add(at));
    else if (kind === "dictation_up") ofDictation.forEach(at => held.delete(at));
    else return;
    showHeld();
  }
  function practise(on: boolean): void {
    if (practising === on) return;
    practising = on;
    host.practiseKeys(on);
  }

  function watchAction(): void {
    if (phase === "step" && !confirmation && !wait) setWait("action", ACTION_WAIT_MS);
  }

  function targetPressed(): void {
    if (pressing) return;
    if (seeing) { used = true; return; }
    watchAction();
  }

  /** The step's action is done: light what it opened and explain it, until 好的. */
  function see(): void {
    clearWait();
    seeing = true;
    draw(true);
    view?.keepFocus(controls());
  }

  /** The tour presses one of the window's own controls, which its spotlight lets through for that press alone. */
  function press(control: HTMLElement | null): void {
    pressing = control;
    try { control?.click(); } finally { pressing = null; }
  }

  /** Closes what a step opened through the window's own way out of it. */
  function closeLayer(id: Layer, panel: HTMLElement): void {
    if (id === "apps" || id === "settings") host.closeSettings();
    else if (id === "team") press(panel.querySelector<HTMLElement>('[data-dlg="cancel"]'));
    else if (id === "details") press(panel.querySelector<HTMLElement>('[data-det="close"]'));
    else if (id === "memberSettings") host.go("agent");
    else closeMenu();
  }

  function closeOpened(keep?: Layer): void {
    // The slime's settings first: closing them brings its conversation back, and its panel closes after.
    for (const [id, panel] of [...ownedLayers].sort(([a]) => a === "memberSettings" ? -1 : 0)) {
      if (id === keep) continue;
      ownedLayers.delete(id);
      const now = layer(id);
      if (now && (now === panel || id === "details")) closeLayer(id, now);
    }
  }

  /** The menu the step works in or shows: the window closes its menus on a resize, and the tour opens this one again. */
  function neededMenu(): Layer | undefined {
    const step = stepNow();
    const id = seeing ? (step.page ? undefined : step.opens ?? step.layer) : step.layer;
    return id && id in MENU_OPENERS ? id : undefined;
  }

  /**
   * Opens the step's menu again from its own control when it is not there: after a look at another row's page of the account
   * menu (the conversation comes back first), or after a resize or a switch away closed it. The model list is shown again too.
   */
  function reopenMenu(): void {
    const id = neededMenu();
    if (!id || layer(id)) return;
    if (id === "account" && !host.isConversation()) host.go("agent");
    press(MENU_OPENERS[id]!());
    const menu = layer(id);
    if (!menu) return;
    ownedLayers.set(id, menu);
    if (seeing && stepNow().id === "model-list") press(menu.querySelector<HTMLElement>('[data-cb-act="models"]'));
  }

  function arrive(): void {
    clearWait();
    seeing = false;
    used = false;
    reopenMenu();
    while (stepNow().target && !target()) {
      at++;
      closeOpened(stepNow().layer);
    }
    const step = stepNow();
    // What the step's press opens starts closed (a wide window shows the slime's panel already), so the press opens it.
    const already = step.opens ? layer(step.opens) : null;
    if (step.opens && already && step.opens !== step.layer) closeLayer(step.opens, already);
    priorLayer = layer(step.opens);
    held.clear();
    practise(!!step.keys);
    draw(true);
    view?.keepFocus(controls());
  }

  function advance(): void {
    at++;
    closeOpened(stepNow().layer);
    // A menu the person opened from what they were trying out goes too, unless the next step works in a menu.
    if (!stepNow().layer) closeMenu();
    arrive();
  }

  function showFinish(): void {
    if (finishReady) return;
    clearWait();
    finishReady = true;
    draw(false);
    view?.pressKeys(askCodes().map((_, at) => held.has(at)));
  }

  function rememberAnswer(): void {
    answered = true;
    void host.setDevice({ tour_offered: true }).catch(error => console.warn("tour: the answer could not be remembered", error));
  }

  async function askToLeave(button: "skip" | "close"): Promise<void> {
    const skip = button === "skip";
    const paused = wait && { kind: wait.kind, remaining: Math.max(0, wait.deadline - Date.now()) };
    clearTimeout(actionWait);
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
    if (paused) setWait(paused.kind, paused.remaining);
    if (phase === "step" || phase === "offer" && conversationUncovered()) view?.focusButton(button);
    check();
  }

  function pressed(button: Pressed): void {
    if (confirmation || phase === "covered" || phase === "offer" && !conversationUncovered()) return;
    if (phase === "offer" && button === "start") {
      rememberAnswer();
      at = 0;
      phase = "step";
      arrive();
      return;
    }
    if (phase === "offer" && button === "skip" || phase === "step" && button === "close") void askToLeave(button);
    else if (button === "dismiss") close();
    else if (phase === "step" && button === "gotIt" && seeing) advance();
    else if (phase === "step" && button === "done" && finishReady) finish();
  }

  function finish(): void {
    closeOpened();
    clearWait();
    practise(false);
    phase = "bye";
    timer = setTimeout(close, BYE_MS + draw(true));
  }

  function clear(): TourView | null {
    clearTimeout(timer);
    clearTimeout(settle);
    clearWait();
    // The keys always come back to their real work, however the tour ends.
    practise(false);
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
    trackKeys(event);
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
    const allowed = controls();
    if (event.key === "Tab" && event.type === "keydown" && !modified) {
      view?.tab(allowed, event.shiftKey);
    } else if (event.key !== "Escape" && event.key !== "Tab" && event.target instanceof Element) {
      if (allowed.some(control => control.contains(event.target as Node))) return;
      if (view?.contains(event.target) || event.target.closest(CAPTION_CONTROLS)) {
        // Keep native button activation while keeping keys out of other open surfaces.
        event.stopImmediatePropagation();
        return;
      }
    }
    if (stepNow().keys && event.key !== "Escape" && event.key !== "Tab") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** The window's own layer handlers get the key first. */
  function quietKey(event: KeyboardEvent): void {
    if (confirmation || event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
    if (phase === "offer" && !conversationUncovered()) return;
    if (phase === "offer" || phase === "bye") close();
  }

  function schedule(): void {
    if (frame || phase === "idle") return;
    frame = requestAnimationFrame(() => { frame = 0; check(); });
  }

  function listen(): void {
    const observer = new MutationObserver(records => {
      if (records.some(record => !view?.contains(record.target))) schedule();
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    observer.observe(document.documentElement, { attributes: true });
    document.addEventListener("focusin", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("keydown", walkKey, true);
    window.addEventListener("keyup", walkKey, true);
    window.addEventListener("keydown", quietKey);
    const language = onLocaleChange(() => {
      if (phase === "offer" || phase === "step" || phase === "bye") draw(false);
    });
    const events = host.onEvent(event => {
      if (phase !== "step" || !stepNow().keys || confirmation) return;
      if (event.type === "Hotkey") hookKey(event.kind);
      else if (event.type === "Dictation" && event.agent && event.phase === "listening") summon();
    });
    unlisten = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      document.removeEventListener("focusin", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("keydown", walkKey, true);
      window.removeEventListener("keyup", walkKey, true);
      window.removeEventListener("keydown", quietKey);
      language();
      events();
    };
  }

  return { offerOnce, conversationChanged: schedule, active: () => phase === "offer" || phase === "step" || phase === "bye",
    navigate: () => phase === "step" || !!confirmation, stop };
}
