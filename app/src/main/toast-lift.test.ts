// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { toaster } from "./ui";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const stand = (box: { top: number; width: number; height: number }): HTMLElement => {
  document.body.innerHTML = '<section class="page-agent"><form class="composer"></form></section>';
  const composer = document.querySelector<HTMLElement>(".composer")!;
  composer.getBoundingClientRect = () => ({ top: box.top, left: 0, right: box.width, bottom: box.top + box.height, width: box.width, height: box.height, x: 0, y: box.top, toJSON() {} }) as DOMRect;
  return composer;
};

test("a note stands over the composer's top edge, wherever a long draft or its attachments put it", () => {
  vi.useFakeTimers();
  vi.stubGlobal("innerHeight", 900);
  stand({ top: 600, width: 700, height: 250 });
  toaster.info("最多只能附加 20 個檔案");
  const host = document.querySelector<HTMLElement>(".toasts")!;
  expect(host.style.getPropertyValue("--toast-lift")).toBe("312px");
  // The composer shrinks again: the next note follows it.
  stand({ top: 780, width: 700, height: 100 });
  toaster.info("好了");
  expect(document.querySelector<HTMLElement>(".toasts")!.style.getPropertyValue("--toast-lift")).toBe("132px");
  vi.unstubAllGlobals();
});

test("with no composer in sight the note keeps its usual place", () => {
  vi.useFakeTimers();
  vi.stubGlobal("innerHeight", 900);
  document.body.innerHTML = "<main></main>";
  toaster.info("好了");
  expect(document.querySelector<HTMLElement>(".toasts")!.style.getPropertyValue("--toast-lift")).toBe("");
  vi.unstubAllGlobals();
});
