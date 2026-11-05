// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { replyContentHTML } from "./message-content";
import { firstBelow, followRichScroll, mountRichContent, preserveRichScroll, releaseRichScroll, richScrollFollows } from "./message-rich";
import { copyButton } from "./ui";
import { renderDiagram } from "./message-diagram";
vi.mock("./member-dialogs", () => ({ openDialog: vi.fn() }));
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
