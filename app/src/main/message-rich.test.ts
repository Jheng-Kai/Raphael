// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { replyContentHTML } from "./message-content";
import { firstBelow, followRichScroll, mountRichContent, preserveRichScroll, releaseRichScroll, richScrollFollows } from "./message-rich";
import { copyButton } from "./ui";
import { renderDiagram } from "./message-diagram";
import { openDialog } from "./member-dialogs";
import { t } from "./i18n";
// The dialog's own behaviour is diagram-zoom.test.ts's: here it only has to stand as the larger view's element.
vi.mock("./member-dialogs", () => ({ openDialog: vi.fn((options: { body: string; tools?: string }) => {
  const el = document.createElement("div");
  el.innerHTML = `<div class="mb-dlg-head">${options.tools ?? ""}</div><div class="mb-dlg-body">${options.body}</div>`;
  document.body.append(el);
  return { el, close: vi.fn() };
}) }));
vi.mock("./message-highlight", () => ({ highlight: () => '<span>Highlighted code</span>' }));
vi.mock("./message-diagram", () => ({ renderDiagram: vi.fn(async () => '<svg><path d="M0 0L1 1" /></svg>') }));
vi.mock("./ui", async importOriginal => ({ ...await importOriginal<typeof import("./ui")>(), copyButton: vi.fn(async () => {}) }));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("completed code highlighting needs no layout on ordinary reply mutations", async () => {
  const root = document.createElement("div"); document.body.append(root);
  root.innerHTML = replyContentHTML('```python\nprint(1)\n```');
  const geometry = vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0,0,600,400));
  vi.spyOn(root.querySelector('.message-code')!, "getBoundingClientRect").mockReturnValue(new DOMRect(0,0,600,40));
  mountRichContent(root);
  await vi.waitFor(() => expect(root.querySelector('[data-highlighted="true"]')).not.toBeNull());
  await new Promise(requestAnimationFrame);
  geometry.mockClear();
  for (let index = 0; index < 20; index++) root.append(document.createElement("p"));
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(geometry).not.toHaveBeenCalled();
});

test("ordinary reply mutations do not remeasure pending offscreen code", async () => {
  const root = document.createElement("div"); document.body.append(root);
  root.innerHTML = replyContentHTML('```python\nprint(1)\n```');
  const geometry = vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0,0,600,400));
  vi.spyOn(root.querySelector('.message-code')!, "getBoundingClientRect").mockReturnValue(new DOMRect(0,-2000,600,40));
  mountRichContent(root);
  geometry.mockClear();
  for (let index = 0; index < 20; index++) root.append(document.createElement("p"));
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(geometry).not.toHaveBeenCalled();
  expect(root.querySelector('[data-highlighted="true"]')).toBeNull();
});

test("a diagram retains its render across text updates and rerenders for changed theme tokens", async () => {
  const root = document.createElement("div"); document.body.append(root);
  root.style.setProperty('--text', 'rgb(1, 2, 3)');
  root.innerHTML = replyContentHTML('```mermaid\nflowchart LR\n  Alpha --> Beta\n```');
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0,0,600,400));
  vi.spyOn(root.querySelector('.message-code')!, "getBoundingClientRect").mockReturnValue(new DOMRect(0,0,600,40));
  const before = vi.mocked(renderDiagram).mock.calls.length;
  mountRichContent(root);
  await vi.waitFor(() => expect(vi.mocked(renderDiagram).mock.calls.length).toBe(before + 1));
  root.append(document.createElement('p'));
  await new Promise(requestAnimationFrame);
  expect(vi.mocked(renderDiagram).mock.calls.length).toBe(before + 1);
  root.style.setProperty('--text', 'rgb(4, 5, 6)');
  document.documentElement.dataset.theme = 'dark';
  await vi.waitFor(() => expect(vi.mocked(renderDiagram).mock.calls.length).toBe(before + 2));
  delete document.documentElement.dataset.theme;
});

