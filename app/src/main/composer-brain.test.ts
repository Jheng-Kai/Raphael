// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  agent_model: "@p:global",
  clis: [] as object[],
}));
const api = vi.hoisted(() => ({
  core: vi.fn(async (method: string) => method === "settings.get" ? { settings: { agent_model: state.agent_model } } : method === "brains.cli" ? { clis: state.clis } : {
    llm: [
      { input_per_mtok: null, output_per_mtok: null, per_minute: null, free: false, variable_price: false, context_length: null, created_at_ms: null, id: "global", provider_id: "p", provider_name: "P", provider: "P", name: "Global", roles: { answer: { usable: true, reason: null } }, reasoning_efforts: ["low", "high"], default_effort: "low", capabilities: {} },
      { input_per_mtok: null, output_per_mtok: null, per_minute: null, free: false, variable_price: false, context_length: null, created_at_ms: null, id: "mine", provider_id: "p", provider_name: "P", provider: "P", name: "Mine", roles: { answer: { usable: true, reason: null } }, capabilities: {} },
    ], stt: [], replaced: [],
  }),
  settingsSet: vi.fn(async (_key: string, value: string) => { state.agent_model = value; return { settings: { agent_model: value } }; }),
  membersUpdate: vi.fn(async () => ({})),
}));
vi.mock("./api", () => api);
import { createCliBrains } from "./cli-brains";
import { mountComposerBrain } from "./composer-brain";
import { closeMenu } from "./ui";
import type { MainEvent, Member } from "./types";

const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
const CODEX = (models: object[]) => ({ id: "codex", name: "Codex", installed: true, logged_in: true, disconnected: false, available: true, login_command: [], models });
const RUNNABLE = { id: "cli:codex:gpt-6.1", name: "GPT-6.1", is_default: true, reasoning_efforts: ["low", "high"], default_effort: "low" };
const q = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

function mount(member: Member = { id: 0, name: "Raphael", model: "" } as Member) {
  const slot = document.createElement("span"); document.body.append(slot);
  const events: ((event: MainEvent) => void)[] = [];
  const brain = mountComposerBrain(slot, () => member, { onEvent: handler => events.push(handler) });
  const emit = (type: MainEvent["type"]): void => { for (const handler of events) handler({ type } as MainEvent); };
  return { slot, brain, emit, member, name: () => slot.querySelector(".mp-tname")!.textContent, open: () => slot.querySelector<HTMLElement>(".mp-trigger")!.click() };
}

/** The card opens on the model; a press on it turns to the sources, and a press on one to its models. */
const browse = (): void => { q(".cb-pick")!.click(); };
const toModels = (source = "p"): void => { browse(); q(`[data-cb-source="${source}"]`)!.click(); };

beforeEach(() => { closeMenu(); document.body.innerHTML = ""; vi.clearAllMocks(); state.agent_model = "@p:global"; state.clis = []; });

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
  const { emit, open } = mount();
  await flush();
  open();
  await flush();
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
  const { open, name } = mount();
  await flush();
  open();
  await flush();
  toModels();
  q('[data-model="@p:mine"]')!.click();
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:mine");
  expect(api.membersUpdate).not.toHaveBeenCalled();
  expect(name()).toBe("Mine");
  expect(q(".cb-pick")!.textContent).toContain("Mine");
});

test("a member's choice is its own and the global setting is untouched; one with none shows the default as what it runs on", async () => {
  const { open, name, member } = mount({ id: 3, name: "Ada", model: "" } as Member);
  await flush();
  open();
  await flush();
  expect(name()).toBe("Global");
  expect(q(".cb-menu")!.textContent).not.toContain("跟隨");
  toModels();
  q('[data-model="@p:mine"]')!.click();
  await flush();
  expect(api.membersUpdate).toHaveBeenLastCalledWith(3, { model: "@p:mine" });
  expect(api.settingsSet).not.toHaveBeenCalled();
  expect(member.model).toBe("@p:mine");
  expect(name()).toBe("Mine");
});

