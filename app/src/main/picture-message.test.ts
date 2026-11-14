// @vitest-environment happy-dom
// What a picture a member sent is as a message (R-UI-156): which media are pictures, how a reply quotes one and shows the
// quote, and the clipboard write that copies the picture itself.
import { afterEach, expect, test, vi } from "vitest";
import { quoteHTML } from "./message-quote";
import { copyPicture, mediaPicture, pictureQuote, quotedPicture } from "./picture-message";
import { pictureActionsHTML, messageActionsHTML } from "./timeline";

const ID = `${"b".repeat(32)}.png`;
const sent = (attachment: unknown): string => JSON.stringify({ attachment });

afterEach(() => { vi.unstubAllGlobals(); });

test("only a stored picture the window draws is a picture message", () => {
  expect(mediaPicture(sent({ id: ID, name: "office.png", mime: "image/png", size: 10 }))).toEqual({ id: ID, name: "office.png", mime: "image/png", size: 10 });
  expect(mediaPicture(sent({ id: `${"b".repeat(32)}.jpg`, name: "night.jpg", mime: "image/jpeg" }))?.name).toBe("night.jpg");
  // An SVG is a document, a PDF a file, a path or a malformed id nothing the window opens, an older URL payload no stored file.
  for (const text of [sent({ id: `${"b".repeat(32)}.svg`, name: "chart.svg", mime: "image/svg+xml" }), sent({ id: `${"b".repeat(32)}.pdf`, name: "r.pdf", mime: "application/pdf" }),
    sent({ id: "C:/office.png", name: "office.png", mime: "image/png" }), JSON.stringify({ type: "image", url: "https://example.test/a.png" }), "not json"]) {
    expect(mediaPicture(text)).toBeNull();
  }
});

test("a reply quotes a picture as a link to its stored file, and only that whole link reads back as a picture", () => {
  const quote = pictureQuote({ id: ID, name: "office [final].png" });
  expect(quote).toBe(`[office final.png](attachment:${ID})`);
  expect(quotedPicture(quote)).toEqual({ id: ID, name: "office final.png" });
  expect(quotedPicture(`看這張 [office.png](attachment:${ID})`)).toBeNull();
  expect(quotedPicture(`[report.pdf](attachment:${"b".repeat(32)}.pdf)`)).toBeNull();
  expect(quotedPicture("Ordinary words")).toBeNull();
});

test("a quoted picture shows its thumbnail and the word for a picture, never the link, and quoted words stay as they were", () => {
  const host = document.createElement("div");
  host.innerHTML = quoteHTML({ text: pictureQuote({ id: ID, name: "office.png" }), author: "設計師" }, true);
  const quote = host.querySelector<HTMLElement>("button.message-quote.has-picture[data-act='jump-quote']")!;
  expect(quote.querySelector(".quote-author")!.textContent).toBe("設計師");
  expect(quote.querySelector("img.quote-thumb")!.getAttribute("data-attachment")).toBe(ID);
  expect(quote.querySelector(".quote-text")!.textContent).toBe("圖片");
  expect(quote.textContent).not.toContain("attachment:");
  expect(quoteHTML({ text: "明天九點開會", author: "小晴" })).toBe('<span class="message-quote"><span class="quote-author">小晴</span><span class="quote-text">明天九點開會</span></span>');
});

test("a room's Copy beside a picture copies the picture; its other actions are the message's own", () => {
  const row = messageActionsHTML(1, false, undefined, false, '<button type="button" data-act="react-message"></button>');
  const host = document.createElement("div");
  host.innerHTML = pictureActionsHTML(row);
  const buttons = [...host.querySelectorAll<HTMLElement>(".message-actions > button")];
  expect(buttons.map(button => button.dataset.act)).toEqual(["react-message", "copy-picture"]);
  expect(buttons[1]!.getAttribute("aria-label")).toBe("複製圖片");
  expect(host.querySelector('[data-act="copy-message"]')).toBeNull();
});

test("copying a picture hands the clipboard one PNG item at once, and fails plainly where images cannot be copied", async () => {
  const items: Record<string, Promise<Blob>>[] = [];
  const write = vi.fn(async () => {});
  vi.stubGlobal("ClipboardItem", class { constructor(item: Record<string, Promise<Blob>>) { items.push(item); } });
  vi.stubGlobal("navigator", { clipboard: { write } });
  let release!: (file: { mime: string; data: string }) => void;
  const copied = copyPicture(() => new Promise(resolve => { release = resolve; }));
  // The item is written before the picture has been read: the press that asked for it is the gesture the clipboard sees.
  await Promise.resolve();
  expect(write).toHaveBeenCalledOnce();
  release({ mime: "image/png", data: btoa("png bytes") });
  await copied;
  const blob = await items[0]!["image/png"]!;
  expect(blob.type).toBe("image/png");
  expect(await blob.text()).toBe("png bytes");
  vi.stubGlobal("ClipboardItem", undefined);
  await expect(copyPicture(async () => ({ mime: "image/png", data: "" }))).rejects.toThrow();
});
