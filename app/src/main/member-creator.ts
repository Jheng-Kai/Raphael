// 新增成員, as Grok Bot's Create New Bot (owner, 2026-11-11: 「為什麼這麼寬呢？…要盡量減少顯示在前端的事情」): one small dialog over the
// dimmed window. The slime as it will be, large; the name directly under it, the only thing asked; the same tabbed slime picker the
// face popover uses (slime-tabs.ts), then 取消 and 建立. The member then opens and asks what it is for (the core's greeting), and the
// owner's answer becomes its job: nothing else is asked here. The store and the templates have their own entry (member-store.ts).
import "./member-creator.css";
import { t } from "./i18n";
import { type Dialog, openDialog } from "./member-dialogs";
import { NAME_MAX, cleanName, isMemberNameTaken } from "./members";
import { defaultSlimeAvatar, pickSlime, slimeFaceHTML } from "./slime";
import { selectSlimeTab, slimeKeys, slimePickerHTML } from "./slime-tabs";
import type { Member, NewMember } from "./types";
import { btn, esc } from "./ui";

const FACE_SIZE = 96, ARRIVING_MS = 700;

export interface MemberCreatorOptions {
  /** The group it starts in (the one the menu was opened from), null for 未分組. */
  groupId: number | null;
  /** The names already taken (the names are unique). */
  taken: readonly string[];
  /** Makes the member: what it became, or null when it could not, which was said. */
  create(member: NewMember): Promise<Member | null>;
}

export function openMemberCreator(o: MemberCreatorOptions): Dialog {
  let avatar = defaultSlimeAvatar(o.taken.length);
  let busy = false;
  let hop: ReturnType<typeof setTimeout> | undefined;

  const dialog = openDialog({
    title: t("members.newMember"),
    cls: "cr-dialog mb-confirm",
    body: `<div class="cr-face"></div>` +
      `<input id="mb-new-name" class="mb-fin cr-name" maxlength="${NAME_MAX}" placeholder="${esc(t("members.name"))}" aria-label="${esc(t("members.name"))}" autocomplete="off" spellcheck="false">` +
      // A name another member has is refused here, in the owner's words, and goes when the name is typed again.
      `<p class="note field-error" role="alert" hidden></p>` +
      // The picker's rules belong to `.menu.mb-avpop` (slime.css); the dialog stands it in its body unchanged and takes off only the popover's chrome.
      `<div class="menu mb-avpop cr-picker" role="group" aria-label="${esc(t("settings.avatar"))}">${slimePickerHTML(avatar, esc)}</div>`,
    actions: {
      secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'),
      primary: { label: esc(t("members.create")), attrs: ' data-dlg="create" disabled' },
    },
    canClose: () => !busy,
    onAct(act) {
      if (busy) return;
      if (act === "create") void create();
      else if (act === "cancel") dialog.close();
    },
    onEnter() { void create(); },
    onClose() { clearTimeout(hop); },
  });

  const name = dialog.el.querySelector<HTMLInputElement>("#mb-new-name")!;
  const start = dialog.el.querySelector<HTMLButtonElement>('[data-dlg="create"]')!;
  const cancel = dialog.el.querySelector<HTMLButtonElement>('[data-dlg="cancel"]')!;
  const picker = dialog.el.querySelector<HTMLElement>(".cr-picker")!;
  const refusal = dialog.el.querySelector<HTMLElement>(".field-error")!;

  function drawFace(arriving: boolean): void {
    const face = dialog.el.querySelector<HTMLElement>(".cr-face")!;
    face.innerHTML = slimeFaceHTML({ id: -1, avatar }, FACE_SIZE);
    if (!arriving) return;
    const svg = face.querySelector<SVGElement>("svg.slime")!;
    svg.dataset.state = "arriving";
    clearTimeout(hop);
    hop = setTimeout(() => { svg.dataset.state = "idle"; }, ARRIVING_MS);
  }

  function nameChanged(): void {
    start.disabled = busy || !cleanName(name.value);
    name.removeAttribute("aria-invalid");
    refusal.hidden = true;
  }

  async function create(): Promise<void> {
    if (busy) return;
    const wanted = cleanName(name.value);
    if (!wanted) return;
    if (isMemberNameTaken(wanted, o.taken)) {
      name.setAttribute("aria-invalid", "true");
      refusal.textContent = t("members.nameTaken", { p0: wanted });
      refusal.hidden = false;
      name.focus();
      return;
    }
    busy = true;
    start.disabled = true;
    cancel.disabled = true;
    start.textContent = t("members.creating");
    try {
      // A refusal is said by whoever refused it (the core's words, or the unique-name rule): the dialog stays, with what was typed.
      const made = await o.create({ name: wanted, group_id: o.groupId, avatar, greet: true });
      if (!made) return;
      busy = false;
      dialog.close();
    } finally {
      busy = false;
      if (dialog.el.isConnected) {
        cancel.disabled = false;
        start.textContent = t("members.create");
        nameChanged();
      }
    }
  }

  picker.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("button");
    if (!button || busy) return;
    // A tab shows its group in the place the others stand in; the chip row's arrows scroll the row (chip-scroll.ts).
    if (button.dataset.slimeTab) { selectSlimeTab(picker, button.dataset.slimeTab); return; }
    const next = pickSlime(button);
    if (!next) return;
    avatar = next;
    drawFace(true);
  });
  picker.addEventListener("keydown", event => { if (slimeKeys(picker, event)) event.preventDefault(); });
  name.addEventListener("input", nameChanged);
  drawFace(false);
  name.focus({ preventScroll: true });
  return dialog;
}
