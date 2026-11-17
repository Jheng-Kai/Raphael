// The composer's + menu (R-UI-166), as Claude's desktop composer has it: the + opens one menu of what can be added to the words.
// 加入檔案或圖片 (with its shortcut), 加入資料夾 (the member's folders, composer-folder.ts), 斜線指令 (a / in the words, which opens the
// / menu as typing it does), then 應用程式 › and 技能 ›, submenus whose rows are switches bound to the settings the member's
// 工具 and 技能與指令 tabs hold, each followed by the way into those tabs. Raphael has no plugins and no connectors: its apps and
// its skills are what they are called elsewhere. The menu is the same one in every member's conversation; a room has no single member
// to name the apps and skills of, so its + opens the file picker alone.
import * as api from "./api";
import { rememberAppLogos } from "./app-logos";
import { describeError } from "./format";
import { t } from "./i18n";
import { shortcutText } from "./keys";
import { connectedApps, toolOn, toolsAfterToggle, type ToolChoices } from "./member-tools";
import { memberAccent, memberColor, memberSwitch } from "./owner-bubble";
import { entryIcon } from "./service-mark";
import type { Member, MemberPatch, MemberSkill, MainEvent } from "./types";
import { type IconName, closeMenu, esc, ico, openPopover, placeMenu, toaster } from "./ui";
import { primaryKey } from "../shared/platform";
import "./composer-plus.css";

export interface ComposerPlusHost {
  /** The composer's field: the / goes into it, the shortcut is heard around it. */
  input: HTMLTextAreaElement;
  /** The open member, as the list has it. */
  member(): Member;
  /** Changes the member and reads the list again; false (with a toast) when the core refused (the settings' own call). */
  update(id: number, patch: MemberPatch): Promise<boolean>;
  /** Opens the file picker. */
  pickFiles(): void;
  /** The member's folders in the composer's row: the row of the menu is offered while that button is, and is its action. */
  folder?: { shown(): boolean; add(): void };
  /** 瀏覽應用程式: the Connect Apps view. */
  browseApps(): void;
  /** 管理應用程式 and 管理技能: this member's settings, on that tab. */
  manage(tab: "tools" | "skills"): void;
  /** A skill was switched: what the / menu lists is read again. */
  skillsChanged?(): void;
  onEvent?(handler: (event: MainEvent) => void): void;
}

type Sub = "apps" | "skills";

/** The shortcut that opens the file picker, written for this system. */
export const filesShortcut = (): string => shortcutText(["Primary", "U"]);

/** Whether a key press is the shortcut of 加入檔案或圖片 (Ctrl+U, ⌘U): the letter it types, else its place on the keyboard. */
export function isFilesShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  if (!primaryKey(event) || event.altKey || event.shiftKey) return false;
  const typed = event.key.toLowerCase();
  return typed === "u" || (!/^[a-z0-9]$/.test(typed) && event.code === "KeyU");
}

