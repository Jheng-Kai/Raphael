// The picture picker of a member's face, shared by the details panel and the member settings page: the slimes for every
// member, the first one too (the owner dressed it in the guide and may dress it again), and for the first member also the
// owner's own picture from the PC.
import { changeRaphaelAvatar, resetRaphaelAvatar } from "./avatar-settings";
import { currentAvatar } from "./avatar";
import { firstBotSlime } from "./first-bot";
import { t } from "./i18n";
import { openAvatarPicker } from "./member-dialogs";
import { RAPHAEL_ID } from "./members";
import { defaultSlimeAvatar } from "./slime";
import type { Member, MemberPatch } from "./types";

export function openMemberAvatarMenu(anchor: HTMLElement, member: Member, update: (id: number, patch: MemberPatch) => Promise<boolean>): void {
  if (member.id === RAPHAEL_ID) {
    openAvatarPicker(anchor, {
      slimes: true,
      current: firstBotSlime(member.avatar),
      // A slime chosen stands in place of the owner's picture, which would hide it: the picture goes first, so the roster that
      // comes back with the new slime draws it everywhere (the sidebar redraws on a roster that changed, not on a picture).
      onSlime: (avatar) => void (async () => {
        if (currentAvatar() !== null) await resetRaphaelAvatar();
        await update(member.id, { avatar });
      })(),
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
