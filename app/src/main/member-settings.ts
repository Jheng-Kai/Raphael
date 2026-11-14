// The settings of one member, as a page of its own in the main area where the conversation is: the gear
// of the member's panel opens it, the arrow left of its name (and Escape) goes back to the conversation. It reads like a
// Notion page: a cover the owner can change (a pattern in the member's own slime colour, or a picture), the face large
// across the cover's lower edge, the name and the role in place. Under them the settings are kinds in a column on the left,
// as Settings' own, and only the chosen kind is shown, as
// compact sections, each a name over one tinted list of rows. Every member has the same kinds, Raphael
// too: tools, skills and commands, personality and instructions, notifications (owner, 2026-11-09). There is no memory
// here, nor anywhere in the app (owner, 2026-11-11: 「可以像 Hermes Agent 一樣，都不要讓我們看到記憶好了，所以記憶是在背後
// 管理的…如果使用者在使用的情況下遇到記憶有錯誤的時候，再跟他說一下，他自己去改就好了」): the core keeps it, the member
// corrects it when told. The model is chosen at the composer alone, and members have no voice. What the panel beside it
// already shows (routines, messaging) is not here. The personality and the instructions are one kind of thing, the words the
// owner gives the member about how to be and what to do, so each is one quiet row of its words, whole, with a pencil: a press
// turns the row into a field in place (owner, 2026-11-12). A skill opens in a view of its own; no row has a text button where
// an icon says it.
import "./member-panel.css";
import "./member-settings.css";
import * as api from "./api";
import { describeError } from "./format";
import { onLocaleChange, getLocale, t } from "./i18n";
import { openMemberAvatarMenu } from "./member-avatar-menu";
import type { MessageKey } from "./i18n/zh-TW";
import { pickPicture, readPicture } from "./member-dialogs";
import { INSTRUCTIONS_MAX, NAME_MAX, PERSONALITY_MAX, RAPHAEL_ID, ROLE_MAX, cleanName, faceHTML, isMemberNameTaken, stableMember } from "./members";
import { entryIcon } from "./service-mark";
import { skillOriginLabel } from "./skill-source";
import { slimeColorOf } from "./slime";
import type { AppContext, Member, MemberCommand, MemberPatch, MemberSkill, MembersList } from "./types";
import { type IconName, actionRow, btn, closeMenu, esc, ico, iconBtn, iconButton, openConfirmMenu, openPopover, patchHTML, tg, toaster } from "./ui";

export interface MemberSettingsHost {
  app: AppContext;
  /** The member whose thread is open: the page is about this one. */
  member(): Member;
  list(): MembersList | null;
  /** Changes the member and reads the list again; false (with a toast) when the core refused. */
  update(id: number, patch: MemberPatch): Promise<boolean>;
  /** Reads the list again after a change made by another call (a cover picture). */
  refreshList(): void;
  /** The arrow and Escape: back to the member's conversation. */
  back(): void;
}

export interface MemberSettings {
  readonly el: HTMLElement;
  isOpen(): boolean;
  open(): void;
  /** Hides the page at once, without a step back (another member or page came in its place). */
  close(): void;
  /** The list changed, or the language: the page is drawn again if it is open. */
  draw(): void;
  /** What the member has (skills, commands, tools) is read again. */
  refresh(): void;
  /** The view on screen in words the way back keeps: the tab (`skills`), and a skill's or a command's page in it (`skills/skill:4`). */
  navView(): string;
  /** Shows the view `navView` named, as the presses that lead there do. */
  showNavView(key: string): void;
}

type View = { kind: "main" } | { kind: "skill"; id: number } | { kind: "command"; id: number | null };
type Field = "personality" | "instructions";
type Loaded<T> = T | "loading" | "failed";
interface ToolChoices { tools: string[]; connections: { id: string; name: string; enabled: boolean }[] }

/** The kinds of settings in the page's left column, in the owner's order, the same for every member (owner, 2026-11-09). */
type Category = "tools" | "skills" | "soul" | "notify";
const CATEGORIES: readonly { id: Category; icon: IconName; label: MessageKey }[] = [
  { id: "tools", icon: "plug", label: "settings.paneTools" },
  { id: "skills", icon: "sparkle", label: "members.profile.skills" },
  { id: "soul", icon: "smile", label: "members.profile.soul" },
  { id: "notify", icon: "bell", label: "memberSettings.notify" },
];
const tr = t as unknown as (key: MessageKey) => string;

/** Where a cover picture is shown, 0 (its top) to 100 (its bottom); 50 until the owner moves it. */
export const coverPosition = (member: Member): number =>
  member.cover?.kind === "image" && typeof member.cover.position === "number" ? Math.min(100, Math.max(0, member.cover.position)) : 50;

/** The cover's patterns, drawn in the member's colour by member-settings.css; the first is the page's own. */
export const COVER_PATTERNS = ["dots", "grid", "lines", "glow", "plain"] as const;
export function coverPattern(member: Member): string {
  const cover = member.cover;
  if (cover?.kind === "image") return "image";
  return cover?.kind === "pattern" && (COVER_PATTERNS as readonly string[]).includes(cover.id) ? cover.id : COVER_PATTERNS[0];
}

const COMMAND_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

