import { iconHTML } from "./connections";
import { RECALL } from "./composer-history";
import { catalogs, getLocale, t } from "./i18n";
import { faceHTML, primaryFirst, primaryIdOf, RAPHAEL_ID } from "./members";
import { bindMentionField, type MentionField } from "./mention-field";
import type { MentionTarget } from "./mention-text";
import { serviceIconOf } from "./service-icons";
import type { AppState, MembersList } from "./types";
import { closeMenu, ico, matchingChoices, menuIsOpenFor, openMenu, type Choice } from "./ui";
import { textPositionRect } from "./text-position";

/** The names the core takes for everyone and for Raphael, in every language (members/rooms.py `_targets`): the catalogue's own words. */
const inEveryLanguage = (key: "team.everyone" | "agent.title"): string[] => Object.values(catalogs).map(catalog => catalog[key]);
const EVERYONE = inEveryLanguage("team.everyone");
const RAPHAEL = inEveryLanguage("agent.title");
type RosterEntry = MentionTarget & { tag?: string; source?: string; /** A member's id. */ id?: number; /** An app's state in the owner's inventory. */ state?: AppState };
type TargetRoster = RosterEntry[];
const targetRosters = new Map<string, TargetRoster>();

/**
 * Prompts, menus and chips consume the same public inventory; apps never become bot recipients. Each leads with who or what
 * it names: a member's face, the app's connection mark, the team icon for everyone and groups.
 */
export function mentionTargets(list: MembersList, allowed?: number[]): TargetRoster {
  const people = primaryFirst<{ id: number; name: string }>(list.team_context?.members ?? list.members, primaryIdOf(list));
  // Presence ticks do not change an address. Keep the roster identity shared by composer and finished messages.
  const version = JSON.stringify([getLocale(), people.map(person => [person.id, person.name, list.members.find(member => member.id === person.id)?.avatar]),
    list.groups.map(group => [group.id, group.name]), list.team_context?.apps, allowed]);
  const known = targetRosters.get(version);
  if (known) return known;
  const team = (): string => ico("grid");
  const targets: TargetRoster = [
    { name: t("team.everyone"), kind: "everyone", aliases: EVERYONE, mark: team },
    ...people.filter(m => !allowed || allowed.includes(m.id)).map(m => ({ id: m.id, name: m.name, kind: "member" as const, aliases: m.id === RAPHAEL_ID ? RAPHAEL : [],
      mark: (size: number) => faceHTML(list.members.find(other => other.id === m.id) ?? m, size) })),
    ...(!allowed ? list.groups.map(g => ({ name: g.name, kind: "group" as const, mark: team })) : []),
    ...[...(list.team_context?.apps ?? [])].sort((a, b) => Number(b.state === "ready") - Number(a.state === "ready") || (b.last_used_at ?? 0) - (a.last_used_at ?? 0)).map(app => ({ name: app.name, kind: "app" as const, aliases: app.aliases, source: app.plugin, state: app.state, mark: () => iconHTML(app.name, app.id === "google" ? "gmail" : serviceIconOf({ name: app.name }), "md"),
      tag: app.state === "needs_sign_in" ? t("rooms.appSignIn") : app.state === "needs_secret" ? t("rooms.appKey") : undefined })),
  ];
  if (targetRosters.size >= 8) targetRosters.delete(targetRosters.keys().next().value!);
  targetRosters.set(version, targets);
  return targets;
}

export interface MentionMenuOptions {
  /** The member whose conversation the field is in: the menu never offers it to itself. */
  self?: number;
  /** Opens where an app is signed in. An app that is not signed in is a way there, not an address. */
  connect?: () => void;
}

/** An app that is not usable yet but one step from it: waiting for a sign-in or for a key. */
const waiting = (app: RosterEntry): boolean => app.state === "needs_sign_in" || app.state === "needs_secret";

/**
 * The @ menu is Grok Bot's (owner, 2026-11-13, R-MENU-01): the other members, then the apps the member can use, each row a mark,
 * the name and, quietly at the right, what it is. No groups, no one for everyone, nothing else: an address that is none of these
 * is still a chip when it is typed. Completion always keeps the focus in the field, including during input-method composition.
 */
