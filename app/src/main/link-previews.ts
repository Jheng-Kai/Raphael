import { messageUrl, rememberedUrls, urlLabel } from "./message-content";
import { esc } from "./ui";

export interface LinkPreview {
  url: string;
  site: string;
  title: string;
  description: string;
  thumbnail: string | null;
}

function contents(url: string, preview: LinkPreview | null = null): string {
  // Core supplies bounded raster data only. Never load a remote image from a chat message.
  const thumbnail = preview?.thumbnail;
  const image = typeof thumbnail === "string" && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(thumbnail)
    ? `<img class="preview-image" src="${esc(thumbnail)}" alt="" width="64" height="64">` : "";
  // A page with no title of its own (an internal address, say) is its address, once.
  return image + `<span class="preview-meta">` + (preview?.title ? `<span class="preview-site">${esc(preview.site || new URL(url).host)}</span>` : "") +
    `<span class="preview-title">${esc(preview?.title || urlLabel(url))}</span>` +
    (preview?.title && preview.description ? `<span class="preview-description">${esc(preview.description)}</span>` : "") + `</span>`;
}

/** An address only this machine or its network can open: no public page is behind it, so its card never fills. */
function isLocalAddress(url: string): boolean {
  const host = new URL(url).hostname;
  return !host.includes(".") || /\.(?:local|internal|lan)$/.test(host) || /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
}

/** A link that needs its owner's account (a mail, a drive) lands on a sign-in page, the same for every such link:
 * its card shows the link's own address instead of that page. */
function signInDetour(url: string, preview: LinkPreview): boolean {
  try {
    const from = new URL(url), to = new URL(preview.url || url);
    return from.hostname !== to.hostname && (/^(?:accounts|login|auth|signin|sso)\./.test(to.hostname) || /sign-?in|log-?in|oauth|servicelogin/i.test(to.pathname));
  } catch { return false; }
}

/** Links that differ only after `#` are one page to its server, so they share one card. */
const pageOf = (url: string): string => url.split("#")[0]!;

/** Pages that gave nothing to show. The markup never carries this (R-UI-71); a later draw paints it from the cache before the frame. */
const unreadable = new Set<string>();
function noteUnreadable(url: string): void {
  unreadable.add(url);
  if (unreadable.size > 256) unreadable.delete(unreadable.values().next().value!);
}

export function previewCardsHTML(text: string): string {
  const urls = rememberedUrls(text).filter((url, index, all) => all.findIndex(other => pageOf(other) === pageOf(url)) === index).slice(0, 3);
  return urls.length ? `<div class="preview-cards">${urls.map(url =>
    `<button type="button" class="btn preview-card${isLocalAddress(url) ? " is-local" : ""}" data-act="open-url" data-url="${esc(url)}" data-preview-url="${esc(url)}" title="${esc(url)}">${contents(url)}</button>`).join("")}</div>` : "";
}

/** Observes only cards near the reader, sharing in-flight and cached results across thread draws. */
export function createLinkPreviews(root: HTMLElement, fetch: (url: string) => Promise<LinkPreview | null>) {
  const cache = new Map<string, { until: number; result?: LinkPreview | null; promise: Promise<LinkPreview | null> }>();
  let active = false;
  const load = (card: HTMLElement): void => {
    const url = messageUrl(card.dataset.previewUrl);
    if (!url || card.dataset.previewLoaded) return;
    card.dataset.previewLoaded = "true";
    let entry = cache.get(url);
    if (!entry || entry.until <= Date.now()) {
      const promise = Promise.resolve().then(() => fetch(url)).catch(() => null);
      entry = { until: Date.now() + 86400_000, promise };
      cache.set(url, entry);
      const current = entry;
      void promise.then(result => { current.result = result; if (!result) current.until = Date.now() + 300_000; });
      // Keep the cache small even when searching through a long history.
      if (cache.size > 128) cache.delete(cache.keys().next().value!);
    }
    const paint = (result: LinkPreview | null): void => {
      if (active && root.contains(card)) {
        // A page with no title and no picture, or a sign-in page, leaves only the link's own address.
        const shown = result && (result.title || result.thumbnail) && !signInDetour(url, result) ? result : null;
        card.innerHTML = contents(url, shown); card.dataset.previewState = shown ? "ready" : "unavailable";
        if (!shown) { noteUnreadable(url); card.classList.add("is-short"); }
      }
      else delete card.dataset.previewLoaded;
    };
    if (entry.result !== undefined) paint(entry.result);
    else void entry.promise.then(paint);
  };
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) if (active && entry.isIntersecting) { observer!.unobserve(entry.target); load(entry.target as HTMLElement); }
  }, { root, rootMargin: "160px" }) : null;
  const fallback = (): void => {
    if (!active || observer) return;
    const view = root.getBoundingClientRect();
    for (const card of root.querySelectorAll<HTMLElement>("[data-preview-url]")) {
      const box = card.getBoundingClientRect();
      if (box.top <= view.bottom + 160 && box.bottom >= view.top - 160) load(card);
    }
  };
  root.addEventListener("scroll", fallback, { passive: true });
  return {
    sync(): void {
      active = true;
      observer?.disconnect();
      for (const card of root.querySelectorAll<HTMLElement>("[data-preview-url]:not([data-preview-loaded])")) {
        const entry = cache.get(card.dataset.previewUrl ?? "");
        if (entry && entry.until > Date.now() && entry.result !== undefined) load(card);
        else observer?.observe(card);
      }
      fallback();
    },
    pause(): void { active = false; observer?.disconnect(); },
  };
}
