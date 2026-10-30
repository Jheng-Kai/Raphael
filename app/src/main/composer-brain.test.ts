// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({
  core: vi.fn(async (method: string) => method === "settings.get" ? { settings: { agent_model: "@p:global" } } : method === "brains.cli" ? { clis: [] } : { llm: [{ id: "@p:global", name: "Global" }, { id: "@p:mine", name: "Mine" }] }),
  settingsSet: vi.fn(async () => ({ settings: { agent_model: "@p:mine" } })),
  membersUpdate: vi.fn(async () => ({})),
}));
vi.mock("./api", () => api);
import { mountComposerBrain } from "./composer-brain";
import type { Member } from "./types";

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

test("the picker sits in its slot and follows the open conversation's member", async () => {
  const slot = document.createElement("span"); document.body.append(slot);
  let member = { id: 0, name: "Raphael", model: "" } as Member;
  const brain = mountComposerBrain(slot, () => member);
  await flush();
  expect(slot.querySelectorAll(".mp-trigger")).toHaveLength(1);
  expect(slot.querySelector('.mp-trigger')!.textContent).toContain("Global");
  member = { id: 3, name: "Ada", model: "@p:mine" } as Member;
  brain.draw();
  expect(slot.querySelectorAll(".mp-trigger")).toHaveLength(1);
  expect(slot.querySelector('.mp-trigger')!.textContent).toContain("Mine");
});
