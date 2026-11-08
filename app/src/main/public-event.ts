import { t } from "./i18n";

/** Transport keys and target IDs are never part of a receipt's public words. */
export function publicEventText(text: string): string {
  if (!/^[\s]*[\[{]/.test(text)) return text;
  try {
    const event = JSON.parse(text);
    if (event?.type === "action") return "";
    if (!["routine", "calendar", "meeting", "skill_learned"].includes(event?.type)) return text;
    if (typeof event?.text === "string") return event.text;
    if (typeof event?.name === "string") {
      const labels = {
        "routine.created": "event.routine.created", "routine.updated": "event.routine.updated", "routine.deleted": "event.routine.deleted",
        "calendar.created": "event.calendar.created", "calendar.updated": "event.calendar.updated", "calendar.deleted": "event.calendar.deleted",
        // A skill it already had and rewrote says so (owner, 2026-11-08: the same skill is 「更新了」, not 「學會了」).
        "meeting": "rooms.meetingOpened", "skill_learned": "skills.learnedNotice", "skill_learned.updated": "skills.updatedNotice",
      } as const;
      const key = `${event.type}.${event.action}` in labels ? `${event.type}.${event.action}` : event.type;
      if (Object.prototype.hasOwnProperty.call(labels, key)) return t(labels[key as keyof typeof labels], {p0: event.name});
    }
  } catch { return text; }
  return t("event.changed");
}