export function createMemberSettings(host: MemberSettingsHost): MemberSettings {
  const el = document.createElement("section");
  el.className = "ms-pane";
  el.hidden = true;
  el.tabIndex = -1;
  el.dataset.memberSettings = "";
  // The way back stays at the page's top left, on the cover and over a view's heading (owner, 2026-11-11).
  el.innerHTML =
    `<div class="ms-bar">${iconButton("left", t("chooser.back"), ' data-ms="back" data-k="ms-back" data-nav-back', "ms-back")}</div>` +
    `<div class="ms-scroll"><div class="ms-cover"></div><div class="ms-body"><div class="ms-id"></div><div class="ms-main"></div></div></div>`;
  const backButton = el.querySelector<HTMLElement>('[data-ms="back"]')!;
  const scroll = el.querySelector<HTMLElement>(".ms-scroll")!;
  const cover = el.querySelector<HTMLElement>(".ms-cover")!;
  const idSlot = el.querySelector<HTMLElement>(".ms-id")!;
  const main = el.querySelector<HTMLElement>(".ms-main")!;

  let view: View = { kind: "main" };
  let category: Category = CATEGORIES[0].id;
  /** The cover picture being moved, as Notion's Reposition: where it was, and where it is now. */
  let reposition: { from: number; at: number } | null = null;
  /** The long fields that are open to be typed in: closed, each is a row of its words. */
  const editing = new Set<Field>();
  /** The words of a long field on their way to the core (key `member:field`), shown in its row with a spinner for the pencil until it answers. */
  const saving = new Map<string, string>();
  let adding = false;
  let skills: Loaded<MemberSkill[]> = "loading";
  let commands: Loaded<MemberCommand[]> = "loading";
  let toolChoices: Loaded<ToolChoices> = "loading";
  let skillText: { id: number; skill: MemberSkill; text: string; revision?: string } | "loading" | null = null;
  let skillBusy = false;
  let command: { id: number | null; name: string; description: string; template: string } = { id: null, name: "", description: "", template: "" };
  let source = "";
  let epoch = 0;
  let drawn = "";
  let drawnFor: number | null = null;

  // ---------- reading ----------

  async function load(): Promise<void> {
    if (el.hidden) return;
    const mine = ++epoch, id = host.member().id;
    // Each read is its own: one that fails (or a core that has not got it) leaves the others to answer.
    const read = <T>(call: () => Promise<T>): Promise<T> => Promise.resolve().then(call);
    const [skillList, commandList, tools] = await Promise.allSettled([
      read(() => api.membersSkillsList(id)),
      read(() => api.membersCommandsList(id)),
      read(() => api.membersToolChoices()),
    ]);
    if (mine !== epoch || id !== host.member().id || el.hidden) return;
    if (skillList.status === "fulfilled") skills = skillList.value?.skills ?? []; else if (!Array.isArray(skills)) skills = "failed";
    if (commandList.status === "fulfilled") commands = commandList.value?.commands ?? []; else if (!Array.isArray(commands)) commands = "failed";
    if (tools.status === "fulfilled" && tools.value) toolChoices = tools.value; else if (typeof toolChoices !== "object") toolChoices = "failed";
    draw();
  }

  // ---------- drawing ----------

  const spinner = (): string => `<span class="spin" role="status" aria-label="${esc(t("common.loading"))}"></span>`;
  // A kind with one section needs no name over it: the column on the left says it.
  const section = (title: string, rows: string, tool = "", key = ""): string =>
    `<section class="ms-section"${key ? ` data-k="${key}"` : ""}>${title || tool ? `<div class="ms-head">${title ? `<h2>${esc(title)}</h2>` : ""}${tool}</div>` : ""}<div class="ms-list">${rows}</div></section>`;
  const muted = (text: string): string => `<p class="ms-empty">${esc(text)}</p>`;
  const row = (label: string, control: string, key = ""): string =>
    `<div class="ms-row"${key ? ` data-k="${key}"` : ""}><span class="ms-label">${esc(label)}</span>${control}</div>`;

  function idHTML(member: Member): string {
    // A press on the face opens the picker (slimes, 生成) at once, as the panel's does; under the pointer a pencil shows on it.
    const face = `<button type="button" class="btn mb-face-edit ms-face" data-ms="avatar" data-k="ms-face" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("members.changeAvatar"))}">${faceHTML(member, 96)}<span class="mb-face-pencil" aria-hidden="true">${ico("pencil")}</span></button>`;
    // Raphael's name is not the owner's to change here, nor has he a role.
    if (member.id === RAPHAEL_ID) return face + `<b class="ms-name ms-static">${esc(member.name)}</b>`;
    return face +
      `<input class="mb-edit ms-name" id="ms-name" data-member="${member.id}" type="text" maxlength="${NAME_MAX}" value="${esc(member.name)}" aria-label="${esc(t("members.name"))}" autocomplete="off" spellcheck="false">` +
      `<input class="mb-edit ms-role" id="ms-role" data-member="${member.id}" type="text" maxlength="${ROLE_MAX}" value="${esc(member.role)}" placeholder="${esc(t("members.role"))}" aria-label="${esc(t("members.role"))}" autocomplete="off" spellcheck="false">`;
  }

  /**
   * A long field, the personality or the instructions: a quiet row of its words as they are, as many lines as they take, with a
   * pencil at its end, or, when nothing is written, one line saying what could stand there. A press turns the row into a field
   * in place that is as tall as its words, in the row's own place, size and type, so nothing moves under the pointer.
   */
  function fieldHTML(member: Member, field: Field): string {
    const label = t(field === "personality" ? "members.personality" : "members.instructions");
    const hint = t(field === "personality" ? "members.personalityHint" : "members.instructionsHint");
    const pending = saving.get(`${member.id}:${field}`);
    const value = pending ?? member[field] ?? "";
    if (editing.has(field)) {
      return `<textarea id="ms-${field}" data-member="${member.id}" data-field="${field}" class="mb-fin mb-ta ms-field" rows="1" maxlength="${field === "personality" ? PERSONALITY_MAX : INSTRUCTIONS_MAX}" aria-label="${esc(label)}" placeholder="${esc(hint)}" spellcheck="false">${esc(value)}</textarea>`;
    }
    const words = value.trim();
    const mark = pending === undefined ? ico("pencil") : `<span class="spin" aria-hidden="true"></span>`;
    return `<button type="button" class="btn ms-open ms-value" data-ms="edit" data-field="${field}" data-k="ms-edit:${field}" aria-label="${esc(t("mem.editLabel", { p0: label }))}"${pending === undefined ? "" : ' aria-busy="true"'}><span class="ms-label${words ? "" : " is-empty"}">${esc(words || hint)}</span>${mark}</button>`;
  }

  function skillsHTML(): string {
    const title = t("members.panelSkills");
    const tool = iconBtn("plus", t("memberSettings.add", { p0: title }), ' data-ms="skill-add" data-k="ms-skill-add"');
    let rows: string;
    if (skills === "loading") rows = spinner();
    else if (skills === "failed") rows = muted(t("mem.loadFailed"));
    else {
      rows = (adding
        ? `<div class="ms-add"><input id="ms-skill-source" class="mb-fin" maxlength="2048" value="${esc(source)}" placeholder="${esc(t("members.profile.source"))}" aria-label="${esc(t("members.profile.source"))}" autocomplete="off">${btn(esc(t("members.profile.import")), "sm", ' data-ms="skill-import" data-k="ms-skill-import"')}</div>` : "") +
        skills.map(skill =>
          `<div class="ms-row" data-k="ms-skill:${skill.id}"><button type="button" class="btn ms-open" data-ms="skill-open" data-id="${skill.id}" data-k="ms-skill-open:${skill.id}"><span class="ms-label">${esc(skill.name)}</span></button>` +
          `${tg(skill.enabled, `${t("members.profile.enable")} ${skill.name}`, ` data-ms="skill-toggle" data-id="${skill.id}" data-k="ms-skill-toggle:${skill.id}"`)}</div>`).join("") +
        (skills.length || adding ? "" : muted(t("members.profile.noSkills")));
    }
    return section(title, rows, tool, "ms-skills");
  }

  function commandsHTML(): string {
    const title = t("members.panelCommands");
    const tool = iconBtn("plus", t("memberSettings.add", { p0: title }), ' data-ms="command-add" data-k="ms-command-add"');
    let rows: string;
    if (commands === "loading") rows = spinner();
    else if (commands === "failed") rows = muted(t("mem.loadFailed"));
    else rows = commands.map(item =>
      `<div class="ms-row" data-k="ms-command:${item.id}"><button type="button" class="btn ms-open" data-ms="command-open" data-id="${item.id}" data-k="ms-command-open:${item.id}"><span class="ms-label">/${esc(item.name)}</span>${item.description ? `<small>${esc(item.description)}</small>` : ""}</button></div>`).join("") ||
      muted(t("members.profile.noCommands"));
    return section(title, rows, tool, "ms-commands");
  }

  /**
   * The apps the owner connected, each with its own mark so what the member may use is seen at a glance, and a switch: each
   * member has its own list (owner, 2026-11-09: 「工具的部分都要放上 Icon…可以個別開放我們已經連結好的 connectors」). Under
   * them, how it acts with mail and Slack.
   */
  function toolsHTML(member: Member): string {
    let rows: string;
    if (toolChoices === "loading") rows = spinner();
    else if (toolChoices === "failed") rows = muted(t("mem.loadFailed"));
    else {
      const apps = toolChoices.connections.filter(connection => connection.enabled);
      rows = apps.map(app =>
        `<div class="ms-row ms-app" data-k="ms-app:${esc(app.id)}">${entryIcon({ name: app.name, icon: app.id }, "md")}<span class="ms-label">${esc(app.name)}</span>` +
        `${tg(member.tools === null || member.tools.includes(app.id), app.name, ` data-ms="tool" data-id="${esc(app.id)}" data-k="ms-tool:${esc(app.id)}"`)}</div>`).join("") || muted(t("memberSettings.noTools"));
    }
    return section("", rows, "", "ms-tools") +
      section("", row(t("members.profile.draft"), tg(member.draft_first ?? true, t("members.profile.draft"), ' data-ms="draft" data-k="ms-draft"')), "", "ms-draft");
  }

  /** What the chosen kind holds. */
  function categoryHTML(member: Member): string {
    switch (category) {
      case "tools":
        return toolsHTML(member);
      case "skills":
        return skillsHTML() + commandsHTML();
      case "soul":
        return section(t("members.personality"), fieldHTML(member, "personality"), "", "ms-personality") + section(t("members.instructions"), fieldHTML(member, "instructions"), "", "ms-instructions");
      case "notify":
        return section("", row(t("members.profile.notify"), tg(member.notify ?? false, t("members.profile.notify"), ' data-ms="notify" data-k="ms-notify"')), "", "ms-notify");
    }
  }

  /** The kinds in a column on the left, as Settings' own, and the chosen one beside them. */
  function mainHTML(member: Member): string {
    const nav = CATEGORIES.map(item =>
      `<button type="button" class="nav" data-ms="cat" data-cat="${item.id}" data-k="ms-cat:${item.id}" aria-current="${item.id === category ? "page" : "false"}">${ico(item.icon)}<span>${esc(tr(item.label))}</span></button>`).join("");
    return `<div class="ms-layout"><nav class="ms-nav" aria-label="${esc(t("computer.settings"))}">${nav}</nav>` +
      `<div class="ms-content" data-cat="${category}">${categoryHTML(member)}</div></div>`;
  }

  /**
   * The cover: its pattern or picture, and at its lower right the round button that changes it. While a picture is moved
   * (Notion's Reposition) the pointer drags it up and down, and the button gives way to 取消 and 儲存位置.
   */
  function coverHTML(member: Member): string {
    if (member.cover?.kind !== "image") return iconButton("image", t("memberSettings.cover"), ' data-ms="cover" data-k="ms-cover" aria-haspopup="menu" aria-expanded="false"', "ms-cover-btn");
    const at = reposition ? reposition.at : coverPosition(member);
    const image = `<img class="ms-cover-img" src="${esc(member.cover.url)}" alt="" style="object-position: 50% ${at}%">`;
    if (!reposition) return image + iconButton("image", t("memberSettings.cover"), ' data-ms="cover" data-k="ms-cover" aria-haspopup="menu" aria-expanded="false"', "ms-cover-btn");
    return image + `<span class="ms-cover-hint" aria-hidden="true">${esc(t("memberSettings.dragToReposition"))}</span>` +
      actionRow({ cls: "ms-cover-actions", secondary: btn(esc(t("common.cancel")), "sm", ' data-ms="cover-cancel" data-k="ms-cover-cancel"'), primary: { label: esc(t("memberSettings.savePosition")), kind: "sm", attrs: ' data-ms="cover-save" data-k="ms-cover-save"' } });
  }

  /** The picture's overflow below the cover, in pixels, as `object-fit: cover` draws it: how far a drag can move it. */
  function coverOverflow(): number {
    const img = cover.querySelector<HTMLImageElement>(".ms-cover-img");
    if (!img || !img.naturalWidth || !img.naturalHeight) return 0;
    const box = cover.getBoundingClientRect();
    const scale = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight);
    return Math.max(0, img.naturalHeight * scale - box.height);
  }

  function endReposition(save: boolean): void {
    const moved = reposition;
    if (!moved) return;
    reposition = null;
    delete cover.dataset.repositioning;
    const member = host.member();
    draw();
    if (save && Math.abs(moved.at - moved.from) >= 0.1) void host.update(member.id, { cover_position: Math.round(moved.at * 10) / 10 });
  }

  // The picture follows the pointer while it is held: dragged down, more of its top shows.
  cover.addEventListener("pointerdown", (event) => {
    const img = (event.target as Element).closest<HTMLImageElement>(".ms-cover-img");
    if (!reposition || !img || event.button !== 0) return;
    event.preventDefault();
    const overflow = coverOverflow();
    if (!overflow) return;
    const startY = event.clientY, from = reposition.at;
    img.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent): void => {
      if (!reposition) return;
      reposition.at = Math.min(100, Math.max(0, from - (next.clientY - startY) / overflow * 100));
      img.style.objectPosition = `50% ${reposition.at}%`;
    };
    const up = (): void => { img.removeEventListener("pointermove", move); img.removeEventListener("pointerup", up); img.removeEventListener("pointercancel", up); };
    img.addEventListener("pointermove", move);
    img.addEventListener("pointerup", up);
    img.addEventListener("pointercancel", up);
  });

  /** The cover's choices: its patterns as small covers in the member's colour, a picture from this PC, and taking a picture off. */
  function openCoverMenu(anchor: HTMLElement, member: Member): void {
    const current = coverPattern(member);
    const tint = member.id === RAPHAEL_ID ? "var(--raphael-color)" : slimeColorOf(member);
    const swatches = COVER_PATTERNS.map((id, at) =>
      `<button type="button" role="menuitemradio" aria-checked="${id === current}" tabindex="-1" class="ms-swatch" data-cover="${id}" aria-label="${esc(t("memberSettings.coverPattern", { p0: at + 1 }))}"><span class="ms-cover" data-pattern="${id}"></span></button>`).join("");
    const action = (act: string, label: string): string => `<button type="button" role="menuitem" tabindex="-1" class="menu-action" data-cover-act="${act}"><span class="mt">${esc(label)}</span></button>`;
    const pop = openPopover(anchor,
      `<div class="ms-swatches">${swatches}</div>` + action("upload", t("members.fromPc")) +
      (current === "image" ? action("reposition", t("memberSettings.reposition")) + action("remove", t("providers.remove")) : ""),
      { className: "menu ms-cover-menu", role: "menu", label: t("memberSettings.cover") });
    // The menu lives outside the page, so it is given the member's colour itself.
    pop.querySelector<HTMLElement>(".ms-swatches")?.style.setProperty("--ms-tint", tint);
    pop.addEventListener("click", (event) => {
      const target = (event.target as Element).closest<HTMLElement>("button");
      if (!target) return;
      const id = member.id;
      if (target.dataset.cover) {
        closeMenu();
        // The page's own band is no cover at all.
        void host.update(id, { cover: target.dataset.cover === COVER_PATTERNS[0] ? null : `pattern:${target.dataset.cover}` });
      } else if (target.dataset.coverAct === "upload") {
        closeMenu();
        pickPicture(async (file) => {
          const picture = await readPicture(file);
          if (!picture) return;
          try { await api.membersSetCover(id, picture); host.refreshList(); } catch (error) { toaster.info(describeError(error)); }
        });
      } else if (target.dataset.coverAct === "reposition") {
        closeMenu();
        const at = coverPosition(member);
        reposition = { from: at, at };
        cover.dataset.repositioning = "";
        draw();
        el.querySelector<HTMLElement>('[data-ms="cover-save"]')?.focus({ preventScroll: true });
      } else if (target.dataset.coverAct === "remove") {
        closeMenu();
        void host.update(id, { cover: null });
      }
    });
  }

  /** A view of its own (a skill, a command): the page's arrow goes back to the page from it, not to the conversation. */
  const subHead = (title: string, more = ""): string => `<div class="ms-subhead"><h2 class="ms-title">${esc(title)}</h2>${more}</div>`;

  function skillHTML(id: number): string {
    const known = Array.isArray(skills) ? skills.find(skill => skill.id === id) : undefined;
    if (skillText === "loading" || skillText === null) return subHead(known?.name ?? "") + spinner();
    const { skill, text } = skillText;
    const shared = !!skill.shared;
    const meta = [skill.description, skillOriginLabel(skill)].filter(Boolean).join(" · ");
    return subHead(skill.name, shared ? "" : iconBtn("more", t("members.more", { p0: skill.name }), ' data-ms="skill-more" aria-haspopup="menu" aria-expanded="false"')) +
      `<p class="ms-meta">${esc(meta)}</p>` +
      `<textarea id="ms-skill-text" class="mb-fin mb-ta ms-text" rows="14" spellcheck="false" aria-label="${esc(t("skills.instructions"))}"${shared || skillBusy ? " disabled" : ""}>${esc(text)}</textarea>` +
      (shared ? "" : actionRow({ cls: "ms-actions", primary: { label: esc(t("skills.save")), kind: "sm", attrs: ` data-ms="skill-save" data-k="ms-skill-save"${skillBusy ? " disabled" : ""}` } }));
  }

  function commandHTML(): string {
    const field = (id: string, value: string, label: string, max: number): string => `<input id="${id}" class="mb-fin" maxlength="${max}" value="${esc(value)}" placeholder="${esc(label)}" aria-label="${esc(label)}" autocomplete="off">`;
    return subHead(command.id === null ? t("memberSettings.add", { p0: t("members.panelCommands") }) : `/${command.name}`,
      command.id === null ? "" : iconBtn("more", t("members.more", { p0: command.name }), ' data-ms="command-more" aria-haspopup="menu" aria-expanded="false"')) +
      `<div class="ms-fields">${field("ms-command-name", command.name, t("members.profile.commandName"), 32)}${field("ms-command-description", command.description, t("members.profile.commandDescription"), 200)}` +
      `<textarea id="ms-command-template" class="mb-fin mb-ta" rows="6" maxlength="8000" placeholder="${esc(t("members.profile.commandTemplate", { input: "{input}" }))}" aria-label="${esc(t("members.profile.commandTemplate", { input: "{input}" }))}">${esc(command.template)}</textarea></div>` +
      actionRow({ cls: "ms-actions", primary: { label: esc(t("members.profile.saveCommand")), kind: "sm", attrs: ' data-ms="command-save" data-k="ms-command-save"' } });
  }

  function viewHTML(member: Member): string {
    if (view.kind === "skill") return skillHTML(view.id);
    if (view.kind === "command") return commandHTML();
    return mainHTML(member);
  }

  function draw(): void {
    if (el.hidden) return;
    const member = host.member();
    const sameMember = drawnFor === member.id;
    // Another member, or the picture taken off, ends a move of the cover that was under way.
    if (reposition && (!sameMember || member.cover?.kind !== "image")) { reposition = null; delete cover.dataset.repositioning; }
    const face = faceHTML(member, 96).replace(/--slime-(?:delay|since):[^;"\s]+;?| data-slime-mounted="[\d.]+"/g, "");
    const signature = JSON.stringify([stableMember(member), face, view, category, [...editing], [...saving], adding, skills, commands, toolChoices, skillText, skillBusy, command, getLocale(),
      reposition ? reposition.from : null]);
    if (drawn === signature) return;
    drawn = signature;
    el.dataset.view = view.kind;
    el.setAttribute("aria-label", t("computer.settings"));
    backButton.title = t("chooser.back"); backButton.setAttribute("aria-label", backButton.title);
    el.style.setProperty("--ms-tint", member.id === RAPHAEL_ID ? "var(--raphael-color)" : slimeColorOf(member));
    cover.dataset.pattern = coverPattern(member);
    patchHTML(cover, coverHTML(member));
    const focused = document.activeElement as HTMLElement | null;
    const inside = !!focused && el.contains(focused);
    const typingIn = inside && focused!.matches("input, textarea") ? focused!.id : "";
    const focusKey = inside ? focused!.closest<HTMLElement>("[data-k]")?.dataset.k : undefined;
    const textField = typingIn ? focused as HTMLInputElement | HTMLTextAreaElement : null;
    const selection = textField && typeof textField.selectionStart === "number" ? [textField.selectionStart, textField.selectionEnd!, textField.selectionDirection] as const : null;
    const top = scroll.scrollTop;
    // The name and the role are drawn afresh for another member, and left alone while they are typed in.
    if (!sameMember || !(typingIn === "ms-name" || typingIn === "ms-role")) patchHTML(idSlot, view.kind === "main" ? idHTML(member) : "");
    else patchHTML(idSlot.querySelector<HTMLElement>(".ms-face")!, faceHTML(member, 96) + `<span class="mb-face-pencil" aria-hidden="true">${ico("pencil")}</span>`);
    for (const [id, value] of [["ms-name", member.name], ["ms-role", member.role]]) {
      const input = idSlot.querySelector<HTMLInputElement>(`#${id}`);
      if (input && (!sameMember || id !== typingIn) && input.value !== value) input.value = value;
    }
    drawnFor = member.id;
    patchHTML(main, viewHTML(member));
    if (sameMember && typingIn) {
      const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${CSS.escape(typingIn)}`);
      if (field && document.activeElement !== field) field.focus({ preventScroll: true });
      if (field && selection) field.setSelectionRange(selection[0], selection[1], selection[2] ?? undefined);
    } else if (sameMember && focusKey) el.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    if (sameMember && scroll.scrollTop !== top) scroll.scrollTop = top;
  }

  // ---------- doing ----------

  async function reloadSkills(): Promise<void> {
    const id = host.member().id;
    try {
      const answer = await api.membersSkillsList(id);
      if (id !== host.member().id) return;
      skills = answer.skills ?? [];
    } catch (error) { toaster.info(describeError(error)); }
    draw();
  }
  async function reloadCommands(): Promise<void> {
    const id = host.member().id;
    try {
      const answer = await api.membersCommandsList(id);
      if (id !== host.member().id) return;
      commands = answer.commands ?? [];
    } catch (error) { toaster.info(describeError(error)); }
    draw();
  }
  const back = (): void => { view = { kind: "main" }; draw(); scroll.scrollTop = 0; };

  async function openSkill(id: number): Promise<void> {
    const memberId = host.member().id;
    view = { kind: "skill", id }; skillText = "loading"; draw(); scroll.scrollTop = 0;
    try {
      const answer = await api.membersSkillsRead(memberId, id);
      if (view.kind !== "skill" || view.id !== id || memberId !== host.member().id) return;
      // The list knows whose the skill is (shared, from the library); the read adds its text and its revision.
      const known = Array.isArray(skills) ? skills.find(item => item.id === id) : undefined;
      skillText = { id, skill: { ...known, ...answer.skill }, text: answer.text, revision: answer.skill?.revision ?? undefined };
    } catch (error) { toaster.info(describeError(error)); back(); return; }
    draw();
  }
  async function saveSkill(): Promise<void> {
    if (view.kind !== "skill" || !skillText || skillText === "loading" || skillBusy) return;
    const id = view.id, current = skillText;
    skillBusy = true; draw();
    try {
      await api.core("members.skills.update", { member_id: host.member().id, id, text: current.text, expected_hash: current.revision });
      toaster.info(t("mem.saved"));
      skillBusy = false; back(); await reloadSkills();
    } catch (error) { skillBusy = false; toaster.info(describeError(error)); draw(); }
  }
  async function importSkills(): Promise<void> {
    const value = source.trim();
    if (!value) return;
    try {
      await api.membersSkillsImport(host.member().id, value);
      source = ""; adding = false;
      await reloadSkills();
    } catch (error) { toaster.info(describeError(error)); }
  }
  async function toggleSkill(id: number): Promise<void> {
    const skill = Array.isArray(skills) ? skills.find(item => item.id === id) : undefined;
    if (!skill) return;
    const enabled = !skill.enabled;
    skill.enabled = enabled;
    try { await api.membersSkillsUpdate(host.member().id, id, enabled); } catch (error) { skill.enabled = !enabled; toaster.info(describeError(error)); }
    await reloadSkills();
  }
  async function saveCommand(): Promise<void> {
    const name = command.name.trim().replace(/^\//, "").toLowerCase();
    if (!COMMAND_NAME.test(name) || !command.template.includes("{input}")) { toaster.info(t("members.profile.badCommand", { input: "{input}" })); return; }
    try {
      await api.membersCommandsSave(host.member().id, { ...(command.id === null ? {} : { id: command.id }), name, description: command.description.trim(), template: command.template.trim() });
      back(); await reloadCommands();
    } catch (error) { toaster.info(describeError(error)); }
  }
  async function toggleTool(id: string): Promise<void> {
    const member = host.member();
    if (typeof toolChoices !== "object") return;
    const everything = [...toolChoices.tools, ...toolChoices.connections.filter(connection => connection.enabled).map(connection => connection.id)];
    const on = !(member.tools === null || member.tools.includes(id));
    const base = member.tools ?? everything;
    const next = on ? [...new Set([...base, id])] : base.filter(item => item !== id);
    // Everything on again is the core's own default, 「every one that is on」, which later connections join too.
    const all = everything.every(item => next.includes(item)) && next.every(item => everything.includes(item));
    await host.update(member.id, { tools: all ? null : next });
  }

  async function saveField(input: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
    const member = host.list()?.members.find(item => item.id === Number(input.dataset.member)) ?? (host.member().id === Number(input.dataset.member) ? host.member() : null);
    if (!member) return;
    // Raphael's name and role are not the owner's to type; his personality and instructions are, as everyone's.
    if (member.id === RAPHAEL_ID && (input.id === "ms-name" || input.id === "ms-role")) return;
    if (input.id === "ms-name") {
      const value = cleanName(input.value);
      if (value === member.name) { input.value = member.name; return; }
      const others = (host.list()?.members ?? []).filter(other => other.id !== member.id).map(other => other.name);
      const taken = value !== "" && isMemberNameTaken(value, others);
      if (value === "" || taken) {
        if (taken) toaster.info(t("members.nameTaken", { p0: value }));
        input.value = member.name;
        return;
      }
      input.value = value;
      await host.update(member.id, { name: value });
    } else if (input.id === "ms-role") {
      const value = cleanName(input.value);
      input.value = value;
      if (value !== member.role) await host.update(member.id, { role: value });
    } else if (input instanceof HTMLTextAreaElement && (input.dataset.field === "personality" || input.dataset.field === "instructions")) {
      const field = input.dataset.field;
      // Leaving the field once it is closed (it went out of the page) asks nothing again.
      const key = `${member.id}:${field}`;
      if (saving.has(key)) return;
      const value = input.value.trim();
      editing.delete(field);
      if (value === (member[field] ?? "").trim()) { draw(); return; }
      saving.set(key, value); draw();
      // Saved without a word, as the name and the role beside it are: the row shows the new words (a spinner for the pencil)
      // until the core answers, and a refusal is the host's own note.
      try { await host.update(member.id, { [field]: value }); } finally { saving.delete(key); }
      draw();
    }
  }

  // ---------- input ----------

  el.addEventListener("click", (event) => {
    const target = event.target as Element;
    const act = target.closest<HTMLElement>("[data-ms]");
    if (!act || (act as HTMLButtonElement).disabled) return;
    const member = host.member();
    switch (act.dataset.ms) {
      case "back": if (view.kind === "main") host.back(); else back(); break;
      case "avatar": openMemberAvatarMenu(act, member, host.update); break;
      case "edit": {
        const field = act.dataset.field as Field;
        // A field still on its way to the core is not opened again: its row shows the words being saved.
        if (saving.has(`${member.id}:${field}`)) break;
        editing.add(field); draw();
        // The keyboard comes with the caret at the end of the words, where a person goes on writing.
        const box = el.querySelector<HTMLTextAreaElement>(`#ms-${field}`);
        box?.focus({ preventScroll: true });
        box?.setSelectionRange(box.value.length, box.value.length);
        break;
      }
      case "skill-add": adding = !adding; draw(); if (adding) el.querySelector<HTMLInputElement>("#ms-skill-source")?.focus({ preventScroll: true }); break;
      case "skill-import": void importSkills(); break;
      case "skill-open": void openSkill(Number(act.dataset.id)); break;
      case "skill-toggle": void toggleSkill(Number(act.dataset.id)); break;
      case "skill-save": void saveSkill(); break;
      case "skill-more": {
        const id = view.kind === "skill" ? view.id : -1;
        openConfirmMenu(act, { label: t("members.profile.delete"), ask: t("conn.deleteConfirm"), run: () => void api.membersSkillsDelete(member.id, id).then(() => { back(); return reloadSkills(); }).catch(error => toaster.info(describeError(error))) });
        break;
      }
      case "command-add": command = { id: null, name: "", description: "", template: "" }; view = { kind: "command", id: null }; draw(); scroll.scrollTop = 0; break;
      case "command-open": {
        const found = Array.isArray(commands) ? commands.find(item => item.id === Number(act.dataset.id)) : undefined;
        if (!found) break;
        command = { id: found.id, name: found.name, description: found.description, template: found.template };
        view = { kind: "command", id: found.id }; draw(); scroll.scrollTop = 0;
        break;
      }
      case "command-save": void saveCommand(); break;
      case "command-more": {
        const id = command.id;
        if (id === null) break;
        openConfirmMenu(act, { label: t("members.profile.delete"), ask: t("conn.deleteConfirm"), run: () => void api.membersCommandsDelete(member.id, id).then(() => { back(); return reloadCommands(); }).catch(error => toaster.info(describeError(error))) });
        break;
      }
      case "cat": {
        category = act.dataset.cat as Category;
        draw();
        break;
      }
      case "cover": openCoverMenu(act, member); break;
      case "cover-save": endReposition(true); break;
      case "cover-cancel": endReposition(false); break;
      case "draft": void host.update(member.id, { draft_first: !(member.draft_first ?? true) }); break;
      case "notify": void host.update(member.id, { notify: !(member.notify ?? false) }); break;
      case "tool": void toggleTool(act.dataset.id ?? ""); break;
    }
  });

  el.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (target.id === "ms-skill-source") source = target.value;
    else if (target.id === "ms-skill-text" && skillText && skillText !== "loading") skillText.text = target.value;
    else if (target.id === "ms-command-name") command.name = target.value;
    else if (target.id === "ms-command-description") command.description = target.value;
    else if (target.id === "ms-command-template") command.template = target.value;
  });

  el.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    const field = target instanceof HTMLInputElement && (target.id === "ms-name" || target.id === "ms-role") || target instanceof HTMLTextAreaElement && !!target.dataset.field;
    if (event.key === "Enter" && !event.isComposing && target instanceof HTMLInputElement && (target.id === "ms-name" || target.id === "ms-role")) {
      event.preventDefault();
      target.blur();
    } else if (event.key === "Enter" && !event.isComposing && target.id === "ms-skill-source") {
      event.preventDefault();
      void importSkills();
    } else if (event.key === "Enter" && !event.isComposing && target instanceof HTMLTextAreaElement && target.dataset.field && (event.ctrlKey || event.metaKey || (!event.shiftKey && !target.value.includes("\n")))) {
      // A value of one line is saved by Enter, and any value by Ctrl+Enter; Shift+Enter, or Enter in words of several lines, starts a new line.
      event.preventDefault();
      target.blur();
    } else if (event.key === "Escape" && field) {
      // Leaving a field with Escape puts back what it held and keeps the page.
      event.preventDefault();
      event.stopPropagation();
      const member = host.member();
      if (target instanceof HTMLInputElement) target.value = target.id === "ms-name" ? member.name : member.role;
      else { const name = (target as HTMLTextAreaElement).dataset.field as Field; (target as HTMLTextAreaElement).value = member[name] ?? ""; }
      target.blur();
    }
  });
  el.addEventListener("focusout", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && (target.id === "ms-name" || target.id === "ms-role") || target instanceof HTMLTextAreaElement && target.dataset.field) void saveField(target as HTMLInputElement | HTMLTextAreaElement);
  });
  // Escape anywhere else steps back: out of a view to the page, out of the page to the conversation.
  document.addEventListener("keydown", (event) => {
    if (el.hidden || !el.isConnected || event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    if (document.querySelector("#app-popover, .mb-scrim:not([hidden]), .modal-scrim:not([hidden])")) return;
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    if (typing && el.contains(document.activeElement)) return;
    event.preventDefault();
    // A move of the cover is left first, the picture back where it was.
    if (reposition) endReposition(false);
    else if (view.kind === "main") host.back(); else back();
  });
  onLocaleChange(draw);
  scroll.addEventListener("scroll", () => { el.toggleAttribute("data-scrolled", scroll.scrollTop > 8); }, { passive: true });

  return {
    el,
    isOpen: () => !el.hidden,
    open() {
      if (!el.hidden) { draw(); return; }
      el.hidden = false;
      view = { kind: "main" }; category = CATEGORIES[0].id; editing.clear(); saving.clear(); adding = false; source = ""; skillText = null; skillBusy = false;
      skills = "loading"; commands = "loading"; toolChoices = "loading"; reposition = null; delete cover.dataset.repositioning;
      drawn = ""; drawnFor = null;
      draw();
      scroll.scrollTop = 0; el.removeAttribute("data-scrolled");
      el.focus({ preventScroll: true });
      void load();
    },
    close() {
      if (el.hidden) return;
      el.hidden = true;
      epoch++;
      reposition = null; delete cover.dataset.repositioning;
    },
    draw,
    refresh() { void load(); },
    navView() {
      if (view.kind === "skill") return `${category}/skill:${view.id}`;
      if (view.kind === "command") return `${category}/command:${view.id ?? "new"}`;
      return category;
    },
    showNavView(key) {
      const [tab, inner = ""] = key.split("/");
      const next = CATEGORIES.find(item => item.id === tab)?.id ?? CATEGORIES[0].id;
      const skill = /^skill:(\d+)$/.exec(inner), made = /^command:(\d+|new)$/.exec(inner);
      if (skill) {
        category = next;
        if (view.kind !== "skill" || view.id !== Number(skill[1])) void openSkill(Number(skill[1]));
        return;
      }
      if (made) {
        const found = made[1] === "new" ? null : Array.isArray(commands) ? commands.find(item => item.id === Number(made[1])) : undefined;
        // A command that is gone (or not read yet) leaves the tab it is in.
        if (found !== undefined) {
          category = next;
          command = found ? { id: found.id, name: found.name, description: found.description, template: found.template } : { id: null, name: "", description: "", template: "" };
          view = { kind: "command", id: found ? found.id : null };
          draw(); scroll.scrollTop = 0;
          return;
        }
      }
      if (view.kind === "main" && category === next) return;
      category = next;
      view = { kind: "main" };
      draw(); scroll.scrollTop = 0;
    },
  };
}
