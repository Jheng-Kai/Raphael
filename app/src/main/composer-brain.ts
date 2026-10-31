/**
 * The model of the open conversation, chosen next to where the owner writes. One card stands on the composer and turns
 * through three views: the model with its depth of thought as a slider; pressing the model, the sources; pressing a
 * source, its models. Choosing a model saves it and turns back to the first view, where its depth is right there.
 *
 * The core holds the choice and every list. This reads them again whenever the core says one changed, which is how a
 * choice made in Settings reaches the button, and how a CLI's models reach it: the core asks the CLI only after the
 * first read, in the background.
 */
import "./composer-brain.css";
import * as api from "./api";
import { t } from "./i18n";
import {
  chooserSources, effortOf, effortSliderHTML, modelPickerHTML, modelPickerSelection, modelRefWith, moveEffortSlider, orderedEfforts, pickerModelsFor, buttonFaceHTML,
  sourceMarkHTML, concreteModel, chooserPrice, usableFor, reasonText, fitFor, effortText, type ChooserSource, type ModelPickerLook,
} from "./model-picker";
import { knownCatalog, knownClis, rememberCatalog, rememberClis } from "./brain-lists";
import { RAPHAEL_ID } from "./members";
import type { BrainSettings, CatalogModel, CliBrain, MainEvent, Member, ModelCatalog } from "./types";
import { closeMenu, esc, ico, iconButton, openPopover, placeMenu, toaster } from "./ui";
import { describeError } from "./format";

const SEARCH_FROM = 12;
/** How long a signed-in CLI may be silent about its models while the menu is open before this says so. */
const MODEL_WAIT_TRIES = 20, MODEL_WAIT_MS = 2000;
const CHANGES: readonly MainEvent["type"][] = ["SettingsChanged", "BrainsChanged", "ProvidersChanged"];

export interface ComposerBrainHost {
  onEvent?: (handler: (event: MainEvent) => void) => unknown;
}

