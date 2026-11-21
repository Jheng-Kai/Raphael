import { entryIcon } from "./service-mark";
import { rememberAppLogos } from "./app-logos";
import { RECALL } from "./composer-history";
import { AT_TRIGGER } from "./completion-trigger";
import { catalogs, getLocale, t } from "./i18n";
import { faceHTML, primaryFirst, primaryIdOf, RAPHAEL_ID } from "./members";
import { bindMentionField, type MentionField } from "./mention-field";
import type { MentionTarget } from "./mention-text";
import { serviceIconOf } from "./service-icons";
import type { AppState, MembersList } from "./types";
import { closeMenu, ico, matchingChoices, menuIsOpenFor, openMenu, type Choice } from "./ui";
import { completionAnchor } from "./text-position";

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
    list.groups.map(group => [group.id, group.mention ?? group.name]), list.team_context?.apps, allowed]);
  const known = targetRosters.get(version);
  if (known) return known;
  const team = (): string => ico("grid");
  rememberAppLogos(list.team_context?.apps ?? []);
  const targets: TargetRoster = [
    { name: t("team.everyone"), kind: "everyone", aliases: EVERYONE, mark: team },
    ...people.filter(m => !allowed || allowed.includes(m.id)).map(m => ({ id: m.id, name: m.name, kind: "member" as const, aliases: m.id === RAPHAEL_ID ? RAPHAEL : [],
      mark: (size: number) => faceHTML(list.members.find(other => other.id === m.id) ?? m, size) })),
    ...(!allowed ? list.groups.map(g => ({ name: g.mention ?? g.name, kind: "group" as const, mark: team })) : []),
    ...[...(list.team_context?.apps ?? [])].sort((a, b) => Number(b.state === "ready") - Number(a.state === "ready") || (b.last_used_at ?? 0) - (a.last_used_at ?? 0)).map(app => ({ name: app.name, kind: "app" as const, aliases: app.aliases, source: app.plugin, state: app.state, mark: () => entryIcon({ name: app.name, logo: app.logo, icon: app.id === "google" ? "google" : serviceIconOf({ name: app.name }) }, "md"),
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
const menuChoices = new WeakMap<TargetRoster, { people: { id?: number; choice: Choice }[]; apps: Choice[]; signIn: Set<string> }>();

function rosterChoices(targets: TargetRoster) {
  const cached = menuChoices.get(targets);
  if (cached) return cached;
  const memberLabel = t("completion.kindMember"), appLabel = t("completion.kindApp");
  const toChoice = (target: RosterEntry, trail: string): Choice => {
    let lead: string | undefined;
    return { value: target.name, label: target.name, get lead() { return lead ??= target.mark(16); }, tag: target.tag, aliases: target.aliases,
      trail };
  };
  const people = targets.filter(target => target.kind === "member").map(target => ({ id: target.id, choice: toChoice(target, memberLabel) }));
  const apps = targets.filter(target => target.kind === "app" && (target.state === "ready" || waiting(target)));
  const choices = { people, apps: apps.map(target => toChoice(target, appLabel)), signIn: new Set(apps.filter(waiting).map(target => target.name)) };
  menuChoices.set(targets, choices);
  return choices;
}

/**
 * The @ menu (R-MENU-01): the other members, then the apps the member can use, each row a mark,
 * the name and, quietly at the right, what it is. No groups, no one for everyone, nothing else: an address that is none of these
 * is still a chip when it is typed. Completion always keeps the focus in the field, including during input-method composition.
 */
export function teamMentions(input: HTMLTextAreaElement, list: MembersList, allowed?: number[], _composing = false, options: MentionMenuOptions = {}): void {
  const before = input.value.slice(0, input.selectionStart), match = AT_TRIGGER.exec(before);
  if (!match || match[1].length > 40) {
    if (menuIsOpenFor(input) && document.querySelector("#app-popover.team-mentions-menu")) closeMenu();
    return;
  }
  const indexed = rosterChoices(mentionTargets(list, allowed));
  const query = match[1];
  const people = indexed.people.filter(person => person.id !== options.self).map(person => person.choice);
  const choices = query ? [...matchingChoices(people, query), ...matchingChoices(indexed.apps, query)].slice(0, 8) : [...people, ...indexed.apps];
  if (!choices.length) { closeMenu(); return; }
  const caret = input.selectionStart;
  const pick = (value: string): void => {
    const prefix = before.slice(0, match.index);
    if (options.connect && indexed.signIn.has(value) && !people.some(person => person.value === value)) {
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
  // One list in a menu of a fixed height: the mouse wheel and the arrow keys take it from the first member to the last app.
  openMenu(input, choices, "", pick, undefined, [],
    { placement: "start", anchorRect: completionAnchor(input, match.index), completion: true, className: "team-mentions-menu" });
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
