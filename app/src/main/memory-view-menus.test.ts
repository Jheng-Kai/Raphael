// @vitest-environment happy-dom
// R-UI-56: a memory's clears wait in the ⋯ of their rows. A click on the ⋯ and a right click on the row open the same menu,
// and the menu keeps the second press the buttons had.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ core: vi.fn() }));
vi.mock("./api", () => api);

import { installContextMenus, uncoveredOverflows } from "./context-menu";
import { type MemoryDocument, createMemory, memoryHTML } from "./memory-view";
import { closeMenu } from "./ui";

const DOC: MemoryDocument = { text: "主人住在台北\n", revision: "r1", chars: 6, entries: 1, limit: 2200, summary: { text: "進行中：規劃週末", updated_at_ms: 1 } };

const item = (): HTMLElement | null => document.querySelector<HTMLElement>("#app-popover [data-confirm-item]");
const called = (method: string): boolean => api.core.mock.calls.some(([name]) => name === method);

let stop: () => void;
let root: HTMLElement;

/** One list drawn in the page the way the panel draws it, hearing the clicks of its section. */
async function mount(space: "shared" | "own" = "own"): Promise<void> {
  const panel = createMemory({ visible: () => true, redraw: () => { root.innerHTML = memoryHTML(panel.view()); }, space, memberId: () => 1, ownerName: () => "小晴" });
  root.addEventListener("click", (event) => panel.click(event.target as Element));
  await panel.load();
}

const rightClick = (target: Element): void => {
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 200 }));
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 200 }));
};

beforeEach(() => {
  api.core.mockReset();
  api.core.mockImplementation(async (method: string) => (method === "memory.get" ? structuredClone(DOC) : {}));
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById("root")!;
  stop = installContextMenus(document);
});

afterEach(() => {
  stop();
  closeMenu();
  vi.useRealTimers();
});

describe("the clears of a memory", () => {
  test("全部清除 waits in the title's ⋯, asks once more, and a right click on the title opens the same menu", async () => {
    await mount();
    expect(root.textContent).not.toContain("全部清除");
    expect(uncoveredOverflows(root)).toEqual([]);

    rightClick(root.querySelector(".mem-head")!);
    expect(item()?.textContent).toBe("全部清除");
    closeMenu();

    root.querySelector<HTMLElement>('[data-mem="section-more"]')!.click();
    expect(item()?.textContent).toBe("全部清除");
    expect(item()?.classList.contains("danger")).toBe(true);

    item()!.click();
    expect(item()?.textContent).toBe("確定全部清除？");
    expect(called("memory.clear")).toBe(false);

    item()!.click();
    expect(item()).toBeNull();
    expect(called("memory.clear")).toBe(true);
  });

  test("the summary's 清除 waits in its row's ⋯, asks once more, and a right click on the row opens the same menu", async () => {
    await mount();
    expect(root.querySelector(".mem-summary")!.textContent).not.toContain("清除");

    rightClick(root.querySelector(".mem-summary")!);
    expect(item()?.textContent).toBe("清除");
    closeMenu();

    root.querySelector<HTMLElement>('[data-mem="summary-more"]')!.click();
    item()!.click();
    expect(item()?.textContent).toBe("確定清除？");
    expect(called("memory.summary_clear")).toBe(false);

    item()!.click();
    expect(called("memory.summary_clear")).toBe(true);
    expect(called("memory.clear")).toBe(false);
  });

  test("the first press is forgotten after a while, and with the menu", async () => {
    await mount();
    vi.useFakeTimers();
    root.querySelector<HTMLElement>('[data-mem="section-more"]')!.click();
    item()!.click();
    vi.advanceTimersByTime(5000);
    expect(item()?.textContent).toBe("全部清除");
    item()!.click();
    expect(called("memory.clear")).toBe(false);

    closeMenu();
    root.querySelector<HTMLElement>('[data-mem="section-more"]')!.click();
    expect(item()?.textContent).toBe("全部清除");
    item()!.click();
    expect(called("memory.clear")).toBe(false);
  });

  test("two sections on one page clear only the one whose ⋯ was pressed", async () => {
    root.innerHTML = '<div id="shared"></div><div id="own"></div>';
    const shared = root.querySelector<HTMLElement>("#shared")!, own = root.querySelector<HTMLElement>("#own")!;
    for (const [space, slot] of [["shared", shared], ["own", own]] as const) {
      const panel = createMemory({ visible: () => true, redraw: () => { slot.innerHTML = memoryHTML(panel.view()); }, space, memberId: () => 1, ownerName: () => "小晴" });
      root.addEventListener("click", (event) => panel.click(event.target as Element));
      await panel.load();
    }
    own.querySelector<HTMLElement>('[data-mem="section-more"]')!.click();
    item()!.click();
    item()!.click();
    expect(api.core).toHaveBeenCalledWith("memory.clear", { space: "own", member_id: 1 });
    expect(api.core).not.toHaveBeenCalledWith("memory.clear", expect.objectContaining({ space: "shared" }));
  });
});
