// Discovery and completion share the mention menu. The core resolves the selected name at send time.
import { membersCommandsList, membersSkillsList } from "./api";
import { eventRead } from './event-read';
import { RECALL } from "./composer-history";
import { t } from "./i18n";
import type { MemberCommand, MemberSkill } from "./types";
import { textPositionRect } from "./text-position";
import { closeMenu, matchingChoices, menuIsOpenFor, openMenu, placeMenu, type Choice } from "./ui";
import { findsName } from "./find-match";
import { slashTrigger, type SlashTrigger } from "./completion-trigger";

export interface SlashMenuOptions { memberId(): number; scope?: object; changed?(): void }
export interface SlashMenu {
  refresh(fromEvent?: boolean): Promise<void>;
  /** The member's skills or commands may have changed: they are read again when the menu is next wanted (at once if it is open). */
  invalidate(): void;
  skills(): readonly MemberSkill[];
  destroy(): void;
}
/** The / the caret stands in the name of, wherever it begins a word (the @ menu's rule: the words before the caret decide). */
const triggerOf = (input: HTMLTextAreaElement | HTMLInputElement): SlashTrigger | undefined => slashTrigger(input.value, input.selectionStart ?? input.value.length);
export const matchingCommands = (commands: readonly MemberCommand[], text: string): MemberCommand[] => {
  const query = slashTrigger(text)?.query;
  return query === undefined ? [] : commands.filter(command => findsName([command.name], query));
};

export function mountSlashMenu(input: HTMLTextAreaElement | HTMLInputElement, options: SlashMenuOptions): SlashMenu {
  let alive = true, generation = 0;
  let loadedFor: number | null = null;
  let stale = false;
  let commands: MemberCommand[] = [], skills: MemberSkill[] = [];
  function close(): void {
    if (menuIsOpenFor(input) && document.querySelector("#app-popover.slash-menu")) closeMenu();
  }
  function draw(): void {
    const trigger = triggerOf(input);
    if (!alive || document.activeElement !== input || loadedFor !== options.memberId() || !trigger) { close(); return; }
    const { query, start } = trigger;
    const choices: Choice[] = [
      ...commands.map(command => ({ value: command.name, label: "/" + command.name, desc: command.description, group: t("completion.commands") })),
      ...skills.filter(skill => skill.enabled).map(skill => ({ value: skill.slash_name ?? skill.name, label: "/" + (skill.slash_name ?? skill.name), desc: skill.description,
        aliases: [skill.name], source: skill.plugin, group: t("completion.skills") })),
    ];
    // As the @ menu: everything on one list that scrolls, and the best eight of what was typed.
    const matched = matchingChoices(choices, query);
    const shown = query ? matched.slice(0, 8) : matched;
    if (!shown.length) { close(); return; }
    const caret = start + 1 + query.length;
    openMenu(input, shown, "", value => {
      // Only the word under the caret is replaced: what stands before and after it stays as it was.
      const rest = input.value.slice(caret), gap = /^\s/u.test(rest) ? "" : " ", at = start + value.length + 2;
      input.value = `${input.value.slice(0, start)}/${value}${gap}${rest}`;
      input.setSelectionRange(at, at);
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, undefined, [], { placement: "start", anchorRect: () => textPositionRect(input, start), selectionIndicator: false, focus: false, completion: true, className: "slash-menu" });
    const panel = document.querySelector<HTMLElement>("#app-popover")!;
    panel.querySelectorAll<HTMLElement>("[data-value]").forEach((row, index) => { row.dataset.slash = String(index); });
    panel.style.minWidth = `${Math.min(360, input.getBoundingClientRect().width, innerWidth - 16)}px`;
    placeMenu();
  }
  async function refresh(fromEvent=false): Promise<void> {
    const mine = ++generation, memberId = options.memberId();
    stale = false;
    close();
    try {
      const [commandAnswer, skillAnswer] = await Promise.all(fromEvent ? [eventRead(`members.commands.list:${memberId}`,()=>membersCommandsList(memberId),options.scope ?? input),eventRead(`members.skills.list:${memberId}`,()=>membersSkillsList(memberId),options.scope ?? input)] : [membersCommandsList(memberId), membersSkillsList(memberId)]);
      if (!alive || mine !== generation || memberId !== options.memberId()) return;
      const previousSkills = skills;
      commands = commandAnswer.commands; skills = skillAnswer.skills;
      const stamp = (known: MemberSkill[]) => JSON.stringify(known.map(skill => [skill.id, skill.enabled, skill.slash_name ?? skill.name]));
      const nextSkills = skillAnswer.skills;
      const changed = loadedFor !== memberId || stamp(previousSkills) !== stamp(nextSkills);
      loadedFor = memberId; draw();
      if (changed) options.changed?.();
    } catch { if (mine === generation) { loadedFor = null; close(); } }
  }
  const onInput = (event?: Event): void => {
    if ((event as InputEvent | undefined)?.inputType === RECALL || !triggerOf(input)) { close(); return; }
    if (loadedFor === options.memberId() && !stale) draw(); else void refresh();
  };
  const onBlur = (): void => { generation++; close(); };
  input.addEventListener("input", onInput);
  input.addEventListener("focus", onInput);
  input.addEventListener("compositionend", onInput);
  input.addEventListener("blur", onBlur);
  return {
    refresh,
    skills: () => loadedFor === options.memberId() ? skills : [],
    invalidate() {
      // Nothing is read for a menu that is closed: a busy team announces its members many times a second.
      if (alive && menuIsOpenFor(input) && document.querySelector("#app-popover.slash-menu")) void refresh(true);
      else stale = true;
    },
    destroy() { alive = false; generation++; close(); input.removeEventListener("input", onInput); input.removeEventListener("focus", onInput); input.removeEventListener("compositionend", onInput); input.removeEventListener("blur", onBlur); } };
}