/** Puts a / where the caret is, as typing it would (after a space when a word comes before it, since a / inside a word opens nothing), and tells the field. */
export function insertSlash(input: HTMLTextAreaElement): void {
  input.focus({ preventScroll: true });
  const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const text = before && !/\s$/u.test(before) ? " /" : "/";
  input.setRangeText(text, start, end, "end");
  input.setSelectionRange(start + text.length, start + text.length);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

const row = (id: string, icon: IconName, words: string, o: { trail?: string; popup?: boolean } = {}): string =>
  `<button type="button" role="menuitem" tabindex="-1" data-plus="${id}"${o.popup ? ' aria-haspopup="menu" aria-expanded="false"' : ""}><span class="ck">${ico(icon)}</span><span class="mt">${esc(words)}</span>` +
  `${o.trail ? `<span class="mtrail">${esc(o.trail)}</span>` : ""}${o.popup ? ico("right") : ""}</button>`;

/** A row that is a switch: the whole row is the button, so that its fill and its press are the row's (R-UI-157); the switch is drawn on it. */
const switchRow = (attr: string, id: string | number, lead: string, name: string, on: boolean): string =>
  `<button type="button" role="menuitemcheckbox" tabindex="-1" class="pm-switch" ${attr}="${esc(id)}" aria-checked="${on}"><span class="mlead" aria-hidden="true">${lead}</span>` +
  `<span class="mt">${esc(name)}</span><span class="tg" aria-hidden="true"></span></button>`;

export function mountComposerPlus(button: HTMLElement, host: ComposerPlusHost): { destroy(): void } {
  let menu: HTMLElement | null = null, sub: HTMLElement | null = null, subKind: Sub | null = null;
  let choices: ToolChoices | null = null, skills: MemberSkill[] | null = null, skillsOf = -1;
  let asked = 0, serial = 0, pending: { id: number; tools: Member["tools"]; serial: number } | null = null;

  /** What the member may use now: what the switch just pressed says while its change is on its way, else the list's own. */
  const toolsNow = (): Member["tools"] => {
    const member = host.member();
    return pending && pending.id === member.id ? pending.tools : member.tools;
  };
  const mySkills = (): MemberSkill[] | null => (skillsOf === host.member().id ? skills : null);

  // The member's own colour on a switch that is on, as in its panel and settings (R-UI-147): the panel is a menu on the body, so it carries the colour itself.
  function wear(panel: HTMLElement): void {
    const color = memberColor(host.member()), { track, knob } = memberSwitch(color);
    panel.dataset.memberSwitch = "";
    panel.style.setProperty("--member-accent", memberAccent(color));
    panel.style.setProperty("--member-switch", track);
    panel.style.setProperty("--member-knob", knob);
  }

  const rootHTML = (): string =>
    row("files", "attach", t("composerPlus.files"), { trail: filesShortcut() }) +
    (host.folder?.shown() ? row("folder", "folder", t("writeFolders.add")) : "") +
    row("slash", "slash", t("composerPlus.slash")) +
    `<div class="menu-sep" role="separator"></div>` +
    row("apps", "plug", t("conn.apps"), { popup: true }) +
    row("skills", "sparkle", t("members.panelSkills"), { popup: true });

  function appsHTML(): string {
    const apps = choices ? connectedApps(choices) : [];
    const tools = toolsNow();
    return row("browse-apps", "store", t("composerPlus.browseApps")) + row("manage-apps", "gear", t("composerPlus.manageApps")) +
      (apps.length ? `<div class="menu-sep" role="separator"></div><div class="pm-list">${apps.map(app =>
        switchRow("data-app", app.id, entryIcon({ name: app.name, icon: app.id, logo: app.logo }, "md"), app.name, toolOn(tools, app.id))).join("")}</div>` : "");
  }

  function skillsHTML(): string {
    const mine = mySkills() ?? [];
    return (mine.length ? `<div class="pm-list">${mine.map(skill => switchRow("data-skill", skill.id, ico("fileText"), skill.name, skill.enabled)).join("")}</div><div class="menu-sep" role="separator"></div>` : "") +
      row("manage-skills", "sliders", t("composerPlus.manageSkills"));
  }

  /** A name the row cuts short has its whole text as a tooltip, as the shared menu does; a name that fits has none to repeat it. */
  function nameCut(panel: HTMLElement): void {
    panel.querySelectorAll<HTMLElement>(".pm-switch").forEach(button => {
      const label = button.querySelector<HTMLElement>(".mt");
      if (label && label.scrollWidth > label.clientWidth && !button.hasAttribute("title")) button.setAttribute("title", label.textContent ?? "");
    });
  }

  /** The open submenu is drawn again from what is known; the row that had the focus keeps it, and a read that changed nothing touches nothing. */
  function drawSub(): void {
    if (!sub?.isConnected || !subKind) return;
    const html = subKind === "apps" ? appsHTML() : skillsHTML();
    if (sub.dataset.drawn === html) return;
    const at = [...sub.querySelectorAll("button")].indexOf(document.activeElement as HTMLButtonElement);
    sub.innerHTML = html; sub.dataset.drawn = html;
    nameCut(sub); placeMenu();
    if (at >= 0) sub.querySelectorAll("button")[at]?.focus({ preventScroll: true });
  }

  async function read(): Promise<void> {
    const mine = ++asked, member = host.member().id;
    const [tools, list] = await Promise.allSettled([api.membersToolChoices(), api.membersSkillsList(member)]);
    if (mine !== asked || member !== host.member().id) return;
    // A reading that fails changes nothing: the last one stands, and a member's skills are never another's.
    if (tools.status === "fulfilled" && tools.value) { choices = tools.value; rememberAppLogos(choices.connections); }
    if (list.status === "fulfilled") { skills = list.value?.skills ?? []; skillsOf = member; }
    if (!pending) drawSub();
  }

  async function toggleApp(id: string): Promise<void> {
    if (!choices) return;
    const member = host.member(), mine = ++serial;
    pending = { id: member.id, tools: toolsAfterToggle(toolsNow(), choices, id), serial: mine };
    const next = pending.tools;
    paintApps();
    await host.update(member.id, { tools: next });
    // A press after this one answers for itself: only the last one lets go.
    if (pending?.serial === mine) pending = null;
    paintApps();
  }

  function paintApps(): void {
    const tools = toolsNow();
    sub?.querySelectorAll<HTMLElement>("[data-app]").forEach(button => button.setAttribute("aria-checked", String(toolOn(tools, button.dataset.app ?? ""))));
    if (sub && subKind === "apps") sub.dataset.drawn = appsHTML();
  }

  async function toggleSkill(id: number): Promise<void> {
    const skill = mySkills()?.find(item => item.id === id);
    if (!skill) return;
    const member = host.member().id, enabled = !skill.enabled;
    skill.enabled = enabled; paintSkills();
    try { await api.membersSkillsUpdate(member, id, enabled); host.skillsChanged?.(); }
    catch (error) { skill.enabled = !enabled; toaster.info(describeError(error)); }
    paintSkills();
    void read();
  }

  function paintSkills(): void {
    const mine = mySkills();
    sub?.querySelectorAll<HTMLElement>("[data-skill]").forEach(button => button.setAttribute("aria-checked", String(mine?.find(item => item.id === Number(button.dataset.skill))?.enabled ?? false)));
    if (sub && subKind === "skills") sub.dataset.drawn = skillsHTML();
  }

  /** Leaves the menu (the focus is the field's, the button's or the picker's, as each action says) and does what its row says. */
  const leave = (go: () => void): void => { closeMenu(); go(); };

  function openSub(anchor: HTMLElement, kind: Sub): void {
    subKind = kind;
    const html = kind === "apps" ? appsHTML() : skillsHTML();
    sub = openPopover(anchor, html, { className: "menu menu-submenu composer-plus-sub", role: "menu", label: anchor.querySelector(".mt")?.textContent ?? undefined, placement: "beside",
      onClose: () => { sub = null; subKind = null; } });
    sub.dataset.drawn = html;
    wear(sub); nameCut(sub);
    sub.addEventListener("click", press => {
      const target = press.target as Element;
      const app = target.closest<HTMLElement>("[data-app]"), skill = target.closest<HTMLElement>("[data-skill]"), plus = target.closest<HTMLElement>("[data-plus]")?.dataset.plus;
      if (app) void toggleApp(app.dataset.app ?? "");
      else if (skill) void toggleSkill(Number(skill.dataset.skill));
      else if (plus === "browse-apps") leave(() => host.browseApps());
      else if (plus === "manage-apps") leave(() => host.manage("tools"));
      else if (plus === "manage-skills") leave(() => host.manage("skills"));
    });
    sub.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }

  function open(): void {
    menu = openPopover(button, rootHTML(), { className: "menu composer-plus", role: "menu", label: t("composerPlus.label"), placement: "start", onClose: () => { menu = null; } });
    menu.addEventListener("click", press => {
      const item = (press.target as Element).closest<HTMLElement>("[data-plus]");
      if (!item) return;
      switch (item.dataset.plus) {
        case "files": leave(() => host.pickFiles()); break;
        case "folder": leave(() => { button.focus({ preventScroll: true }); host.folder?.add(); }); break;
        case "slash": leave(() => insertSlash(host.input)); break;
        case "apps": openSub(item, "apps"); break;
        case "skills": openSub(item, "skills"); break;
      }
    });
    menu.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    void read();
  }

  button.addEventListener("click", event => {
    event.stopPropagation();
    if (menu?.isConnected) { closeMenu(); return; }
    open();
  });

  // Ctrl+U (⌘U) in the composer opens the picker, whatever has the focus there.
  const form = button.closest("form") ?? host.input;
  const key = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || !isFilesShortcut(event)) return;
    event.preventDefault();
    closeMenu();
    host.pickFiles();
  };
  form.addEventListener("keydown", key as EventListener);

  // What the apps and skills are changes while the menu is open (an app connected in another window, a skill learned): read again, drawn only if it differs.
  host.onEvent?.(event => { if ((event.type === "MembersChanged" || event.type === "ConnectionsChanged") && sub?.isConnected) void read(); });
  return { destroy() { form.removeEventListener("keydown", key as EventListener); closeMenu(); } };
}
