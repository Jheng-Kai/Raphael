// Discovery and completion share the mention menu. The core resolves the selected name at send time.
import { membersCommandsList, membersSkillsList } from "./api";
import { eventRead } from './event-read';
import { RECALL } from "./composer-history";
import { t } from "./i18n";
import type { MemberCommand, MemberSkill } from "./types";
import { textPositionRect } from "./text-position";
import { closeMenu, matchingChoices, menuIsOpenFor, openMenu, placeMenu, type Choice } from "./ui";
import { findsName } from "./find-match";

export interface SlashMenuOptions { memberId(): number; scope?: object }
export interface SlashMenu { refresh(fromEvent?: boolean): Promise<void>; destroy(): void }
const queryOf = (text: string): string | undefined => /^\/([^\s/]*)$/u.exec(text)?.[1];
export const matchingCommands = (commands: readonly MemberCommand[], text: string): MemberCommand[] => {
  const query = queryOf(text);
  return query === undefined ? [] : commands.filter(command => findsName([command.name], query));
};

export function mountSlashMenu(input: HTMLTextAreaElement | HTMLInputElement, options: SlashMenuOptions): SlashMenu {
  let alive = true, generation = 0;
  let loadedFor: number | null = null;
  let commands: MemberCommand[] = [], skills: MemberSkill[] = [];
  function close(): void {
    if (menuIsOpenFor(input) && document.querySelector("#app-popover.slash-menu")) closeMenu();
  }
  function draw(): void {
    const query = queryOf(input.value);
    if (!alive || document.activeElement !== input || loadedFor !== options.memberId() || query === undefined) { close(); return; }
    const choices: Choice[] = [
      ...commands.map(command => ({ value: command.name, label: "/" + command.name, desc: command.description, group: t("completion.commands") })),
      ...skills.filter(skill => skill.enabled).map(skill => ({ value: skill.slash_name ?? skill.name, label: "/" + (skill.slash_name ?? skill.name), desc: skill.description,
        aliases: [skill.name], source: skill.plugin, group: t("completion.skills") })),
    ];
    const matched = matchingChoices(choices, query);
    const shown = query ? matched.slice(0, 8) : matched;
    if (!shown.length) { close(); return; }
    openMenu(input, shown, "", value => {
      input.value = `/${value} `;
      input.setSelectionRange(input.value.length, input.value.length);
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, undefined, [], { placement: "start", anchorRect: () => textPositionRect(input, 0), selectionIndicator: false, focus: false, completion: true, className: "slash-menu" });
    const panel = document.querySelector<HTMLElement>("#app-popover")!;
    panel.querySelectorAll<HTMLElement>("[data-value]").forEach((row, index) => { row.dataset.slash = String(index); });
    panel.style.minWidth = `${Math.min(360, input.getBoundingClientRect().width, innerWidth - 16)}px`;
    placeMenu();
  }
  async function refresh(fromEvent=false): Promise<void> {
    const mine = ++generation, memberId = options.memberId();
    close();
    try {
      const [commandAnswer, skillAnswer] = await Promise.all(fromEvent ? [eventRead(`members.commands.list:${memberId}`,()=>membersCommandsList(memberId),options.scope ?? input),eventRead(`members.skills.list:${memberId}`,()=>membersSkillsList(memberId),options.scope ?? input)] : [membersCommandsList(memberId), membersSkillsList(memberId)]);
      if (!alive || mine !== generation || memberId !== options.memberId()) return;
      commands = commandAnswer.commands; skills = skillAnswer.skills;
      loadedFor = memberId; draw();
    } catch { if (mine === generation) { loadedFor = null; close(); } }
  }
  const onInput = (event?: Event): void => {
    if ((event as InputEvent | undefined)?.inputType === RECALL || queryOf(input.value) === undefined) { close(); return; }
    if (loadedFor === options.memberId()) draw(); else void refresh();
  };
  const onBlur = (): void => { generation++; close(); };
  input.addEventListener("input", onInput);
  input.addEventListener("focus", onInput);
  input.addEventListener("compositionend", onInput);
  input.addEventListener("blur", onBlur);
  return { refresh, destroy() { alive = false; generation++; close(); input.removeEventListener("input", onInput); input.removeEventListener("focus", onInput); input.removeEventListener("compositionend", onInput); input.removeEventListener("blur", onBlur); } };
}
