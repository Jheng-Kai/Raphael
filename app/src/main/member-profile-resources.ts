// The profile and details panel share the member-owned skill and command editor. Each explicit
// resource action is written immediately.
import * as api from "./api";
import { eventRead } from './event-read';
import { openActions } from "./member-column";
import { describeError } from "./format";
import { onLocaleChange, t } from "./i18n";
import { skillOriginLabel } from "./skill-source";
import type { MemberCommand, MemberSkill, WireAttachment } from "./types";
import { btn, esc, iconButton, tg, toaster } from "./ui";

export interface ResourceHost {
  memberId: number;
  scope?: object;
  tab: "skills" | "commands";
  /** The narrow details panel gives skills and commands separate subpages. */
  standalone?: boolean;
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
  let alive = true;
  let busy = false;
  let failed = false;
  let generation = 0;
  let loaded = !!host.draft;
  let skills: MemberSkill[] = [];
  let commands: MemberCommand[] = [];
  let command: Omit<MemberCommand, "id"> & { id?: number } = { name: "", description: "", template: "" };
  let suggested = false;
  let source = "";
  let undo: string | null = null;
  let editing: { id?: number; text: string; revision?: string } | null = host.draft ? { text: host.draft.text } : null;
  const counts = (): void => { host.onCount?.({ skills: skills.length, commands: commands.length }); };
  const empty = (text: string): string => `<p class="mp-empty">${esc(text)}</p>`;
  const input = (id: string, value: string, placeholder: string, max = 200): string => `<input id="${id}" class="mb-fin" maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off">`;
  const capture = (): void => {
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
      skills.map(s => `<div class="mp-resource"><div><b>${esc(s.name)}</b>${s.description ? `<p>${esc(s.description)}</p>` : ""}<p data-skill-provenance>${esc(skillOriginLabel(s))}</p></div>${tg(s.enabled, `${t("members.profile.enable")} ${s.name}`, ` data-res="skill-toggle" data-id="${s.id}"${off}`)}${s.shared ? "" : iconButton("more", t("members.more", { p0: s.name }), ` data-res="skill-menu" data-id="${s.id}" aria-haspopup="menu" aria-expanded="false"${off}`)}</div>`).join("") +
      (skills.length || host.draft ? "" : empty(t("members.profile.noSkills"))) +
      (editing ? `<label class="mp-label"><span>${esc(t("skills.instructions"))}</span><textarea id="mp-skill-text" class="mb-fin mb-ta" rows="12" spellcheck="false"${off}>${esc(editing.text)}</textarea></label><div class="mp-end">${btn(esc(t("common.cancel")), "sm", ` data-res="skill-cancel"${off}`)}${btn(esc(t("skills.save")), "sm", ` data-res="skill-save"${off}`)}</div>` : "") +
      (undo ? `<div class="mp-end">${btn(esc(t("skills.undo")), "sm", ` data-res="skill-undo"${off}`)}</div>` : "") + `</section>`;
    const commandsHTML = `<section class="mp-card"><h3>${esc(t("members.profile.commands"))}</h3>` +
      commands.map(c => `<div class="mp-resource"><div><b>/${esc(c.name)}</b><p>${esc(c.description)}</p></div>${iconButton("more", t("members.more", { p0: c.name }), ` data-res="command-menu" data-id="${c.id}" aria-haspopup="menu" aria-expanded="false"${off}`)}</div>`).join("") +
      (commands.length ? "" : empty(t("members.profile.noCommands"))) +
      `<div class="mp-command-fields">${input("mp-command-name", command.name, t("members.profile.commandName"), 32)}${input("mp-command-description", command.description, t("members.profile.commandDescription"), 200)}</div>` +
      `<textarea id="mp-command-template" class="mb-fin mb-ta" rows="4" maxlength="8000" placeholder="${esc(t("members.profile.commandTemplate", { input: "{input}" }))}" aria-label="${esc(t("members.profile.commandTemplate", { input: "{input}" }))}">${esc(command.template)}</textarea>` +
      `<div class="mp-end">${command.id === undefined ? "" : btn(esc(t("common.cancel")), "sm", ` data-res="command-cancel"${off}`)}${btn(esc(t("members.profile.saveCommand")), "sm", ` data-res="command-save"${off}`)}</div></section>`;
    container.innerHTML = failed ? `<div class="mp-error" role="alert">${btn(esc(t("members.profile.retry")), "sm", ' data-res="retry"')}</div>` : !loaded ? `<span class="spin" role="status" aria-label="${esc(t("common.loading"))}"></span>` :
      (host.tab === "skills" ? skillHTML : "") + (host.tab === "commands" || !host.standalone ? commandsHTML : "");
  }
  async function refresh(fromEvent = false): Promise<void> {
    const mine = ++generation;
    try {
      const [s, c] = await Promise.all(fromEvent ? [eventRead(`members.skills.list:${host.memberId}`,()=>api.membersSkillsList(host.memberId),host.scope ?? container),eventRead(`members.commands.list:${host.memberId}`,()=>api.membersCommandsList(host.memberId),host.scope ?? container)] : [api.membersSkillsList(host.memberId), api.membersCommandsList(host.memberId)]);
      if (!alive || mine !== generation) return;
      skills = s.skills;
      undo = s.undo ?? null;
      commands = c.commands;
      if (suggested && command.id === undefined && command.name) command.id = commands.find(saved => saved.name === command.name)?.id;
      counts();
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
  function choose(action: string | undefined, id: number): void {
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
  const click = (e: Event): void => {
    const target = (e.target as Element).closest<HTMLButtonElement>("[data-res]");
    if (!target || target.disabled || busy) return;
    capture();
    const action = target.dataset.res;
    const id = Number(target.dataset.id);

    if (action === "skill-menu") openActions(target, [{ id: "skill-edit", label: t("members.profile.editResource"), icon: "pencil" }, { id: "skill-delete", label: t("members.profile.delete"), icon: "trash" }], choice => choose(choice, id));
    else if (action === "command-menu") openActions(target, [{ id: "command-edit", label: t("members.profile.editResource"), icon: "pencil" }, { id: "command-delete", label: t("members.profile.delete"), icon: "trash" }], choice => choose(choice, id));
    else choose(action, id);
  };
  container.addEventListener("click", click);
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
    destroy() { alive = false; generation++; stopLocale(); container.removeEventListener("click", click); },
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