/** A reply whose diagram has been drawn (its own source, so no other test's drawing is reused). */
async function drawnDiagram(source: string): Promise<HTMLElement> {
  const root = document.createElement("div"); document.body.append(root);
  root.innerHTML = replyContentHTML("```mermaid\n" + source + "\n```");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
  vi.spyOn(root.querySelector(".message-code")!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 40));
  mountRichContent(root);
  await vi.waitFor(() => expect(root.querySelector('.message-diagram[data-diagram-state="rendered"] .diagram-view svg')).not.toBeNull());
  return root;
}
const press = (target: Element, at: [number, number], to = at): void => {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: at[0], clientY: at[1], button: 0 }));
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: to[0], clientY: to[1], detail: 1 }));
};
const opened = (): number => vi.mocked(openDialog).mock.calls.filter(([options]) => options.cls?.includes("diagram-dialog")).length;

test("a press anywhere on a drawn diagram's chart opens it larger, and the header's icons keep their own actions", async () => {
  // Before it is drawn, the chart is nothing to press: the source stands in its place.
  const pending = document.createElement("div"); document.body.append(pending);
  pending.innerHTML = replyContentHTML("```mermaid\nflowchart LR\n  Writing -->");
  expect(pending.querySelector(".diagram-view")!.matches('[role], [tabindex], [data-rich-act]')).toBe(false);

  const root = await drawnDiagram("flowchart LR\n  Press --> Opens");
  const view = root.querySelector<HTMLElement>(".diagram-view")!;
  expect(view.getAttribute("role")).toBe("button");
  expect(view.tabIndex).toBe(0);
  expect(view.getAttribute("aria-label")).toBe(t("chat.diagramOpen"));
  expect(view.hasAttribute("title")).toBe(false);
  vi.mocked(openDialog).mockClear();

  root.querySelector<HTMLButtonElement>('[data-rich-act="copy-source"]')!.click();
  expect(copyButton).toHaveBeenLastCalledWith(expect.any(HTMLElement), "flowchart LR\n  Press --> Opens");
  root.querySelector<HTMLButtonElement>('[data-rich-act="view-source"]')!.click();
  expect(root.querySelector<HTMLElement>(".message-diagram pre")!.hidden).toBe(false);
  press(root.querySelector(".message-diagram .rich-head")!, [580, 12]);
  expect(opened()).toBe(0);

  press(view.querySelector("path")!, [120, 60]);
  expect(opened()).toBe(1);
  const options = vi.mocked(openDialog).mock.calls[0]![0];
  expect(options.title).toBe(t("chat.diagram"));
  expect(options.body).toContain("<svg");
  expect(options.body).not.toContain("data-rich-act");
  press(view, [8, 8]);
  expect(opened()).toBe(2);
  root.querySelector<HTMLButtonElement>('[data-rich-act="expand"]')!.click();
  expect(opened()).toBe(3);
});

test("a press that moved, or that selected words of the chart, does not open the diagram", async () => {
  vi.mocked(renderDiagram).mockResolvedValueOnce('<svg viewBox="0 0 200 100"><text>Selectable words</text></svg>');
  const root = await drawnDiagram("flowchart LR\n  Select --> Words");
  const view = root.querySelector<HTMLElement>(".diagram-view")!, words = view.querySelector("text")!;
  vi.mocked(openDialog).mockClear();
  press(words, [40, 40], [90, 42]);
  expect(opened()).toBe(0);
  getSelection()!.selectAllChildren(words);
  press(words, [40, 40]);
  expect(opened()).toBe(0);
  getSelection()!.removeAllRanges();
  press(words, [40, 40], [42, 41]);
  expect(opened()).toBe(1);
});

test("Enter or Space on the focused chart opens the diagram larger, and other keys do not", async () => {
  const root = await drawnDiagram("flowchart LR\n  Keys --> Open");
  const view = root.querySelector<HTMLElement>(".diagram-view")!;
  vi.mocked(openDialog).mockClear();
  view.focus();
  for (const key of ["Tab", "a", "ArrowDown"]) view.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  expect(opened()).toBe(0);
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  view.dispatchEvent(enter);
  expect(opened()).toBe(1);
  expect(enter.defaultPrevented).toBe(true);
  const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  view.dispatchEvent(space);
  expect(opened()).toBe(2);
  expect(space.defaultPrevented).toBe(true);
});

test("the end of an older mounted window is not the newest conversation turn", () => {
  const root = document.createElement("div"); root.dataset.windowLater = "80";
  document.body.append(root);
  Object.defineProperties(root, { scrollHeight: {value:600}, clientHeight: {value:300} });
  root.scrollTop = 300;
  expect(richScrollFollows(root)).toBe(false);
});

