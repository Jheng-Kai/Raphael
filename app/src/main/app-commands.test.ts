import { expect, test, vi } from "vitest";
import { appCommandOf, runAppCommand } from "./app-commands";

test("an app command is the whole draft, in any case, with spaces around it and nothing else", () => {
  expect(appCommandOf("/usage")).toBe("usage");
  expect(appCommandOf("  /USAGE \n")).toBe("usage");
  expect(appCommandOf("/usage please")).toBeNull();
  expect(appCommandOf("usage")).toBeNull();
  expect(appCommandOf("/use")).toBeNull();
  expect(appCommandOf("/review")).toBeNull();
  expect(appCommandOf("/constructor")).toBeNull();
});

test("/usage opens Settings › 用量", () => {
  const go = vi.fn();
  runAppCommand("usage", go);
  expect(go).toHaveBeenCalledExactlyOnceWith("settings", "usage");
});
