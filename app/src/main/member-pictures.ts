/**
 * The pictures of the members, kept by revision. The roster names a picture by `avatar_rev` / `cover.rev` and does
 * not carry it: with the pictures inline `members.list` was ten megabytes and was read several times at start-up
 * (owner, 2026-11-11: 「第一次開 app 的速度還是非常慢，就只有第一次而已」). A picture is read once through
 * `members.picture`; the same revision is then shown from here, and a new one (the owner chose another) is read again.
 */
import type { Member } from "./types";

type Kind = "avatar" | "cover";
type Read = (method: string, params: object) => Promise<unknown>;

const shown = new Map<string, string>();
const reading = new Map<string, Promise<string | null>>();
/** The newest revision seen for each picture, so the one it replaced is let go. */
const latest = new Map<string, string>();

const slot = (kind: Kind, id: number): string => `${kind}:${id}`;

async function pictureOf(read: Read, kind: Kind, id: number, rev: string): Promise<string | null> {
  const key = `${slot(kind, id)}:${rev}`;
  const known = shown.get(key);
  if (known !== undefined) return known;
  const under = reading.get(key);
  if (under) return under;
  const task = (async (): Promise<string | null> => {
    try {
      const answer = await read("members.picture", { id, kind }) as { rev: string | null; url: string | null };
      if (!answer?.url || !answer.rev) return null;
      // The picture may have changed since the roster was read: it is kept under the revision it really has.
      const actual = `${slot(kind, id)}:${answer.rev}`;
      shown.set(actual, answer.url);
      const before = latest.get(slot(kind, id));
      if (before && before !== answer.rev) shown.delete(`${slot(kind, id)}:${before}`);
      latest.set(slot(kind, id), answer.rev);
      return answer.url;
    } catch {
      return null; // the face stays the silhouette; the next roster asks again
    } finally {
      reading.delete(key);
    }
  })();
  reading.set(key, task);
  return task;
}

/**
 * Puts each member's picture (`avatar_url`, `cover.url`) where the pages read it, from the cache or from the core.
 * `answer` is whatever a members call returned: a roster (`members`), one member (`member`) or neither.
 */
export async function fillPictures(read: Read, answer: unknown): Promise<void> {
  const holder = answer as { members?: unknown; member?: unknown } | null;
  if (!holder || typeof holder !== "object") return;
  const members = [...(Array.isArray(holder.members) ? holder.members : []), ...(holder.member ? [holder.member] : [])] as Member[];
  const work: Promise<void>[] = [];
  for (const member of members) {
    if (!member || typeof member.id !== "number") continue;
    if (member.avatar_rev) {
      const rev = member.avatar_rev;
      work.push(pictureOf(read, "avatar", member.id, rev).then(url => { if (url) member.avatar_url = url; else delete member.avatar_url; }));
    }
    const cover = member.cover;
    if (cover?.kind === "image" && cover.rev) {
      work.push(pictureOf(read, "cover", member.id, cover.rev).then(url => { cover.url = url ?? ""; }));
    }
  }
  await Promise.all(work);
}

/** For tests: forget everything kept. */
export function forgetPictures(): void {
  shown.clear(); reading.clear(); latest.clear();
}
