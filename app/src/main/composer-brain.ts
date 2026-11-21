/**
 * The model of the open conversation, chosen next to where the owner writes. One card stands on the composer and shows
 * one view at a time. First, what is chosen: the provider's mark at the top left, the depth of thought and the model in the
 * middle, the slider below. Pressing the model lists that provider's models, which is what is changed most; pressing the
 * mark lists the connected providers, and 新增供應商 under them leads to Settings. Choosing a model saves it and turns back.
 *
 * Each member answers on its own model, so a member's conversation writes that member's and moves no one else. Raphael's is
 * what Settings writes, and a quick conversation's what 快速提問 writes.
 * The core holds the choice and every list. This reads them again whenever the core says one changed, which is how a
 * choice made in Settings reaches the button, and how a CLI's models reach it: the core asks the CLI only after the
 * first read, in the background.
 */
import { bindLayerSteps, LayerViews } from "./nav-layers";
import "./composer-brain.css";
import * as api from "./api";
import { t } from "./i18n";
import {
  chooserSources, effortOf, effortSliderHTML, modelPickerHTML, modelPickerSelection, modelRefWith, moveEffortSlider, orderedEfforts, pickerModelsFor, buttonFaceHTML,
  sourceMarkHTML, concreteModel, chooserPrice, splitEffort, usableFor, reasonText, fitFor, effortText, refsOf, sourceConnected, holdsCurrent, type ChooserSource, type ModelPickerLook,
} from "./model-picker";
import { knownCatalog, knownClis, rememberCatalog, rememberClis } from "./brain-lists";
import { RAPHAEL_ID } from "./members";
import type { BrainSettings, CatalogModel, ChatGptStatus, CliBrain, MainEvent, Member, ModelCatalog, ModelProvider } from "./types";
import { btn, closeMenu, esc, ico, backButton, openPopover, placeMenu, toaster } from "./ui";
import { describeError } from "./format";
import { optionalRead } from "./startup-reads";
import { findsName } from "./find-match";

/** A list longer than this gets a search above it. */
const SEARCH_FROM = 12;
const GROUPS = ["subscriptions", "api", "local"] as const;
/** How long a signed-in CLI may be silent about its models while the menu is open before this says so. */
const MODEL_WAIT_TRIES = 20, MODEL_WAIT_MS = 2000;
const CHANGES: readonly MainEvent["type"][] = ["SettingsChanged", "BrainsChanged", "ProvidersChanged"];
type View = "now" | "models" | "sources";

export interface ComposerBrainHost {
  onEvent?: (handler: (event: MainEvent) => void) => unknown;
  /** Whether the open conversation is the quick one, which answers on 快速提問's model. */
  quick?: () => boolean;
}

/** The way to Settings' list of providers to connect, through the notices' own repair (missing.ts bindMissing). */
const addSourceHTML = (cls: string): string =>
  btn(`${ico("plus")}<span>${esc(t("providers.add"))}</span>`, cls, ' data-missing-repair="models" data-missing-resource="connect"');