export function mountComposerBrain(slot: HTMLElement, member: () => Member, host: ComposerBrainHost = {}): { draw(): void; reload(): void } {
  let catalog: ModelCatalog | null = knownCatalog(), clis: CliBrain[] = knownClis(), answerModel = "", generation = 0;
  let menu: HTMLElement | null = null, source = "", query = "", view: "now" | "sources" | "models" = "now";
  let modelTries = 0, modelTimer: ReturnType<typeof setTimeout> | undefined;
  let paintedWho: string | null = null, paintedDepth: string | null = null;

  const look = (): ModelPickerLook => {
    const who = member();
    return { role: "answer", current: who.id === RAPHAEL_ID ? answerModel : who.model || answerModel, catalog, clis, label: t("members.brain"), key: "composer-brain" };
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
    button.innerHTML = face.inner;
    button.setAttribute("aria-label", face.label);
    const levels = model?.reasoning_efforts ?? [];
    if (effort && levels.length > 1) button.querySelector(".mp-tname")?.insertAdjacentHTML("afterend", `<span class="cb-depth">${esc(effortText(effort))}</span>`);
  }

  function save(model: string, then?: () => void): void {
    const who = member();
    // A read that began before this choice would put the old one back.
    generation++;
    const saved = who.id === RAPHAEL_ID ? api.settingsSet("agent_model", model).then(result => { answerModel = result.settings.agent_model ?? model; })
      : api.membersUpdate(who.id, { model }).then(() => { who.model = model; });
    void saved.then(() => { then?.(); paintButton(); paintMenu(); }).catch(error => { toaster.info(describeError(error)); void reload(); });
  }

  function sourcesHTML(sources: ChooserSource[]): string {
    const { model } = chosen();
    const groups = [["subscriptions", "chooser.subscriptions"], ["api", "chooser.api"], ["local", "chooser.local"]] as const;
    const rows = groups.map(([group, title]) => {
      // Only what can answer now: signing in and adding a source belong to Settings.
      const items = sources.filter(item => item.group === group && (group !== "subscriptions" || item.cli?.available));
      return !items.length ? "" : `<div class="cb-group"><h4>${esc(t(title))}</h4>${items.map(item => {
        const holds = !!model && item.models.some(row => row.id === model.id);
        return `<button type="button" role="menuitem" class="cb-source" data-cb-source="${esc(item.id)}" aria-haspopup="true">${sourceMarkHTML(item)}<span class="cb-name"><b>${esc(item.name)}</b></span>${holds ? `<span class="cb-check" aria-hidden="true">${ico("check")}</span>` : ""}${ico("right")}</button>`;
      }).join("")}</div>`;
    }).join("");
    return headHTML(t("chooser.title"), t("chooser.back")) + `<div class="cb-list">${rows || `<p class="cb-empty">${esc(t("chooser.empty"))}</p>`}</div>`;
  }

  /** The way back on the left, and what this view is in the middle. */
  function headHTML(title: string, back: string, mark = ""): string {
    return `<header class="cb-head">${iconButton("left", back, ' data-cb-act="back"', "cb-back")}<h3>${mark}<span>${esc(title)}</span></h3></header>`;
  }

  function modelsHTML(sources: ChooserSource[]): string {
    const item = sources.find(row => row.id === source);
    const searching = (item?.models.length ?? 0) > SEARCH_FROM;
    return headHTML(item?.name ?? "", t("chooser.back"), item ? sourceMarkHTML(item) : "") +
      `<div class="cb-pane">` + (searching ? `<input type="search" class="cb-search" aria-label="${esc(t("chooser.search"))}" placeholder="${esc(t("chooser.search"))}" value="${esc(query)}">` : "") +
      `<div class="cb-list" role="radiogroup" aria-label="${esc(t("chooser.title"))}">${rowsHTML(sources)}</div></div>`;
  }

  function rowsHTML(sources: ChooserSource[]): string {
    const item = sources.find(row => row.id === source), o = look();
    if (!item) return `<p class="cb-empty">${esc(t("chooser.empty"))}</p>`;
    if (item.group === "subscriptions" && !item.models.length) {
      return modelTries < MODEL_WAIT_TRIES ? `<p class="cb-empty" role="status">${esc(t("chooser.readingModels"))}</p>`
        : `<div class="cb-empty"><p>${esc(t("chooser.modelsFailed"))}</p><button type="button" class="btn sm" data-cb-act="retry">${esc(t("page.retry"))}</button></div>`;
    }
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const models = item.models.filter(row => words.every(word => `${row.name} ${row.provider} ${row.id}`.toLowerCase().includes(word)));
    const { model: current } = chosen();
    const all = pickerModelsFor(o);
    const rows = models.map(row => {
      const usable = usableFor(row, "answer"), checked = row.id === current?.id, price = chooserPrice(row, all, "answer");
      return `<button type="button" role="radio" class="cb-row" data-model="${esc(row.id)}" aria-checked="${checked}"${usable ? "" : ` disabled title="${esc(reasonText(fitFor(row, "answer").reason))}"`}>` +
        `<span class="cb-check" aria-hidden="true">${checked ? ico("check") : ""}</span><span class="cb-name"><b>${esc(row.name)}</b></span>${price ? `<small>${esc(price)}</small>` : ""}</button>`;
    }).join("");
    return rows || `<p class="cb-empty">${esc(t("chooser.empty"))}</p>`;
  }

  function depthHTML(): string {
    const { model, effort } = chosen();
    const levels = orderedEfforts(model?.reasoning_efforts ?? []);
    return levels.length > 1 ? effortSliderHTML(levels, effort) : "";
  }

  /** What is chosen now, which is also the way to choose another. */
  function nowHTML(): string {
    const { name, source: from } = modelPickerSelection(look());
    return `<button type="button" class="menu-action cb-pick" data-cb-act="browse"><small>${esc(from)}</small><span class="cb-pick-name"><b>${esc(name)}</b>${ico("right")}</span></button>`;
  }

  /** While the source shown is a signed-in CLI whose models have not come, keep asking, and stop to say so. */
  function waitForModels(sources: ChooserSource[]): void {
    clearTimeout(modelTimer);
    const item = sources.find(row => row.id === source);
    if (!menu?.isConnected || view !== "models" || !item?.cli?.available || item.models.length || modelTries >= MODEL_WAIT_TRIES) return;
    modelTimer = setTimeout(() => { modelTries++; void reload(); }, MODEL_WAIT_MS);
  }

  function paintMenu(): void {
    if (!menu?.isConnected) return;
    const sources = chooserSources(look());
    // A change that arrives while the owner is here must not take the keyboard from them.
    const held = document.activeElement instanceof HTMLElement && menu.contains(document.activeElement) ? document.activeElement : null;
    const heldAt = held instanceof HTMLInputElement ? held.selectionStart : null;
    const heldKey = held?.dataset.cbAct === "browse" ? ".cb-pick" : held?.dataset.cbAct === "back" ? ".cb-back" : held?.matches(".mc-range") ? ".mc-range" : held?.dataset.cbSource !== undefined ? `[data-cb-source="${CSS.escape(held.dataset.cbSource)}"]` : held?.dataset.model !== undefined ? `[data-model="${CSS.escape(held.dataset.model)}"]` : held?.matches(".cb-search") ? ".cb-search" : null;
    const body = menu.querySelector<HTMLElement>(".cb-body")!;
    const wasView = body.dataset.view, list = body.querySelector<HTMLElement>(".cb-list"), top = list?.scrollTop ?? 0;
    body.dataset.view = view;
    body.hidden = view === "now";
    menu.querySelector<HTMLElement>(".cb-now")!.hidden = view !== "now";
    body.innerHTML = view === "now" ? "" : view === "sources" ? sourcesHTML(sources) : modelsHTML(sources);
    // A list that arrives while the owner drags the slider must not take the slider from under the pointer.
    const who = nowHTML(), slider = depthHTML();
    if (who !== paintedWho) menu.querySelector<HTMLElement>(".cb-now-who")!.innerHTML = paintedWho = who;
    if (slider !== paintedDepth) {
      const depth = menu.querySelector<HTMLElement>(".cb-depth-slot")!;
      depth.innerHTML = paintedDepth = slider;
      depth.hidden = slider === "";
    }
    const next = body.querySelector<HTMLElement>(".cb-list");
    // A change while the owner reads leaves the list where it was; turning to another list starts it at the top.
    if (next && wasView === view) next.scrollTop = top;
    if (heldKey) {
      const again = menu.querySelector<HTMLElement>(heldKey);
      again?.focus({ preventScroll: true });
      if (again instanceof HTMLInputElement && heldAt !== null) again.setSelectionRange(heldAt, heldAt);
    }
    // The views differ in height, and the menu keeps standing on the composer.
    placeMenu();
    waitForModels(sources);
  }

  function open(button: HTMLButtonElement): void {
    const o = look(), sources = chooserSources(o), { model } = chosen();
    source = sources.find(item => model && item.models.some(row => row.id === model.id))?.id ?? sources[0]?.id ?? "";
    query = ""; modelTries = 0; view = "now"; paintedWho = paintedDepth = null;
    menu = openPopover(button, `<div class="cb-card cb-body" hidden></div><div class="cb-card cb-now"><div class="cb-now-who"></div><div class="cb-depth-slot"></div></div>`,
      { className: "menu cb-menu", role: "dialog", label: t("chooser.title"), placement: "above", onClose: () => { menu = null; clearTimeout(modelTimer); } });
    menu.addEventListener("click", click);
    menu.addEventListener("input", input);
    menu.addEventListener("change", change);
    paintMenu();
    menu.querySelector<HTMLElement>(".mc-range, .cb-pick")?.focus({ preventScroll: true });
    // What was read when the app started may be old by now.
    void reload();
  }

  /** The card shows one view at a time, and the keyboard goes where the owner would look next. */
  function turnTo(next: typeof view): void {
    view = next; query = "";
    paintMenu();
    const selected = next === "models" ? menu?.querySelector<HTMLElement>('.cb-list [aria-checked="true"]') : null;
    selected?.scrollIntoView?.({ block: "nearest" });
    const first = next === "now" ? ".cb-pick" : next === "sources" ? `[data-cb-source="${CSS.escape(source)}"]` : ".cb-back";
    (selected ?? menu?.querySelector<HTMLElement>(first) ?? menu?.querySelector<HTMLElement>(".cb-back"))?.focus({ preventScroll: true });
  }

  function click(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>("[data-cb-source], [data-model], [data-cb-act]");
    if (!target || (target as HTMLButtonElement).disabled) return;
    if (target.dataset.cbAct === "browse") {
      turnTo("sources");
      return;
    }
    if (target.dataset.cbAct === "retry") { modelTries = 0; paintMenu(); void reload(); return; }
    if (target.dataset.cbAct === "back") {
      turnTo(view === "models" ? "sources" : "now");
      return;
    }
    if (target.dataset.cbSource !== undefined) {
      source = target.dataset.cbSource; modelTries = 0;
      turnTo("models");
      return;
    }
    if (target.dataset.model === undefined) return;
    const row = pickerModelsFor(look()).find(item => item.id === target.dataset.model);
    if (row) save(modelRefWith(row, row.default_effort ?? ""), () => { view = "now"; });
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
      if (list) list.innerHTML = rowsHTML(chooserSources(look()));
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

  async function reload(): Promise<void> {
    const mine = ++generation;
    const [catalogResult, cliResult, settingsResult] = await Promise.allSettled([
      api.core<ModelCatalog>("models.catalog"),
      api.core<{ clis: CliBrain[] }>("brains.cli"),
      api.core<{ settings: BrainSettings }>("settings.get"),
    ]);
    if (mine !== generation) return;
    if (catalogResult.status === "fulfilled" && Array.isArray(catalogResult.value?.llm)) { catalog = catalogResult.value; rememberCatalog(catalog); }
    if (cliResult.status === "fulfilled") { clis = cliResult.value?.clis ?? []; rememberClis(clis); }
    if (settingsResult.status === "fulfilled") answerModel = settingsResult.value?.settings?.agent_model ?? "";
    draw();
  }
  host.onEvent?.(event => { if (CHANGES.includes(event.type)) void reload(); });
  draw(); void reload();
  return { draw, reload: () => void reload() };
}
