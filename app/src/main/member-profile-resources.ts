// The profile and details panel share the member-owned skill and command editor. Each explicit
// resource action is written immediately.
import { noticeHTML } from "./missing";
import { createServices, voiceLineHTML } from "./services";
import type { BrainSettings } from "./types";
import * as api from "./api";
import { eventRead } from './event-read';
import { openActions } from "./member-column";
import { describeError, formatDate } from "./format";
import { onLocaleChange, t } from "./i18n";
import { skillSourceLabel } from "./skill-source";
import type { Member, MemberCommand, MemberPatch, MemberSkill, MemberVoice, WireAttachment } from "./types";
import { btn, esc, iconButton, openMenu, sel, tg, toaster } from "./ui";

export interface ResourceHost {
  memberId: number;
  scope?: object;
  tab: "skills" | "commands" | "voice";
  /** The narrow details panel gives skills and commands separate subpages. */
  standalone?: boolean;
  member?: Member;
  /** Profile fields remain drafts until its footer is saved. The details panel writes now. */
  patch?(patch: MemberPatch): void;
  changed?(): void;
  onCount?(counts: { skills: number; commands: number }): void;
  draft?: { text: string; save(text: string): Promise<void>; discard(): Promise<void> };
}
export interface ResourceEditor {
  refresh(fromEvent?: boolean): Promise<void>;
  suggest(command: Omit<MemberCommand, "id">): void;
  destroy(): void;
}