test("the shared end observer keeps automatic following free of scroll geometry reads", async () => {
  vi.stubGlobal("IntersectionObserver", class {});
  const root = document.createElement("div");
  root.innerHTML = '<div class="conversation-end"></div>';
  document.body.append(root);
  preserveRichScroll(root, () => {});
  await new Promise(requestAnimationFrame);
  root.dispatchEvent(new CustomEvent("conversation-near-bottom", { detail: true }));
  const read = vi.fn(() => { throw new Error("Unexpected following geometry read"); });
  Object.defineProperties(root, {
    scrollTop: { get: read, set: () => {} },
    scrollHeight: { get: read },
    clientHeight: { get: read },
  });
  for (let index = 0; index < 20; index++) root.dispatchEvent(new Event("scroll"));
  preserveRichScroll(root, () => root.append(document.createElement("div")));
  await new Promise(requestAnimationFrame);
  expect(read).not.toHaveBeenCalled();
});

test("following coalesces mutations and explicit navigation cancels an older correction", async () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="ra-col"><ol class="thread"></ol></div>';
  document.body.append(root);
  const write = vi.fn();
  Object.defineProperty(root, "scrollTop", { get: () => 0, set: write });
  richScrollFollows(root);
  for (let index = 0; index < 20; index++) preserveRichScroll(root, () => {});
  await new Promise(requestAnimationFrame);
  expect(write).toHaveBeenCalledExactlyOnceWith(1e9);
  preserveRichScroll(root, () => {});
  releaseRichScroll(root);
  await new Promise(requestAnimationFrame);
  expect(write).toHaveBeenCalledTimes(1);
  followRichScroll(root);
  await new Promise(requestAnimationFrame);
  expect(write).toHaveBeenCalledTimes(2);
});

test("a remote Markdown image has no source or request until its explicit load click and omits the referrer", () => {
  const root = document.createElement("div"); document.body.append(root);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ width: 600, top: 0 } as DOMRect);
  root.innerHTML = replyContentHTML('![Preview](https://images.example/private.png?synthetic=secret)');
  mountRichContent(root);
  expect(root.querySelector("img,[src]")).toBeNull();
  expect(root.querySelector("a")).toBeNull();
  root.querySelector<HTMLButtonElement>('[data-rich-act="load-image"]')!.click();
  const image = root.querySelector("img")!;
  expect(image.src).toBe("https://images.example/private.png?synthetic=secret");
  expect(image.referrerPolicy).toBe("no-referrer");
  expect(root.querySelector('[data-rich-act="expand-image"]')).not.toBeNull();
});

test("asynchronous rich content follows latest but preserves the reader's visible anchor away from bottom", async () => {
  const root = document.createElement("div"), anchor = document.createElement("div"); anchor.className = "message-text";
  root.append(anchor); document.body.append(root);
  Object.defineProperties(root, { scrollHeight: { configurable: true, value: 1800 }, clientHeight: { value: 500 } });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  let offset = 10; vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: offset, bottom: offset + 30 } as DOMRect));
  root.scrollTop = 200;
  preserveRichScroll(root, () => { offset = 110; });
  await new Promise(requestAnimationFrame);
  expect(root.scrollTop).toBe(300);
  root.scrollTop = 1300; root.dispatchEvent(new Event("scroll"));
  await new Promise(requestAnimationFrame);
  preserveRichScroll(root, () => Object.defineProperty(root, "scrollHeight", { value: 2000 }));
  await new Promise(requestAnimationFrame);
  expect(root.scrollTop).toBe(1e9);
});

test("repainting a streaming reply above the reader restores the same persisted turn and content anchor", async () => {
  const root = document.createElement("div"); root.innerHTML = '<li class="tn" data-id="12"><div class="message-text">Still reading this reply</div></li>';
  document.body.append(root);
  Object.defineProperties(root, { scrollHeight: { value: 1800 }, clientHeight: { value: 500 } });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  vi.spyOn(root.querySelector('.message-text')!, "getBoundingClientRect").mockReturnValue({ top: 10, bottom: 40 } as DOMRect);
  root.scrollTop = 200;
  preserveRichScroll(root, () => {
    root.innerHTML = '<li class="tn" data-id="12"><div class="message-text">Still reading this reply</div></li>';
    vi.spyOn(root.querySelector('.message-text')!, "getBoundingClientRect").mockReturnValue({ top: 110, bottom: 140 } as DOMRect);
  });
  await new Promise(requestAnimationFrame);
  expect(root.scrollTop).toBe(300);
});

