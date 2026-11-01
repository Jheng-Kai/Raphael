// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { closeMenu, openMenu, submenuCorridor } from "./ui";

afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.useRealTimers(); });

function hoverMenu(): { parent: HTMLElement; row: HTMLButtonElement; other: HTMLButtonElement } {
  const anchor = document.createElement("button"); document.body.append(anchor);
  openMenu(anchor, [], "", () => {}, undefined, [
    { label: "Move to group", submenu: true, run(row) { openMenu(row, [{ value: "a", label: "Sample A" }, { value: "b", label: "Sample B" }], "a", () => {}, undefined, [], { placement: "beside" }); } },
    { label: "Other action", run: vi.fn() },
  ]);
  const parent = document.getElementById("app-popover")!, [row, other] = [...parent.querySelectorAll<HTMLButtonElement>("button")];
  row.getBoundingClientRect = () => ({ left: 100, right: 300, top: 100, bottom: 134, width: 200, height: 34 } as DOMRect);
  parent.getBoundingClientRect = () => ({ left: 94, right: 306, top: 94, bottom: 200, width: 212, height: 106 } as DOMRect);
  return { parent, row, other };
}
const pointer = (el: HTMLElement, x = 180, y = 120): void => { el.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, bubbles: true })); };

test("hover waits 120 ms, preserves the parent highlight and check, then leaves both after 250 ms", () => {
  vi.useFakeTimers();
  const { parent, row } = hoverMenu(); pointer(row);
  vi.advanceTimersByTime(119); expect(document.getElementById("app-submenu")).toBeNull();
  vi.advanceTimersByTime(1); expect(document.getElementById("app-submenu")).not.toBeNull();
  expect(parent.isConnected).toBe(true); expect(row.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('#app-submenu [data-value="a"]')?.getAttribute("aria-checked")).toBe("true");
  pointer(document.body, 800, 800); vi.advanceTimersByTime(249); expect(document.getElementById("app-submenu")).not.toBeNull();
  vi.advanceTimersByTime(1); expect(document.getElementById("app-submenu")).toBeNull(); expect(parent.isConnected).toBe(true);
});

test("a diagonal trip across a neighbour keeps the submenu, a direct move switches immediately", () => {
  vi.useFakeTimers(); const { row, other } = hoverMenu(); pointer(row, 180, 120); vi.advanceTimersByTime(120);
  const child = document.getElementById("app-submenu")!;
  expect(child).not.toBeNull();
  child.getBoundingClientRect = () => ({ left: 306, right: 500, top: 100, bottom: 250 } as DOMRect);
  pointer(other, 250, 150); expect(document.getElementById("app-submenu")).toBe(child);
  pointer(child, 310, 160); vi.advanceTimersByTime(300); expect(document.getElementById("app-submenu")).toBe(child);
  pointer(other, 120, 160); expect(document.getElementById("app-submenu")).toBeNull();
});

test("safe triangles work to either side and reject motion away from the submenu", () => {
  expect(submenuCorridor({ x: 100, y: 100 }, { x: 150, y: 130 }, { left: 200, right: 300, top: 100, bottom: 200 })).toBe(true);
  expect(submenuCorridor({ x: 400, y: 100 }, { x: 350, y: 130 }, { left: 200, right: 300, top: 100, bottom: 200 })).toBe(true);
  expect(submenuCorridor({ x: 100, y: 100 }, { x: 90, y: 130 }, { left: 200, right: 300, top: 100, bottom: 200 })).toBe(false);
});

test("Right opens; Left and Escape close only the child; redraw and page scroll keep the menu's position", () => {
  const { parent, row } = hoverMenu(); row.focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(document.getElementById("app-submenu")).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(document.getElementById("app-submenu")).toBeNull(); expect(document.activeElement).toBe(row);
  row.click(); const child = document.getElementById("app-submenu")!;
  const at = [child.style.top, child.style.left, parent.style.top, parent.style.left];
  row.getBoundingClientRect = () => ({ left: 200, right: 400, top: 300, bottom: 334, width: 200, height: 34 } as DOMRect);
  document.dispatchEvent(new Event("scroll", { bubbles: true }));
  expect([child.style.top, child.style.left, parent.style.top, parent.style.left]).toEqual(at);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.getElementById("app-submenu")).toBeNull(); expect(parent.isConnected).toBe(true);
});

