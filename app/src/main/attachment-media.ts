// Stored media of one mounted thread: pictures load near the viewport, videos and sounds get our players (media-player.ts).
// What a stored id points at never changes, so its URL and the decoded picture belong to the app, not to this thread
// (media-cache.ts): a conversation opened again draws its pictures at once and asks the shell for nothing it already asked.
import { bindPlayers } from "./media-player";
import { isKept, keepDecoded, knownMediaUrl, mediaUrl, STORED_ID, type ReadStored } from "./media-cache";

export function createAttachmentMedia(root: HTMLElement, read: ReadStored) {
  let epoch = 0;
  const players = new Set<HTMLMediaElement>();
  const watched = new WeakSet<HTMLImageElement>();
  const apply = (id: string, url: string): void => {
    for (const node of root.querySelectorAll<HTMLImageElement | HTMLMediaElement>(`img[data-attachment="${id}"],video[data-attachment="${id}"],audio[data-attachment="${id}"]`)) {
      if (node.getAttribute("src") !== url) node.src = url;
    }
  };
  /** A picture that has loaded is kept decoded for the next conversation that shows it. */
  const watch = (image: HTMLImageElement, id: string): void => {
    if (watched.has(image)) return;
    watched.add(image);
    const keep = (): void => keepDecoded(id, image);
    if (image.complete && image.naturalWidth) keep();
    else image.addEventListener("load", keep);
  };
  /** Kept as soon as it is decoded: a line drawn again before the thread's own picture reports its load still has it at once. */
  const decoded = (id: string, url: string): Promise<void> => {
    const image = new Image();
    image.src = url;
    return image.decode().then(() => keepDecoded(id, image), () => { /* A picture that cannot be decoded is shown as the browser shows it. */ });
  };
  const load = (node: Element): void => {
    const id = (node as HTMLElement).dataset.attachment;
    if (!id || !STORED_ID.test(id)) return;
    const picture = node instanceof HTMLImageElement && !isKept(id);
    const known = knownMediaUrl(id);
    if (known && !picture) { apply(id, known); return; }
    const generation = epoch;
    mediaUrl(id, read)
      // A picture is decoded before it is shown, so it goes from its name to itself in one frame and never stands empty
      // between them: what stands above it in the thread does not move down and up (R-FOLLOW-01).
      .then(async url => { if (picture) await decoded(id, url); return url; })
      .then(url => { if (generation === epoch) apply(id, url); })
      // A missing stored copy leaves its name visible, without exposing backend details.
      .catch(() => {});
  };
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer!.unobserve(entry.target);
      load(entry.target.querySelector("audio") ?? entry.target);
    }
  }, { root, rootMargin: "240px" }) : null;
  return {
    sync(): void {
      observer?.disconnect();
      for (const player of players) if (!root.contains(player)) { player.pause(); players.delete(player); }
      for (const player of root.querySelectorAll<HTMLMediaElement>("audio,video")) players.add(player);
      bindPlayers(root);
      for (const node of root.querySelectorAll<HTMLElement>("img[data-attachment],video[data-attachment],audio[data-attachment]")) {
        const id = node.dataset.attachment ?? "";
        if (node instanceof HTMLImageElement) watch(node, id);
        // A picture this session still holds decoded is set now, in the same frame as the thread: nothing loads again and
        // nothing jumps. Everything else waits until it is near the viewport (its URL, once known, is not asked again).
        const known = knownMediaUrl(id);
        if (known && node.getAttribute("src") === known) continue;
        if (known && node instanceof HTMLImageElement && isKept(id)) { node.src = known; continue; }
        // Our audio player hides the element; watch its visible row instead.
        if (observer) observer.observe(node.closest(".attachment-audio") ?? node);
        else load(node);
      }
    },
    source(button: HTMLElement): string | undefined {
      const id = button.dataset.attachment;
      if (id) return knownMediaUrl(id);
      const src = button.querySelector("img")?.getAttribute("src");
      // A draft's thumbnail was set from its own bytes or its stored copy (agent.ts, chat-composer.ts).
      if (src && button.classList.contains("cmp-pic")) return src;
      return src && /^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,/.test(src) ? src : undefined;
    },
    reset(): void {
      epoch++;
      for (const player of players) player.pause();
      players.clear();
      observer?.disconnect();
    },
  };
}
