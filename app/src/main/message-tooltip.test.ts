// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { dropEchoTitles, messageTooltip } from "./message-tooltip";

test("a tip that only repeats the words on screen never shows, outside the dictation pages (owner, 2026-11-07)", () => {
  document.body.innerHTML = '<section><p class="work-line" data-tooltip="檔案太大，我在本機抽出那段函式。">檔案太大，我在本機抽出那段函式。</p>' +
    '<button data-tooltip="停止" aria-label="停止"><svg></svg></button></section>' +
    '<div class="page-dictation"><p data-tooltip="今天的聽寫">今天的聽寫</p></div>';
  const host = document.querySelector("section")!, dictation = document.querySelector<HTMLElement>(".page-dictation")!;
  messageTooltip(host); messageTooltip(dictation);
  const tip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  host.querySelector("p")!.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(tip.hidden).toBe(true);
  host.querySelector("button")!.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(tip.hidden).toBe(false);
  expect(tip.textContent).toBe("停止");
  dictation.querySelector("p")!.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(dictation.querySelector<HTMLElement>('[role="tooltip"]')!.hidden).toBe(false);
});

test("the browser's own title is taken away under the pointer when it only repeats the words", () => {
  document.body.innerHTML = '<span id="echo" title="研究摘要.md">研究摘要.md</span><button id="icon" title="新增"><svg></svg></button>';
  dropEchoTitles(document);
  for (const id of ["echo", "icon"]) document.getElementById(id)!.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(document.getElementById("echo")!.hasAttribute("title")).toBe(false);
  expect(document.getElementById("icon")!.getAttribute("title")).toBe("新增");
});

test("typing outside the sidebar hides its tooltip until an intentional hover or focus", async () => {
  document.body.innerHTML = '<section><span data-tooltip="Working">Face</span></section><textarea></textarea>';
  const host = document.querySelector("section")!, face = host.querySelector("span")!;
  messageTooltip(host);
  const tip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  const measure = vi.spyOn(face, "getBoundingClientRect");
  face.dispatchEvent(new Event("pointerover", {bubbles:true}));
  expect(tip.hidden).toBe(false);
  measure.mockClear();
  document.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", {key:"a", bubbles:true}));
  face.dataset.tooltip = "Waiting";
  face.dispatchEvent(new Event("pointerover", {bubbles:true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(tip.hidden).toBe(true);
  expect(measure).not.toHaveBeenCalled();
  face.dispatchEvent(new MouseEvent("pointermove", {bubbles:true, movementX:1}));
  expect(tip.hidden).toBe(false);
  expect(measure).toHaveBeenCalledTimes(1);
  document.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", {key:"b", bubbles:true}));
  face.dispatchEvent(new Event("focusin", {bubbles:true}));
  expect(tip.hidden).toBe(false);
  measure.mockRestore();
});

test("moving within an animated tooltip target does not measure it again", () => {
  document.body.innerHTML = '<section><span data-tooltip="Working"><i>One</i><b>Two</b></span></section>';
  const host = document.querySelector("section")!, face = host.querySelector("span")!;
  messageTooltip(host);
  const measure = vi.spyOn(face, "getBoundingClientRect");
  face.firstElementChild!.dispatchEvent(new Event("pointerover", {bubbles:true}));
  expect(measure).toHaveBeenCalledTimes(1);
  face.firstElementChild!.dispatchEvent(new MouseEvent("pointerout", {bubbles:true, relatedTarget:face.lastElementChild}));
  face.lastElementChild!.dispatchEvent(new Event("pointerover", {bubbles:true}));
  expect(host.querySelector<HTMLElement>('[role="tooltip"]')!.hidden).toBe(false);
  expect(measure).toHaveBeenCalledTimes(1);
  face.dispatchEvent(new MouseEvent("pointerout", {bubbles:true, relatedTarget:host}));
  expect(host.querySelector<HTMLElement>('[role="tooltip"]')!.hidden).toBe(true);
  measure.mockRestore();
});

test("the armed Escape hint replaces the hovered or focused Stop tooltip", () => {
  document.body.innerHTML = '<section><button data-tooltip="Stop" aria-label="Stop"><svg></svg></button></section>';
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
