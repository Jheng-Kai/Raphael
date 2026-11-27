// The picture picker of a slime's face, shared by the details panel and the member settings page: the slimes, in the
// slime's colours. Raphael has none: its face is the first blue slime, always.
import { openAvatarPicker } from "./member-dialogs";
import { defaultSlimeAvatar } from "./slime";
import type { Member, MemberPatch } from "./types";

export function openMemberAvatarMenu(anchor: HTMLElement, member: Member, update: (id: number, patch: MemberPatch) => Promise<boolean>): void {
  openAvatarPicker(anchor, {
    slimes: true,
    current: member.avatar || defaultSlimeAvatar(member.id),
    onSlime: (avatar) => void update(member.id, { avatar }),
  });
}