test("repeated mutations retain one anchor without collecting or measuring the whole thread", async () => {
  const root = document.createElement("div");
  root.innerHTML = `<ol class="thread">${Array.from({ length: 150 }, (_, index) => `<li class="tn" data-id="${index}"><div class="message-text">Reply ${index}</div></li>`).join("")}</ol>`;
  document.body.append(root);
  Object.defineProperties(root, { scrollHeight: { configurable: true, value: 20000 }, clientHeight: { configurable: true, value: 500 } });
  root.scrollTop = 2000;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  const turns = [...root.querySelectorAll<HTMLElement>(".tn")];
  for (const [index, turn] of turns.entries()) vi.spyOn(turn, "getBoundingClientRect").mockReturnValue({ top: index * 100 - 2000, bottom: index * 100 - 1900 } as DOMRect);
  const anchor = turns[20]!.firstElementChild!;
  let top = 10;
  vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top, bottom: top + 40 } as DOMRect));
  preserveRichScroll(root, () => {});
  const query = vi.spyOn(root, "querySelectorAll");
  const anchorRect = vi.mocked(anchor.getBoundingClientRect);
  anchorRect.mockClear();
  Object.defineProperties(root, {
    scrollHeight: { get: () => { throw new Error("Container height read during content update"); } },
    clientHeight: { get: () => { throw new Error("Container viewport read during content update"); } },
  });
  turns.forEach(turn => vi.mocked(turn.getBoundingClientRect).mockClear());
  for (let index = 0; index < 10; index++) preserveRichScroll(root, () => { top += 5; });
  expect(query).not.toHaveBeenCalled();
  expect(turns.reduce((count, turn) => count + vi.mocked(turn.getBoundingClientRect).mock.calls.length, 0)).toBe(0);
  await new Promise(requestAnimationFrame);
  expect(anchorRect).toHaveBeenCalledTimes(1);
  expect(root.scrollTop).toBe(2050);
});

test("a quote or search jump invalidates a queued latest correction", async () => {
  const root = document.createElement('div'); document.body.append(root);
  Object.defineProperties(root, { scrollHeight: {value:900}, clientHeight: {value:300} });
  root.scrollTop = 600;
  preserveRichScroll(root, () => {});
  releaseRichScroll(root);
  root.scrollTop = 120;
  preserveRichScroll(root, () => {});
  await new Promise(requestAnimationFrame);
  expect(root.scrollTop).toBe(120);
});

test("card copy actions copy TSV and exact code source without invoking a tool", () => {
  const root = document.createElement("div"); document.body.append(root);
  root.innerHTML = replyContentHTML('| Name | Value |\n| --- | --- |\n| **Alpha** | `a|b` |\n\n```bash\necho "hello"\n```');
  mountRichContent(root);
  root.querySelector<HTMLButtonElement>('[data-rich-act="copy-table"]')!.click();
  expect(copyButton).toHaveBeenLastCalledWith(expect.any(HTMLElement), "Name\tValue\nAlpha\ta|b");
  root.querySelector<HTMLButtonElement>('[data-rich-act="copy-source"]')!.click();
  expect(copyButton).toHaveBeenLastCalledWith(expect.any(HTMLElement), 'echo "hello"');
});

test("answer forms use the same source copy action as existing code cards", () => {
  const root = document.createElement("div"); document.body.append(root);
  const source = '{"columns":[{"title":"Ready","cards":[{"title":"Review"}]}]}';
  root.innerHTML = replyContentHTML("```board\n" + source + "\n```");
  mountRichContent(root);
  root.querySelector<HTMLButtonElement>('[data-rich-act="copy-source"]')!.click();
  expect(copyButton).toHaveBeenLastCalledWith(expect.any(HTMLElement), source);
});

