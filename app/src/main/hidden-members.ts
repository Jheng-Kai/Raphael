import { noticeHTML } from "./missing";
import * as api from "./api";
import { describeError } from "./format";
import { getLocale, t } from "./i18n";
import type { Member } from "./types";
import { btn, esc, toaster } from "./ui";

export function createHiddenMembers(): { load(): Promise<void>; mount(root: HTMLElement): void } {
  let members: Member[] = [];
  let root: HTMLElement | null = null;
  let epoch = 0;
  let failed = false;
  function draw(): void {
    const slot = root?.querySelector<HTMLElement>("[data-hidden-members]");
    if (!slot) return;
    slot.innerHTML = `<h3>${esc(t("members.sideHidden"))}</h3>` + (failed ? noticeHTML("hidden") + btn(esc(t("page.retry")), "sm", ' data-hidden-retry') : members.length ? members.map(member =>
      `<div class="mb-hidden-row"><span>${esc(member.name)}</span>${btn(esc(t("members.sideRestore")), "sm", ` data-restore-member="${member.id}"`)}</div>`).join("") : `<p class="muted">${esc(t("members.sideNoHidden"))}</p>`);
    slot.onclick = event => {
      if ((event.target as Element).closest("[data-hidden-retry]")) { void load(); return; }
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-restore-member]");
      if (!button) return;
      button.disabled = true;
      void api.membersUpdate(Number(button.dataset.restoreMember), { hidden: false }).then(load)
        .catch(error => { button.disabled = false; toaster.info(describeError(error)); });
    };
  }
  async function load(): Promise<void> {
    const mine = ++epoch;
    try {
      const list = await api.membersList(getLocale());
      if (mine !== epoch) return;
      failed = false;
      members = list?.members?.filter(member => member.id !== 0 && member.hidden) ?? [];
      draw();
    } catch { if (mine === epoch) { failed = true; draw(); } }
  }
  return { load, mount(next) { root = next; draw(); } };
}
