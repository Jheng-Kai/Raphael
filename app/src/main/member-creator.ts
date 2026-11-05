// 新增成員 as a character maker: the slime large in the middle, a colour or a character under it, and a name. It stands
// where the conversation stands, with the sidebar beside it. The member then opens and asks what it is for (the core's
// greeting), and the owner's answer becomes its job: nothing else is asked here.
import "./member-creator.css";
import { openTemplateGallery } from "./member-templates";
import { openMemberStore } from "./member-store";
import { t } from "./i18n";
import { type Dialog, openDialog } from "./member-dialogs";
import { NAME_MAX, cleanName, isMemberNameTaken } from "./members";
import { defaultSlimeAvatar, pickSlime, slimeCharactersHTML, slimeColorsHTML, slimeFaceHTML } from "./slime";
import type { Member, NewMember } from "./types";
import { btn, esc, toaster } from "./ui";

const FACE_SIZE = 120, ARRIVING_MS = 700;

export interface MemberCreatorOptions {
  /** The group it starts in (the one the menu was opened from), null for 未分組. */
  groupId: number | null;
  /** The names already taken (the names are unique). */
  taken: readonly string[];
  store?: boolean;
  /** Makes the member: what it became, or null when it could not, which was said. */
  create(member: NewMember): Promise<Member | null>;
}

export function openMemberCreator(o: MemberCreatorOptions): Dialog {
  let avatar = defaultSlimeAvatar(o.taken.length);
  let busy = false;
  let hop: ReturnType<typeof setTimeout> | undefined;

  const dialog = openDialog({
    title: t("members.newMember"),
    cls: "cr-dialog",
    body: `<div class="cr-tabs" role="tablist" aria-label="${esc(t("members.newMember"))}">${btn(esc(t("members.newMember")), "sm", ' role="tab" aria-selected="true"')}${btn(esc(t("store.title")), "sm", ' data-dlg="store" role="tab" aria-selected="false"')}</div><div class="cr-maker"><div class="cr-face"></div>` +
      `<div class="cr-colors" role="group" aria-label="${esc(t("members.creator.colors"))}">${slimeColorsHTML(avatar, esc)}</div>` +
      `<div class="cr-characters" role="group" aria-label="${esc(t("members.creator.characters"))}">${slimeCharactersHTML(avatar, esc)}</div>` +
      `<div class="cr-fields"><label class="mp-label" for="mb-new-name"><span>${esc(t("members.name"))}</span><input id="mb-new-name" class="mb-fin" maxlength="${NAME_MAX}" autocomplete="off"></label></div>` +
      `<div class="cr-start">${btn(esc(t("template.gallery")), "", ' data-dlg="templates"')}${btn(esc(t("members.create")), "pri", ' data-dlg="create" disabled')}</div></div>`,
    actions: {},
    canClose: () => !busy,
    onAct(act) {
      if (!busy && act === "create") void create();
      if (!busy && act === "templates") openTemplateGallery(o.create, o.groupId, () => dialog.close());
      if (!busy && act === "store") openMemberStore(o.create, o.groupId, () => dialog.close());
    },
    onEnter() { void create(); },
    onClose() { clearTimeout(hop); },
  });
  dialog.el.closest(".mb-scrim")!.classList.add("cr-scrim");

  const name = dialog.el.querySelector<HTMLInputElement>("#mb-new-name")!;
  const start = dialog.el.querySelector<HTMLButtonElement>('[data-dlg="create"]')!;

  function drawFace(arriving: boolean): void {
    const face = dialog.el.querySelector<HTMLElement>(".cr-face")!;
    face.innerHTML = slimeFaceHTML({ id: -1, avatar }, FACE_SIZE);
    if (!arriving) return;
    const svg = face.querySelector<SVGElement>("svg.slime")!;
    svg.dataset.state = "arriving";
    clearTimeout(hop);
    hop = setTimeout(() => { svg.dataset.state = "idle"; }, ARRIVING_MS);
  }

  function nameChanged(): void { start.disabled = !cleanName(name.value); }

  function setAvatar(next: string): void {
    avatar = next;
    for (const other of dialog.el.querySelectorAll<HTMLElement>("[data-slime-character], [data-slime-color]")) {
      other.setAttribute("aria-pressed", String(next === (other.dataset.slimeCharacter ? `slime:${other.dataset.slimeCharacter}` : `slime:color:${other.dataset.slimeColor}`)));
    }
    drawFace(true);
  }

  async function create(): Promise<void> {
    if (busy) return;
    const wanted = cleanName(name.value);
    if (!wanted || isMemberNameTaken(wanted, o.taken)) {
      name.focus();
      toaster.info(wanted ? t("members.nameTaken", { p0: wanted }) : t("members.nameEmpty"));
      return;
    }
    busy = true;
    start.disabled = true;
    try {
      const made = await o.create({ name: wanted, group_id: o.groupId, avatar, greet: true });
      if (!made) return;
      busy = false;
      dialog.close();
    } finally {
      busy = false;
      if (dialog.el.isConnected) nameChanged();
    }
  }

  dialog.el.querySelector(".cr-maker")!.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("[data-slime-character], [data-slime-color]");
    const next = button && !busy ? pickSlime(button) : null;
    if (next) setAvatar(next);
  });
  name.addEventListener("input", nameChanged);
  drawFace(false);
  name.focus();
  if (o.store) openMemberStore(o.create, o.groupId, () => dialog.close());
  return dialog;
}
