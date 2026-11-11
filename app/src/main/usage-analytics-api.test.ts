import { expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ brains: [] })) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
import * as api from "./api";

test("the usage page reads only the subscription allowances across the shell", async () => {
  expect(await api.usageAllowances()).toEqual({ brains: [] });
  expect(invoke).toHaveBeenCalledWith("core_call", { method: "usage.allowances", params: {} });
  expect(Object.keys(api).filter((name) => /^usage|UsageCsv$/.test(name))).toEqual(["usageAllowances"]);
});