test("a depth is saved with its model, and the button says it", async () => {
  const { open, slot } = mount();
  await flush();
  open();
  await flush();
  const range = q<HTMLInputElement>(".mc-range")!;
  range.value = "1";
  range.dispatchEvent(new Event("input", { bubbles: true }));
  expect(api.settingsSet).not.toHaveBeenCalled();
  range.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:global?effort=high");
  expect(slot.querySelector(".cb-depth")!.textContent).toBe("高");
  expect(q('[data-effort="high"]')!.getAttribute("data-on")).toBe("true");
});

test("one view at a time: the model and its depth, then the sources, then a source's models, each with a way back and a title", async () => {
  state.clis = [CODEX([RUNNABLE]), { ...CODEX([]), id: "gemini", name: "Gemini", available: false, installed: false }];
  const { open } = mount();
  await flush();
  open();
  await flush();
  const showing = (): string => (q<HTMLElement>(".cb-now")!.hidden ? "" : "now") + (q<HTMLElement>(".cb-body")!.hidden ? "" : "list");
  expect(showing()).toBe("now");
  expect(q(".cb-source")).toBeNull();
  expect(q(".cb-now .mc-range")).not.toBeNull();
  browse();
  expect(showing()).toBe("list");
  expect(q(".cb-head h3")!.textContent).toBe("選擇模型");
  expect(q('[data-cb-source="cli:codex"]')).not.toBeNull();
  expect(q('[data-cb-source="cli:gemini"]')).toBeNull();
  expect(q('[data-cb-act="sources"]')).toBeNull();
  q('[data-cb-source="cli:codex"]')!.click();
  expect(showing()).toBe("list");
  expect(q(".cb-head h3")!.textContent).toBe("Codex");
  q(".cb-back")!.click();
  expect(q(".cb-head h3")!.textContent).toBe("選擇模型");
  q(".cb-back")!.click();
  expect(showing()).toBe("now");
});

test("choosing a model turns back to it, with its depth right there, and the menu stays", async () => {
  const { open } = mount();
  await flush();
  open();
  await flush();
  expect(q(".cb-now")!.textContent).toContain("Global");
  expect(q("[data-model]")).toBeNull();
  toModels();
  expect(q(".cb-source")).toBeNull();
  expect(q('[data-model="@p:global"]')!.getAttribute("aria-checked")).toBe("true");
  q('[data-model="@p:global"]')!.click();
  await flush();
  expect(q<HTMLElement>(".cb-now")!.hidden).toBe(false);
  expect(q<HTMLElement>(".cb-body")!.hidden).toBe(true);
  expect(q(".cb-now .mc-range")).not.toBeNull();
});

test("a list that arrives while the owner drags the depth leaves the slider where it is", async () => {
  const { open, emit } = mount();
  await flush();
  open();
  await flush();
  const range = q<HTMLInputElement>(".mc-range")!;
  emit("BrainsChanged");
  await flush();
  expect(q(".mc-range")).toBe(range);
});

test("a model without depths has no slider", async () => {
  state.agent_model = "@p:mine";
  const { open } = mount();
  await flush();
  open();
  await flush();
  expect(q(".mc-range")).toBeNull();
  expect(q<HTMLElement>(".cb-depth-slot")!.hidden).toBe(true);
});

test("a save the core refuses leaves what the core holds, and says so", async () => {
  api.settingsSet.mockRejectedValueOnce(new Error("refused"));
  const { open, name } = mount();
  await flush();
  open();
  await flush();
  toModels();
  q('[data-model="@p:mine"]')!.click();
  await flush();
  expect(name()).toBe("Global");
  expect(q('[data-model="@p:global"]')!.getAttribute("aria-checked")).toBe("true");
  expect(document.body.textContent).toContain("refused");
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
