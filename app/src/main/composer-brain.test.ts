import { t } from "./i18n";
// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  agent_model: "@p:global",
  quick_model: "",
  quick_effort: "low",
  clis: [] as object[],
  favorites: [] as string[],
  extra: [] as object[],
  model: (id: string, name: string, over: object = {}): object => ({
    input_per_mtok: null, output_per_mtok: null, per_minute: null, free: false, variable_price: false, context_length: null, created_at_ms: null,
    id, provider_id: "p", provider_name: "P", provider: "P", name, roles: { answer: { usable: true, reason: null } }, capabilities: {}, ...over,
  }),
}));
const api = vi.hoisted(() => ({
  core: vi.fn(async (method: string) => method === "settings.get" ? { settings: { agent_model: state.agent_model, quick_model: state.quick_model, quick_effort: state.quick_effort, model_favorites: { answer: state.favorites } } } : method === "brains.cli" ? { clis: state.clis } : {
    llm: [
      state.model("global", "Global", { reasoning_efforts: ["low", "high"], default_effort: "low" }),
      state.model("mine", "Mine"),
      state.model("wide", "Wide", { reasoning_efforts: ["low", "medium", "high", "xhigh", "max"], default_effort: "medium" }),
      ...state.extra,
    ], stt: [], replaced: [],
  }),
  settingsSet: vi.fn(async (key: string, value: string) => {
    Object.assign(state, { [key]: value });
    return { settings: { agent_model: state.agent_model, quick_model: state.quick_model, quick_effort: state.quick_effort } };
  }),
  membersUpdate: vi.fn(async () => ({})),
}));
vi.mock("./api", () => api);
import { createCliBrains } from "./cli-brains";
import { mountComposerBrain, type ComposerBrainHost } from "./composer-brain";
import { closeMenu } from "./ui";
import type { MainEvent, Member } from "./types";

const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
const CODEX = (models: object[]) => ({ id: "codex", name: "Codex", installed: true, logged_in: true, disconnected: false, available: true, login_command: [], models });
const RUNNABLE = { id: "cli:codex:gpt-6.1", name: "GPT-6.1", is_default: true, reasoning_efforts: ["low", "high"], default_effort: "low" };
const CHATGPT = () => state.model("gpt", "GPT", { provider_id: "chatgpt", provider_name: "ChatGPT", provider: "OpenAI" });
const QUICK: ComposerBrainHost = { quick: () => true };
const q = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

function mount(member: Member = { id: 0, name: "Raphael", model: "" } as Member, host: ComposerBrainHost = {}) {
  const slot = document.createElement("span"); document.body.append(slot);
  const events: ((event: MainEvent) => void)[] = [];
  const brain = mountComposerBrain(slot, () => member, { onEvent: handler => events.push(handler), ...host });
  const emit = (type: MainEvent["type"]): void => { for (const handler of events) handler({ type } as MainEvent); };
  return { slot, brain, emit, member, name: () => slot.querySelector(".mp-tname")!.textContent, open: () => slot.querySelector<HTMLElement>(".mp-trigger")!.click() };
}

/** The card opens on the model; a press on it opens the sources beside their models, and a press on a source lists its models. */
const browse = (): void => { q(".cb-pick")!.click(); };
const toModels = (source = "p"): void => { browse(); q(`[data-cb-source="${source}"]`)!.click(); };
const listed = (): string[] => [...document.querySelectorAll<HTMLElement>(".cb-list [data-model]")].map(row => row.dataset.model!);
const choose = (model: string): void => { q(`[data-model="${model}"]`)!.click(); };
/** `Global`, `Mine` and `Wide` and newer ones after them, to make a source of `count` models. */
const crowd = (count: number): void => { state.extra = Array.from({ length: count - 3 }, (_, i) => state.model(`n${i}`, `Newer ${i}`, { created_at_ms: 1_000 + i })); };

const slide = (index: number): void => { const range = q<HTMLInputElement>(".mc-range")!; range.value = String(index); range.dispatchEvent(new Event("input", { bubbles: true })); };
const release = (): void => { q(".mc-range")!.dispatchEvent(new Event("change", { bubbles: true })); };
const slideTo = (level: string): void => { slide(q<HTMLInputElement>(".mc-range")!.dataset.levels!.split(",").indexOf(level)); release(); };
const rested = (): string | undefined => q<HTMLInputElement>(".mc-range")!.dataset.levels!.split(",")[Number(q<HTMLInputElement>(".mc-range")!.value)];

