/** Shared owner profile and appearance controls. */
import * as api from "./api";
import { t } from "./i18n";
import type { BrainSettings } from "./types";
import { btn, esc, toaster } from "./ui";
import { describeError } from "./format";
import { ownerFaceHTML, setOwnerProfile } from "./owner-avatar";
import { openAvatarPicker, pickPicture, readPicture } from "./member-dialogs";
import { cropDialog } from "./avatar-settings";
import { croppedMemberPicture } from "./member-profile-resources";
import { isPictureUrl } from "./members";
import "./owner-settings.css";

export function applyAppearance(appearance: "system" | "light" | "dark", systemDark: boolean): void {
  document.documentElement.dataset.theme = appearance === "system" ? systemDark ? "dark" : "light" : appearance;
}
export function ownerProfileHTML(brain: BrainSettings | null): string {
  return `<section class="sgroup owner-profile"><h2>${esc(t("owner.profile"))}</h2><div class="slist">` +
    `<div class="owner-photo-row"><span class="owner-photo-label">${esc(t("settings.avatar"))}</span>${btn(ownerFaceHTML(64, brain?.owner_photo), "owner-photo", ` data-owner-photo aria-label="${esc(t("settings.avatar"))}"${brain ? "" : " disabled"}`)}</div>` +
    `<label>${esc(t("owner.name"))}<input class="field" data-owner="owner_name" maxlength="100" value="${esc(brain?.owner_name ?? "")}" ${brain ? "" : "disabled"}></label>` +
    `<label>${esc(t("owner.about"))}<textarea class="field" rows="4" data-owner="owner_about" maxlength="4000" ${brain ? "" : "disabled"}>${esc(brain?.owner_about ?? "")}</textarea></label></div></section>`;
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
        void api.membersPresets().then(({ presets }) => openAvatarPicker(photo, {
          presets,
          more: [{ label: t("settings.avatarReset"), run: () => set("owner_photo", "") }],
          onPreset(next) {
            const url = presets.find(p => p.avatar === next)?.url;
            if (!isPictureUrl(url)) return;
            const file = { name: "avatar.png", mime: url.slice(5, url.indexOf(";")), data: url.slice(url.indexOf(",") + 1) };
            void croppedMemberPicture(file, { x: 0.5, y: 0.5, zoom: 1 }, 192, "image/webp").then(cropped => {
              set("owner_photo", `data:${cropped.mime};base64,${cropped.data}`);
            }).catch(error => toaster.info(describeError(error)));
          },
          onComputer: () => pickPicture(file => { void (async () => {
            const read = await readPicture(file); if (!read) return;
            const crop = await cropDialog(`data:${read.mime};base64,${read.data}`); if (!crop) return;
            const cropped = await croppedMemberPicture(read, crop, 192, "image/webp");
            set("owner_photo", `data:${cropped.mime};base64,${cropped.data}`);
          })().catch(error => toaster.info(describeError(error))); }),
        })).catch(error => toaster.info(describeError(error)));
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
