// Stored attachments are immutable: an opaque id names its bytes for good, so the window asks for each id once a session and
// keeps what it has shown across conversations. The shell serves an id under one
// stable URL with a year-long immutable lifetime (media_protocol.rs), so the browser's own caches hold the bytes; this module
// keeps the URL of each id, so a conversation opened again sets its pictures at once without asking the shell, and the last
// pictures shown, so the browser keeps them decoded. Nothing that changes (a page being edited, a computer's frame) comes here.
import { attachmentSource } from "./api";

export const STORED_ID = /^[a-f0-9]{32}\.[a-z0-9]{1,12}$/;

/** A stored copy as base64, the shell's older way (`attachments.get`), for an id its media protocol does not serve. */
export type ReadStored = (id: string) => Promise<{ mime: string; data: string }>;

/** The most URLs remembered; each is a short string. */
const MAX_URLS = 4096;
/** Pictures kept decoded across conversations: at most this many, and at most this many decoded bytes. */
const MAX_KEPT = 120;
const MAX_KEPT_BYTES = 192 * 1024 * 1024;
/** Copies read as base64 (a type the protocol does not serve) are held as Blobs: at most this many bytes. */
const MAX_BLOB_BYTES = 96 * 1024 * 1024;

const urls = new Map<string, string>();
const asking = new Map<string, Promise<string>>();
const blobs = new Map<string, number>();
const kept = new Map<string, { image: HTMLImageElement; bytes: number }>();
let keptBytes = 0;

const remember = (id: string, url: string): void => {
  urls.delete(id);
  urls.set(id, url);
  if (urls.size > MAX_URLS) {
    const [oldest, old] = urls.entries().next().value!;
    urls.delete(oldest);
    forgetBlob(oldest, old);
  }
};
function forgetBlob(id: string, url: string): void {
  if (!blobs.has(id)) return;
  blobs.delete(id);
  URL.revokeObjectURL(url);
}

/** The URL of a stored id this session already has, or undefined: a conversation opened again draws with it at once. */
export function knownMediaUrl(id: string): string | undefined {
  return urls.get(id);
}

/**
 * The URL of a stored id, asked of the shell once a session: the same id asked again, from any conversation, room or the
 * Library, at the same time or later, is the same answer. `read` is the fallback for a copy the protocol does not serve
 * (an older stored type), read once as a Blob of bounded size.
 */
export function mediaUrl(id: string, read?: ReadStored): Promise<string> {
  if (!STORED_ID.test(id)) return Promise.reject(new Error("invalid attachment id"));
  const known = urls.get(id);
  if (known) return Promise.resolve(known);
  const pending = asking.get(id);
  if (pending) return pending;
  const asked = (async () => {
    try { return await attachmentSource(id); }
    catch (error) {
      if (!read) throw error;
      const file = await read(id);
      const bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
      let held = [...blobs.values()].reduce((sum, size) => sum + size, 0);
      for (const [old] of blobs) {
        if (held + bytes.length <= MAX_BLOB_BYTES) break;
        held -= blobs.get(old) ?? 0;
        forgetBlob(old, urls.get(old) ?? "");
        urls.delete(old);
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
      blobs.set(id, bytes.length);
      return url;
    }
  })().then(url => { remember(id, url); return url; }).finally(() => asking.delete(id));
  asking.set(id, asked);
  return asked;
}

/** Whether a picture of this id is still held decoded (drawn again at once, without waiting to be scrolled near). */
export const isKept = (id: string): boolean => kept.has(id);

/**
 * Holds a picture the window drew, so the browser keeps it decoded when its conversation is closed: the next one that shows
 * the same id takes it from memory. The oldest go first, by count and by decoded size.
 */
export function keepDecoded(id: string, image: HTMLImageElement): void {
  if (!image.naturalWidth || !STORED_ID.test(id)) return;
  const old = kept.get(id);
  if (old) { kept.delete(id); keptBytes -= old.bytes; }
  const bytes = image.naturalWidth * image.naturalHeight * 4;
  kept.set(id, { image, bytes });
  keptBytes += bytes;
  while (kept.size > MAX_KEPT || (keptBytes > MAX_KEPT_BYTES && kept.size > 1)) {
    const [oldest, entry] = kept.entries().next().value!;
    kept.delete(oldest);
    keptBytes -= entry.bytes;
  }
}

/** Pictures sent from their own bytes and drawn from them under their stored id: at most this many characters of data URLs. */
const MAX_ADOPTED_CHARS = 48 * 1024 * 1024;
const adopted = new Map<string, string>();
let adoptedChars = 0;

/**
 * A picture the owner just sent, drawn from its own bytes (`url`, a data URL) while the message was on its way, under the stored id
 * its turn now has: the thread draws the turn's picture at once from what it already decoded, and the shell is not asked for it.
 * Without this the turn's picture stood empty, its name showing, until its stored copy loaded. Past the bound the oldest are asked
 * for as any other id.
 */
export function adoptPicture(id: string, url: string, image: HTMLImageElement): void {
  if (!STORED_ID.test(id) || urls.has(id) || !image.naturalWidth) return;
  remember(id, url);
  keepDecoded(id, image);
  adopted.set(id, url);
  adoptedChars += url.length;
  while (adoptedChars > MAX_ADOPTED_CHARS && adopted.size > 1) {
    const [oldest, old] = adopted.entries().next().value!;
    adopted.delete(oldest);
    adoptedChars -= old.length;
    if (urls.get(oldest) !== old) continue;
    urls.delete(oldest);
    const entry = kept.get(oldest);
    if (entry) { kept.delete(oldest); keptBytes -= entry.bytes; }
  }
}

/** For tests: forget everything. */
export function resetMediaCache(): void {
  for (const [id, url] of urls) forgetBlob(id, url);
  urls.clear(); asking.clear(); blobs.clear(); kept.clear(); keptBytes = 0; adopted.clear(); adoptedChars = 0;
}