async function opened(member?: Member, host?: ComposerBrainHost) {
  const view = mount(member, host);
  await flush();
  view.open();
  await flush();
  return view;
}

beforeEach(() => {
  closeMenu(); document.body.innerHTML = ""; vi.clearAllMocks();
  state.agent_model = "@p:global"; state.quick_model = ""; state.quick_effort = "low"; state.clis = []; state.favorites = []; state.extra = [];
});

test.each([
  ["a provider's model", "@p:global", "P", "Global"],
  ["a CLI's model", "cli:codex:gpt-6.1", "Codex", "GPT-6.1"],
  ["a ChatGPT model", "@chatgpt:gpt", "ChatGPT", "GPT"],
])("the small card of %s names the source over the model", async (_kind, ref, source, model) => {
  state.clis = [CODEX([RUNNABLE])];
  state.extra = [CHATGPT()];
  state.agent_model = ref;
  await opened();
  expect(q(".cb-pick small")!.textContent).toBe(source);
  expect(q(".cb-pick b")!.textContent).toBe(model);
});

test("a ChatGPT model's card has no plan line and no usage button", async () => {
  state.extra = [CHATGPT()];
  state.agent_model = "@chatgpt:gpt";
  await opened();
  expect(q(".cb-pick small")!.textContent).toBe("ChatGPT");
  expect(q(".cb-pick b")!.textContent).toBe("GPT");
  expect(q(".cb-now")!.querySelectorAll("button")).toHaveLength(1);
  expect(q(".cb-menu")!.textContent).not.toContain("使用 ChatGPT 方案");
  expect(q(".cb-menu")!.textContent).not.toContain("管理用量");
});

