import { iconHTML } from "./connections";
import { catalogs, t } from "./i18n";
import { faceHTML, primaryFirst, primaryIdOf, RAPHAEL_ID } from "./members";
import { bindMentionField, type MentionField } from "./mention-field";
import type { MentionTarget } from "./mention-text";
import { serviceIconOf } from "./service-icons";
import type { MembersList } from "./types";
import { closeMenu, ico, menuIsOpenFor, openMenu } from "./ui";
import { textPositionRect } from "./text-position";

const APP_STATES = { ready: "rooms.appConnected", needs_sign_in: "rooms.appSignIn", needs_secret: "rooms.appKey" } as const;

/** The names the core takes for everyone and for Raphael, in every language (members/rooms.py `_targets`): the catalogue's own words. */
const inEveryLanguage = (key: "team.everyone" | "agent.title"): string[] => Object.values(catalogs).map(catalog => catalog[key]);
const EVERYONE = inEveryLanguage("team.everyone");
const RAPHAEL = inEveryLanguage("agent.title");

/**
 * Prompts, menus and chips consume the same public inventory; apps never become bot recipients. Each leads with who or what
 * it names: a member's face, the app's connection mark, the team icon for everyone and groups.
 */
export function mentionTargets(list: MembersList, allowed?: number[]): (MentionTarget & { tag?: string })[] {
  const people = primaryFirst<{ id: number; name: string }>(list.team_context?.members ?? list.members, primaryIdOf(list));
  const team = (): string => ico("grid");
  return [
    { name: t("team.everyone"), kind: "everyone", aliases: EVERYONE, mark: team },
    ...people.filter(m => !allowed || allowed.includes(m.id)).map(m => ({ name: m.name, kind: "member" as const, aliases: m.id === RAPHAEL_ID ? RAPHAEL : [],
      mark: (size: number) => faceHTML(list.members.find(other => other.id === m.id) ?? m, size) })),
    ...(!allowed ? list.groups.map(g => ({ name: g.name, kind: "group" as const, mark: team })) : []),
    ...(list.team_context?.apps ?? []).map(app => ({ name: app.name, kind: "app" as const, mark: () => iconHTML(app.name, serviceIconOf({ name: app.name }), "md"),
      tag: t(APP_STATES[app.state as keyof typeof APP_STATES] ?? "rooms.appUnknown") })),
  ];
}

/** `composing`: an input method is composing in the field, which keeps the focus (see `bindTeamMentions`). */
export function teamMentions(input: HTMLTextAreaElement, list: MembersList, allowed?: number[], composing = false): void {
  const before = input.value.slice(0, input.selectionStart), match = /@([^@\n]*)$/.exec(before);
  if (!match || match[1].length > 40) {
    if (menuIsOpenFor(input) && document.querySelector("#app-popover[data-team-mentions]")) closeMenu();
    return;
  }
  const choices = mentionTargets(list, allowed).map(target => ({ value: target.name, label: "@" + target.name, lead: target.mark(20), tag: target.tag }))
    .filter(c => c.value.toLocaleLowerCase().includes(match[1].toLocaleLowerCase()));
  if (!choices.length) { closeMenu(); return; }
  const caret = input.selectionStart;
  openMenu(input, choices, "", value => {
    const prefix = before.slice(0, match.index);
    input.value = prefix + "@" + value + " " + input.value.slice(caret);
    input.focus(); input.setSelectionRange(prefix.length + value.length + 2, prefix.length + value.length + 2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, undefined, [], { placement: "start", anchorRect: () => textPositionRect(input, match.index), selectionIndicator: false, focus: !composing });
  document.querySelector<HTMLElement>("#app-popover")!.dataset.teamMentions = "true";
  if (!composing) input.focus();
}

export interface TeamMentionsSource { list: MembersList | null; allowed?: number[] }

/** A composer's field: the menu that completes an @ and the chips that show what the words address. */
export function bindComposerMentions(input: HTMLTextAreaElement, source: () => TeamMentionsSource): MentionField {
  bindTeamMentions(input, source);
  return bindMentionField(input, () => { const { list, allowed } = source(); return list ? mentionTargets(list, allowed) : []; });
}

/**
 * The mention menu follows the field, and never takes the focus while an input method composes in it: a focus change ends a
 * composition, and what the input method then commits is typed a second time (a Chinese input method typed `@` twice, in the
 * order composing input, compositionend, blur, focus, input). It is drawn as the words are composed and takes the focus, as
 * before, once they are committed.
 */
export function bindTeamMentions(input: HTMLTextAreaElement, source: () => TeamMentionsSource): void {
  const follow = (composing: boolean): void => { const { list, allowed } = source(); if (list) teamMentions(input, list, allowed, composing); };
  input.addEventListener("input", event => follow((event as InputEvent).isComposing));
  input.addEventListener("compositionend", () => follow(false));
}
