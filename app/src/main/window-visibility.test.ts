// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { visibilityGate, watchWindowVisibility } from "./window-visibility";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute("data-window-hidden"); });

test("hidden polls do nothing, returning refreshes once, and losing focus keeps work visible", () => {
  let hidden = false, active = true;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const refresh = vi.fn(), gate = visibilityGate(refresh, () => active), stop = watchWindowVisibility();
  gate.run(); expect(refresh).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("blur")); gate.run(); expect(refresh).toHaveBeenCalledTimes(2);
  hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  expect(document.documentElement.hasAttribute("data-window-hidden")).toBe(true);
  for (let i = 0; i < 5; i++) gate.run();
  expect(refresh).toHaveBeenCalledTimes(2);
  hidden = false; document.dispatchEvent(new Event("visibilitychange")); document.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(document.documentElement.hasAttribute("data-window-hidden")).toBe(false);
  active = false; hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  hidden = false; document.dispatchEvent(new Event("visibilitychange")); gate.run();
  expect(refresh).toHaveBeenCalledTimes(3);
  gate.stop(); stop();
});

test("the existing offscreen pause also covers the whole hidden window and pseudo elements", () => {
  const css = readFileSync(resolve(__dirname, "slime.css"), "utf8");
  expect(css).toContain("html[data-window-hidden] *, html[data-window-hidden] *::before, html[data-window-hidden] *::after { animation-play-state: paused !important; }");
  expect(css).not.toMatch(/html\[data-window-hidden\][^{]*\{[^}]*animation:\s*none/);
});
