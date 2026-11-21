import { expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ brains: [] })) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
import * as api from "./api";

test("the usage page reads the allowances and a period's analytics across the shell, and nothing exports", async () => {
  expect(await api.usageAllowances()).toEqual({ brains: [] });
  expect(invoke).toHaveBeenCalledWith("core_call", { method: "usage.allowances", params: {} });
  await api.usageAnalytics("30d");
  expect(invoke).toHaveBeenCalledWith("core_call", { method: "usage.analytics", params: { range: "30d" } });
  expect(Object.keys(api).filter((name) => /^usage|UsageCsv$/.test(name)).sort()).toEqual(["usageAllowances", "usageAnalytics"]);
});