test("the reading anchor is found by halving, reading a few positions of a long thread instead of all", () => {
  const lines = Array.from({ length: 1000 }, (_, index) => {
    const line = document.createElement("p");
    line.getBoundingClientRect = vi.fn(() => new DOMRect(0, index * 40 - 20_000, 100, 40));
    return line;
  });
  expect(firstBelow(lines, 62)).toBe(lines[501]);
  expect(lines.reduce((reads, line) => reads + vi.mocked(line.getBoundingClientRect).mock.calls.length, 0)).toBeLessThanOrEqual(11);
  expect(firstBelow(lines, 1e9)).toBeUndefined();
  expect(firstBelow([], 0)).toBeUndefined();
});


test("scrolling reuses the observer's code list and only measures nearby blocks", () => {
  const root = document.createElement("div"); document.body.append(root);
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
  const blocks = Array.from({length: 1000}, (_, index) => {
    const block = document.createElement("div"); block.className = "message-code";
    vi.spyOn(block, "getBoundingClientRect").mockReturnValue(new DOMRect(0, index * 50 - 25_000, 600, 40));
    root.append(block); return block;
  });
  mountRichContent(root);
  blocks.forEach(block => vi.mocked(block.getBoundingClientRect).mockClear());
  const query = vi.spyOn(root, "querySelectorAll");
  for (let i = 0; i < 20; i++) root.dispatchEvent(new Event("scroll"));
  expect(frames).toHaveLength(1); frames.shift()!(0);
  expect(query.mock.calls.some(([selector]) => selector === ".message-code")).toBe(false);
  expect(blocks.reduce((count, block) => count + vi.mocked(block.getBoundingClientRect).mock.calls.length, 0)).toBeLessThan(40);
});

/** A thread with real-looking geometry: its content height, its viewport and a clamped scroll position; the stick's observer is ours to call. */
function stickThread(view = { height: 2000, client: 600, top: 1400 }) {
  let resized: () => void = () => {};
  const watched: Element[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe(node: Element) { watched.push(node); } disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {});
  const root = document.createElement("div");
  root.innerHTML = '<div class="ra-col"><ol class="thread"></ol></div><span class="conversation-end"></span>';
  document.body.append(root);
  Object.defineProperties(root, {
    scrollHeight: { configurable: true, get: () => view.height },
    clientHeight: { configurable: true, get: () => view.client },
    scrollTop: { configurable: true, get: () => view.top, set: (value: number) => { view.top = Math.max(0, Math.min(value, view.height - view.client)); } },
  });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  richScrollFollows(root);
  const gap = (): number => view.height - view.top - view.client;
  // A change of size is told after layout: the content grew or shrank, or what stands under the scroller did.
  const change = (next: Partial<typeof view>): void => { Object.assign(view, next); view.top = Math.min(view.top, view.height - view.client); resized(); };
  const scroll = async (top: number): Promise<void> => { root.scrollTop = top; root.dispatchEvent(new Event("scroll")); await new Promise(requestAnimationFrame); };
  return { root, view, watched, gap, change, scroll };
}

test("a thread at its bottom stays there through every change of its height or its scroller's, in the frame of the change", () => {
  const thread = stickThread();
  // The column and the end marker are watched as well as the scroller: words, a late picture, a card, the work line going.
  expect(thread.watched).toEqual([thread.root, thread.root.querySelector(".ra-col"), thread.root.querySelector(".conversation-end")]);
  for (const next of [{ height: 2272 }, { height: 2316 }, { height: 2290 }, { client: 520 }, { client: 640 }, { height: 2900, client: 560 }]) {
    thread.change(next);
    expect(thread.gap()).toBe(0);
  }
});

test("the stick to the bottom writes a clamped position and reads no container geometry", () => {
  const thread = stickThread();
  const read = vi.fn(() => { throw new Error("Unexpected geometry read while following"); });
  const write = vi.fn();
  Object.defineProperties(thread.root, { scrollTop: { get: read, set: write }, scrollHeight: { get: read }, clientHeight: { get: read } });
  for (let index = 0; index < 5; index++) thread.change({});
  expect(write.mock.calls).toEqual(Array.from({ length: 5 }, () => [1e9]));
  expect(read).not.toHaveBeenCalled();
});