export function teamMentions(input: HTMLTextAreaElement, list: MembersList, allowed?: number[], _composing = false, options: MentionMenuOptions = {}): void {
  const before = input.value.slice(0, input.selectionStart), match = /[@＠]([^@＠\n]*)$/.exec(before);
  if (!match || match[1].length > 40) {
    if (menuIsOpenFor(input) && document.querySelector("#app-popover.team-mentions-menu")) closeMenu();
    return;
  }
  const targets = mentionTargets(list, allowed);
  const query = match[1];
  const people = targets.filter(target => target.kind === "member" && target.id !== options.self);
  const apps = targets.filter(target => target.kind === "app" && (target.state === "ready" || waiting(target)));
  const toChoice = (target: RosterEntry): Choice => ({ value: target.name, label: target.name, lead: target.mark(16), tag: target.tag, aliases: target.aliases,
    trail: t(target.kind === "app" ? "completion.kindApp" : "completion.kindMember") });
  const found = (rows: RosterEntry[]): Choice[] => matchingChoices(rows.map(toChoice), query);
  const choices = query ? [...found(people), ...found(apps)].slice(0, 8) : [...people, ...apps.slice(0, 5)].map(toChoice);
  if (!choices.length) { closeMenu(); return; }
  const caret = input.selectionStart;
  const signIn = new Set(apps.filter(waiting).map(app => app.name));
  const pick = (value: string): void => {
    const prefix = before.slice(0, match.index);
    if (options.connect && signIn.has(value) && !people.some(person => person.name === value)) {
      // An app that is not signed in cannot be asked yet: the typed @ goes and the place to sign it in opens.
      input.value = prefix + input.value.slice(caret);
      input.focus(); input.setSelectionRange(prefix.length, prefix.length);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      options.connect();
      return;
    }
    input.value = prefix + match[0][0] + value + " " + input.value.slice(caret);
    input.focus(); input.setSelectionRange(prefix.length + value.length + 2, prefix.length + value.length + 2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const draw = (expanded = false): void => {
    openMenu(input, expanded ? apps.map(toChoice) : choices, "", pick, undefined,
      !query && !expanded && apps.length > 5 ? [{ label: t("completion.all", { count: apps.length }), run: () => draw(true) }] : [],
      { placement: "start", anchorRect: () => textPositionRect(input, match.index), selectionIndicator: false, focus: false, completion: true, className: "team-mentions-menu", pageSize: expanded ? 8 : undefined });
    document.querySelector<HTMLElement>("#app-popover")!.dataset.teamMentions = "true";
  };
  draw();
}

export interface TeamMentionsSource extends MentionMenuOptions { list: MembersList | null; allowed?: number[] }

/** A composer's field: the menu that completes an @ and the chips that show what the words address. */
export function bindComposerMentions(input: HTMLTextAreaElement, source: () => TeamMentionsSource): MentionField {
  bindTeamMentions(input, source);
  return bindMentionField(input, () => { const { list, allowed } = source(); return list ? mentionTargets(list, allowed) : []; });
}

/**
 * The mention menu follows the field, and never takes the focus while an input method composes in it: a focus change ends a
 * composition, and what the input method then commits is typed a second time (a Chinese input method typed `@` twice, in the
 * order composing input, compositionend, blur, focus, input). It is drawn as the words are composed; navigation and selection
 * also leave focus in the field.
 */
export function bindTeamMentions(input: HTMLTextAreaElement, source: () => TeamMentionsSource): void {
  const follow = (composing: boolean): void => { const { list, allowed, self, connect } = source(); if (list) teamMentions(input, list, allowed, composing, { self, connect }); };
  // A recalled message (composer-history.ts) is not typing: it opens no menu.
  input.addEventListener("input", event => { if ((event as InputEvent).inputType !== RECALL) follow((event as InputEvent).isComposing); });
  input.addEventListener("compositionend", () => follow(false));
}
