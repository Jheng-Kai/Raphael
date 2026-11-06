// Shared member actions for the column and the team board.
import { exportMemberTemplate } from "./member-templates";
import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import { confirmDelete, groupChoices, groupFromValue, groupValue, openEditMemberDialog } from "./member-dialogs";
import { RAPHAEL_ID, memberOf, orderedMembers, primaryIdOf } from "./members";
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
  function editMember(m: Member): void {
    openEditMemberDialog({groups: host.list()?.groups ?? [], taken: (host.list()?.members ?? []).filter(other => other.id !== m.id).map(other => other.name), update: host.update, saved: () => void host.load()}, m);
  }

  async function memberAction(id: number, action: string): Promise<void> {
    const m = memberOf(host.list(), id);
    if (!m) return;
    if (action === "primary") return choosePrimary();
    if (id === RAPHAEL_ID) {
      if (action === "pin") { await api.settingsSet("chief_pinned", !m.pinned).catch(error => toaster.info(describeError(error))); await host.load(); }
      return;
    }
    if (action === "edit") return editMember(m);
    try {
      if (action === "export-template") return await exportMemberTemplate(id);
      if (action === "pin") await host.update(id, {pinned: !m.pinned});
      else if (action === "hide") {
        await api.membersUpdate(id, {hidden: true});
        if (host.current() === id) host.select(RAPHAEL_ID);
        await host.load();
      } else if (action === "unread") {
        await api.core("members.unread", {id});
        // Marking the open conversation unread moves away so viewing does not immediately clear it.
        if (host.current() === id) host.select(RAPHAEL_ID);
        await host.load();
      }
    } catch (err) { toaster.info(describeError(err)); }
  }

  /** 換成其他成員 on the primary's menu: choose who takes over, without changing the chief or existing conversations. */
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
    const m = list?.members.find((other) => other.id === id);
    if (!m) return;
    const settings = await api.settingsGet().catch(() => null);
    const computerHost = settings?.settings.computer_ssh_alias;
    let removeComputer = false;
    if (!(await confirmDelete(m.name, { ...(settings ? { computerHost: computerHost ?? '' } : {}), removeComputer: value => { removeComputer = value; } }))) return;
    try {
      if (removeComputer) await api.membersDelete(id, true, computerHost ?? '');
      else await api.membersDelete(id);
    } catch (err) {
      toaster.info(describeError(err));
      return;
    }
    host.deleted(id);
    if (host.current() === id) host.select(RAPHAEL_ID);
    toaster.info(t("members.deleted", { p0: m.name }));
    await host.load();
  }

  return { editMember, memberAction, moveMember, deleteMember, update: host.update };
}
