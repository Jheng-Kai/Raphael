// 新增成員 as a character maker: the slime large in the middle, a colour or a character under it, and a name. It stands
// where the conversation stands, with the sidebar beside it. The member then opens and asks what it is for (the core's
// greeting), and the owner's answer becomes its job: nothing else is asked here.
import "./member-creator.css";
import { openTemplateGallery } from "./member-templates";
import { mountMemberStore } from "./member-store";
import { t } from "./i18n";
import { type Dialog, openDialog } from "./member-dialogs";
import { NAME_MAX, cleanName, isMemberNameTaken } from "./members";
import { defaultSlimeAvatar, pickSlime, slimeCharactersHTML, slimeColorsHTML, slimeFaceHTML } from "./slime";
import type { Member, NewMember } from "./types";
import { btn, esc, tabs, toaster } from "./ui";

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
  let storeMounted = false;
  const tabItems = [{id:"maker", label:t("members.newMember")}, {id:"store", label:t("store.title")}];
  const tabHTML = (selected: string): string => tabs(tabItems.map(item => ({...item, attrs:` data-dlg="creator-tab" data-tab="${item.id}" aria-controls="creator-${item.id}"`})), selected, {kind:"nav", plain:true, fill:true, label:t("members.newMember")});

  const dialog = openDialog({
    title: t("members.newMember"),
    cls: "cr-dialog",
    body: `<div class="cr-tabs mb-tabs">${tabHTML("maker")}</div><div class="cr-maker" id="creator-maker" role="tabpanel"><div class="cr-face"></div>` +
      `<div class="cr-colors" role="group" aria-label="${esc(t("members.creator.colors"))}">${slimeColorsHTML(avatar, esc)}</div>` +
      `<div class="cr-characters" role="group" aria-label="${esc(t("members.creator.characters"))}">${slimeCharactersHTML(avatar, esc)}</div>` +
      `<div class="cr-fields"><label class="mp-label" for="mb-new-name"><span>${esc(t("members.name"))}</span><input id="mb-new-name" class="mb-fin" maxlength="${NAME_MAX}" autocomplete="off"></label></div>` +
      `<div class="cr-start">${btn(esc(t("template.gallery")), "", ' data-dlg="templates"')}${btn(esc(t("members.create")), "pri", ' data-dlg="create" disabled')}</div></div><section class="member-store" id="creator-store" role="tabpanel" hidden></section>`,
    actions: {},
    canClose: () => !busy,
    onAct(act, button) {
      if (!busy && act === "create") void create();
      if (!busy && act === "templates") openTemplateGallery(o.create, o.groupId, () => dialog.close());
      if (!busy && act === "creator-tab") selectTab(button.dataset.tab!);
    },
    onEnter() { if (!name.closest("[hidden]")) void create(); },
    onClose() { clearTimeout(hop); },
  });
  dialog.el.closest(".mb-scrim")!.classList.add("cr-scrim");

  const name = dialog.el.querySelector<HTMLInputElement>("#mb-new-name")!;
  const start = dialog.el.querySelector<HTMLButtonElement>('[data-dlg="create"]')!;

  function selectTab(tab: string): void {
    const store = dialog.el.querySelector<HTMLElement>(".member-store")!;
    dialog.el.querySelector<HTMLElement>(".cr-maker")!.hidden = tab !== "maker";
    store.hidden = tab !== "store";
    dialog.el.querySelector(".cr-tabs")!.innerHTML = tabHTML(tab);
    if (tab === "store" && !storeMounted) {
      storeMounted = true;
      mountMemberStore(store, o.create, o.groupId, () => dialog.close());
    }
    // The maker is taller than the window, so the name field below the fold must take the focus without scrolling the page: a scroll would
    // carry the tab row (which sits inside the same scroller) out of sight under the pointer that just clicked it.
    dialog.el.querySelector<HTMLInputElement>(tab === "store" ? "[data-store-search]" : "#mb-new-name")!.focus({ preventScroll: true });
  }

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
  name.focus({ preventScroll: true });
  if (o.store) selectTab("store");
  return dialog;
}
