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
  q('[data-cb-source="cli:codex"]')!.click();
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
    q('[data-cb-source="cli:codex"]')!.click();
    await vi.advanceTimersByTimeAsync(13_000);
    expect(q(".cb-pane")!.textContent).toContain("讀不到模型");
    state.clis = [CODEX([RUNNABLE])];
    q('[data-cb-act="retry"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(q('[data-model="cli:codex:gpt-6.1"]')).not.toBeNull();
  } finally { vi.useRealTimers(); }
});

test("Raphael's choice is the global setting, and the menu says it reaches other members", async () => {
  const { open, name } = mount();
  await flush();
  open();
  await flush();
  expect(q(".cb-menu .menu-head")!.textContent).toContain("預設");
  q('[data-model="@p:mine"]')!.click();
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:mine");
  expect(api.membersUpdate).not.toHaveBeenCalled();
  expect(name()).toBe("Mine");
  expect(q('[data-model="@p:mine"]')!.getAttribute("aria-checked")).toBe("true");
});

test("a member's choice is its own, the global setting is untouched, and following the default is a choice too", async () => {
  const { open, name, member } = mount({ id: 3, name: "Ada", model: "@p:mine" } as Member);
  await flush();
  open();
  await flush();
  expect(q(".cb-menu .menu-head")!.textContent).toContain("Ada");
  q('[data-model="@p:global"]')!.click();
  await flush();
  expect(api.membersUpdate).toHaveBeenLastCalledWith(3, { model: "@p:global?effort=low" });
  expect(api.settingsSet).not.toHaveBeenCalled();
  expect(member.model).toBe("@p:global?effort=low");
  q('.cb-lead')!.click();
  await flush();
  expect(api.membersUpdate).toHaveBeenLastCalledWith(3, { model: "" });
  expect(name()).toBe("Global");
});

test("a depth is saved with its model, and the button says it", async () => {
  const { open, slot } = mount();
  await flush();
  open();
  await flush();
  q('[data-effort="high"]')!.click();
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("agent_model", "@p:global?effort=high");
  expect(slot.querySelector(".cb-depth")!.textContent).toBe("高");
  expect(q('[data-effort="high"]')!.getAttribute("aria-pressed")).toBe("true");
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
  q('[data-model="@p:mine"]')?.click();
  await flush();
  finish({ settings: { agent_model: "@p:global" } } as never);
  await flush();
  expect(name()).toBe("Mine");
});
