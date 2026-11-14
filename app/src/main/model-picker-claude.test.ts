// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { mountModelPicker, modelPickerHTML, pickerModelsFor, refsOf, type ModelPicker } from "./model-picker";
import type { CliBrain, CliModel } from "./types";
import { t } from "./i18n";

// The shape of Claude Code's list as the core sends it (agent/cli/models.py): the exact models, each with its version,
// the alias the CLI also takes for the newest of a family, and the older models its own program still runs.
const depths = ["low", "medium", "high", "xhigh", "max"];
const claudeModels: CliModel[] = [
  { id: "cli:claude:claude-opus-5-5", name: "Claude Opus 5.5", aliases: ["opus"], is_default: true, reasoning_efforts: depths, default_effort: "high", description: "Best for everyday, complex tasks" },
  { id: "cli:claude:claude-fable-5-2", name: "Claude Fable 5.2", aliases: ["fable"], reasoning_efforts: depths, default_effort: "high" },
  { id: "cli:claude:claude-sonnet-5-5", name: "Claude Sonnet 5.5", aliases: ["sonnet"], reasoning_efforts: depths, default_effort: "high" },
  { id: "cli:claude:claude-haiku-5-5", name: "Claude Haiku 5.5", aliases: ["haiku"], reasoning_efforts: depths, default_effort: "high" },
  { id: "cli:claude:claude-opus-4-5-20251101", name: "Claude Opus 4.5", aliases: [], reasoning_efforts: [], default_effort: null },
  { id: "cli:claude:claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", aliases: [], description: "Retires November 30, 2026", reasoning_efforts: [], default_effort: null },
];
const clis: CliBrain[] = [
  { id: "claude", name: "Claude Code", disconnected: false, installed: true, logged_in: true, available: true, login_command: "claude auth login", models: claudeModels },
  { id: "codex", name: "Codex", disconnected: false, installed: true, logged_in: true, available: true, login_command: "codex login", models: [{ id: "cli:codex:luna", name: "GPT Luna", is_default: true }] },
];
let picker: ModelPicker;
afterEach(() => { picker?.close(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
function mount(current: string, extra: Record<string, unknown> = {}) {
  const slot = document.createElement("div"); document.body.append(slot);
  const choose = vi.fn(), favorite = vi.fn();
  picker = mountModelPicker(slot, { role: "answer", catalog: null, clis, current, label: "Answer", onChoose: choose, onFavorite: favorite, ...extra });
  picker.button.focus(); picker.open(); return { choose, favorite };
}
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
const names = () => [...document.querySelectorAll(".mc-row strong")].map(row => row.textContent);

test("the Claude Code tab names every model with its version, in the order the core gave", () => {
  mount("cli:claude");
  expect(names()).toEqual(claudeModels.map(model => model.name));
  expect(names().every(name => /\d/.test(name ?? ""))).toBe(true);
  expect([...document.querySelectorAll(".mc-row")].map(row => row.getAttribute("data-model"))).toEqual(claudeModels.map(model => model.id));
});

test("a member saved with the alias is on the model the alias is, shown and checked, and keeps its alias", () => {
  const html = modelPickerHTML({ role: "answer", current: "cli:claude:opus?effort=low", catalog: null, clis, label: "Answer" });
  expect(html).toContain("Claude Opus 5.5");
  const { choose } = mount("cli:claude:haiku");
  expect(document.querySelector('.mc-row[aria-checked="true"]')?.getAttribute("data-model")).toBe("cli:claude:claude-haiku-5-5");
  expect(document.querySelector(".mc-selection")?.textContent).toContain("Claude Haiku 5.5");
  // Pressing 使用 on the model it already is changes nothing: the member is not moved to another id.
  click('[data-dlg="use"]');
  expect(choose).not.toHaveBeenCalled();
});

test("a new depth for a member on the alias is saved on the alias", () => {
  const { choose } = mount("cli:claude:haiku");
  const range = document.querySelector<HTMLInputElement>(".mc-range")!;
  range.value = String(range.dataset.levels!.split(",").indexOf("low"));
  range.dispatchEvent(new Event("input", { bubbles: true }));
  click('[data-dlg="use"]');
  expect(choose).toHaveBeenCalledWith("cli:claude:haiku?effort=low");
});

test("choosing a row saves the exact id of that row, an older model too", () => {
  const { choose } = mount("cli:claude:sonnet");
  click('[data-model="cli:claude:claude-fable-5-2"]');
  click('[data-dlg="use"]');
  expect(choose).toHaveBeenCalledWith("cli:claude:claude-fable-5-2?effort=high");
  picker.close(); document.body.innerHTML = "";
  const again = mount("cli:claude:sonnet");
  click('[data-model="cli:claude:claude-opus-4-5-20251101"]');
  click('[data-dlg="use"]');
  expect(again.choose).toHaveBeenCalledWith("cli:claude:claude-opus-4-5-20251101");
});

test("the alias of a family is described in the words of the window; an older model says what it is", () => {
  mount("cli:claude");
  const subs = Object.fromEntries([...document.querySelectorAll(".mc-row")].map(row => [row.getAttribute("data-model"), row.querySelector(".mc-description")?.textContent]));
  expect(subs["cli:claude:claude-opus-5-5"]).toBe(t("chooser.opus"));
  expect(subs["cli:claude:claude-haiku-5-5"]).toBe(t("chooser.haiku"));
  expect(subs["cli:claude:claude-sonnet-4-5-20250929"]).toContain("Anthropic");
});

test("a star saved under the alias is that model's star: shown, and taken away by pressing it", () => {
  const { favorite } = mount("cli:claude", { favorites: ["cli:claude:opus"] });
  expect(document.querySelector('.mp-star[data-star="cli:claude:claude-opus-5-5"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('.mp-star[data-star="cli:claude:claude-fable-5-2"]')?.getAttribute("aria-pressed")).toBe("false");
  click('.mp-star[data-star="cli:claude:claude-opus-5-5"]');
  expect(favorite).toHaveBeenCalledWith("cli:claude:opus", false);
  click('.mp-star[data-star="cli:claude:claude-fable-5-2"]');
  expect(favorite).toHaveBeenLastCalledWith("cli:claude:claude-fable-5-2", true);
});

test("every ref a model is saved as is found by refsOf", () => {
  const models = pickerModelsFor({ role: "answer", current: "", catalog: null, clis, label: "Answer" });
  const opus = models.find(model => model.id === "cli:claude:claude-opus-5-5")!;
  expect(refsOf(opus)).toEqual(["cli:claude:claude-opus-5-5", "cli:claude:opus"]);
  expect(refsOf(models.find(model => model.id === "cli:codex:luna")!)).toEqual(["cli:codex:luna"]);
});
