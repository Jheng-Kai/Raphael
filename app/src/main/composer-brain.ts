/**
 * The model of the open conversation, chosen next to where the owner writes. One card stands on the composer and shows
 * one view at a time: the source and the model with its depth of thought as a slider, the same for every source; and,
 * pressing the model, the sources on the left with the models of the one pressed on the right. Choosing a model saves
 * it and turns back, where its depth is right there.
 *
 * Each member answers on its own model, so a member's conversation writes that member's and moves no one else. Raphael's is
 * what Settings writes, and a quick conversation's what 快速提問 writes.
 * The core holds the choice and every list. This reads them again whenever the core says one changed, which is how a
 * choice made in Settings reaches the button, and how a CLI's models reach it: the core asks the CLI only after the
 * first read, in the background.
 */
import { noticeHTML } from "./missing";
import "./composer-brain.css";
import * as api from "./api";
import { t } from "./i18n";
import {
  chooserSources, effortOf, effortSliderHTML, modelPickerHTML, modelPickerSelection, modelRefWith, moveEffortSlider, orderedEfforts, pickerModelsFor, buttonFaceHTML,
  sourceMarkHTML, concreteModel, chooserPrice, splitEffort, usableFor, reasonText, fitFor, effortText, type ChooserSource, type ModelPickerLook,
} from "./model-picker";
import { knownCatalog, knownClis, rememberCatalog, rememberClis } from "./brain-lists";
import { RAPHAEL_ID } from "./members";
import type { BrainSettings, CatalogModel, CliBrain, MainEvent, Member, ModelCatalog } from "./types";
import { closeMenu, esc, ico, iconButton, openPopover, placeMenu, toaster } from "./ui";
import { describeError } from "./format";
import { optionalRead } from "./startup-reads";
import { findsName } from "./find-match";

/** A source's models fold past this many, under a button that says how many there are. */
const COMPACT = 5;
const SEARCH_FROM = 12;
/** The rail's first row when something is starred: not a source, what the owner starred across them. */
const FAVORITES = "favorites";
const GROUPS = ["subscriptions", "api", "local"] as const;
/** How long a signed-in CLI may be silent about its models while the menu is open before this says so. */
const MODEL_WAIT_TRIES = 20, MODEL_WAIT_MS = 2000;
const CHANGES: readonly MainEvent["type"][] = ["SettingsChanged", "BrainsChanged", "ProvidersChanged"];

export interface ComposerBrainHost {
  onEvent?: (handler: (event: MainEvent) => void) => unknown;
  /** Whether the open conversation is the quick one, which answers on 快速提問's model. */
  quick?: () => boolean;
}

