// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { messageTooltip } from "./message-tooltip";

test("the armed Escape hint replaces the hovered or focused Stop tooltip", () => {
  document.body.innerHTML = '<section><button data-tooltip="Stop">Stop</button></section>';
  const host = document.querySelector("section")!, button = host.querySelector("button")!;
  messageTooltip(host);
  const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  button.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(tooltip.hidden).toBe(false);
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  button.dataset.cancelArmed = "true";
  for (const type of ["pointerover", "focusin"]) {
    button.dispatchEvent(new Event(type, { bubbles: true }));
    expect(tooltip.hidden).toBe(true);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  }
  delete button.dataset.cancelArmed;
  button.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(tooltip.hidden).toBe(false);
});

test("a header hover opens below its avatar and remains clear of the window chrome", () => {
  document.body.innerHTML = '<section><header class="mb-head"><span data-tooltip="Checking a sample">Face</span></header></section>';
  const host = document.querySelector("section")!, face = host.querySelector<HTMLElement>("span")!;
  messageTooltip(host);
  const tip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  vi.spyOn(face, "getBoundingClientRect").mockReturnValue({left: 300, top: 36, right: 328, bottom: 64, width: 28, height: 28} as DOMRect);
  vi.spyOn(tip, "getBoundingClientRect").mockReturnValue({width: 150, height: 28} as DOMRect);
  face.dispatchEvent(new Event("pointerover", {bubbles: true}));
  expect(Number.parseFloat(tip.style.top)).toBeGreaterThanOrEqual(70);
  expect(document.activeElement).not.toBe(face);
  vi.restoreAllMocks();
});

test("a hover near the top stays below its target and completely inside the viewport", () => {
  document.body.innerHTML = '<section><span data-tooltip="Checking a sample">Face</span></section>';
  const host = document.querySelector("section")!, face = host.querySelector<HTMLElement>("span")!;
  messageTooltip(host);
  const tip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  vi.spyOn(face, "getBoundingClientRect").mockReturnValue({left: 2, top: 10, right: 30, bottom: 38, width: 28, height: 28} as DOMRect);
  vi.spyOn(tip, "getBoundingClientRect").mockReturnValue({width: 150, height: 28} as DOMRect);
  face.dispatchEvent(new Event("pointerover", {bubbles: true}));
  expect(Number.parseFloat(tip.style.top)).toBeGreaterThanOrEqual(38 + 6);
  expect(Number.parseFloat(tip.style.top) + 28).toBeLessThanOrEqual(innerHeight - 8);
  vi.restoreAllMocks();
});

test("a collapsed member rail shares one tooltip with the name before the live action", async () => {
  document.documentElement.setAttribute("data-sidebar-collapsed", "");
  document.body.innerHTML = '<section><button class="mb-row" data-tooltip="Sample"><b>Sample</b><span data-presence-member="1" data-tooltip="Checking">Face</span></button></section>';
  const host = document.querySelector("section")!, face = host.querySelector<HTMLElement>("span")!;
  messageTooltip(host);
  face.dispatchEvent(new Event("pointerover", {bubbles: true}));
  const tip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tip.textContent).toBe("Sample\nChecking");
  face.dataset.tooltip = "Waiting for a colleague";
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(tip.textContent).toBe("Sample\nWaiting for a colleague");
  expect(host.querySelectorAll('[role="tooltip"]:not([hidden])')).toHaveLength(1);
  document.documentElement.removeAttribute("data-sidebar-collapsed");
});
