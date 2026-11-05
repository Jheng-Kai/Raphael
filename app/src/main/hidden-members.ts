import { missingHTML } from "./missing";
import * as api from "./api";
import { describeError } from "./format";
import { getLocale, t } from "./i18n";
import type { Member, Room } from "./types";
import { btn, esc, row, toaster } from "./ui";

/** The members and the group chats taken off the sidebar, each with the way back: a hidden group had none and was lost. */
export function createHiddenMembers(): { load(): Promise<void>; mount(root: HTMLElement): void } {
  let members: Member[] = [];
  let rooms: Room[] = [];
  let root: HTMLElement | null = null;
  let epoch = 0;
  let failed = false;
  const restoreRow = (name: string, attrs: string): string => row(esc(name), "", btn(esc(t("members.sideRestore")), "sm", attrs));
  function draw(): void {
    const slot = root?.querySelector<HTMLElement>("[data-hidden-members]");
    if (!slot) return;
    const rows = members.map(member => restoreRow(member.name, ` data-restore-member="${member.id}"`)).join("") +
      rooms.map(room => restoreRow(room.name, ` data-restore-room="${room.id}"`)).join("");
    // The same section and rows as the rest of Settings; a failed read is the shared note with its retry beside it.
    slot.innerHTML = `<h2>${esc(t("members.sideHidden"))}</h2>` + (failed
      ? missingHTML({ resource: "app", requirement: "hidden", state: "missing", repair: null }, undefined, btn(esc(t("page.retry")), "sm", ' data-hidden-retry'))
      : `<div class="slist">${rows || row(esc(t("members.sideNoHidden")))}</div>`);
    slot.onclick = event => {
      if ((event.target as Element).closest("[data-hidden-retry]")) { void load(); return; }
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-restore-member], [data-restore-room]");
      if (!button) return;
      button.disabled = true;
      const restored = button.dataset.restoreRoom !== undefined
        ? api.roomsUpdate(Number(button.dataset.restoreRoom), { hidden: false })
        : api.membersUpdate(Number(button.dataset.restoreMember), { hidden: false });
      void restored.then(load).catch(error => { button.disabled = false; toaster.info(describeError(error)); });
    };
  }
  async function load(): Promise<void> {
    const mine = ++epoch;
    try {
      const list = await api.membersList(getLocale());
      const groups = await api.roomsList();
      if (mine !== epoch) return;
      failed = false;
      members = list?.members?.filter(member => member.id !== 0 && member.hidden) ?? [];
      rooms = groups?.rooms?.filter(room => room.hidden) ?? [];
      draw();
    } catch { if (mine === epoch) { failed = true; draw(); } }
  }
  return { load, mount(next) { root = next; draw(); } };
}
