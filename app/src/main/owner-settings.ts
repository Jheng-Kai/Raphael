/** Shared owner profile and appearance controls. */
import * as api from "./api";
import { t } from "./i18n";
import type { BrainSettings } from "./types";
import { btn, esc, ico, toaster } from "./ui";
import { describeError } from "./format";
import { ownerFaceHTML, setOwnerProfile } from "./owner-avatar";
import { pickPicture, readPicture } from "./member-dialogs";
import { cropDialog } from "./avatar-settings";
import { croppedMemberPicture } from "./member-profile-resources";
import "./owner-settings.css";

export function applyAppearance(appearance: "system" | "light" | "dark", systemDark: boolean): void {
  document.documentElement.dataset.theme = appearance === "system" ? systemDark ? "dark" : "light" : appearance;
}
export function ownerProfileHTML(brain: BrainSettings | null): string {
  return `<section class="sgroup owner-profile" aria-label="${esc(t("owner.profile"))}"><div class="slist">` +
    // The photo is the button: under the pointer a pencil shows on it, and a press goes straight to the file dialog
    // (no menu, no reset).
    btn(ownerFaceHTML(72, brain?.owner_photo) + `<span class="owner-photo-edit" aria-hidden="true">${ico("pencil")}</span>`, "owner-photo", ` data-owner-photo aria-label="${esc(t("members.changeAvatar"))}"${brain ? "" : " disabled"}`) +
    `<div class="owner-fields"><label>${esc(t("owner.name"))}<input class="field" data-owner="owner_name" maxlength="100" value="${esc(brain?.owner_name ?? "")}" ${brain ? "" : "disabled"}></label>` +
    `<label>${esc(t("owner.about"))}<textarea class="field" rows="4" data-owner="owner_about" maxlength="4000" ${brain ? "" : "disabled"}>${esc(brain?.owner_about ?? "")}</textarea></label></div></div></section>`;
}
export function createOwnerControls(saved: (settings: BrainSettings) => void) {
  let writes = Promise.resolve();
  const set = (key: "owner_name" | "owner_about" | "owner_photo", value: string): void => {
    writes = writes.then(async () => { const settings = (await api.settingsSet(key, value)).settings; setOwnerProfile(settings); saved(settings); }).catch(error => toaster.info(describeError(error)));
  };
  return {
    click(target: Element): boolean {
      const photo = target.closest<HTMLElement>("[data-owner-photo]");
      if (photo) {
        pickPicture(file => { void (async () => {
          const read = await readPicture(file); if (!read) return;
          const crop = await cropDialog(`data:${read.mime};base64,${read.data}`); if (!crop) return;
          const cropped = await croppedMemberPicture(read, crop, 192, "image/webp");
          set("owner_photo", `data:${cropped.mime};base64,${cropped.data}`);
        })().catch(error => toaster.info(describeError(error))); });
        return true;
      }
      return false;
    },
    async change(target: Element): Promise<void> {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (target.dataset.owner === "owner_name" || target.dataset.owner === "owner_about") set(target.dataset.owner, target.value);
      }
    },
  };
}
