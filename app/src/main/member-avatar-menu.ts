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
      // A slime chosen stands in place of the owner's picture, which would hide it. The slime is saved first and the picture
      // goes only once it is: a save that fails keeps the owner's picture, and a picture chosen while it was saving is the
      // newer choice and stays. Clearing the picture says so (onAvatarChange), and every face is drawn again.
      onSlime: (avatar) => void (async () => {
        const picture = currentAvatar();
        if (!(await update(member.id, { avatar }))) return;
        if (picture !== null && currentAvatar() === picture) await resetRaphaelAvatar();
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