export function mountComposerBrain(slot: HTMLElement, member: () => Member, host: ComposerBrainHost = {}): { draw(): void; reload(): void } {
  let catalog: ModelCatalog | null = knownCatalog(), clis: CliBrain[] = knownClis(), answerModel = "", quickModel = "", quickEffort = "low", generation = 0;
  let menu: HTMLElement | null = null, source = "", query = "", showAll = false, view: "now" | "browse" = "now";
  let modelTries = 0, modelTimer: ReturnType<typeof setTimeout> | undefined;
  let paintedWho: string | null = null, paintedDepth: string | null = null, paintedBody: string | null = null;
  let favorites: readonly string[] = [];

  const look = (): ModelPickerLook => {
    const who = member(), own = (who.id !== RAPHAEL_ID && who.model) || answerModel;
    const current = host.quick?.() ? `${(quickModel || own).split("?effort=")[0]}?effort=${quickEffort}` : own;
    return { role: "answer", current, catalog, clis, label: t("members.brain"), key: "composer-brain" };
  };
  const chosen = (): { model: CatalogModel | undefined; effort: string } => {
    const o = look(), models = pickerModelsFor(o);
    const model = models.find(item => item.id === concreteModel(o, models));
    const stored = effortOf(o.current, models);
    return { model, effort: stored && model?.reasoning_efforts?.includes(stored) ? stored : model?.default_effort ?? "" };
  };

  function paintButton(): void {
    const button = slot.querySelector<HTMLButtonElement>(".mp-trigger");
    if (!button) return;
    const { model, effort } = chosen();
    const face = buttonFaceHTML(look());
    const levels = model?.reasoning_efforts ?? [];
    // Drawn every time the roster or the conversation changes, and almost always the same words: then nothing is touched,
    // so the chip does not flash and its hover stays (owner, 2026-11-11).
    const stamp = JSON.stringify([face.inner, face.label, effort && levels.length > 1 ? effortText(effort) : ""]);
    if (button.dataset.painted === stamp) return;
    button.dataset.painted = stamp;
    button.innerHTML = face.inner;
    button.setAttribute("aria-label", face.label);
    if (effort && levels.length > 1) button.querySelector(".mp-tname")?.insertAdjacentHTML("afterend", `<span class="cb-depth">${esc(effortText(effort))}</span>`);
  }

  async function write(model: string): Promise<void> {
    if (host.quick?.()) {
      const split = splitEffort(model, pickerModelsFor(look()));
      await api.settingsSet("quick_model", split.model);
      quickModel = split.model;
      if (split.effort) { await api.settingsSet("quick_effort", split.effort); quickEffort = split.effort; }
      return;
    }
    const who = member();
    if (who.id !== RAPHAEL_ID) { await api.membersUpdate(who.id, { model }); who.model = model; return; }
    const result = await api.settingsSet("agent_model", model);
    answerModel = result.settings.agent_model ?? model;
  }

  function save(model: string, then?: () => void): void {
    // A read that began before this choice would put the old one back.
    generation++;
    void write(model).then(() => { then?.(); paintButton(); paintMenu(); }).catch(error => { toaster.info(describeError(error)); void reload(); });
  }

  /** What the owner starred in Settings, in the order they did, of what can answer now. */
  function starred(): CatalogModel[] {
    const all = pickerModelsFor(look());
    return favorites.flatMap(id => all.filter(row => row.id === id && usableFor(row, "answer")));
  }

  /** The rail: only what can answer now, since signing in and adding a source belong to Settings. */
  function answering(): ChooserSource[] {
    const sources = chooserSources(look());
    return GROUPS.flatMap(group => sources.filter(item => item.group === group && (item.cli?.available || item.models.length)));
  }

  /** The source pressed while it is there; before that, or after it is gone, the one holding what is chosen. */
  function settleSource(sources: ChooserSource[]): void {
    if (source === FAVORITES ? starred().length : sources.some(item => item.id === source)) return;
    const { model } = chosen();
    source = sources.find(item => model && item.models.some(row => row.id === model.id))?.id ?? sources[0]?.id ?? "";
  }

  function railHTML(sources: ChooserSource[]): string {
    const rail = (id: string, mark: string, name: string): string =>
      `<button type="button" class="menu-action cb-source" data-cb-source="${esc(id)}" aria-pressed="${id === source}">${mark}<span class="cb-name"><b>${esc(name)}</b></span></button>`;
    const liked = starred().length ? rail(FAVORITES, `<span class="mono md" aria-hidden="true">${ico("star")}</span>`, t("chooser.favorites")) : "";
    return `<div class="cb-rail" role="group" aria-label="${esc(t("chooser.rail"))}">${liked}${sources.map(item => rail(item.id, sourceMarkHTML(item), item.name)).join("")}</div>`;
  }

  function browseHTML(sources: ChooserSource[]): string {
    const head = `<header class="cb-head">${iconButton("left", t("chooser.back"), ' data-cb-act="back"', "cb-back")}<h3><span>${esc(t("chooser.title"))}</span></h3></header>`;
    if (!sources.length) return `${head}${noticeHTML("noModels", "models")}`;
    const total = sources.find(row => row.id === source)?.models.length ?? 0;
    return `${head}<div class="cb-browse">${railHTML(sources)}<div class="cb-pane">` +
      (showAll && total > SEARCH_FROM ? `<input type="search" class="cb-search" aria-label="${esc(t("chooser.search"))}" placeholder="${esc(t("chooser.search"))}" value="${esc(query)}">` : "") +
      `<div class="cb-list" role="radiogroup" aria-label="${esc(t("chooser.title"))}">${rowsHTML(sources)}</div>` +
      (total > COMPACT + 1 ? `<button type="button" class="menu-action cb-all" data-cb-act="all" aria-expanded="${showAll}"><span>${esc(showAll ? t("chooser.showFewer") : t("chooser.showAll", { p0: total }))}</span>${ico("down")}</button>` : "") +
      `</div></div>`;
  }

  /** What the owner starred and what is chosen come first; then a subscription's own order, or the newest of a long list. */
  function rowsOf(item: ChooserSource): { rows: CatalogModel[]; first: number } {
    const now = chosen().model?.id, liked = starred().filter(row => item.models.some(other => other.id === row.id));
    const head = [...liked, ...item.models.filter(row => row.id === now && !liked.some(other => other.id === now))];
    const order = item.group === "subscriptions" ? item.models : [...item.models].sort((a, b) => (b.created_at_ms ?? 0) - (a.created_at_ms ?? 0));
    const rest = order.filter(row => !head.some(other => other.id === row.id));
    return { rows: [...head, ...rest.filter(row => usableFor(row, "answer")), ...rest.filter(row => !usableFor(row, "answer"))], first: head.length };
  }

  function rowsHTML(sources: ChooserSource[]): string {
    const all = pickerModelsFor(look()), checked = chosen().model?.id;
    const row = (model: CatalogModel, note = ""): string => {
      const words = !usableFor(model, "answer") ? reasonText(fitFor(model, "answer").reason) || t("missing.modelFormat") : note || chooserPrice(model, all, "answer");
      return `<button type="button" role="radio" class="cb-row" data-model="${esc(model.id)}" aria-checked="${model.id === checked}"${usableFor(model, "answer") ? "" : " disabled"}>` +
        `<span class="cb-name"><b>${esc(model.name)}</b>${words ? `<small>${esc(words)}</small>` : ""}</span>${model.id === checked ? `<span class="cb-check" aria-hidden="true">${ico("check")}</span>` : ""}</button>`;
    };
    const empty = `<p class="cb-empty">${esc(t("chooser.empty"))}</p>`;
    if (source === FAVORITES) return starred().map(model => row(model, sources.find(item => item.models.some(other => other.id === model.id))?.name)).join("") || empty;
    const item = sources.find(candidate => candidate.id === source);
    if (!item) return empty;
    if (item.group === "subscriptions" && !item.models.length) {
      return modelTries < MODEL_WAIT_TRIES ? `<p class="cb-empty" role="status">${esc(t("chooser.readingModels"))}</p>`
        : `<div class="cb-empty"><p>${esc(t("chooser.modelsFailed"))}</p><button type="button" class="btn sm" data-cb-act="retry">${esc(t("page.retry"))}</button></div>`;
    }
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) return item.models.filter(model => findsName([model.name, model.provider, model.id], query)).map(model => row(model)).join("") || empty;
    const { rows, first } = rowsOf(item);
    return (showAll || rows.length <= COMPACT + 1 ? rows : rows.slice(0, Math.max(COMPACT, first))).map(model => row(model)).join("") || empty;
  }

  function depthHTML(): string {
    const { model, effort } = chosen();
    return effortSliderHTML(model?.reasoning_efforts ?? [], effort, !!model);
  }

  /** What is chosen now, which is also the way to choose another: the source above the model, whatever the source. */
  function nowHTML(): string {
    const { name, provider } = modelPickerSelection(look());
    return `<button type="button" class="menu-action cb-pick" data-cb-act="browse"><small>${esc(provider)}</small><span class="cb-pick-name"><b>${esc(name)}</b>${ico("right")}</span></button>`;
  }

  /** While the source shown is a signed-in CLI whose models have not come, keep asking, and stop to say so. */
  function waitForModels(sources: ChooserSource[]): void {
    clearTimeout(modelTimer);
    const item = sources.find(row => row.id === source);
    if (!menu?.isConnected || view !== "browse" || !item?.cli?.available || item.models.length || modelTries >= MODEL_WAIT_TRIES) return;
    modelTimer = setTimeout(() => { modelTries++; void reload(); }, MODEL_WAIT_MS);
  }

  function paintMenu(): void {
    if (!menu?.isConnected) return;
    const sources = answering();
    settleSource(sources);
    // A change that arrives while the owner is here must not take the keyboard from them.
    const held = document.activeElement instanceof HTMLElement && menu.contains(document.activeElement) ? document.activeElement : null;
    const heldAt = held instanceof HTMLInputElement ? held.selectionStart : null;
    const heldKey = held?.dataset.cbAct === "browse" ? ".cb-pick" : held?.dataset.cbAct === "back" ? ".cb-back" : held?.dataset.cbAct === "all" ? ".cb-all" : held?.matches(".mc-range") ? ".mc-range" : held?.dataset.cbSource !== undefined ? `[data-cb-source="${CSS.escape(held.dataset.cbSource)}"]` : held?.dataset.model !== undefined ? `[data-model="${CSS.escape(held.dataset.model)}"]` : held?.matches(".cb-search") ? ".cb-search" : null;
    const body = menu.querySelector<HTMLElement>(".cb-body")!;
    const sameList = body.dataset.view === view && body.dataset.source === source, sameView = body.dataset.view === view;
    const top = body.querySelector<HTMLElement>(".cb-list")?.scrollTop ?? 0, railTop = body.querySelector<HTMLElement>(".cb-rail")?.scrollTop ?? 0;
    body.dataset.view = view;
    body.dataset.source = source;
    body.hidden = view === "now";
    menu.querySelector<HTMLElement>(".cb-now")!.hidden = view !== "now";
    // The same list again (a roster read that changed nothing here) is left as it is under the owner's hand.
    const listing = view === "now" ? "" : browseHTML(sources);
    if (listing !== paintedBody) body.innerHTML = paintedBody = listing;
    // A list that arrives while the owner drags the slider must not take the slider from under the pointer.
    const who = nowHTML(), slider = depthHTML();
    if (who !== paintedWho) menu.querySelector<HTMLElement>(".cb-now-who")!.innerHTML = paintedWho = who;
    if (slider !== paintedDepth) menu.querySelector<HTMLElement>(".cb-depth-slot")!.innerHTML = paintedDepth = slider;
    // A change while the owner reads leaves the lists where they were; another source's list starts at its top.
    const rail = body.querySelector<HTMLElement>(".cb-rail"), next = body.querySelector<HTMLElement>(".cb-list");
    if (rail && sameView) rail.scrollTop = railTop;
    if (next && sameList) next.scrollTop = top;
    if (heldKey) {
      const again = menu.querySelector<HTMLElement>(heldKey) ?? menu.querySelector<HTMLElement>(view === "now" ? ".cb-pick" : ".cb-back");
      again?.focus({ preventScroll: true });
      if (again instanceof HTMLInputElement && heldAt !== null) again.setSelectionRange(heldAt, heldAt);
    }
    // The views differ in size, and the menu keeps standing on the composer.
    placeMenu();
    waitForModels(sources);
  }

  function open(button: HTMLButtonElement): void {
    source = ""; query = ""; showAll = false; modelTries = 0; view = "now"; paintedWho = paintedDepth = paintedBody = null;
    menu = openPopover(button, `<div class="cb-card cb-body" hidden></div><div class="cb-card cb-now"><div class="cb-now-who"></div><div class="cb-depth-slot"></div></div>`,
      { className: "menu cb-menu", role: "dialog", label: t("chooser.title"), placement: "above", onClose: () => { menu = null; clearTimeout(modelTimer); } });
    menu.addEventListener("click", click);
    menu.addEventListener("input", input);
    menu.addEventListener("change", change);
    paintMenu();
    menu.querySelector<HTMLElement>(".mc-range:not(:disabled), .cb-pick")?.focus({ preventScroll: true });
    // What was read when the app started may be old by now.
    void reload();
  }

  /** The card shows one view at a time, and the keyboard goes where the owner would look next. */
  function turnTo(next: typeof view): void {
    view = next; query = ""; showAll = false;
    paintMenu();
    const selected = next === "browse" ? menu?.querySelector<HTMLElement>('.cb-list [aria-checked="true"]') : null;
    selected?.scrollIntoView?.({ block: "nearest" });
    (selected ?? menu?.querySelector<HTMLElement>(next === "now" ? ".cb-pick" : ".cb-back"))?.focus({ preventScroll: true });
  }

  function click(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>("[data-cb-source], [data-model], [data-cb-act]");
    if (!target || (target as HTMLButtonElement).disabled) return;
    const act = target.dataset.cbAct;
    if (act === "browse" || act === "back") { turnTo(act === "browse" ? "browse" : "now"); return; }
    if (act === "retry") { modelTries = 0; paintMenu(); void reload(); return; }
    if (act === "all") { showAll = !showAll; query = ""; paintMenu(); return; }
    if (target.dataset.cbSource !== undefined) {
      source = target.dataset.cbSource; modelTries = 0; query = ""; showAll = false;
      paintMenu();
      return;
    }
    if (target.dataset.model === undefined) return;
    const row = pickerModelsFor(look()).find(item => item.id === target.dataset.model);
    if (!row) return;
    // The depth stays where the owner put it if the new model has that depth; else what the slider will then show.
    const { effort } = chosen(), levels = row.reasoning_efforts ?? [];
    save(modelRefWith(row, levels.includes(effort) ? effort : row.default_effort ?? orderedEfforts(levels)[0] ?? ""), () => { view = "now"; });
  }

  function saveDepth(effort: string): void {
    const { model } = chosen();
    if (model) save(modelRefWith(model, effort));
  }

  function input(event: Event): void {
    const field = event.target as HTMLInputElement;
    if (field.matches(".cb-search")) {
      query = field.value;
      const list = menu?.querySelector<HTMLElement>(".cb-list");
      if (list) { list.innerHTML = rowsHTML(answering()); paintedBody = null; }
    } else if (field.matches(".mc-range")) moveEffortSlider(field);
  }

  /** A drag saves where it ends, not at every stop on the way. */
  function change(event: Event): void {
    const field = event.target as HTMLInputElement;
    if (field.matches(".mc-range")) saveDepth(moveEffortSlider(field));
  }

  function draw(): void {
    if (!slot.querySelector(".mp-trigger")) {
      slot.innerHTML = modelPickerHTML(look());
      const button = slot.querySelector<HTMLButtonElement>(".mp-trigger")!;
      button.setAttribute("aria-haspopup", "dialog");
      button.addEventListener("click", event => {
        event.stopPropagation();
        if (menu?.isConnected) closeMenu(); else open(button);
      });
    }
    paintButton();
    paintMenu();
  }

  /** `quietly`: a read of the app's own accord (start-up, a change); the owner opening the menu reads at once. */
  async function reload(quietly = false): Promise<void> {
    const mine = ++generation;
    // The two lists wait for the first view and for each other at start-up (startup-reads.ts); the settings are small.
    const optional = <T>(method: string): Promise<T> => quietly ? optionalRead(() => api.core<T>(method)) : api.core<T>(method);
    const [catalogResult, cliResult, settingsResult] = await Promise.allSettled([
      optional<ModelCatalog>("models.catalog"),
      optional<{ clis: CliBrain[] }>("brains.cli"),
      api.core<{ settings: BrainSettings }>("settings.get"),
    ]);
    if (mine !== generation) return;
    if (catalogResult.status === "fulfilled" && Array.isArray(catalogResult.value?.llm)) { catalog = catalogResult.value; rememberCatalog(catalog); }
    if (cliResult.status === "fulfilled") { clis = cliResult.value?.clis ?? []; rememberClis(clis); }
    if (settingsResult.status === "fulfilled") {
      const settings = settingsResult.value?.settings;
      answerModel = settings?.agent_model ?? "";
      quickModel = settings?.quick_model ?? "";
      quickEffort = settings?.quick_effort ?? "low";
      favorites = settings?.model_favorites?.answer ?? [];
    }
    draw();
  }
  host.onEvent?.(event => { if (CHANGES.includes(event.type)) void reload(true); });
  draw(); void reload(true);
  return { draw, reload: () => void reload() };
}
