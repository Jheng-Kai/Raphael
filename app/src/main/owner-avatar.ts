/** One owner identity for account settings, the sidebar and outgoing messages. */
import { t } from "./i18n";
import type { BrainSettings } from "./types";
import { esc, ico } from "./ui";

let profile: Pick<BrainSettings, "owner_name" | "owner_photo"> = {};
const listeners = new Set<() => void>();
export function setOwnerProfile(settings: BrainSettings): void {
  profile = { owner_name: settings.owner_name, owner_photo: settings.owner_photo };
  document.querySelectorAll(".me > .owner-face").forEach(face => { face.outerHTML = ownerFaceHTML(); });
  for (const listener of listeners) listener();
}
export const onOwnerProfile = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const ownerName = (): string => profile.owner_name?.trim() || t("chat.you");
export function ownerFaceHTML(size = 30, photo = profile.owner_photo): string {
  return `<span class="owner-face" style="--owner-face:${size}px" aria-hidden="true">${photo ? `<img src="${esc(photo)}" alt="">` : ico("person")}</span>`;
}
