// A system event in a conversation is one centred grey line, as colleagues' chats show who was asked,
// who a task went to or which meeting opened: the window language's words with a small face or icon
// before the name. The words keep each language's order: `NAME` stands where the name goes.
import { esc } from "./ui";

/** Pass as the name's value to `t()`; `eventLineHTML` puts the face and the name in its place. */
export const NAME = "\u0000";

export interface EventPerson { name: string; face: string }

/** Indexed slots let localized list punctuation stay attached to its own words. */
export function eventPeopleHTML(words: string, people: readonly EventPerson[], state = ""): string {
  const parts = words.split(/(\u0000\d+\u0000)/g).map((part, index, parts) => {
    const slot = /^\u0000(\d+)\u0000$/.exec(part);
    if (!slot) return esc(part);
    const person = people[Number(slot[1])];
    const gap = /[\p{Script=Latin}\d]$/u.test(person.name) && /^\p{Script=Han}/u.test(parts[index + 1] ?? "");
    return `<span class="event-person${gap ? " is-word-gap" : ""}">${person.face}<b>${esc(person.name)}</b></span>`;
  }).join("");
  return `<span class="sys event-line event-people"><span>${parts}</span>${state ? `<span class="event-state">${esc(state)}</span>` : ""}</span>`;
}

/** The line itself: `words` from `t(key, { p0: NAME })`, `lead` a face or an icon, `state` quieter at the end. */
export function eventLineHTML(words: string, lead: string, name: string, state = ""): string {
  const [before = "", after = ""] = words.split(NAME);
  return `<span class="sys event-line">` +
    (before.trim() ? `<span>${esc(before)}</span>` : "") + lead + `<b>${esc(name)}</b>` +
    (after.trim() ? `<span>${esc(after)}</span>` : "") +
    (state ? `<span class="event-state">${esc(state)}</span>` : "") + `</span>`;
}
