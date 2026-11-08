// The picture picker of a member's face, shared by the details panel and the member settings page: the slimes and 生成
// for a member, the owner's own picture from the PC for Raphael.
import * as api from "./api";
import { changeRaphaelAvatar, resetRaphaelAvatar } from "./avatar-settings";
import { currentAvatar } from "./avatar";
import { t } from "./i18n";
import { openAvatarPicker } from "./member-dialogs";
import { RAPHAEL_ID, faceHTML } from "./members";
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
    generate: {
      memberId: member.id,
      face: faceHTML(member, 88),
      apply: async (file) => { await api.membersSetAvatar(member.id, file); },
    },
  });
}
