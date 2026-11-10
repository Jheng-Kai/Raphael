// The picture picker of a member's face, shared by the details panel and the member settings page: the slimes for a
// member, the owner's own picture from the PC for Raphael.
import { changeRaphaelAvatar, resetRaphaelAvatar } from "./avatar-settings";
import { currentAvatar } from "./avatar";
import { t } from "./i18n";
import { openAvatarPicker } from "./member-dialogs";
import { RAPHAEL_ID } from "./members";
import { defaultSlimeAvatar } from "./slime";
import type { Member, MemberPatch } from "./types";

export function openMemberAvatarMenu(anchor: HTMLElement, member: Member, update: (id: number, patch: MemberPatch) => Promise<boolean>): void {
  if (member.id === RAPHAEL_ID) {
    openAvatarPicker(anchor, {
      onComputer: () => void changeRaphaelAvatar(),
      more: currentAvatar() !== null ? [{ label: t("settings.avatarReset"), run: () => void resetRaphaelAvatar() }] : [],
    });
    return;
  }
  openAvatarPicker(anchor, {
    slimes: true,
    current: member.avatar || defaultSlimeAvatar(member.id),
    onSlime: (avatar) => void update(member.id, { avatar }),
  });
}
