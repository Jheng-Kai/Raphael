// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { replyContentHTML } from "./message-content";
import { mountRichContent, preserveRichScroll } from "./message-rich";
import { copyText } from "./ui";
vi.mock("./member-dialogs", () => ({ openDialog: vi.fn() }));
vi.mock("./ui", async importOriginal => ({ ...await importOriginal<typeof import("./ui")>(), copyText: vi.fn(async () => {}) }));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

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

test("asynchronous rich content follows latest but preserves the reader's visible anchor away from bottom", () => {
  const root = document.createElement("div"), anchor = document.createElement("div"); anchor.className = "message-text";
  root.append(anchor); document.body.append(root);
  Object.defineProperties(root, { scrollHeight: { configurable: true, value: 1800 }, clientHeight: { value: 500 } });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  let offset = 10; vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: offset, bottom: offset + 30 } as DOMRect));
  root.scrollTop = 200;
  preserveRichScroll(root, () => { offset = 110; });
  expect(root.scrollTop).toBe(300);
  root.scrollTop = 1300;
  preserveRichScroll(root, () => Object.defineProperty(root, "scrollHeight", { value: 2000 }));
  expect(root.scrollTop).toBe(2000);
});

test("repainting a streaming reply above the reader restores the same persisted turn and content anchor", () => {
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
  expect(root.scrollTop).toBe(300);
});

test("card copy actions copy TSV and exact code source without invoking a tool", () => {
  const root = document.createElement("div"); document.body.append(root);
  root.innerHTML = replyContentHTML('| Name | Value |\n| --- | --- |\n| **Alpha** | `a|b` |\n\n```bash\necho "hello"\n```');
  mountRichContent(root);
  root.querySelector<HTMLButtonElement>('[data-rich-act="copy-table"]')!.click();
  expect(copyText).toHaveBeenLastCalledWith("Name\tValue\nAlpha\ta|b");
  root.querySelector<HTMLButtonElement>('[data-rich-act="copy-source"]')!.click();
  expect(copyText).toHaveBeenLastCalledWith('echo "hello"');
});

test("answer forms use the same source copy action as existing code cards", () => {
  const root = document.createElement("div"); document.body.append(root);
  const source = '{"columns":[{"title":"Ready","cards":[{"title":"Review"}]}]}';
  root.innerHTML = replyContentHTML("```board\n" + source + "\n```");
  mountRichContent(root);
  root.querySelector<HTMLButtonElement>('[data-rich-act="copy-source"]')!.click();
  expect(copyText).toHaveBeenLastCalledWith(source);
});
