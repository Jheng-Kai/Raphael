// The one light of a sidebar row (a member, a group chat, a pinned face): what the owner most needs to know about
// it, as a dot, and nothing else (R-SIDE-04, owner 2026-11-14: 「他們如果在思考的情況下，不要有提示…只有他們真正傳出訊息的時候，我左邊才會有提示」).
//
//   waiting  orange  a question or an approval waits for the owner; it stays until it is answered
//   failed   red     work went wrong and needs a look
//   done     green   a task, a routine or a meeting ended and the owner has not seen it
//   message  white   a new message the owner has not read (the theme's own text colour)
//   null             nothing: a member that is thinking or working has said nothing yet, and its slime shows the work
//
// Only the strongest one shows, in that order. The core decides what is news (a turn that is still running is none until
// it has sent a message) and says what kind it is (`unread_kind`); this module decides which light, and draws it. Opening
// the conversation reads its news: white, green and red go, orange stays for as long as its question waits.

import { t } from "./i18n";
import { esc } from "./ui";

export type Light = "waiting" | "failed" | "done" | "message";

/** What a light is made from: the fields of a member or a group chat in the list (`members.list`, `rooms.list`). */
export interface LightSource {
  waiting?: boolean;
  /** The member's activity: "blocked" is a question that waits for the owner, "error" a run that failed unseen. */
  activity?: string;
  unread?: boolean;
  unread_kind?: "message" | "done" | "failed" | null;
}

/** Strongest first. */
export const LIGHTS: readonly Light[] = ["waiting", "failed", "done", "message"];

/** The light of a row, or null. `open`: its conversation is the one on screen, which reads everything but a waiting question. */
export function lightOf(row: LightSource, open = false): Light | null {
  if (row.waiting || row.activity === "blocked") return "waiting";
  if (open) return null;
  if (row.activity === "error" || (row.unread && row.unread_kind === "failed")) return "failed";
  if (!row.unread) return null;
  return row.unread_kind === "done" ? "done" : "message";
}

/** The strongest of several lights (the header's choice of member shows one for all the others), or null. */
export const strongest = (lights: readonly (Light | null)[]): Light | null => LIGHTS.find((light) => lights.includes(light)) ?? null;

/** The dot's class: the same two names the sidebar has always had for orange and white, and one each for red and green. */
export const lightClass = (light: Light): string => ({ waiting: "is-wait", failed: "is-failed", done: "is-done", message: "is-unread" })[light];

/** The words for a light: its accessible name, which is also what the header's list of members tags a member with. */
export const lightName = (light: Light): string =>
  ({ waiting: t("members.waitingShort"), failed: t("members.lightFailed"), done: t("members.lightDone"), message: t("members.unread") })[light];

/** The dot of a row: a plain, still circle that names itself; nothing for no light. */
export const lightHTML = (light: Light | null): string =>
  light ? `<span class="mb-dot ${lightClass(light)}" data-light="${light}" role="img" aria-label="${esc(lightName(light))}"></span>` : "";
