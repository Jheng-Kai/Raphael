// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createLinkPreviews, previewCardsHTML } from "./link-previews";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });
test("cards load on intersection, share cached requests on redraw, reserve space and reject remote thumbnails", async () => {
  let observe!: IntersectionObserverCallback;
  const watched: Element[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { observe = callback; }
    observe(el: Element) { watched.push(el); }
    unobserve() {} disconnect() {}
  });
  const root = document.createElement("div"); document.body.append(root);
  root.innerHTML = previewCardsHTML("https://example.com/a https://example.com/b https://example.com/a https://example.com/c https://example.com/d");
  const fetch = vi.fn().mockResolvedValue({ url: "https://example.com/a", title: "<img onerror=alert(1)>", site: "Example", description: "A story", thumbnail: "https://private.example/image" });
  const previews = createLinkPreviews(root, fetch);
  previews.sync(); expect(fetch).not.toHaveBeenCalled(); expect(watched).toHaveLength(3);
  const first = root.querySelector<HTMLElement>(".preview-card")!;
  const html = first.outerHTML;
  observe([{ target: first, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(fetch).toHaveBeenCalledExactlyOnceWith("https://example.com/a");
  expect(first.textContent).toContain("A story"); expect(first.querySelector("img")).toBeNull();
  expect(first.querySelector("script,[onerror]")).toBeNull();
  root.innerHTML = html; previews.sync();
  const replacement = root.firstElementChild!;
  expect(replacement.getAttribute("data-preview-state")).toBe("ready");
  expect(replacement.textContent).toContain("A story");
  observe([{ target: replacement, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(replacement.textContent).toContain("A story");
  previews.pause();
});

test("a page that gives nothing to show takes the short card, and keeps it from the next draw on", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const root = document.createElement("div"); document.body.append(root);
  root.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect;
  const url = "https://unreadable.example/status/2115841281049940460";
  root.innerHTML = previewCardsHTML(url);
  const card = (): HTMLElement => root.querySelector<HTMLElement>(".preview-card")!;
  card().getBoundingClientRect = () => ({ top: 10, bottom: 120 }) as DOMRect;
  expect(card().classList.contains("is-short")).toBe(false);
  const previews = createLinkPreviews(root, vi.fn().mockResolvedValue({ url, site: "unreadable.example", title: "", description: "", thumbnail: null }));
  previews.sync(); for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(card().dataset.previewState).toBe("unavailable");
  expect(card().classList.contains("is-short")).toBe(true);
  // R-UI-71: the markup stays the same, so an unchanged line is never replaced; the cache paints the card before the frame.
  const markup = previewCardsHTML(url);
  expect(markup).not.toContain("is-short");
  root.innerHTML = markup; previews.sync();
  expect(card().classList.contains("is-short")).toBe(true);
  expect([...card().querySelectorAll(".preview-meta > span")].map(line => line.textContent)).toEqual(["unreadable.example/status/2115841281049940460"]);
  previews.pause();
});

test("an address with no page behind it reads once, in full, and says nothing else", () => {
  const root = document.createElement("div");
  root.innerHTML = previewCardsHTML("http://127.0.0.1:5173/some/rather/long/path/to/a/page/of/the/tool");
  const lines = [...root.querySelectorAll(".preview-meta > span")].map(line => line.textContent);
  expect(lines).toEqual(["127.0.0.1:5173/some/rather/long/path/to/a/page/of/the/tool"]);
  root.innerHTML = previewCardsHTML("http://127.0.0.1:5173/");
  expect([...root.querySelectorAll(".preview-meta > span")].map(line => line.textContent)).toEqual(["127.0.0.1:5173"]);
});

test("only an address no public page can stand behind gets the short card", () => {
  const root = document.createElement("div");
  const short = (url: string): boolean => { root.innerHTML = previewCardsHTML(url); return root.querySelector(".preview-card")!.classList.contains("is-local"); };
  for (const url of ["http://127.0.0.1:5173/", "http://localhost:3000/a", "http://192.168.1.20/", "http://10.0.0.5/", "http://172.16.0.1/", "http://printer.local/", "http://nas/"]) expect(short(url), url).toBe(true);
  for (const url of ["https://example.com/a", "http://172.32.0.1/", "http://192.169.1.1/"]) expect(short(url), url).toBe(false);
});

test("a pending result cannot mutate a hidden or replaced thread, and can be reused when shown", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  let resolve!: (value: null) => void;
  const fetch = vi.fn(() => new Promise<null>(r => { resolve = r; }));
  const root = document.createElement("div"); document.body.append(root);
  root.innerHTML = previewCardsHTML("https://example.com");
  const previews = createLinkPreviews(root, fetch); previews.sync(); await Promise.resolve();
  previews.pause(); resolve(null);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(root.querySelector("[data-preview-loaded]")).toBeNull();
  previews.sync(); expect(fetch).toHaveBeenCalledTimes(1);
  expect(root.querySelector("[data-preview-state='unavailable']")).not.toBeNull();
});

test("preview cache expires after one day and keeps bounded raster thumbnails", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.useFakeTimers(); vi.setSystemTime(0);
  const root = document.createElement("div"); document.body.append(root);
  const fetch = vi.fn().mockResolvedValue({ url: "https://example.com/", site: "Site", title: "Article", description: "Summary", thumbnail: "data:image/png;base64,cG5n" });
  const previews = createLinkPreviews(root, fetch);
  const draw = async () => { root.innerHTML = previewCardsHTML("https://example.com"); previews.sync(); for (let i = 0; i < 8; i++) await Promise.resolve(); };
  await draw(); expect(root.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,cG5n");
  vi.setSystemTime(86399_000); await draw(); expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(86401_000); await draw(); expect(fetch).toHaveBeenCalledTimes(2);
  previews.pause();
});
