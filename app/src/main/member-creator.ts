// 新增成員 as a character maker: the slime large in the middle, a colour or a character under it, a name, and a few
// members to start from. It stands where the conversation stands, with the sidebar beside it. The member then opens and
// asks what it is for (the core's greeting), and the owner's answer becomes its job: nothing else is asked here.
import "./member-creator.css";
import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import { type Dialog, openDialog } from "./member-dialogs";
import { memberPreset, presetChoices, presetCommand, presetSlime, type ProfilePreset } from "./member-profile-presets";
import { NAME_MAX, cleanName, isMemberNameTaken } from "./members";
import { bareSlimeHTML, defaultSlimeAvatar, pickSlime, slimeCharactersHTML, slimeColorsHTML, slimeFaceHTML } from "./slime";
import type { Member, NewMember } from "./types";
import { btn, esc, toaster } from "./ui";

const FACE_SIZE = 120, ARRIVING_MS = 700;

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
  let preset: ProfilePreset = "custom";
  let busy = false;
  let filledIn = "";
  let hop: ReturnType<typeof setTimeout> | undefined;

  const suggestions = presetChoices().filter(choice => choice.value !== "custom").map(choice => {
    const fields = memberPreset(choice.value);
    return btn(`<span class="cr-card-face">${bareSlimeHTML(presetSlime(choice.value))}</span><span class="cr-card-text"><b>${esc(choice.label)}</b><small>${esc(fields.blurb ?? "")}</small></span>`,
      "cr-suggestion", ` data-dlg="preset" data-preset="${choice.value}" aria-pressed="false"`);
  }).join("");

  const dialog = openDialog({
    title: t("members.newMember"),
    cls: "cr-dialog",
    body: `<div class="cr-maker"><div class="cr-face"></div>` +
      `<div class="cr-colors" role="group" aria-label="${esc(t("members.creator.colors"))}">${slimeColorsHTML(avatar, esc)}</div>` +
      `<div class="cr-characters" role="group" aria-label="${esc(t("members.creator.characters"))}">${slimeCharactersHTML(avatar, esc)}</div>` +
      `<div class="cr-fields"><label class="mp-label" for="mb-new-name"><span>${esc(t("members.name"))}</span><input id="mb-new-name" class="mb-fin" maxlength="${NAME_MAX}" autocomplete="off"></label></div>` +
      `<div class="cr-start">${btn(esc(t("members.create")), "pri", ' data-dlg="create" disabled')}</div></div>` +
      `<section class="cr-suggestions"><h3>${esc(t("members.creator.suggestions"))}</h3><div class="cr-suggestion-list">${suggestions}</div></section>`,
    actions: {},
    canClose: () => !busy,
    onAct(act, target) {
      if (busy) return;
      if (act === "create") void create();
      else if (act === "preset") choosePreset(target.dataset.preset as ProfilePreset);
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

  /** A start names the member and looks the part, unless the owner has typed a name; pressing it again takes that back. */
  function choosePreset(next: ProfilePreset): void {
    const leaving = preset === next;
    preset = leaving ? "custom" : next;
    for (const card of dialog.el.querySelectorAll<HTMLElement>(".cr-suggestion")) card.setAttribute("aria-pressed", String(card.dataset.preset === preset));
    if (!cleanName(name.value) || name.value === filledIn) {
      filledIn = leaving ? "" : memberPreset(preset).role ?? "";
      name.value = filledIn;
    }
    if (!leaving) setAvatar(presetSlime(preset));
    nameChanged();
    name.focus();
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
      const made = await o.create({ ...memberPreset(preset), name: wanted, group_id: o.groupId, avatar, greet: true });
      if (!made) return;
      const command = presetCommand(preset);
      // The member exists by now: a starter command that fails is said, and does not hold the maker open.
      if (command) await api.membersCommandsSave(made.id, command).catch(error => toaster.info(describeError(error)));
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
  return dialog;
}
