// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { usageModel } from "./usage-models";
import { cliModels } from "./cli-brains";
import type { CliBrain } from "./types";

it("removes effort before rendering an unknown model", () => {
  const result = usageModel("cli:codex:gpt-6.1-sol?effort=xhigh");
  expect(result.name).not.toContain("?effort");
  expect(result.html).not.toContain("?effort");
});

it("looks up the normalized CLI catalog id", () => {
  const models = cliModels([{ id: "codex", available: true, models: [{ id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }] }] as CliBrain[]);
  expect(usageModel("cli:codex:gpt-6.1-sol?effort=xhigh", models).name).toBe("GPT-6.1 Sol");
});
