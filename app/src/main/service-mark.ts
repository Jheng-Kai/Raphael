import { ICON } from "./icon-set";
import { pluginLogoURL } from "./plugins-data";
import { SERVICE_ICONS, brandStyle, hasLogo, serviceIconOf, serviceIconSVG, serviceLogoHTML, type ServiceIconId } from "./service-icons";
import { esc } from "./ui";

export const isIcon = (id: string | null | undefined): id is ServiceIconId => !!id && (id in SERVICE_ICONS || hasLogo(id as ServiceIconId));

/**
 * The one mark of an app, tool server or service we draw no mark for and the catalogue gives no picture of: a drawn app,
 * as large as a brand's mark beside it (it is a `.logo`), never the plug of 工具 and 連結應用程式 and never a letter.
 * Every list, menu, card and work step draws it from here (R-UI-164).
 */
export const genericGlyph = (): string => `<svg class="logo logo-generic" viewBox="0 0 24 24" aria-hidden="true">${ICON.app}</svg>`;
export const genericMark = (size: "md" | "xl"): string => `<span class="mono ${size}" aria-hidden="true">${genericGlyph()}</span>`;

/** One bare mark renderer for store entries, connected apps and conversation cards. */
export function iconHTML(_name: string, icon: ServiceIconId | null, size: "md" | "xl"): string {
  if (icon && hasLogo(icon)) return `<span class="mono ${size} logo-art">${serviceLogoHTML(icon)}</span>`;
  return icon && icon in SERVICE_ICONS
    ? `<span class="mono ${size} logo-mono"${brandStyle(icon)}>${serviceIconSVG(icon)}</span>`
    : genericMark(size);
}

/** A service the app knows is drawn with its own mark in its brand colour; a catalogue's picture is only for the rest
 */
export function entryIcon(entry: { name: string; icon?: string | null; logo?: string }, size: "md" | "xl"): string {
  return entryMark(entry, size) ?? iconHTML(entry.name, null, size);
}

type MarkEntry = { name: string; icon?: string | null; logo?: string };

/** Which of our own marks an app is drawn with (its given icon, else the one its name says); null when it has none of ours. */
const markIcon = (entry: MarkEntry): ServiceIconId | null => (isIcon(entry.icon) ? entry.icon : serviceIconOf({ name: entry.name }));

/**
 * The marks of the Connections pill: the connected apps' own first, in the order given, then, while fewer than `limit`
 * are drawn, the starters that are not connected, in their own order. Whether a starter is connected is read from the
 * mark both would be drawn with (never from a display name), so one app never stands twice; an app with no mark of its
 * own is left out and leaves no hole. The same apps give the same marks every time. `key` names the mark, for what reads it.
 */
export function pillMarks(connected: readonly MarkEntry[], starters: readonly MarkEntry[], limit = 3): { key: string; html: string }[] {
  const drawn: { key: string; html: string }[] = [], icons = new Set<string>();
  for (const entry of connected) {
    const html = entryMark(entry, "md");
    if (!html) continue;
    const icon = markIcon(entry);
    drawn.push({ key: icon ?? entry.name.trim().toLowerCase(), html });
    if (icon) icons.add(icon);
  }
  const marks = drawn.slice(0, limit);
  for (const starter of starters) {
    if (marks.length >= limit) break;
    const icon = markIcon(starter), html = entryMark(starter, "md");
    if (icon && html && !icons.has(icon)) { marks.push({ key: icon, html }); icons.add(icon); }
  }
  return marks;
}

/** The app's own mark (ours, else the catalogue's picture, the one source every place draws it from), or null where only
 *  the generic mark would stand: a row of marks leaves such an app out rather than show the generic one. */
export function entryMark(entry: MarkEntry, size: "md" | "xl"): string | null {
  const known = markIcon(entry);
  if (known) return iconHTML(entry.name, known, size);
  const logo = pluginLogoURL(entry.logo);
  return logo ? `<span class="mono ${size} logo-art"><img class="logo" src="${esc(logo)}" alt="" referrerpolicy="no-referrer" loading="lazy"></span>` : null;
}
