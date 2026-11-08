import { pluginLogoURL } from "./plugins-data";
import { SERVICE_ICONS, brandStyle, hasLogo, serviceIconOf, serviceIconSVG, serviceLogoHTML, type ServiceIconId } from "./service-icons";
import { esc, ico } from "./ui";

const isIcon = (id: string | null | undefined): id is ServiceIconId => !!id && (id in SERVICE_ICONS || hasLogo(id as ServiceIconId));

/** One bare mark renderer for store entries, connected apps and conversation cards. */
export function iconHTML(_name: string, icon: ServiceIconId | null, size: "md" | "xl"): string {
  if (icon && hasLogo(icon)) return `<span class="mono ${size} logo-art">${serviceLogoHTML(icon)}</span>`;
  return icon && icon in SERVICE_ICONS
    ? `<span class="mono ${size} logo-mono"${brandStyle(icon)}>${serviceIconSVG(icon)}</span>`
    : `<span class="mono ${size}" aria-hidden="true">${ico("plug")}</span>`;
}

/** A service the app knows is drawn with its own mark in its brand colour; a catalogue's picture is only for the rest
 * (owner, 2026-11-08: Spotify's catalogue picture is black and vanished on the dark theme). */
export function entryIcon(entry: { name: string; icon?: string | null; logo?: string }, size: "md" | "xl"): string {
  const known = isIcon(entry.icon) ? entry.icon : serviceIconOf({ name: entry.name });
  if (known) return iconHTML(entry.name, known, size);
  const logo = pluginLogoURL(entry.logo);
  return logo
    ? `<span class="mono ${size} logo-art"><img class="logo" src="${esc(logo)}" alt="" referrerpolicy="no-referrer" loading="lazy"></span>`
    : iconHTML(entry.name, null, size);
}
