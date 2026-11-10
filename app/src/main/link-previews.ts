import { isLocalAddress, messageUrl, urlLabel } from "./message-content";
import { esc } from "./ui";

// The links of a reply are chips in its words. This reads, for the chips near the reader, the page behind a bare
// address, so the chip can say the page's own title, and shows the page's preview under the pointer.

export interface LinkPreview {
  url: string;
  site: string;
  title: string;
  description: string;
  thumbnail: string | null;
}

/** What the preview under the pointer shows: the picture (bounded raster data from the core only, never a remote
 * image), the site, the title and a line of description; a page with nothing to show is its address, once. */
export function previewHTML(url: string, preview: LinkPreview | null = null): string {
  const thumbnail = preview?.thumbnail;
  const image = typeof thumbnail === "string" && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(thumbnail)
    ? `<img class="preview-image" src="${esc(thumbnail)}" alt="" width="64" height="64">` : "";
  return image + `<span class="preview-meta">` + (preview?.title ? `<span class="preview-site">${esc(preview.site || new URL(url).host)}</span>` : "") +
    `<span class="preview-title">${esc(preview?.title || urlLabel(url))}</span>` +
    (preview?.title && preview.description ? `<span class="preview-description">${esc(preview.description)}</span>` : "") + `</span>`;
}

/** A link that needs its owner's account (a mail, a drive) lands on a sign-in page, the same for every such link:
 * its chip keeps its own site instead of that page's title. */
function signInDetour(url: string, preview: LinkPreview): boolean {
  try {
    const from = new URL(url), to = new URL(preview.url || url);
    return from.hostname !== to.hostname && (/^(?:accounts|login|auth|signin|sso)\./.test(to.hostname) || /sign-?in|log-?in|oauth|servicelogin/i.test(to.pathname));
  } catch { return false; }
}

/** What a read gave that is worth showing: a title or a picture, from the page itself rather than a sign-in page. */
const usable = (url: string, result: LinkPreview | null): LinkPreview | null =>
  result && (result.title || result.thumbnail) && !signInDetour(url, result) ? result : null;

/** Links that differ only after `#` are one page to its server, so they share one read. */
const pageOf = (url: string): string => url.split("#")[0]!;

const HOVER_MS = 350;

/** Reads only the chips near the reader, sharing in-flight and cached results across thread draws. */
export function createLinkPreviews(root: HTMLElement, fetch: (url: string) => Promise<LinkPreview | null>) {
  const cache = new Map<string, { until: number; result?: LinkPreview | null; promise: Promise<LinkPreview | null> }>();
  let active = false;
  const read = (url: string): { result?: LinkPreview | null; promise: Promise<LinkPreview | null> } => {
    const key = pageOf(url);
    let entry = cache.get(key);
    if (!entry || entry.until <= Date.now()) {
      const promise = Promise.resolve().then(() => fetch(url)).catch(() => null);
      entry = { until: Date.now() + 86400_000, promise };
      cache.set(key, entry);
      const current = entry;
      void promise.then(result => { current.result = result; if (!result) current.until = Date.now() + 300_000; });
      // Keep the cache small even when searching through a long history.
      if (cache.size > 128) cache.delete(cache.keys().next().value!);
    }
    return entry;
  };
  /** A bare address says its page's title once it is read; one with nothing usable keeps its site. */
  const title = (chip: HTMLElement): void => {
    const url = messageUrl(chip.dataset.linkUrl);
    if (!url || chip.dataset.linkLoaded) return;
    chip.dataset.linkLoaded = "true";
    const entry = read(url);
    const paint = (result: LinkPreview | null): void => {
      if (!active || !root.contains(chip)) { delete chip.dataset.linkLoaded; return; }
      const shown = usable(url, result);
      const name = chip.querySelector<HTMLElement>(".link-name");
      if (shown?.title && name) name.textContent = shown.title;
      chip.dataset.linkState = shown?.title ? "ready" : "unavailable";
    };
    if (entry.result !== undefined) paint(entry.result);
    else void entry.promise.then(paint);
  };
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) if (active && entry.isIntersecting) { observer!.unobserve(entry.target); title(entry.target as HTMLElement); }
  }, { root, rootMargin: "160px" }) : null;
  const fallback = (): void => {
    if (!active || observer) return;
    const view = root.getBoundingClientRect();
    for (const chip of root.querySelectorAll<HTMLElement>("[data-link-title]:not([data-link-loaded])")) {
      const box = chip.getBoundingClientRect();
      if (box.top <= view.bottom + 160 && box.bottom >= view.top - 160) title(chip);
    }
  };

  // ---------- the preview under the pointer ----------
  let hover: HTMLElement | null = null, timer = 0, over: HTMLElement | null = null;
  const hide = (): void => { clearTimeout(timer); over = null; hover?.remove(); hover = null; };
  const place = (chip: HTMLElement, card: HTMLElement): void => {
    const box = chip.getBoundingClientRect(), width = card.offsetWidth, height = card.offsetHeight, gap = 6;
    const left = Math.max(8, Math.min(box.left, innerWidth - width - 8));
    const below = box.bottom + gap + height <= innerHeight - 8;
    card.style.left = `${left}px`;
    card.style.top = `${below ? box.bottom + gap : Math.max(8, box.top - gap - height)}px`;
  };
  const show = (chip: HTMLElement): void => {
    const url = messageUrl(chip.dataset.linkUrl);
    if (!url || isLocalAddress(url)) return;
    const draw = (result: LinkPreview | null): void => {
      if (!active || over !== chip || !chip.isConnected) return;
      hover?.remove();
      hover = document.createElement("div");
      hover.className = "link-hover";
      hover.setAttribute("role", "tooltip");
      hover.innerHTML = previewHTML(url, usable(url, result));
      document.body.append(hover);
      place(chip, hover);
    };
    const entry = read(url);
    if (entry.result !== undefined) draw(entry.result);
    else void entry.promise.then(draw);
  };
  const enter = (event: Event): void => {
    const chip = (event.target as Element | null)?.closest?.<HTMLElement>("a.link-chip");
    if (!chip || !active || chip === over) return;
    hide(); over = chip;
    timer = window.setTimeout(() => show(chip), HOVER_MS);
  };
  const leave = (event: Event): void => {
    const chip = (event.target as Element | null)?.closest?.<HTMLElement>("a.link-chip");
    const to = (event as PointerEvent | FocusEvent).relatedTarget as Node | null;
    if (chip && chip === over && !(to && chip.contains(to))) hide();
  };
  const escape = (event: KeyboardEvent): void => { if (event.key === "Escape" && hover) hide(); };
  root.addEventListener("pointerover", enter);
  root.addEventListener("pointerout", leave);
  root.addEventListener("focusin", enter);
  root.addEventListener("focusout", leave);
  root.addEventListener("click", hide);
  root.addEventListener("scroll", () => { hide(); fallback(); }, { passive: true });
  document.addEventListener("keydown", escape);

  return {
    sync(): void {
      active = true;
      observer?.disconnect();
      for (const chip of root.querySelectorAll<HTMLElement>("[data-link-title]:not([data-link-loaded])")) {
        // A page read before paints before the frame: the markup never carries what a read found (R-UI-71).
        const entry = cache.get(pageOf(chip.dataset.linkUrl ?? ""));
        if (entry && entry.until > Date.now() && entry.result !== undefined) title(chip);
        else observer?.observe(chip);
      }
      if (over && !over.isConnected) hide();
      fallback();
    },
    pause(): void { active = false; observer?.disconnect(); hide(); },
  };
}
