// The profile dialog of a member that exists. The footer owns member fields; explicit resource
// actions belong to the resource itself. A new member is made in member-creator.ts.
import { routineRunState, testRoutine } from "./routine-run";
import * as api from "./api";
import { openActions } from "./member-column";
import { defaultSlimeAvatar } from "./slime";
import { describeError } from "./format";
import { t } from "./i18n";
import { groupChoices, groupFromValue, groupValue, openAvatarPicker, openDialog, type Dialog } from "./member-dialogs";
import { mountMemberResources, type ResourceEditor } from "./member-profile-resources";
import { memberPreset, presetChoices, presetCommand, randomMemberName, type ProfilePreset } from "./member-profile-presets";
import { INSTRUCTIONS_MAX, NAME_MAX, PERSONALITY_MAX, ROLE_MAX, cleanName, faceHTML, isMemberNameTaken, routineSentenceHTML, routineStatus } from "./members";
import { MEMORY_MAX, memoryError, type MemoryDocument } from "./memory-view";
import type { Member, MemberGroup, MemberPatch, Routine } from "./types";
import { btn, esc, iconButton, openMenu, sel, tabs, tg, toaster } from "./ui";
import { openRoutineDialog } from "./routine-dialog";
import "./member-profile.css";

export type ProfileTab = "identity" | "soul" | "skills" | "memory" | "routines" | "permissions" | "voice";
const TAB_KEYS = { identity: "members.profile.identity", soul: "members.profile.soul", skills: "members.profile.skills", memory: "members.profile.memory", routines: "members.profile.routines", permissions: "members.profile.permissions", voice: "members.profile.voice" } as const;
const TABS: ProfileTab[] = ["identity", "soul", "skills", "memory", "routines", "permissions", "voice"];

export interface MemberProfileHost {
  groups: readonly MemberGroup[];
  taken: readonly string[];
  update?(id: number, patch: MemberPatch): Promise<boolean>;
  saved?(member: Member): void;
}

const field = (id: string, label: string, value: string, max: number): string => `<label class="mb-frow mp-label" for="${id}"><span>${esc(label)}</span><input id="${id}" class="mb-fin" maxlength="${max}" value="${esc(value)}" autocomplete="off"></label>`;
const area = (id: string, label: string, value: string, max: number, rows: number): string => `<label class="mb-frow mp-label" for="${id}"><span>${esc(label)}</span><textarea id="${id}" class="mb-fin mb-ta" maxlength="${max}" rows="${rows}">${esc(value)}</textarea></label>`;

