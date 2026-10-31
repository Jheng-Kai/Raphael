/**
 * The model of the open conversation, chosen next to where the owner writes: a menu above the composer like the one
 * beside it, with every source on the left, its models on the right and the depth of thought as a slider under both.
 * A choice is saved as it is made and the menu stays, so that a model and its depth are set together.
 */
import "./composer-brain.css";
import * as api from "./api";
import { t } from "./i18n";
import {
  chooserSources, effortOf, effortSliderHTML, modelPickerHTML, modelRefWith, moveEffortSlider, orderedEfforts, pickerModelsFor, buttonFaceHTML,
  sourceMarkHTML, sourceStatus, concreteModel, chooserPrice, usableFor, reasonText, fitFor, effortText, type ChooserSource, type ModelPickerLook,
} from "./model-picker";
import { RAPHAEL_ID } from "./members";
import type { BrainSettings, CatalogModel, CliBrain, Member, ModelCatalog } from "./types";
import { closeMenu, esc, ico, openPopover, placeMenu, toaster } from "./ui";
import { describeError } from "./format";

const SEARCH_FROM = 12;

export function mountComposerBrain(slot: HTMLElement, member: () => Member, openSources: () => void = () => {}): { draw(): void; reload(): void } {
  let catalog: ModelCatalog | null = null, clis: CliBrain[] = [], answerModel = "", generation = 0;
  let menu: HTMLElement | null = null, source = "", query = "";

  const look = (): ModelPickerLook => {
    const who = member(), raphael = who.id === RAPHAEL_ID;
    return { role: "answer", current: raphael ? answerModel : who.model || "", catalog, clis, label: t("members.brain"), key: "composer-brain",
      lead: raphael ? undefined : { id: "", name: t("members.inheritBrain") }, inheritFrom: raphael ? undefined : answerModel };
  };
  const chosen = (): { model: CatalogModel | undefined; effort: string; inherits: boolean } => {
    const o = look(), models = pickerModelsFor(o), inherits = !!o.lead && o.current === o.lead.id;
    const id = concreteModel(inherits ? { ...o, current: o.inheritFrom ?? "" } : o, models);
    const model = models.find(item => item.id === id);
    const stored = effortOf(inherits ? o.inheritFrom ?? "" : o.current, models);
    return { model, inherits, effort: stored && model?.reasoning_efforts?.includes(stored) ? stored : model?.default_effort ?? "" };
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

  function save(model: string): void {
    const who = member();
    const saved = who.id === RAPHAEL_ID ? api.settingsSet("agent_model", model).then(result => { answerModel = result.settings.agent_model ?? model; })
      : api.membersUpdate(who.id, { model }).then(() => { who.model = model; });
    void saved.then(() => { paintButton(); paintMenu(); }).catch(error => toaster.info(describeError(error)));
  }

  function railHTML(sources: ChooserSource[]): string {
    const { model } = chosen();
    const groups = [["subscriptions", "chooser.subscriptions"], ["api", "chooser.api"], ["local", "chooser.local"]] as const;
    return groups.map(([group, title]) => {
      const items = sources.filter(item => item.group === group);
      return !items.length ? "" : `<div class="cb-group"><h4>${esc(t(title))}</h4>${items.map(item => {
        const holds = !!model && item.models.some(row => row.id === model.id);
        return `<button type="button" class="cb-source" data-cb-source="${esc(item.id)}" aria-pressed="${item.id === source}">${sourceMarkHTML(item)}<span class="cb-name"><b>${esc(item.name)}</b><small>${esc(sourceStatus(item, look()))}</small></span>${holds ? '<i class="cb-here" aria-hidden="true"></i>' : ""}</button>`;
      }).join("")}</div>`;
    }).join("");
  }

  function rowsHTML(sources: ChooserSource[]): string {
    const item = sources.find(row => row.id === source), o = look();
    if (!item) return `<p class="cb-empty">${esc(t("chooser.empty"))}</p>`;
    if (item.group === "subscriptions" && !item.cli?.available) {
      return `<div class="cb-empty"><p>${esc(t(item.cli?.disconnected ? "brains.disconnected" : item.cli?.installed ? "chooser.loginNote" : "chooser.installNote"))}</p><button type="button" class="btn sm" data-cb-act="sources">${esc(t(item.cli?.installed ? "brains.connect" : "brains.install"))}</button></div>`;
    }
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const models = item.models.filter(row => words.every(word => `${row.name} ${row.provider} ${row.id}`.toLowerCase().includes(word)));
    const { model: current, inherits } = chosen();
    const all = pickerModelsFor(o);
    const rows = models.map(row => {
      const usable = usableFor(row, "answer"), checked = !inherits && row.id === current?.id, price = chooserPrice(row, all, "answer");
      return `<button type="button" role="radio" class="cb-row" data-model="${esc(row.id)}" aria-checked="${checked}"${usable ? "" : ` disabled title="${esc(reasonText(fitFor(row, "answer").reason))}"`}>` +
        `<span class="cb-check" aria-hidden="true">${checked ? ico("check") : ""}</span><span class="cb-name"><b>${esc(row.name)}</b></span>${price ? `<small>${esc(price)}</small>` : ""}</button>`;
    }).join("");
    return rows || `<p class="cb-empty">${esc(t("chooser.empty"))}</p>`;
  }

  function depthHTML(): string {
    const { model, effort, inherits } = chosen();
    const levels = inherits ? [] : orderedEfforts(model?.reasoning_efforts ?? []);
    return levels.length > 1 ? effortSliderHTML(levels, effort) : "";
  }

  function paintMenu(): void {
    if (!menu?.isConnected) return;
    const o = look(), sources = chooserSources(o);
    const body = menu.querySelector<HTMLElement>(".cb-body")!;
    const list = body.querySelector<HTMLElement>(".cb-list"), top = list?.scrollTop ?? 0;
    const item = sources.find(row => row.id === source);
    const searching = (item?.models.length ?? 0) > SEARCH_FROM;
    const lead = o.lead ? `<button type="button" role="radio" class="cb-row cb-lead" data-model="${esc(o.lead.id)}" aria-checked="${o.current === o.lead.id}"><span class="cb-check" aria-hidden="true">${o.current === o.lead.id ? ico("check") : ""}</span><span class="cb-name"><b>${esc(o.lead.name)}</b></span></button>` : "";
    body.innerHTML = lead + `<div class="cb-panes"><div class="cb-rail">${railHTML(sources)}</div><div class="cb-pane">` +
      (searching ? `<input type="search" class="cb-search" aria-label="${esc(t("chooser.search"))}" placeholder="${esc(t("chooser.search"))}" value="${esc(query)}">` : "") +
      `<div class="cb-list" role="radiogroup" aria-label="${esc(t("chooser.title"))}">${rowsHTML(sources)}</div></div></div>`;
    const depth = menu.querySelector<HTMLElement>(".cb-depth-slot")!;
    depth.innerHTML = depthHTML();
    depth.hidden = depth.innerHTML === "";
    const next = body.querySelector<HTMLElement>(".cb-list");
    if (next) next.scrollTop = top;
    // The slider comes and goes with the model, and the menu keeps standing on the composer.
    placeMenu();
  }

  function open(button: HTMLButtonElement): void {
    const o = look(), sources = chooserSources(o), { model } = chosen();
    source = sources.find(item => model && item.models.some(row => row.id === model.id))?.id ?? sources[0]?.id ?? "";
    query = "";
    menu = openPopover(button, `<div class="menu-head">${esc(t("chooser.title"))}</div><div class="cb-body"></div><div class="cb-depth-slot"></div>` +
      `<div class="menu-sep" role="separator"></div><button type="button" class="menu-action" data-cb-act="sources"><span class="mt">${esc(t("chooser.sources"))}</span></button>`,
      { className: "menu cb-menu", role: "dialog", label: t("chooser.title"), onClose: () => { menu = null; } });
    menu.addEventListener("click", click);
    menu.addEventListener("input", input);
    menu.addEventListener("change", change);
    paintMenu();
    const selected = menu.querySelector<HTMLElement>('.cb-list [aria-checked="true"]');
    selected?.scrollIntoView?.({ block: "nearest" });
    selected?.focus({ preventScroll: true });
  }

  function click(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>("[data-cb-source], [data-model], [data-effort], [data-cb-act]");
    if (!target || (target as HTMLButtonElement).disabled) return;
    if (target.dataset.cbAct === "sources") { closeMenu(); openSources(); return; }
    if (target.dataset.cbSource !== undefined) { source = target.dataset.cbSource; query = ""; paintMenu(); return; }
    if (target.dataset.effort) { saveDepth(target.dataset.effort); return; }
    if (target.dataset.model === undefined) return;
    if (target.dataset.model === look().lead?.id) { save(target.dataset.model); return; }
    const row = pickerModelsFor(look()).find(item => item.id === target.dataset.model);
    if (row) save(modelRefWith(row, row.default_effort ?? ""));
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
    if (catalogResult.status === "fulfilled" && Array.isArray(catalogResult.value?.llm)) catalog = catalogResult.value;
    if (cliResult.status === "fulfilled") clis = cliResult.value?.clis ?? [];
    if (settingsResult.status === "fulfilled") answerModel = settingsResult.value?.settings?.agent_model ?? "";
    draw();
  }
  draw(); void reload();
  return { draw, reload: () => void reload() };
}