export function mountMemberResources(container: HTMLElement, host: ResourceHost): ResourceEditor {
  let brain: BrainSettings | null = null;
  let voiceDraft: string | null = null;
  const raphaelVoice = host.memberId === 0 && host.tab === "voice" ? createServices({
    root: container, visible: () => alive, redraw: () => draw(), brain: () => brain,
    changeSetting: async (key, value) => { brain = (await api.settingsSet(key, value)).settings; },
  }) : null;
  let alive = true;
  let busy = false;
  let failed = false;
  let generation = 0;
  let loaded = !!host.draft;
  let skills: MemberSkill[] = [];
  let commands: MemberCommand[] = [];
  let voices: MemberVoice[] = [];
  let configured = false;
  const voiceState = { voice: host.member?.voice ?? "", read_aloud: host.member?.read_aloud ?? false, notify: host.member?.notify ?? false };
  let command: Omit<MemberCommand, "id"> & { id?: number } = { name: "", description: "", template: "" };
  let suggested = false;
  let source = "";
  let undo: string | null = null;
  let editing: { id?: number; text: string; revision?: string } | null = host.draft ? { text: host.draft.text } : null;
  const counts = (): void => { if (host.tab !== "voice") host.onCount?.({ skills: skills.length, commands: commands.length }); };
  const empty = (text: string): string => `<p class="mp-empty">${esc(text)}</p>`;
  const label = (text: string, content: string): string => `<label class="mp-label"><span>${esc(text)}</span>${content}</label>`;
  const input = (id: string, value: string, placeholder: string, max = 200): string => `<input id="${id}" class="mb-fin" maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off">`;
  const capture = (): void => {
    if (raphaelVoice) voiceDraft = container.querySelector<HTMLInputElement>("#svc-voice-id")?.value ?? voiceDraft;
    if (editing) editing.text = container.querySelector<HTMLTextAreaElement>("#mp-skill-text")?.value ?? editing.text;
    source = container.querySelector<HTMLInputElement>("#mp-skill-source")?.value ?? source;
    command.name = container.querySelector<HTMLInputElement>("#mp-command-name")?.value ?? command.name;
    command.description = container.querySelector<HTMLInputElement>("#mp-command-description")?.value ?? command.description;
    command.template = container.querySelector<HTMLTextAreaElement>("#mp-command-template")?.value ?? command.template;
  };
  function draw(): void {
    if (!alive) return;
    capture();
    const off = busy ? " disabled" : "";
    const skillHTML = `<section class="mp-card"><h3>${esc(t("members.profile.skillsTitle"))}</h3>` +
      (host.draft ? "" : `<div class="mp-add">${input("mp-skill-source", source, t("members.profile.source"), 2048)}${btn(esc(t("members.profile.import")), "sm", ` data-res="import"${off}`)}</div>`) +
      skills.map(s => `<div class="mp-resource"><div><b>${esc(s.name)}</b><p>${esc(s.description || skillSourceLabel(s.source, s.plugin))}</p><p>${esc(s.shared ? `${t("skills.shared")} · ${skillSourceLabel(s.source, s.plugin)}` : skillSourceLabel(s.source, s.plugin))}</p><p>${esc(s.provenance === "learned" ? t("skills.learnedAt", { p0: s.learned_at ? formatDate(s.learned_at) : "" }) : t(s.provenance === "owner" || s.source === "owner" ? "skills.owner" : "skills.imported"))}</p></div>${tg(s.enabled, `${t("members.profile.enable")} ${s.name}`, ` data-res="skill-toggle" data-id="${s.id}"${off}`)}${s.shared ? "" : iconButton("more", t("members.more", { p0: s.name }), ` data-res="skill-menu" data-id="${s.id}" aria-haspopup="menu" aria-expanded="false"${off}`)}</div>`).join("") +
      (skills.length || host.draft ? "" : empty(t("members.profile.noSkills"))) +
      (editing ? `<label class="mp-label"><span>${esc(t("skills.instructions"))}</span><textarea id="mp-skill-text" class="mb-fin mb-ta" rows="12" spellcheck="false"${off}>${esc(editing.text)}</textarea></label><div class="mp-end">${btn(esc(t("common.cancel")), "sm", ` data-res="skill-cancel"${off}`)}${btn(esc(t("skills.save")), "sm", ` data-res="skill-save"${off}`)}</div>` : "") +
      (undo ? `<div class="mp-end">${btn(esc(t("skills.undo")), "sm", ` data-res="skill-undo"${off}`)}</div>` : "") + `</section>`;
    const commandsHTML = `<section class="mp-card"><h3>${esc(t("members.profile.commands"))}</h3>` +
      commands.map(c => `<div class="mp-resource"><div><b>/${esc(c.name)}</b><p>${esc(c.description)}</p></div>${iconButton("more", t("members.more", { p0: c.name }), ` data-res="command-menu" data-id="${c.id}" aria-haspopup="menu" aria-expanded="false"${off}`)}</div>`).join("") +
      (commands.length ? "" : empty(t("members.profile.noCommands"))) +
      `<div class="mp-command-fields">${input("mp-command-name", command.name, t("members.profile.commandName"), 32)}${input("mp-command-description", command.description, t("members.profile.commandDescription"), 200)}</div>` +
      `<textarea id="mp-command-template" class="mb-fin mb-ta" rows="4" maxlength="8000" placeholder="${esc(t("members.profile.commandTemplate", { input: "{input}" }))}" aria-label="${esc(t("members.profile.commandTemplate", { input: "{input}" }))}">${esc(command.template)}</textarea>` +
      `<div class="mp-end">${command.id === undefined ? "" : btn(esc(t("common.cancel")), "sm", ` data-res="command-cancel"${off}`)}${btn(esc(t("members.profile.saveCommand")), "sm", ` data-res="command-save"${off}`)}</div></section>`;
    const voiceChoices = [{ value: "", label: t("members.profile.defaultVoice") }, ...voices.map(v => ({ value: v.id, label: v.name }))];
    if (voiceState.voice && !voiceChoices.some(v => v.value === voiceState.voice)) voiceChoices.push({ value: voiceState.voice, label: voiceState.voice });
    container.innerHTML = failed ? `<div class="mp-error" role="alert">${btn(esc(t("members.profile.retry")), "sm", ' data-res="retry"')}</div>` : !loaded ? `<span class="spin" role="status" aria-label="${esc(t("common.loading"))}"></span>` :
      raphaelVoice ? `<section class="mp-card"><h3>${esc(t("members.panelVoice"))}</h3>${voiceLineHTML(raphaelVoice.view(), voiceDraft ?? brain?.tts_fish_voice ?? "")}</section>` :
      host.tab === "voice" ? `<section class="mp-card">${label(t("members.profile.voiceLabel"), sel(voiceChoices, voiceState.voice, t("members.profile.voiceLabel"), ` data-res="voice"${!configured || busy ? " disabled" : ""}`))}${configured ? "" : noticeHTML("voice", "voice", "fish")}</section>` +
        `<section class="mp-card">${(["read_aloud", "notify"] as const).map(key => `<div class="mp-resource"><span>${esc(t(key === "read_aloud" ? "members.profile.readAloud" : "members.profile.notify"))}</span>${tg(voiceState[key], t(key === "read_aloud" ? "members.profile.readAloud" : "members.profile.notify"), ` data-res="${key}"${off}`)}</div>`).join("")}</section>` :
      (host.tab === "skills" ? skillHTML : "") + (host.tab === "commands" || !host.standalone ? commandsHTML : "");
  }
  async function refresh(fromEvent = false): Promise<void> {
    const mine = ++generation;
    try {
      if (host.tab === "voice") {
        if (raphaelVoice) { brain = (await api.settingsGet()).settings; await raphaelVoice.load(); }
        const answer = await (fromEvent ? eventRead('members.voices',()=>api.membersVoices(),host.scope ?? container) : api.membersVoices());
        if (!alive || mine !== generation) return;
        voices = answer.voices;
        configured = answer.configured;
      } else {
        const [s, c] = await Promise.all(fromEvent ? [eventRead(`members.skills.list:${host.memberId}`,()=>api.membersSkillsList(host.memberId),host.scope ?? container),eventRead(`members.commands.list:${host.memberId}`,()=>api.membersCommandsList(host.memberId),host.scope ?? container)] : [api.membersSkillsList(host.memberId), api.membersCommandsList(host.memberId)]);
        if (!alive || mine !== generation) return;
        skills = s.skills;
        undo = s.undo ?? null;
        commands = c.commands;
        if (suggested && command.id === undefined && command.name) command.id = commands.find(saved => saved.name === command.name)?.id;
        counts();
      }
      loaded = true;
      failed = false;
    } catch (error) {
      if (!alive || mine !== generation) return;
      failed = true;
      toaster.info(describeError(error));
    }
    draw();
  }
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    capture();
    busy = true;
    draw();
    try { await action(); if (alive) { host.changed?.(); counts(); } }
    catch (error) { toaster.info(describeError(error)); }
    finally { busy = false; draw(); }
  }
  async function patch(next: MemberPatch): Promise<void> {
    if (host.patch) host.patch(next);
    else await api.membersUpdate(host.memberId, next);
    Object.assign(voiceState, next);
  }
  function choose(action: string | undefined, id: number, target: HTMLButtonElement): void {
    if (action === "skill-cancel") {
      if (host.draft) void run(async () => { await host.draft!.discard(); editing = null; });
      else { editing = null; draw(); }
      return;
    }
    if (action === "skill-edit") {
      void (async () => {
        try {
          const answer = await api.core<{ skill: MemberSkill; text: string }>("members.skills.read", { member_id: host.memberId, id });
          if (alive) { editing = { id, text: answer.text, revision: answer.skill?.revision ?? undefined }; draw(); }
        } catch (error) { toaster.info(describeError(error)); }
      })();
      return;
    }
    if (action === "retry") { void refresh(); return; }
    if (action === "voice") {
      openMenu(target, [{ value: "", label: t("members.profile.defaultVoice") }, ...voices.map(v => ({ value: v.id, label: v.name }))], voiceState.voice, value => void run(() => patch({ voice: value })));
      return;
    }
    if (action === "read_aloud" || action === "notify") { void run(() => patch({ [action]: !voiceState[action] })); return; }
    if (action === "command-edit") { suggested = false; command = { ...commands.find(c => c.id === id)! }; container.innerHTML = ""; draw(); container.querySelector<HTMLInputElement>("#mp-command-name")?.focus(); return; }
    if (action === "command-cancel") { suggested = false; command = { name: "", description: "", template: "" }; container.innerHTML = ""; draw(); return; }
    void run(async () => {
      if (action === "skill-save" && editing) {
        if (host.draft) { await host.draft.save(editing.text); editing = null; return; }
        await api.core("members.skills.update", { member_id: host.memberId, id: editing.id, text: editing.text, expected_hash: editing.revision });
        editing = null;
        await refresh();
      } else if (action === "skill-undo" && undo) {
        await api.core("members.skills.update", { member_id: host.memberId, undo });
        editing = null;
        await refresh();
      } else if (action === "import") {
        const value = source.trim();
        if (!value) return;
        const answer = await api.membersSkillsImport(host.memberId, value);
        for (const skill of answer.skills ?? [answer.skill]) {
          const index = skills.findIndex(existing => existing.id === skill.id);
          if (index < 0) skills.push(skill); else skills[index] = skill;
        }
        source = "";
        const field = alive ? container.querySelector<HTMLInputElement>("#mp-skill-source") : null;
        if (field) field.value = "";
      } else if (action === "skill-toggle") {
        const skill = skills.find(s => s.id === id)!;
        await api.membersSkillsUpdate(host.memberId, id, !skill.enabled);
        await refresh();
      } else if (action === "skill-delete") {
        await api.membersSkillsDelete(host.memberId, id);
        const index = skills.findIndex(s => s.id === id);
        if (index >= 0) skills.splice(index, 1);
        editing = null;
        await refresh();
      } else if (action === "command-delete") {
        await api.membersCommandsDelete(host.memberId, id);
        const index = commands.findIndex(c => c.id === id);
        if (index >= 0) commands.splice(index, 1);
      } else if (action === "command-save") {
        const name = command.name.trim().replace(/^\//, "").toLowerCase();
        if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || !command.template.includes("{input}")) { toaster.info(t("members.profile.badCommand", { input: "{input}" })); return; }
        const next = { ...command, name, description: command.description.trim(), template: command.template.trim() };
        const saved = (await api.membersCommandsSave(host.memberId, next) as { command?: MemberCommand } | undefined)?.command;
        if (saved) {
          const index = commands.findIndex(existing => existing.id === saved.id);
          if (index < 0) commands.push(saved); else commands[index] = saved;
        } else commands = (await api.membersCommandsList(host.memberId)).commands;
        command = { name: "", description: "", template: "" };
        suggested = false;
        if (alive) container.innerHTML = "";
      }
    });
  }
  const key = (event: KeyboardEvent): void => { raphaelVoice?.key(event); };
  const click = (e: Event): void => {
    if (raphaelVoice?.click(e.target as Element)) return;
    const target = (e.target as Element).closest<HTMLButtonElement>("[data-res]");
    if (!target || target.disabled || busy) return;
    capture();
    const action = target.dataset.res;
    const id = Number(target.dataset.id);

    if (action === "skill-menu") openActions(target, [{ id: "skill-edit", label: t("members.profile.editResource"), icon: "pencil" }, { id: "skill-delete", label: t("members.profile.delete"), icon: "trash" }], choice => choose(choice, id, target));
    else if (action === "command-menu") openActions(target, [{ id: "command-edit", label: t("members.profile.editResource"), icon: "pencil" }, { id: "command-delete", label: t("members.profile.delete"), icon: "trash" }], choice => choose(choice, id, target));
    else choose(action, id, target);
  };
  container.addEventListener("click", click);
  container.addEventListener("keydown", key);
  const stopLocale = onLocaleChange(draw);
  draw();
  if (!host.draft) void refresh();
  return {
    refresh,
    suggest(next) {
      capture();
      suggested = true;
      command = { ...next, ...(commands.find(saved => saved.name === next.name)?.id === undefined ? {} : { id: commands.find(saved => saved.name === next.name)!.id }) };
      container.innerHTML = "";
      draw();
    },
    destroy() { raphaelVoice?.reset(); container.removeEventListener("keydown", key); alive = false; generation++; stopLocale(); container.removeEventListener("click", click); },
  };
}

/** Converts the user's selected crop into the file sent to members.set_avatar. */
export async function croppedMemberPicture(file: WireAttachment, crop: { x: number; y: number; zoom: number }, side = 512, mime = "image/png"): Promise<WireAttachment> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(t("agent.attachUnreadable", { p0: file.name }))); image.src = `data:${file.mime};base64,${file.data}`; });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("agent.attachUnreadable", { p0: file.name }));
  const scale = side / Math.min(image.naturalWidth, image.naturalHeight) * crop.zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, (side - width) * crop.x, (side - height) * crop.y, width, height);
  return { name: "avatar.png", mime, data: canvas.toDataURL(mime, 0.9).split(",")[1]! };
}
