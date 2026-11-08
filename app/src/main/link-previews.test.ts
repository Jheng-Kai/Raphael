// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createLinkPreviews } from "./link-previews";
import { replyContentHTML } from "./message-content";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const thread = (text: string): HTMLElement => {
  const root = document.createElement("div"); document.body.append(root);
  root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
  root.innerHTML = replyContentHTML(text);
  for (const chip of root.querySelectorAll<HTMLElement>("a.link-chip")) chip.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 20, right: 120 }) as DOMRect;
  return root;
};
const chips = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>("a.link-chip")];

test("a link is a chip in the words: the site's mark, then its words or, bare, its site (owner, 2026-11-08)", () => {
  const root = thread("看 [Google 帳戶安全通知](https://myaccount.google.com/notifications)，或 https://www.github.com/x/y，或 http://127.0.0.1:5173/tool");
  const [named, bare, local] = chips(root);
  expect(named!.querySelector(".link-name")!.textContent).toBe("Google 帳戶安全通知");
  expect(named!.hasAttribute("data-link-title")).toBe(false);
  expect(bare!.querySelector(".link-name")!.textContent).toBe("github.com");
  expect(bare!.querySelector(".link-mark.logo-mono svg")).not.toBeNull(); // GitHub's own mark
  expect(bare!.hasAttribute("data-link-title")).toBe(true);
  expect(local!.querySelector(".link-name")!.textContent).toBe("127.0.0.1:5173/tool"); // no page to read: itself in full
  expect(local!.hasAttribute("data-link-title")).toBe(false);
  for (const chip of chips(root)) expect(chip.querySelector(".link-mark")).not.toBeNull();
  expect(root.querySelector(".preview-cards, .preview-card")).toBeNull();
});

test("a bare address says its page's title once read near the reader, shares cached reads and never takes markup from the page", async () => {
  let observe!: IntersectionObserverCallback;
  const watched: Element[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { observe = callback; }
    observe(el: Element) { watched.push(el); }
    unobserve() {} disconnect() {}
  });
  const root = thread("https://example.com/a and https://example.com/a#part and [named](https://example.com/b)");
  const fetch = vi.fn().mockResolvedValue({ url: "https://example.com/a", title: "<img onerror=alert(1)>", site: "Example", description: "A story", thumbnail: null });
  const previews = createLinkPreviews(root, fetch);
  previews.sync(); expect(fetch).not.toHaveBeenCalled(); expect(watched).toHaveLength(2); // the two bare ones, not the named one
  const first = chips(root)[0]!, html = root.innerHTML;
  observe([{ target: first, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  await settle();
  expect(fetch).toHaveBeenCalledExactlyOnceWith("https://example.com/a");
  expect(first.querySelector(".link-name")!.textContent).toBe("<img onerror=alert(1)>");
  expect(first.querySelector("img,[onerror]")).toBeNull();
  // A redraw paints from the cache before the frame (R-UI-71), and the same page after # is the same read.
  root.innerHTML = html; previews.sync();
  expect(chips(root)[0]!.dataset.linkState).toBe("ready");
  expect(chips(root)[1]!.querySelector(".link-name")!.textContent).toBe("<img onerror=alert(1)>");
  expect(fetch).toHaveBeenCalledTimes(1);
  previews.pause();
});

test("a link that lands on a sign-in page, or a page with nothing to show, keeps its site", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const root = thread("https://mail.google.com/mail/u/0/ https://unreadable.example/status/1");
  const fetch = vi.fn(async (url: string) => url.includes("mail")
    ? { url: "https://accounts.google.com/v3/signin/identifier", site: "accounts.google.com", title: "Gmail", description: "Sign in", thumbnail: null }
    : { url, site: "unreadable.example", title: "", description: "", thumbnail: null });
  const previews = createLinkPreviews(root, fetch); previews.sync(); await settle();
  const [mail, other] = chips(root);
  expect(mail!.querySelector(".link-name")!.textContent).toBe("mail.google.com");
  expect(mail!.dataset.linkState).toBe("unavailable");
  expect(other!.querySelector(".link-name")!.textContent).toBe("unreadable.example");
  previews.pause();
});

test("the page's preview shows under the pointer after a moment, only bounded pictures, and goes with the pointer or Escape", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.useFakeTimers();
  const root = thread("[Article](https://example.com/a) [Other](https://example.com/b)");
  const fetch = vi.fn(async (url: string) => ({ url, site: "Example", title: "Article", description: "Summary", thumbnail: url.endsWith("a") ? "data:image/png;base64,cG5n" : "https://remote.example/x.png" }));
  const previews = createLinkPreviews(root, fetch); previews.sync();
  const [a, b] = chips(root);
  a!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  expect(document.querySelector(".link-hover")).toBeNull(); // not at once
  await vi.advanceTimersByTimeAsync(400);
  const card = document.querySelector<HTMLElement>(".link-hover")!;
  expect(card.getAttribute("role")).toBe("tooltip");
  expect(card.textContent).toContain("Summary");
  expect(card.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,cG5n");
  a!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
  expect(document.querySelector(".link-hover")).toBeNull();
  b!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(400);
  expect(document.querySelector(".link-hover img")).toBeNull(); // a remote picture is never loaded
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.querySelector(".link-hover")).toBeNull();
  previews.pause();
});

test("a pending read cannot change a hidden or replaced thread, and is reused when shown", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  let resolve!: (value: null) => void;
  const fetch = vi.fn(() => new Promise<null>(r => { resolve = r; }));
  const root = thread("https://example.com");
  const previews = createLinkPreviews(root, fetch); previews.sync(); await Promise.resolve();
  previews.pause(); resolve(null);
  await settle();
  expect(root.querySelector("[data-link-loaded]")).toBeNull();
  previews.sync(); expect(fetch).toHaveBeenCalledTimes(1);
  expect(root.querySelector("[data-link-state='unavailable']")).not.toBeNull();
});

test("a read is kept for one day", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.useFakeTimers(); vi.setSystemTime(0);
  const root = thread("");
  const fetch = vi.fn().mockResolvedValue({ url: "https://example.com/", site: "Site", title: "Article", description: "Summary", thumbnail: null });
  const previews = createLinkPreviews(root, fetch);
  const draw = async () => { root.innerHTML = replyContentHTML("https://example.com"); previews.sync(); await settle(); };
  await draw(); expect(root.querySelector(".link-name")!.textContent).toBe("Article");
  vi.setSystemTime(86399_000); await draw(); expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(86401_000); await draw(); expect(fetch).toHaveBeenCalledTimes(2);
  previews.pause();
});