test("what the owner starred is the rail's first row, lists those models across sources, and choosing one works", async () => {
  state.favorites = ["@p:mine", "@gone:model", "cli:codex:gpt-6.1"];
  state.clis = [CODEX([RUNNABLE])];
  await opened();
  browse();
  const first = q(".cb-rail .cb-source")!;
  expect(first.dataset.cbSource).toBe("favorites");
  expect(first.textContent).toContain("我的最愛");
  first.click();
  expect(q('[data-cb-source="favorites"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(listed()).toEqual(["@p:mine", "cli:codex:gpt-6.1"]);
  expect([...document.querySelectorAll(".cb-list small")].map(small => small.textContent)).toEqual(["P", "Codex"]);
  choose("@p:mine");
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:mine");
  expect(q<HTMLElement>(".cb-now")!.hidden).toBe(false);
});

test("in a source's own list the starred models come first, then the chosen one, then the rest, with no headings", async () => {
  state.favorites = ["@p:wide"];
  await opened();
  toModels();
  expect(listed()).toEqual(["@p:wide", "@p:global", "@p:mine"]);
  expect([...q(".cb-list")!.children].every(row => row.matches("[data-model]"))).toBe(true);
  expect(q(".cb-pane")!.textContent).not.toContain("我的最愛");
  expect(q(".cb-pane")!.textContent).not.toContain("所有模型");
});

test("nothing starred, no favourites row", async () => {
  await opened();
  browse();
  expect(q('[data-cb-source="favorites"]')).toBeNull();
  expect(q(".cb-menu")!.textContent).not.toContain("我的最愛");
});

test("the fill follows the thumb to every stop of the ruler", async () => {
  state.agent_model = "@p:wide";
  await opened();
  const track = q<HTMLElement>(".cb-now .mc-track")!;
  expect(track.getAttribute("style")).toContain("--p:0.25");
  for (const [index, fill] of [[0, "0"], [2, "0.5"], [3, "0.75"], [4, "1"]] as const) {
    slide(index);
    expect(track.style.getPropertyValue("--p")).toBe(fill);
  }
});

test("every model lays its depths on one ruler of five stops, dim where it has none", async () => {
  const { emit } = await opened();
  const ruler = () => ({ stops: q(".mc-stops")!.children.length, dots: q(".mc-dots")!.children.length, max: q(".mc-range")!.getAttribute("max") });
  const short = ruler();
  expect(q<HTMLInputElement>(".mc-range")!.dataset.levels).toBe("low,,high,,");
  expect(document.querySelectorAll('.mc-stops [data-effort=""]')).toHaveLength(3);
  state.agent_model = "@p:wide";
  emit("SettingsChanged");
  await flush();
  expect(q<HTMLInputElement>(".mc-range")!.dataset.levels).toBe("low,medium,high,xhigh,max");
  expect(document.querySelectorAll('.mc-stops [data-effort=""]')).toHaveLength(0);
  expect(ruler()).toEqual(short);
  expect(short).toEqual({ stops: 5, dots: 5, max: "4" });
});

test("the thumb never rests on a stop the model lacks, and the depth saved is where it rests", async () => {
  await opened();
  slide(1);
  expect(rested()).toBe("high");
  expect(q<HTMLElement>(".cb-now .mc-track")!.style.getPropertyValue("--p")).toBe("0.5");
  expect(q('[data-effort="high"]')!.getAttribute("data-on")).toBe("true");
  expect(q('[data-effort="low"]')!.getAttribute("data-on")).toBe("false");
  expect([...document.querySelectorAll('[data-effort=""]')].map(stop => stop.getAttribute("data-on"))).toEqual(["false", "false", "false"]);
  expect(api.settingsSet).not.toHaveBeenCalled();
  release();
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:global?effort=high");
  slide(1);
  expect(rested()).toBe("low");
  release();
  await flush();
  expect(api.settingsSet).toHaveBeenLastCalledWith("agent_model", "@p:global?effort=low");
  slide(4);
  expect(rested()).toBe("high");
  expect(q<HTMLInputElement>(".mc-range")!.getAttribute("aria-valuetext")).toBe("高");
});

test("a model without depths shows the same ruler, still, and says it has none", async () => {
  state.agent_model = "@p:mine";
  await opened();
  const range = q<HTMLInputElement>(".mc-range")!;
  expect(range.disabled).toBe(true);
  expect(range.getAttribute("max")).toBe("4");
  expect(q(".cb-now")!.textContent).toContain("這個模型不分思考程度");
});

test("a model that is not read yet shows the ruler and does not say it has no depths", async () => {
  state.agent_model = "@p:unread";
  await opened();
  expect(q<HTMLInputElement>(".mc-range")!.disabled).toBe(true);
  expect(q(".cb-now .mc-range")).not.toBeNull();
  expect(q(".cb-now")!.textContent).not.toContain("這個模型不分思考程度");
});

test("the picker sits in its slot and follows the open conversation's member", async () => {
  const slot = document.createElement("span"); document.body.append(slot);
  let member = { id: 0, name: "Raphael", model: "" } as Member;
  const brain = mountComposerBrain(slot, () => member);
  await flush();
  expect(slot.querySelectorAll(".mp-trigger")).toHaveLength(1);
  expect(slot.querySelector(".mp-trigger")!.textContent).toContain("Global");
  member = { id: 3, name: "Ada", model: "@p:mine" } as Member;
  brain.draw();
  expect(slot.querySelectorAll(".mp-trigger")).toHaveLength(1);
  expect(slot.querySelector(".mp-trigger")!.textContent).toContain("Mine");
});

test("Settings know what the composer was told before their own first read, so they never show a bare model id", async () => {
  state.clis = [CODEX([RUNNABLE])];
  mount();
  await flush();
  const settings = createCliBrains({ visible: () => false, redraw: () => {} });
  expect(settings.view().clis).toEqual(state.clis);
});

test("a choice made in Settings reaches the button without a reopen", async () => {
  const { emit, name } = mount();
  await flush();
  expect(name()).toBe("Global");
  state.agent_model = "@p:mine";
  emit("SettingsChanged");
  await flush();
  expect(name()).toBe("Mine");
});

test("a CLI's models that arrive after the first read reach a menu already open, which never calls them absent", async () => {
  state.clis = [CODEX([])];
  const { emit } = await opened();
  toModels("cli:codex");
  expect(q(".cb-pane")!.textContent).toContain("正在讀取模型");
  expect(q(".cb-pane")!.textContent).not.toContain("尚無可用模型");
  state.clis = [CODEX([RUNNABLE])];
  emit("BrainsChanged");
  await flush();
  expect(q('[data-model="cli:codex:gpt-6.1"]')).not.toBeNull();
});

test("a CLI that stays silent is said to be so, with a way to try again", async () => {
  vi.useFakeTimers();
  try {
    state.clis = [CODEX([])];
    const { open } = mount();
    await vi.advanceTimersByTimeAsync(0);
    open();
    await vi.advanceTimersByTimeAsync(0);
    toModels("cli:codex");
    await vi.advanceTimersByTimeAsync(41_000);
    expect(q(".cb-pane")!.textContent).toContain("讀不到模型");
    state.clis = [CODEX([RUNNABLE])];
    q('[data-cb-act="retry"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(q('[data-model="cli:codex:gpt-6.1"]')).not.toBeNull();
  } finally { vi.useRealTimers(); }
});

test("Raphael's choice is the global setting", async () => {
  const { name } = await opened();
  toModels();
  choose("@p:mine");
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:mine");
  expect(api.membersUpdate).not.toHaveBeenCalled();
  expect(name()).toBe("Mine");
  expect(q(".cb-pick b")!.textContent).toBe("Mine");
});

test("a member's choice is its own: Raphael's model and Settings stay as they were", async () => {
  const { name, member } = await opened({ id: 3, name: "Ada", model: "@p:wide" } as Member);
  expect(name()).toBe("Wide");
  toModels();
  choose("@p:mine");
  await flush();
  expect(api.membersUpdate).toHaveBeenCalledExactlyOnceWith(3, { model: "@p:mine" });
  expect(api.settingsSet).not.toHaveBeenCalled();
  expect(member.model).toBe("@p:mine");
  expect(name()).toBe("Mine");
});

test("a member with no model yet shows what it answers on, and choosing gives it one", async () => {
  const { name, member } = await opened({ id: 3, name: "Ada", model: "" } as Member);
  expect(name()).toBe("Global");
  expect(q(".cb-menu")!.textContent).not.toContain("跟隨");
  toModels();
  choose("@p:mine");
  await flush();
  expect(api.membersUpdate).toHaveBeenCalledExactlyOnceWith(3, { model: "@p:mine" });
  expect(api.settingsSet).not.toHaveBeenCalled();
  expect(member.model).toBe("@p:mine");
  expect(name()).toBe("Mine");
});

test("a quick conversation shows the quick model at the quick depth", async () => {
  state.quick_model = "@p:wide";
  state.quick_effort = "high";
  const { name, slot } = await opened(undefined, QUICK);
  expect(name()).toBe("Wide");
  expect(slot.querySelector(".cb-depth")!.textContent).toBe("高");
  expect(q(".cb-pick b")!.textContent).toBe("Wide");
  expect(q('[data-effort="high"]')!.getAttribute("data-on")).toBe("true");
});

test("a quick conversation with no quick model of its own shows the answer model at the quick depth", async () => {
  state.quick_effort = "high";
  const { name, slot } = await opened(undefined, QUICK);
  expect(name()).toBe("Global");
  expect(slot.querySelector(".cb-depth")!.textContent).toBe("高");
  expect(q('[data-effort="high"]')!.getAttribute("data-on")).toBe("true");
});

test("choosing in a quick conversation writes the quick model and its depth, and leaves the answer model alone", async () => {
  state.quick_effort = "high";
  const { name } = await opened(undefined, QUICK);
  toModels();
  choose("@p:wide");
  await flush();
  expect(api.settingsSet.mock.calls).toEqual([["quick_model", "@p:wide"], ["quick_effort", "high"]]);
  expect(name()).toBe("Wide");
  api.settingsSet.mockClear();
  toModels();
  choose("@p:mine");
  await flush();
  expect(api.settingsSet.mock.calls).toEqual([["quick_model", "@p:mine"]]);
  expect(name()).toBe("Mine");
  expect(state.agent_model).toBe("@p:global");
});

test("a depth chosen in a quick conversation is written the way a model is", async () => {
  state.quick_model = "@p:wide";
  const { slot } = await opened(undefined, QUICK);
  slideTo("xhigh");
  await flush();
  expect(api.settingsSet.mock.calls).toEqual([["quick_model", "@p:wide"], ["quick_effort", "xhigh"]]);
  expect(slot.querySelector(".cb-depth")!.textContent).toBe("極高");
});

test("a depth chosen in a member's conversation is written the way a model is", async () => {
  const { member, slot } = await opened({ id: 3, name: "Ada", model: "@p:wide" } as Member);
  slideTo("xhigh");
  await flush();
  expect(api.membersUpdate).toHaveBeenCalledExactlyOnceWith(3, { model: "@p:wide?effort=xhigh" });
  expect(api.settingsSet).not.toHaveBeenCalled();
  expect(member.model).toBe("@p:wide?effort=xhigh");
  expect(slot.querySelector(".cb-depth")!.textContent).toBe("極高");
});

test("a depth is saved with its model, and the button says it", async () => {
  const { slot } = await opened();
  slide(2);
  expect(api.settingsSet).not.toHaveBeenCalled();
  release();
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:global?effort=high");
  expect(slot.querySelector(".cb-depth")!.textContent).toBe("高");
  expect(q('[data-effort="high"]')!.getAttribute("data-on")).toBe("true");
});

test("choosing a model keeps the depth when the new model offers it", async () => {
  state.agent_model = "@p:global?effort=high";
  await opened();
  toModels();
  choose("@p:wide");
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:wide?effort=high");
  expect(q('[data-effort="high"]')!.getAttribute("data-on")).toBe("true");
});

test("choosing a model that lacks the depth takes the model's own default", async () => {
  state.agent_model = "@p:wide?effort=max";
  await opened();
  toModels();
  choose("@p:global");
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:global?effort=low");
  expect(q('[data-effort="low"]')!.getAttribute("data-on")).toBe("true");
});

test("one view at a time: the model and its depth, then the sources beside their models, with a title and a way back", async () => {
  state.clis = [CODEX([RUNNABLE]), { ...CODEX([]), id: "gemini", name: "Gemini", available: false, installed: false }];
  await opened();
  const showing = (): string => (q<HTMLElement>(".cb-now")!.hidden ? "" : "now") + (q<HTMLElement>(".cb-body")!.hidden ? "" : "list");
  const pressed = (): (string | undefined)[] => [...document.querySelectorAll<HTMLElement>(".cb-source")].filter(row => row.getAttribute("aria-pressed") === "true").map(row => row.dataset.cbSource);
  expect(showing()).toBe("now");
  expect(q(".cb-source")).toBeNull();
  expect(q(".cb-now .mc-range")).not.toBeNull();
  browse();
  expect(showing()).toBe("list");
  expect(q(".cb-head h3")!.textContent).toBe("選擇模型");
  expect(q(".cb-head .cb-back")).not.toBeNull();
  expect([...document.querySelectorAll<HTMLElement>(".cb-rail .cb-source")].map(row => row.dataset.cbSource)).toEqual(["cli:codex", "p"]);
  expect(pressed()).toEqual(["p"]);
  expect(listed()).toEqual(["@p:global", "@p:mine", "@p:wide"]);
  q('[data-cb-source="cli:codex"]')!.click();
  expect(showing()).toBe("list");
  expect(q(".cb-head h3")!.textContent).toBe("選擇模型");
  expect(pressed()).toEqual(["cli:codex"]);
  expect(listed()).toEqual(["cli:codex:gpt-6.1"]);
  q(".cb-back")!.click();
  expect(showing()).toBe("now");
});

test("the list opens on the source holding the chosen model", async () => {
  state.clis = [CODEX([RUNNABLE])];
  state.agent_model = "cli:codex:gpt-6.1";
  await opened();
  browse();
  expect(q('[data-cb-source="cli:codex"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(q('[data-cb-source="p"]')!.getAttribute("aria-pressed")).toBe("false");
  expect(q('[data-model="cli:codex:gpt-6.1"]')!.getAttribute("aria-checked")).toBe("true");
});

test("choosing a model turns back to it, with its depth right there, and the menu stays", async () => {
  await opened();
  expect(q(".cb-now")!.textContent).toContain("Global");
  expect(q("[data-model]")).toBeNull();
  toModels();
  expect(q('[data-model="@p:global"]')!.getAttribute("aria-checked")).toBe("true");
  choose("@p:global");
  await flush();
  expect(q(".cb-menu")).not.toBeNull();
  expect(q<HTMLElement>(".cb-now")!.hidden).toBe(false);
  expect(q<HTMLElement>(".cb-body")!.hidden).toBe(true);
  expect(q(".cb-now .mc-range")).not.toBeNull();
});

test("a source of more than six models shows five rows and a button for the rest, which folds them again", async () => {
  crowd(8);
  await opened();
  toModels();
  expect(listed()).toEqual(["@p:global", "@p:n4", "@p:n3", "@p:n2", "@p:n1"]);
  const all = q('.cb-all[data-cb-act="all"]')!;
  expect(all.textContent).toContain("顯示全部 8 個");
  expect(all.getAttribute("aria-expanded")).toBe("false");
  all.click();
  expect(listed()).toHaveLength(8);
  expect(q(".cb-all")!.textContent).toContain("收合");
  expect(q(".cb-all")!.getAttribute("aria-expanded")).toBe("true");
  q(".cb-all")!.click();
  expect(listed()).toHaveLength(5);
  expect(q(".cb-all")!.getAttribute("aria-expanded")).toBe("false");
});

test.each([3, 6])("a source of %i models never folds", async count => {
  crowd(count);
  await opened();
  toModels();
  expect(listed()).toHaveLength(count);
  expect(q(".cb-all")).toBeNull();
});

test.each<[number, boolean]>([[12, false], [13, true]])("a source of %i models has a search box once unfolded: %s", async (count, found) => {
  crowd(count);
  await opened();
  toModels();
  expect(q(".cb-search")).toBeNull();
  q(".cb-all")!.click();
  expect(q(".cb-search") !== null).toBe(found);
});

test("a search looks through all the models of the source", async () => {
  crowd(13);
  await opened();
  toModels();
  q(".cb-all")!.click();
  const search = q<HTMLInputElement>(".cb-search")!;
  search.value = "newer 0";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(listed()).toEqual(["@p:n0"]);
});

test("the chosen model and the starred ones are among the rows shown even when they would sort later", async () => {
  crowd(10);
  state.favorites = ["@p:mine", "@p:wide"];
  await opened();
  toModels();
  expect(listed()).toEqual(["@p:mine", "@p:wide", "@p:global", "@p:n6", "@p:n5"]);
});

test("every starred model stays in view even when there are more than five", async () => {
  crowd(10);
  state.favorites = ["@p:n0", "@p:n1", "@p:n2", "@p:n3", "@p:n4", "@p:n5"];
  await opened();
  toModels();
  expect(listed()).toEqual(["@p:n0", "@p:n1", "@p:n2", "@p:n3", "@p:n4", "@p:n5", "@p:global"]);
  expect(q(".cb-all")).not.toBeNull();
});

test("pressing another source resets the fold and the search", async () => {
  crowd(13);
  state.clis = [CODEX([RUNNABLE])];
  await opened();
  toModels();
  q(".cb-all")!.click();
  const search = q<HTMLInputElement>(".cb-search")!;
  search.value = "newer 0";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  q('[data-cb-source="cli:codex"]')!.click();
  expect(listed()).toEqual(["cli:codex:gpt-6.1"]);
  expect(q(".cb-search")).toBeNull();
  q('[data-cb-source="p"]')!.click();
  expect(listed()).toHaveLength(5);
  expect(q(".cb-all")!.getAttribute("aria-expanded")).toBe("false");
  q(".cb-all")!.click();
  expect(q<HTMLInputElement>(".cb-search")!.value).toBe("");
  expect(listed()).toHaveLength(13);
});

test("a list that arrives while the owner drags the depth leaves the slider where it is", async () => {
  const { emit } = await opened();
  const range = q<HTMLInputElement>(".mc-range")!;
  emit("BrainsChanged");
  await flush();
  expect(q(".mc-range")).toBe(range);
});

test("a save the core refuses leaves what the core holds, and says so", async () => {
  api.settingsSet.mockRejectedValueOnce(new Error("refused"));
  const { name } = await opened();
  toModels();
  choose("@p:mine");
  await flush();
  expect(name()).toBe("Global");
  expect(q('[data-model="@p:global"]')!.getAttribute("aria-checked")).toBe("true");
  expect(document.body.textContent).toContain(t("missing.unknown"));
});

test("a read that began before a choice cannot put the old choice back", async () => {
  const { open, name } = mount();
  await flush();
  let finish: (value: never) => void = () => {};
  api.core.mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: never) => void; }));
  open();
  await flush();
  toModels();
  q('[data-model="@p:mine"]')?.click();
  await flush();
  finish({ settings: { agent_model: "@p:global" } } as never);
  await flush();
  expect(name()).toBe("Mine");
});

test("the menu survives another window taking the focus for a moment, and closes when the owner has really left", async () => {
  vi.useFakeTimers();
  try {
    const { open } = mount();
    await vi.advanceTimersByTimeAsync(0);
    open();
    await vi.advanceTimersByTimeAsync(0);
    const focused = vi.spyOn(document, "hasFocus");
    focused.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(400);
    focused.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(q(".cb-menu")).not.toBeNull();
    focused.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(800);
    expect(q(".cb-menu")).toBeNull();
    focused.mockRestore();
  } finally { vi.useRealTimers(); }
});