test("a thread the owner scrolled up stays where they read, near the bottom or far from it, until they are back at its bottom", async () => {
  const thread = stickThread();
  // Their wheel lets go of the bottom before the scroll it starts has moved anything: the growth in that frame does not pull them back.
  thread.root.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
  thread.change({ height: 2040 });
  expect(thread.view.top).toBe(1400);
  await thread.scroll(1370);
  // Thirty pixels up is still their place: nearer than the 80 px band, and the end observer saying "near" changes nothing.
  thread.root.dispatchEvent(new CustomEvent("conversation-near-bottom", { detail: true }));
  thread.change({ height: 2300 });
  thread.change({ client: 520 });
  expect(thread.view.top).toBe(1370);
  expect(richScrollFollows(thread.root)).toBe(false);
  // Back at the very bottom by their own scroll down: the thread follows again.
  await thread.scroll(1780);
  expect(richScrollFollows(thread.root)).toBe(true);
  thread.change({ height: 2500 });
  expect(thread.gap()).toBe(0);
});

test("a place in the middle that a width change put back is the owner's: the end in view for a moment does not make the thread follow", async () => {
  const thread = stickThread({ height: 7000, client: 600, top: 4600 });
  // The thread was following (nothing let it go), then the details panel closed: a shorter thread clamped the view to its end and
  // the end observer said "near"; the reading place put the line read back and says so.
  thread.change({ height: 5100 });
  thread.root.dispatchEvent(new CustomEvent("conversation-near-bottom", { detail: true }));
  thread.root.scrollTop = 3360;
  thread.root.dispatchEvent(new CustomEvent("conversation-hold"));
  expect(richScrollFollows(thread.root)).toBe(false);
  thread.change({ height: 5120 });
  thread.root.dispatchEvent(new CustomEvent("conversation-near-bottom", { detail: true }));
  thread.change({ height: 5140 });
  expect(thread.view.top).toBe(3360);
  // Back at the very bottom by their own scroll, it follows again.
  await thread.scroll(4540);
  expect(richScrollFollows(thread.root)).toBe(true);
});

test("a scroll still going up does not take the bottom again, a thread that cannot scroll is not let go, and the latest button follows", async () => {
  const thread = stickThread();
  thread.root.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
  // The first frame of a smooth scroll up has moved one pixel: within the bottom, but going up.
  await thread.scroll(1399);
  expect(richScrollFollows(thread.root)).toBe(false);
  thread.root.dispatchEvent(new Event("conversation-latest"));
  expect(richScrollFollows(thread.root)).toBe(true);
  thread.change({ height: 2400 });
  expect(thread.gap()).toBe(0);
  // Words typed in a message edited in place, and a wheel on a thread at its top, let nothing go.
  const field = document.createElement("textarea"); thread.root.querySelector(".thread")!.append(field);
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  expect(richScrollFollows(thread.root)).toBe(true);
  const short = stickThread({ height: 400, client: 600, top: 0 });
  short.root.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
  short.change({ height: 900 });
  expect(short.gap()).toBe(0);
});

test("a thread the owner scrolled up that comes to its bottom by getting shorter follows again", async () => {
  const thread = stickThread();
  thread.root.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
  await thread.scroll(1300);
  expect(richScrollFollows(thread.root)).toBe(false);
  // What stood under them went (another room drawn in its place, the end of a long card): the end clamps to the bottom.
  thread.change({ height: 1500 });
  thread.root.dispatchEvent(new Event("scroll"));
  await new Promise(requestAnimationFrame);
  expect(richScrollFollows(thread.root)).toBe(true);
  thread.change({ height: 1800 });
  expect(thread.gap()).toBe(0);
});

test("a hidden thread, an older window and explicit navigation are not pulled to the bottom", () => {
  const thread = stickThread();
  thread.root.hidden = true;
  thread.change({ height: 2300 });
  expect(thread.view.top).toBe(1400);
  thread.root.hidden = false;
  thread.root.dataset.windowLater = "20";
  thread.change({ height: 2400 });
  expect(thread.view.top).toBe(1400);
  delete thread.root.dataset.windowLater;
  releaseRichScroll(thread.root);
  thread.change({ height: 2500 });
  expect(thread.view.top).toBe(1400);
});