export function mountComposerBrain(slot: HTMLElement, member: () => Member, host: ComposerBrainHost = {}): { draw(): void; reload(): void } {
  let catalog: ModelCatalog | null = knownCatalog(), clis: CliBrain[] = knownClis(), answerModel = "", quickModel = "", quickEffort = "low", generation = 0;
  let providers: ModelProvider[] | undefined, chatgpt: ChatGptStatus | null | undefined;
  let menu: HTMLElement | null = null, source = "", query = "", view: View = "now";
  let modelTries = 0, modelTimer: ReturnType<typeof setTimeout> | undefined;
  let paintedWho: string | null = null, paintedDepth: string | null = null, paintedBody: string | null = null;
  let favorites: readonly string[] = [];

  const look = (): ModelPickerLook => {
    const who = member(), own = (who.id !== RAPHAEL_ID && who.model) || answerModel;
    const current = host.quick?.() ? `${(quickModel || own).split("?effort=")[0]}?effort=${quickEffort}` : own;
    return { role: "answer", current, catalog, clis, providers, chatgpt, label: t("members.brain"), key: "composer-brain" };
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
    // so the chip does not flash and its hover stays.
    const stamp = JSON.stringify([face.inner, face.label, effort && levels.length > 1 ? effortText(effort) : ""]);
    if (button.dataset.painted === stamp) return;
    button.dataset.painted = stamp;
    button.innerHTML = face.inner;
    button.setAttribute("aria-label", face.label);
    // Nothing chosen yet: the chip is the way to choose.
    if (!look().current.split("?effort=")[0]) { const nameEl = button.querySelector(".mp-tname"); if (nameEl) nameEl.textContent = t("models.choose"); }
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
    // A model starred under an alias (Claude Code's `opus`) is starred once, whatever the ref it was saved under.
    const seen = new Set<string>();
    return favorites.flatMap(id => all.filter(row => refsOf(row).includes(id) && usableFor(row, "answer"))).filter(row => !seen.has(row.id) && !!seen.add(row.id));
  }

  /** The providers to choose from: those connected, and the one holding what is chosen (chooserSources). */
  function answering(): ChooserSource[] {
    const o = look(), sources = chooserSources(o);
    return GROUPS.flatMap(group => sources.filter(item => item.group === group && (item.cli?.available || item.models.length || holdsCurrent(o, item))));
  }

  /** The provider holding what is chosen; before anything is chosen, the first connected one. */
  function currentSource(sources: ChooserSource[]): ChooserSource | undefined {
    const { model } = chosen();
    const o = look();
    return sources.find(item => holdsCurrent(o, item)) ?? sources.find(item => model && item.models.some(row => row.id === model.id)) ?? (o.current ? undefined : sources[0]);
  }

  /** What the owner starred and what is chosen come first; then a subscription's own order, or the newest of a long list. */
  function rowsOf(item: ChooserSource): CatalogModel[] {
    const now = chosen().model?.id, liked = starred().filter(row => item.models.some(other => other.id === row.id));
    const head = [...liked, ...item.models.filter(row => row.id === now && !liked.some(other => other.id === now))];
    const order = item.group === "subscriptions" ? item.models : [...item.models].sort((a, b) => (b.created_at_ms ?? 0) - (a.created_at_ms ?? 0));
    const rest = order.filter(row => !head.some(other => other.id === row.id));
    return [...head, ...rest.filter(row => usableFor(row, "answer")), ...rest.filter(row => !usableFor(row, "answer"))];
  }

  function rowsHTML(item: ChooserSource | undefined): string {
    const all = pickerModelsFor(look()), checked = chosen().model?.id;
    const row = (model: CatalogModel): string => {
      const words = !usableFor(model, "answer") ? reasonText(fitFor(model, "answer").reason) || t("missing.modelFormat") : chooserPrice(model, all, "answer");
      return `<button type="button" role="radio" class="cb-row" data-model="${esc(model.id)}" aria-checked="${model.id === checked}"${usableFor(model, "answer") ? "" : " disabled"}>` +
        `<span class="cb-name"><b>${esc(model.name)}</b>${words ? `<small>${esc(words)}</small>` : ""}</span>${model.id === checked ? `<span class="cb-check" aria-hidden="true">${ico("check")}</span>` : ""}</button>`;
    };
    const empty = `<p class="cb-empty">${esc(t("chooser.empty"))}</p>`;
    if (!item) return empty;
    if (item.group === "subscriptions" && !item.models.length) {
      return modelTries < MODEL_WAIT_TRIES ? `<p class="cb-empty" role="status">${esc(t("chooser.readingModels"))}</p>`
        : `<div class="cb-empty"><p>${esc(t("chooser.modelsFailed"))}</p><button type="button" class="btn sm" data-cb-act="retry">${esc(t("page.retry"))}</button></div>`;
    }
    if (query.trim()) return item.models.filter(model => findsName([model.name, model.provider, model.id], query)).map(row).join("") || empty;
    return rowsOf(item).map(row).join("") || empty;
  }

  const headHTML = (title: string): string =>
    `<header class="cb-head">${backButton(t("chooser.back"), ' data-cb-act="back"', "cb-back")}<h3>${title}</h3></header>`;

  /** One provider's models: the list changed most, so it is one press from what is chosen. */
  function modelsHTML(sources: ChooserSource[]): string {
    const item = sources.find(row => row.id === source);
    const title = item ? `${sourceMarkHTML(item)}<span>${esc(item.name)}</span>` : `<span>${esc(t("chooser.title"))}</span>`;
    return headHTML(title) +
      ((item?.models.length ?? 0) > SEARCH_FROM ? `<input type="search" class="cb-search" aria-label="${esc(t("chooser.search"))}" placeholder="${esc(t("chooser.search"))}" value="${esc(query)}">` : "") +
      `<div class="cb-list" role="radiogroup" aria-label="${esc(t("chooser.title"))}">${rowsHTML(item)}</div>`;
  }

  /** The connected providers, the one holding what is chosen checked, and the way to connect another. */
  function sourcesHTML(sources: ChooserSource[]): string {
    const now = currentSource(sources)?.id, o = look();
    const rows = sources.map(item => {
      const words = sourceConnected(o, item) ? t(item.group === "subscriptions" ? "brains.subscription" : item.group === "local" ? "providers.local" : "providers.apiKey") : t("chooser.off", { p0: item.name });
      return `<button type="button" class="menu-action cb-source" data-cb-source="${esc(item.id)}" aria-pressed="${item.id === now}">${sourceMarkHTML(item)}` +
        `<span class="cb-name"><b>${esc(item.name)}</b><small${sourceConnected(o, item) ? "" : ' class="is-off"'}>${esc(words)}</small></span>` +
        `${item.id === now ? `<span class="cb-check" aria-hidden="true">${ico("check")}</span>` : ""}</button>`;
    }).join("");
    return headHTML(`<span>${esc(t("chooser.rail"))}</span>`) + `<div class="cb-list cb-sources">${rows}</div>` + addSourceHTML("cb-add");
  }

  function depthHTML(): string {
    const { model, effort } = chosen();
    return effortSliderHTML(model?.reasoning_efforts ?? [], effort, !!model);
  }

  /** What is chosen now: the provider's mark to change provider, and above the slider the depth and the model to change model. */
  function nowHTML(sources: ChooserSource[]): string {
    if (!sources.length) {
      return `<div class="cb-none"><b>${esc(t("chooser.noSource"))}</b><small>${esc(t("chooser.noSourceNote"))}</small>${addSourceHTML("pri sm cb-add-first")}</div>`;
    }
    const o = look(), { name, off, source: words } = modelPickerSelection(o), { model, effort } = chosen(), item = currentSource(sources);
    const levels = model?.reasoning_efforts ?? [];
    const mark = sourceMarkHTML(item ?? { id: "", name: "", kind: "", group: "api", models: [] });
    return `<div class="cb-now-top">` +
      `<button type="button" class="menu-action cb-src" data-cb-act="sources" aria-label="${esc(item ? t("chooser.switchSource", { p0: item.name }) : t("chooser.rail"))}">${mark}</button>` +
      `<button type="button" class="menu-action cb-pick" data-cb-act="models">` +
      (levels.length && effort ? `<b class="cb-effort">${esc(effortText(effort))}</b>` : model && !levels.length ? `<b class="cb-effort is-none">${esc(t("chooser.noDepth"))}</b>` : `<b class="cb-effort"></b>`) +
      `<span class="cb-pick-name"><span>${esc(o.current.split("?effort=")[0] ? name : t("chooser.title"))}</span>${ico("right")}</span>` +
      (off ? `<small class="is-off">${esc(words)}</small>` : "") +
      `</button><span class="cb-top-end" aria-hidden="true"></span></div>`;
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
    const sources = answering();
    if (!sources.some(row => row.id === source)) source = (currentSource(sources) ?? sources[0])?.id ?? "";
    // A change that arrives while the owner is here must not take the keyboard from them.
    const held = document.activeElement instanceof HTMLElement && menu.contains(document.activeElement) ? document.activeElement : null;
    const heldAt = held instanceof HTMLInputElement ? held.selectionStart : null;
    const heldKey = held?.dataset.cbAct ? `[data-cb-act="${CSS.escape(held.dataset.cbAct)}"]` : held?.matches(".mc-range") ? ".mc-range" : held?.dataset.cbSource !== undefined ? `[data-cb-source="${CSS.escape(held.dataset.cbSource)}"]` : held?.dataset.model !== undefined ? `[data-model="${CSS.escape(held.dataset.model)}"]` : held?.matches(".cb-search") ? ".cb-search" : null;
    const body = menu.querySelector<HTMLElement>(".cb-body")!;
    const sameList = body.dataset.view === view && body.dataset.source === source;
    const top = body.querySelector<HTMLElement>(".cb-list")?.scrollTop ?? 0;
    body.dataset.view = view;
    body.dataset.source = source;
    body.hidden = view === "now";
    menu.querySelector<HTMLElement>(".cb-now")!.hidden = view !== "now";
    // The same list again (a roster read that changed nothing here) is left as it is under the owner's hand.
    const listing = view === "models" ? modelsHTML(sources) : view === "sources" ? sourcesHTML(sources) : "";
    if (listing !== paintedBody) body.innerHTML = paintedBody = listing;
    // A list that arrives while the owner drags the slider must not take the slider from under the pointer.
    const who = nowHTML(sources), slider = sources.length ? depthHTML() : "";
    if (who !== paintedWho) menu.querySelector<HTMLElement>(".cb-now-who")!.innerHTML = paintedWho = who;
    if (slider !== paintedDepth) menu.querySelector<HTMLElement>(".cb-depth-slot")!.innerHTML = paintedDepth = slider;
    const next = body.querySelector<HTMLElement>(".cb-list");
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

  let menuViews: LayerViews<View>;
  function resetMenuViews(): void {
    view = "now";
    menuViews = new LayerViews<View>(view);
    if (menu) bindLayerSteps(menu, menuViews, turnTo);
  }
  function open(button: HTMLButtonElement): void {
    source = ""; query = ""; modelTries = 0; view = "now"; paintedWho = paintedDepth = paintedBody = null;
    menu = openPopover(button, `<div class="cb-card cb-body" hidden></div><div class="cb-card cb-now"><div class="cb-now-who"></div><div class="cb-depth-slot"></div></div>`,
      { className: "menu cb-menu", role: "dialog", label: t("chooser.title"), placement: "above", onClose: () => { menu = null; clearTimeout(modelTimer); } });
    resetMenuViews();
    menu.addEventListener("click", click);
    menu.addEventListener("input", input);
    menu.addEventListener("change", change);
    paintMenu();
    menu.querySelector<HTMLElement>(".mc-range:not(:disabled), .cb-pick, .cb-add-first")?.focus({ preventScroll: true });
    // What was read when the app started may be old by now.
    void reload();
  }

  /** The card shows one view at a time, and the keyboard goes where the owner would look next. */
  function turnTo(next: View): void {
    view = next; menuViews.visit(next); query = "";
    paintMenu();
    const selected = next === "models" ? menu?.querySelector<HTMLElement>('.cb-list [aria-checked="true"]') : next === "sources" ? menu?.querySelector<HTMLElement>('.cb-source[aria-pressed="true"]') : null;
    selected?.scrollIntoView?.({ block: "nearest" });
    (selected ?? menu?.querySelector<HTMLElement>(next === "now" ? ".cb-pick" : ".cb-back"))?.focus({ preventScroll: true });
  }

  function click(event: Event): void {
    // 新增供應商 goes to Settings through the notices' repair; the card closes after the press has been heard.
    if ((event.target as Element).closest("[data-missing-repair]")) { setTimeout(closeMenu); return; }
    const target = (event.target as Element).closest<HTMLElement>("[data-cb-source], [data-model], [data-cb-act]");
    if (!target || (target as HTMLButtonElement).disabled) return;
    const act = target.dataset.cbAct;
    if (act === "back") { menuViews.step("back", turnTo); return; }
    if (act === "models") { const sources = answering(); source = (currentSource(sources) ?? sources[0])?.id ?? ""; turnTo("models"); return; }
    if (act === "sources") { turnTo("sources"); return; }
    if (act === "retry") { modelTries = 0; paintMenu(); void reload(); return; }
    if (target.dataset.cbSource !== undefined) {
      // A provider chosen shows its models at once; nothing is saved until a model is chosen.
      source = target.dataset.cbSource; modelTries = 0;
      turnTo("models");
      return;
    }
    if (target.dataset.model === undefined) return;
    const row = pickerModelsFor(look()).find(item => item.id === target.dataset.model);
    if (!row) return;
    // The depth stays where the owner put it if the new model has that depth; else what the slider will then show.
    const { effort } = chosen(), levels = row.reasoning_efforts ?? [];
    save(modelRefWith(row, levels.includes(effort) ? effort : row.default_effort ?? orderedEfforts(levels)[0] ?? ""), resetMenuViews);
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
      if (list) { list.innerHTML = rowsHTML(answering().find(row => row.id === source)); paintedBody = null; placeMenu(); }
    } else if (field.matches(".mc-range")) {
      const level = moveEffortSlider(field), title = menu?.querySelector<HTMLElement>(".cb-effort");
      if (title && level) title.textContent = effortText(level);
    }
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
    const [catalogResult, cliResult, settingsResult, providersResult, chatgptResult] = await Promise.allSettled([
      optional<ModelCatalog>("models.catalog"),
      optional<{ clis: CliBrain[] }>("brains.cli"),
      api.core<{ settings: BrainSettings }>("settings.get"),
      optional<{ providers: ModelProvider[] }>("providers.list"),
      optional<ChatGptStatus>("chatgpt.status"),
    ]);
    if (mine !== generation) return;
    if (catalogResult.status === "fulfilled" && Array.isArray(catalogResult.value?.llm)) { catalog = catalogResult.value; rememberCatalog(catalog); }
    if (cliResult.status === "fulfilled") { clis = cliResult.value?.clis ?? []; rememberClis(clis); }
    if (providersResult.status === "fulfilled" && Array.isArray(providersResult.value?.providers)) providers = providersResult.value.providers;
    if (chatgptResult.status === "fulfilled") chatgpt = chatgptResult.value ?? null;
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