test("action-only menus have no leading separator and keep their parent beside a submenu", () => {
  const anchor = document.createElement("button"), picked = vi.fn();
  document.body.append(anchor);
  openMenu(anchor, [], "", () => {}, undefined, [{ label: "Before acting", submenu: true, run(row) {
    openMenu(row, [{ value: "ask", label: "Ask first" }], "ask", picked, "Before acting", [], { placement: "beside" });
  } }]);
  const parent = document.getElementById("app-popover")!;
  expect(parent.querySelector('[role="separator"]')).toBeNull();
  const row = parent.querySelector<HTMLButtonElement>("button")!;
  expect(row.getAttribute("aria-haspopup")).toBe("menu");
  row.click();
  expect(parent.isConnected).toBe(true);
  expect(document.querySelector("#app-submenu [aria-checked=true]")).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(parent.isConnected).toBe(true);
  expect(document.getElementById("app-submenu")).toBeNull();
  expect(document.activeElement).toBe(row);
  row.click();
  document.querySelector<HTMLButtonElement>('#app-submenu [data-value="ask"]')!.click();
  expect(picked).toHaveBeenCalledWith("ask");
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
  expect(document.activeElement).toBe(anchor);
});

test("a settings redraw that replaces the same keyed control keeps the menu's opening rectangle", () => {
  const anchor = document.createElement("button"); anchor.dataset.k = "sample-setting"; document.body.append(anchor);
  anchor.getBoundingClientRect = () => ({ top: 100, bottom: 134, left: 100, right: 300, width: 200, height: 34 } as DOMRect);
  const show = (button: HTMLElement): void => openMenu(button, [{ value: "a", label: "Sample A" }], "a", () => {});
  show(anchor);
  const before = document.getElementById("app-popover")!, at = [before.style.top, before.style.left];
  const replacement = anchor.cloneNode() as HTMLElement; anchor.replaceWith(replacement);
  replacement.getBoundingClientRect = () => ({ top: 300, bottom: 334, left: 400, right: 600, width: 200, height: 34 } as DOMRect);
  show(replacement);
  const after = document.getElementById("app-popover")!;
  expect([after.style.top, after.style.left]).toEqual(at);
  expect(replacement.getAttribute("aria-expanded")).toBe("true");
});

test.each(["wheel", "touchmove", "PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", " "])("outside %s closes every menu level", input => {
  const { row } = hoverMenu(); row.click();
  if (["wheel", "touchmove"].includes(input)) document.body.dispatchEvent(new Event(input, { bubbles: true }));
  else document.body.dispatchEvent(new KeyboardEvent("keydown", { key: input, bubbles: true }));
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
});

test("scroll input inside either menu preserves both levels and programmatic scroll leaves them still", () => {
  const { parent, row } = hoverMenu(); row.click(); const child = document.getElementById("app-submenu")!;
  const at = [parent.style.top, parent.style.left, child.style.top, child.style.left];
  for (const panel of [parent, child]) for (const input of ["wheel", "touchmove", "scroll"]) panel.dispatchEvent(new Event(input, { bubbles: true }));
  document.dispatchEvent(new Event("scroll"));
  expect(document.getElementById("app-popover")).toBe(parent); expect(document.getElementById("app-submenu")).toBe(child);
  expect([parent.style.top, parent.style.left, child.style.top, child.style.left]).toEqual(at);
});

test("resize closes both levels and live text completions still follow their caret", () => {
  const { row } = hoverMenu(); row.click(); window.dispatchEvent(new Event("resize"));
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
  const input = document.createElement("textarea"); document.body.append(input); input.focus();
  let top = 100;
  openMenu(input, [{ value: "sample", label: "Sample" }], "", () => {}, undefined, [], { completion: true, anchorRect: () => new DOMRect(100, top, 1, 20) });
  const menu = document.getElementById("app-popover")!, before = menu.style.top;
  top = 200; document.dispatchEvent(new Event("scroll"));
  expect(menu.style.top).not.toBe(before);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.getElementById("app-popover")).toBe(menu);
});

test("Tab or an outside activation closes both menu levels and restores the composer trigger", () => {
  const anchor = document.createElement("button"), outside = document.createElement("button");
  document.body.append(anchor, outside);
  const show = (): void => {
    openMenu(anchor, [], "", () => {}, undefined, [{ label: "Before acting", submenu: true, run(row) {
      openMenu(row, [{ value: "ask", label: "Ask first" }], "ask", () => {}, undefined, [], { placement: "beside" });
    } }]);
    document.querySelector<HTMLButtonElement>("#app-popover button")!.click();
  };
  show();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
  expect(document.activeElement).toBe(anchor);
  show(); outside.click();
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
  expect(document.activeElement).toBe(anchor);
});