export function openEditMemberDialog(host: MemberProfileHost, member: Member, initialTab: ProfileTab = "identity"): Dialog {
  let tab = initialTab;
  let busy = false;
  let alive = true;
  let groupId = member.group_id ?? null;
  let avatar = member.avatar ?? "";
  let preset: ProfilePreset = "custom";
  const voice = { voice: member.voice ?? "", read_aloud: member.read_aloud ?? false, notify: member.notify ?? false };
  let ask = member.ask_before_members ?? false;
  let draftFirst = member.draft_first ?? true;
  let reply = member.reply_style ?? "full";
  let memoryRevision = "";
  let memoryText = "";
  let routines: Routine[] = [];
  let memoryLoaded = false;
  let routinesLoaded = false;
  let resources: ResourceEditor | null = null;
  let voiceEditor: ResourceEditor | null = null;
  let suggestedCommand: ReturnType<typeof presetCommand> = null;
  const dialog = openDialog({
    title: t("members.profile.edit"),
    cls: "mb-new mp-dialog",
    body: `<div class="mp-layout"><nav class="member-profile-nav">${tabs(TABS.map(key => ({ id: key, label: t(TAB_KEYS[key]), attrs: ` id="mp-tab-${key}" aria-controls="mp-page-${key}" data-dlg="tab" data-tab="${key}"` })), tab, { kind: "nav", plain: true, label: t("members.profile.edit") })}</nav><div class="mp-pages">` +
      TABS.map(key => `<section class="mp-page" role="tabpanel" id="mp-page-${key}" aria-labelledby="mp-tab-${key}"${key === tab ? "" : " hidden"}>${pageHTML(key)}</section>`).join("") + `</div></div>`,
    actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("members.save")), attrs: ' data-dlg="save"' } },
    canClose: () => !busy,
    onAct(act, target) {
      if (busy) return;
      if (act === "cancel") dialog.close();
      else if (act === "save") void save();
      else if (act === "tab") selectTab(target.dataset.tab as ProfileTab);
      else if (act === "avatar") avatarMenu(target);
      else if (act === "group") openMenu(target, groupChoices(host.groups), groupValue(groupId), value => { groupId = groupFromValue(value); drawGroup(); });
      else if (act === "preset") openMenu(target, presetChoices(), preset, value => applyPreset(value as ProfilePreset));
      else if (act === "female" || act === "male") { nameInput.value = randomMemberName(act, host.taken); drawFace(); }
      else if (act === "reply") openMenu(target, [{ value: "full", label: t("members.profile.full") }, { value: "conversational", label: t("members.profile.conversational") }], reply, value => { reply = value as typeof reply; drawReply(); });
      else if (act === "ask") { ask = !ask; target.setAttribute("aria-checked", String(ask)); }
      else if (act === "draft") { draftFirst = !draftFirst; target.setAttribute("aria-checked", String(draftFirst)); }
      else if (act === "routine-add") routineForm();
      else if (act === "routine-menu") {
        const routine = routines.find(r => r.id === Number(target.dataset.id));
        if (routine) openActions(target, [{ id: "test", label: t(routineRunState(routine.id).running ? "routine.testing" : "routine.test"), icon: "play" }, { id: "edit", label: t("members.profile.editResource"), icon: "pencil" }, { id: "delete", label: t("members.profile.delete"), icon: "trash" }], choice => {
          if (choice === "test") { routineForm(routine); void testRoutine(routine.id); }
          else if (choice === "edit") routineForm(routine);
          else void resourceAction(async () => {
            await api.routinesDelete(routine.id);
            toaster.info(t("common.deleted"));
            await loadRoutines();
          });
        });
      }
      else if (act === "routine-toggle") void resourceAction(async () => {
        const routine = routines.find(r => r.id === Number(target.dataset.id))!;
        await api.routinesUpdate(routine.id, { enabled: !routine.enabled });
        await loadRoutines();
      });
      else if (act === "routine-retry") void loadRoutines();
    },
    onEnter() { if (tab === "identity") void save(); },
    onClose() { alive = false; resources?.destroy(); voiceEditor?.destroy(); },
  });
  const nameInput = dialog.el.querySelector<HTMLInputElement>("#mb-new-name")!;
  const disabledBeforeBusy = new Map<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement, boolean>();
  const value = (id: string): string => dialog.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!.value;
  const set = (id: string, text: string): void => { dialog.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!.value = text; };
  function pageHTML(key: ProfileTab): string {
    if (key === "identity") return `<section class="mp-card mp-fields"><h3>${esc(t("members.profile.identity"))}</h3><label class="mp-label"><span>${esc(t("members.profile.preset"))}</span><span class="mp-preset"></span></label>` +
      `<div class="mp-avatar"><span class="mb-new-av"></span>${btn(esc(t("members.changeAvatar")), "sm", ' data-dlg="avatar" aria-haspopup="menu" aria-expanded="false"')}</div>` +
      field("mb-new-name", t("members.name"), member.name, NAME_MAX) +
      `<div class="mp-name-actions">${btn(esc(t("members.profile.femaleName")), "sm", ' data-dlg="female"')}${btn(esc(t("members.profile.maleName")), "sm", ' data-dlg="male"')}</div>` +
      field("mb-new-role", t("members.role"), member.role ?? "", ROLE_MAX) + field("mp-blurb", t("members.profile.blurb"), member.blurb ?? "", 160) +
      `<div class="mb-frow mp-label"><span>${esc(t("members.group"))}</span><span class="mb-new-group"></span></div></section>`;
    if (key === "soul") return `<section class="mp-card mp-fields"><h3>${esc(t("members.profile.soul"))}</h3>` + area("mb-new-personality", t("members.personality"), member.personality ?? "", PERSONALITY_MAX, 4) +
      area("mb-new-instr", t("members.instructions"), member.instructions ?? "", INSTRUCTIONS_MAX, 8) + `<div class="mp-counter" aria-live="polite"></div></section>` +
      `<section class="mp-card"><h3>${esc(t("members.profile.replyStyle"))}</h3><div class="mp-reply"></div><p class="mp-reply-hint"></p></section>`;
    if (key === "skills") return `<div class="mp-resources"></div>`;
    if (key === "memory") return `<section class="mp-card"><h3>${esc(t("members.profile.memory"))}</h3><textarea id="mp-memory" class="mb-fin mb-ta" maxlength="${MEMORY_MAX}" rows="8" spellcheck="false" aria-label="${esc(t("members.profile.remember"))}"></textarea></section>`;
    if (key === "routines") return `<section class="mp-card"><div class="mp-card-head"><h3>${esc(t("members.profile.routines"))}</h3>${btn(esc(t("members.routineAdd")), "sm", ' data-dlg="routine-add"')}</div><div class="mp-routine-list"></div></section>`;
    if (key === "permissions") return `<section class="mp-card"><h3>${esc(t("members.profile.permissions"))}</h3><div class="mp-resource"><div><b>${esc(t("members.profile.ask"))}</b><p>${esc(t("members.profile.askHint"))}</p></div>${tg(ask, t("members.profile.ask"), ' data-dlg="ask"')}</div>` +
      `<div class="mp-resource"><div><b>${esc(t("members.profile.draft"))}</b><p>${esc(t("members.profile.draftHint"))}</p></div>${tg(draftFirst, t("members.profile.draft"), ' data-dlg="draft"')}</div></section>`;
    return `<div class="mp-voice"></div>`;
  }
  function drawFace(): void {
    dialog.el.querySelector<HTMLElement>(".mb-new-av")!.innerHTML = faceHTML({ id: member.id, name: nameInput.value, avatar }, 104);
  }
  function drawGroup(): void { dialog.el.querySelector<HTMLElement>(".mb-new-group")!.innerHTML = sel(groupChoices(host.groups), groupValue(groupId), t("members.group"), ' data-dlg="group"'); }
  function drawPreset(): void { dialog.el.querySelector<HTMLElement>(".mp-preset")!.innerHTML = sel(presetChoices(), preset, t("members.profile.preset"), ' data-dlg="preset"'); }
  function count(): void { dialog.el.querySelector<HTMLElement>(".mp-counter")!.textContent = t("members.profile.instructionsCount", { count: value("mb-new-instr").length, max: INSTRUCTIONS_MAX }); }
  function drawReply(): void {
    dialog.el.querySelector<HTMLElement>(".mp-reply")!.innerHTML = sel([{ value: "full", label: t("members.profile.full") }, { value: "conversational", label: t("members.profile.conversational") }], reply, t("members.profile.replyStyle"), ' data-dlg="reply"');
    dialog.el.querySelector<HTMLElement>(".mp-reply-hint")!.textContent = t(reply === "full" ? "members.profile.fullHint" : "members.profile.conversationalHint");
  }
  function applyPreset(next: ProfilePreset): void {
    preset = next;
    if (next !== "custom") {
      const fields = memberPreset(next);
      set("mb-new-role", fields.role ?? ""); set("mp-blurb", fields.blurb ?? "");
      set("mb-new-personality", fields.personality ?? ""); set("mb-new-instr", fields.instructions ?? "");
      suggestedCommand = presetCommand(next);
      if (suggestedCommand) resources?.suggest(suggestedCommand);
    }
    drawPreset(); count();
  }
  function selectTab(next: ProfileTab): void {
    if (tab !== next) dialog.el.querySelector<HTMLElement>(".mb-dlg-body")!.scrollTop = 0;
    tab = next;
    dialog.el.querySelectorAll<HTMLElement>(".member-profile-nav .tab").forEach(button => {
      const selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    dialog.el.querySelectorAll<HTMLElement>(".mp-page").forEach(page => { page.hidden = page.id !== `mp-page-${tab}`; });
    if (tab === "skills" && !resources) {
      resources = mountMemberResources(dialog.el.querySelector<HTMLElement>(".mp-resources")!, { memberId: member.id, tab: "skills" });
      if (suggestedCommand) resources.suggest(suggestedCommand);
    }
    if (tab === "voice" && !voiceEditor) voiceEditor = mountMemberResources(dialog.el.querySelector<HTMLElement>(".mp-voice")!, { memberId: member.id, tab: "voice", member: { ...member, ...voice }, patch: patch => Object.assign(voice, patch) });
    if (tab === "memory" && !memoryLoaded) void loadMemory();
    if (tab === "routines" && !routinesLoaded) void loadRoutines();
  }
  function avatarMenu(anchor: HTMLElement): void {
    openAvatarPicker(anchor, {
      slimes: true,
      current: avatar || defaultSlimeAvatar(member.id),
      onSlime(next) { avatar = next; drawFace(); },
    });
  }
  async function resourceAction(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    setBusy();
    try { await action(); } catch (error) { toaster.info(describeError(error)); }
    finally { busy = false; setBusy(); }
  }
  function setBusy(): void {
    dialog.el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input,textarea,button").forEach(control => {
      if (busy) {
        if (!disabledBeforeBusy.has(control)) disabledBeforeBusy.set(control, control.disabled);
        control.disabled = true;
      } else {
        if (disabledBeforeBusy.has(control)) control.disabled = disabledBeforeBusy.get(control)!;
        disabledBeforeBusy.delete(control);
      }
    });
  }
  async function loadMemory(): Promise<void> {
    try {
      const document = await api.core<MemoryDocument>("memory.get", { member_id: member.id, space: "own" });
      if (!alive) return;
      memoryLoaded = true;
      memoryRevision = document.revision;
      memoryText = document.text.trimEnd();
      set("mp-memory", memoryText);
    } catch (error) { if (alive) toaster.info(describeError(error)); }
  }
  /** The document, when it was opened and changed; whether the dialog may go on saving. */
  async function saveMemory(): Promise<boolean> {
    if (!memoryLoaded || value("mp-memory").trimEnd() === memoryText) return true;
    const own = { member_id: member.id, space: "own" };
    try {
      const document = await api.core<MemoryDocument>("memory.update", { ...own, text: value("mp-memory"), revision: memoryRevision });
      memoryRevision = document.revision;
      memoryText = document.text.trimEnd();
      return true;
    } catch (error) {
      const said = memoryError(error);
      // A member wrote meanwhile. What was typed stays; the next 儲存 is made knowing that.
      if (said === t("mem.changed")) memoryRevision = (await api.core<MemoryDocument>("memory.get", own)).revision;
      selectTab("memory");
      toaster.info(said);
      return false;
    }
  }
  async function loadRoutines(): Promise<void> {
    const list = dialog.el.querySelector<HTMLElement>(".mp-routine-list")!;
    try {
      routines = (await api.routinesList(member.id)).routines;
      if (!alive) return;
      routinesLoaded = true;
      list.innerHTML = routines.length ? routines.map(r => `<div class="mp-resource"><div><b>${esc(r.title)}</b><p>${routineSentenceHTML(r)}</p>${r.when ? `<p>${esc(routineStatus(r))}</p>` : ""}</div>${tg(r.enabled, r.title, ` data-dlg="routine-toggle" data-id="${r.id}"`)}${iconButton("more", t("members.more", { p0: r.title }), ` data-dlg="routine-menu" data-id="${r.id}" aria-haspopup="menu" aria-expanded="false"`)}</div>`).join("") : `<p class="mp-empty">${esc(t("members.profile.noRoutines"))}</p>`;
    } catch (error) { if (alive) { list.innerHTML = btn(esc(t("members.profile.retry")), "sm", ' data-dlg="routine-retry"'); toaster.info(describeError(error)); } }
  }
  function routineForm(existing?: Routine): void {
    openRoutineDialog({
      members: [member], memberId: member.id, routine: existing,
      onSaved: () => void loadRoutines(), onDeleted: () => void loadRoutines(),
    });
  }
  async function save(): Promise<void> {
    if (busy) return;
    const name = cleanName(nameInput.value);
    if (!name || isMemberNameTaken(name, host.taken.filter(taken => taken.toLocaleLowerCase() !== member.name.toLocaleLowerCase()))) {
      selectTab("identity"); nameInput.focus(); toaster.info(name ? t("members.nameTaken", { p0: name }) : t("members.nameEmpty")); return;
    }
    const fields: MemberPatch = { name, role: cleanName(value("mb-new-role")), blurb: cleanName(value("mp-blurb")), personality: value("mb-new-personality").trim(), instructions: value("mb-new-instr").trim(), group_id: groupId, reply_style: reply, ask_before_members: ask, draft_first: draftFirst, ...voice, ...(avatar ? { avatar } : {}) };
    busy = true; setBusy();
    try {
      if (!await saveMemory()) return;
      const okay = host.update ? await host.update(member.id, fields) : !!(await api.membersUpdate(member.id, fields));
      if (!okay) return;
      host.saved?.({ ...member, ...fields }); dialog.close();
    } catch (error) { toaster.info(describeError(error)); }
    finally { busy = false; setBusy(); }
  }
  nameInput.addEventListener("input", drawFace);
  dialog.el.querySelector("#mb-new-instr")!.addEventListener("input", count);
  dialog.el.querySelector(".member-profile-nav")!.addEventListener("keydown", event => {
    const e = event as KeyboardEvent;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const index = TABS.indexOf(tab);
    const next = e.key === "Home" ? TABS[0]! : e.key === "End" ? TABS[TABS.length - 1]! : TABS[(index + (e.key === "ArrowDown" ? 1 : -1) + TABS.length) % TABS.length]!;
    selectTab(next); dialog.el.querySelector<HTMLElement>(`#mp-tab-${next}`)!.focus();
  });
  dialog.el.querySelector(".member-profile-nav [role=tablist]")!.setAttribute("aria-orientation", "vertical");
  drawFace(); drawGroup(); drawPreset(); drawReply(); count(); selectTab(initialTab);
  if (initialTab === "identity") nameInput.focus();
  else dialog.el.querySelector<HTMLElement>(`#mp-tab-${initialTab}`)?.focus();
  return dialog;
}
