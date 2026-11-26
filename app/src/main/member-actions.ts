// Shared member actions for the column and the team board.
import { askInChat } from "./chat-ask";
import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import { confirmDelete, groupChoices, groupFromValue, groupValue } from "./member-dialogs";
import { RAPHAEL_ID, fallbackMemberId, memberOf, orderedMembers, pinReplacements, primaryIdOf } from "./members";
import { openPrimaryPicker } from "./primary-picker";
import type { Member, MemberPatch, MembersList } from "./types";
import { openMenu, toaster } from "./ui";

interface MemberActionHost {
  list(): MembersList | null;
  current(): number;
  select(id: number): void;
  load(): Promise<void>;
  update(id: number, patch: MemberPatch): Promise<boolean>;
  deleted(id: number): void;
}

export function createMemberActions(host: MemberActionHost) {
  /** Changing a member is done with it in its conversation: the menu opens it and asks there. */
  function editMember(m: Member): void {
    host.select(m.id);
    askInChat(m.id, "settings");
  }

  async function memberAction(id: number, action: string): Promise<void> {
    // Raphael is not a slime of the list: it cannot be pinned, hidden, grouped, deleted or made the chief.
    const m = id === RAPHAEL_ID ? undefined : memberOf(host.list(), id);
    if (!m) return;
    if (action === "primary") return choosePrimary();
    if (action === "replace-pinned") return replacePinned(id);
    if (action === "edit") return editMember(m);
    try {
      // Sharing is the member packaging itself in its conversation, as the panel's share does.
      if (action === "export-template") { host.select(id); askInChat(id, "share-template"); return; }
      if (action === "pin") await host.update(id, {pinned: !m.pinned});
      else if (action === "hide") {
        // Hidden members wait in the sidebar's hidden folder, where the same item brings them back (R-UI-112).
        await api.membersUpdate(id, {hidden: !m.hidden});
        if (!m.hidden && host.current() === id) host.select(fallbackMemberId(host.list(), id));
        await host.load();
      } else if (action === "unread") {
        await api.core("members.unread", {id});
        // Marking the open conversation unread moves away so viewing does not immediately clear it.
        if (host.current() === id) host.select(fallbackMemberId(host.list(), id));
        await host.load();
      }
    } catch (err) { toaster.info(describeError(err)); }
  }

  /** 換成其他角色 on the primary's menu: choose who takes over, without changing the chief or existing conversations. */
  async function choosePrimary(): Promise<void> {
    const list = host.list();
    if (!list) return;
    const now = primaryIdOf(list);
    const candidates = orderedMembers(list).filter((m) => m.id !== now);
    const chosen = await openPrimaryPicker({ members: candidates });
    if (chosen === null || chosen === now) return;
    try {
      await api.membersSetPrimary(chosen);
    } catch (err) {
      toaster.info(describeError(err));
    }
    await host.load();
  }

  /**
   * 換成其他角色 on a pinned tile: the member chosen takes
   * exactly this tile's place and this member goes back to its folder or list, where it stood before it was pinned. One press
   * on a member, no question; doing it the other way round puts everything back. The tile's place is a place in the roster's
   * order, so the member chosen is set at the old one's position before the old one is unpinned: the old member keeps its own
   * position and group, and nothing else moves in the pinned row.
   */
  async function replacePinned(id: number): Promise<void> {
    const list = host.list(), old = memberOf(list, id);
    if (!list || !old?.pinned) return;
    const chosen = await openPrimaryPicker({ members: pinReplacements(list), title: t("members.sideReplacePrimary"), immediate: true });
    if (chosen === null) return;
    // The roster may have changed while the window was open: the tile must still be this member's.
    const now = host.list(), tile = memberOf(now, id), next = memberOf(now, chosen);
    if (!tile?.pinned || !next || next.pinned) return;
    try {
      await api.membersUpdate(chosen, { pinned: true, position: tile.position });
      await api.membersUpdate(id, { pinned: false });
    } catch (err) {
      toaster.info(describeError(err));
    }
    await host.load();
  }

  function moveMember(id: number, anchor: HTMLElement): void {
    const list = host.list();
    const m = list?.members.find((other) => other.id === id);
    if (!m || !list) return;
    openMenu(anchor, groupChoices([...list.groups].sort((a, b) => a.position - b.position)), groupValue(m.group_id), (value) => {
      const groupId = groupFromValue(value);
      if (groupId !== m.group_id) void host.update(id, { group_id: groupId });
    }, undefined, [], { placement: "beside" });
  }

  async function deleteMember(id: number): Promise<void> {
    const list = host.list();
    const m = id === RAPHAEL_ID ? undefined : list?.members.find((other) => other.id === id);
    if (!m) return;
    if (!(await confirmDelete(m.name, { member: true }))) return;
    try {
      await api.membersDelete(id);
    } catch (err) {
      toaster.info(describeError(err));
      return;
    }
    host.deleted(id);
    if (host.current() === id) host.select(fallbackMemberId(host.list(), id));
    await host.load();
  }

  return { editMember, memberAction, moveMember, deleteMember, update: host.update };
}
