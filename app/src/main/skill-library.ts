// Team skills is the Settings tab for shared skill packages. A plugin set, or the skills of one import (a
// repository, an archive, a folder) are one package; a skill imported alone is a package of one. Each package is for the
// whole team or for the characters chosen, as a private key is (vault.ts); a large one reaches nobody until the owner
// chooses. A plugin opens on a page of its own in the tab (its name with a back arrow, who may use it, an update button when it has
// a source, its switch, then its skills, each with its own switch), and the back arrow, Esc or a step back return to the
// list where it was left. Every skill opens on a page of its own that shows its document. A right click on a package's row
// or page offers 更新 and 刪除 (its ⋯ is not drawn: context-menu.ts presses it at the pointer).
// The importer is the tab's first card (a tab is its name, then its sections: R-UI-115): a skills.sh or GitHub link or
// owner/repo, or pasted SKILL.md text in its place, a .zip, .tar.gz or .md file picked or dropped on the card, or a folder
// picked in the system's dialog, and one 匯入 (#249). The core does the work: skills.library.* (members/service.py). An import
// under way says so under the card; a failure says its own cause with the file, size, limit or packages it names (the core's
// `[[json]]` detail, R-SKILL-21); a skill of a package is renamed from its page (R-SKILL-25) and skills of one name prefix
// arrive as one plugin (R-SKILL-20), with no question to the owner (#355).

import { core, membersList, pickOutputFolder } from "./api";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { isTopLayer } from "./dismissals";
import { confirmDelete } from "./member-dialogs";
import { faceHTML, groupFacesHTML, RAPHAEL_ID } from "./members";
import { replyContentHTML } from "./message-content";
import { rememberLayerBack } from "./nav-history";
import { bindNavLayer, keepEditedField } from "./nav-layers";
import { backButton, btn, closeMenu, esc, fieldHTML, ico, iconBtn, openPopover, tg, toaster } from "./ui";
import "./skill-library.css";

export type Access = "all" | number[];
export interface LibrarySkill { id: number; name: string; description: string; enabled: boolean }
export interface LibraryPackage {
  key: string; name: string; kind: "plugin" | "pack" | "single"; source: string; description: string; version: string;
  enabled: boolean; access: Access; updatable: boolean; skills: LibrarySkill[];
}
export interface LibraryMember { id: number; name: string }
/** A skill an import left out because its name was taken, and the package that holds the name. */
export interface SkippedSkill { name: string; held_by: string }
/** A member's face as the roster draws it: its slime or its picture. */
type Face = Parameters<typeof faceHTML>[0];
export interface SkillLibraryView {
  packages: LibraryPackage[]; members: LibraryMember[]; loaded: boolean; failed: boolean;
  /** The package whose page is open in the list's place, or null for the list. */
  page: string | null; pasting: boolean; busy: boolean; refreshing: Set<string>; error: string;
  /** The skill whose page is open (in its package's place), its document once read, or whether reading it failed. */
  skill: number | null; doc: { id: number; text: string } | null; docFailed: boolean;
  /** What the last import left out for the package it made (#313): said under the importer or on that package's page. */
  skipped: { key: string; items: SkippedSkill[] } | null;
  /** The skill whose name is being edited on its page, in place of its title. */
  renaming: number | null;
}
export const emptySkillLibraryView = (): SkillLibraryView => ({
  packages: [], members: [], loaded: false, failed: false, page: null, pasting: false, busy: false, refreshing: new Set(), error: "",
  skill: null, doc: null, docFailed: false, skipped: null, renaming: null,
});

/** The causes the core names (the `MemberError` kind that leads its message, members/service.py `_library_error`), in
 *  words; any other is the plain failure. */
const CAUSES = {
  archive: "skillLib.badArchive", file: "skillLib.badArchive", size: "skillLib.tooLarge", not_found: "skillLib.noSkill",
  name: "skillLib.badName", skill: "skillLib.invalidDocument", source: "skillLib.unsupported", unsupported: "skillLib.unsupported",
} as const satisfies Record<string, MessageKey>;
/** The largest file the window reads and sends: the core's own upload limit (MAX_UPLOAD_BYTES). A folder has none. */
const MAX_FILE = 128 * 1024 * 1024;
const ACCEPT = ".zip,.tar.gz,.tgz,.md";

/** Who may use a package, in a few words: the whole team, nobody yet, the names of one or two, or how many. */
export function accessText(access: Access, members: LibraryMember[]): string {
  if (access === "all") return t("vault.everyone");
  if (!access.length) return t("skillLib.nobody");
  const names = access.map(id => members.find(m => m.id === id)?.name).filter((name): name is string => !!name);
  return names.length <= 2 ? names.join("、") : t("skillLib.people", { count: names.length });
}

/** A package's controls, on its row and on its page: who may use it and its switch; on its page also an update button when
 *  it has a source, and its trash, which asks in the red dialog (Settings has no right click and no ⋯: R-UI-44, R-UI-56). */
function controlsHTML(p: LibraryPackage, v: SkillLibraryView, page = false): string {
  const busy = v.refreshing.has(p.key) ? " disabled" : "";
  return `<div class="ctl">` +
    (busy ? `<span class="d skl-refresh-status" role="status">${esc(t("desktop.updating"))}</span>` : "") +
    `<button type="button" class="sel skl-access" data-skl="access" data-key="${esc(p.key)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("vault.access"))}"${busy}>` +
    `<span>${esc(accessText(p.access, v.members))}</span>${ico("down")}</button>` +
    (page && p.updatable ? iconBtn("refresh", t("skillLib.update"), ` data-skl="refresh" data-key="${esc(p.key)}"${busy}`) : "") +
    (page ? iconBtn("trash", t("skillLib.remove"), ` data-skl="remove" data-key="${esc(p.key)}"${busy}`) : "") +
    tg(p.enabled, `${t("members.profile.enable")} ${p.name}`, ` data-skl="toggle" data-key="${esc(p.key)}"${busy}`) +
    `</div>`;
}

/** A manifest or several skills makes a plugin, including a manifest with only one skill. */
const isPlugin = (p: LibraryPackage): boolean => p.kind === "plugin" || p.skills.length > 1;
const hasPage = (p: LibraryPackage | undefined): p is LibraryPackage => !!p && isPlugin(p);

const descriptionOf = (p: LibraryPackage): string =>
  p.description || (isPlugin(p) ? "" : p.skills[0]?.description ?? "");

function packageHTML(p: LibraryPackage, v: SkillLibraryView): string {
  const plugin = isPlugin(p);
  const count = plugin ? '<span class="skl-count">' + esc(t("skillLib.count", { count: p.skills.length })) + ico("right") + '</span>' : "";
  const words = libraryLabelHTML(p.name, descriptionOf(p), count);
  const name = plugin
    ? '<button type="button" class="btn skl-open" data-skl="open" data-key="' + esc(p.key) + '">' + words + '</button>'
    : '<button type="button" class="btn skl-single skl-doc-open" data-skl="open-skill" data-key="' + esc(p.key) + '" data-id="' + (p.skills[0]?.id ?? "") + '" data-library-skill="' + (p.skills[0]?.id ?? "") + '">' + words + '</button>';
  return libraryRowHTML("skl-pack", `data-skl-pack="${esc(p.key)}"`, name, controlsHTML(p, v));
}

function libraryLabelHTML(name: string, description: string, count = ""): string {
  return `<span class="lbl skl-label"><span class="t skl-title"><span class="skl-name">${esc(name)}</span>${count}</span>` +
    (description ? `<span class="d skl-description">${esc(description)}</span>` : "") + "</span>";
}

function libraryRowHTML(className: string, attrs: string, label: string, controls: string): string {
  return `<div class="row skl-entry ${className}" ${attrs}>${label}${controls}</div>`;
}

/** A skill's own switch, off while its package is. */
const skillToggleHTML = (p: LibraryPackage, skill: LibrarySkill, v: SkillLibraryView): string =>
  tg(skill.enabled, `${t("members.profile.enable")} ${skill.name}`, ` data-skl="skill" data-key="${esc(p.key)}" data-id="${skill.id}"${p.enabled && !v.refreshing.has(p.key) ? "" : " disabled"}`);

/** A pack's skill's pencil, on its own page: its title becomes a field. A plugin's own skills keep the plugin's names. */
const skillRenameHTML = (p: LibraryPackage, skill: LibrarySkill, v: SkillLibraryView): string =>
  p.key.startsWith("set:") ? "" : iconBtn("pencil", t("skillLib.rename"), ` data-skl="skill-rename" data-key="${esc(p.key)}" data-id="${skill.id}"${v.refreshing.has(p.key) ? " disabled" : ""}`);

/** A plugin's skill's trash, on its own page: it asks in the red dialog. */
const skillRemoveHTML = (p: LibraryPackage, skill: LibrarySkill, v: SkillLibraryView): string =>
  iconBtn("trash", t("skillLib.remove"), ` data-skl="skill-remove" data-key="${esc(p.key)}" data-id="${skill.id}"${v.refreshing.has(p.key) ? " disabled" : ""}`);

/** A skill of a plugin: the whole row opens the skill's page, its switch at the right. */
function pluginSkillHTML(p: LibraryPackage, skill: LibrarySkill, v: SkillLibraryView): string {
  const label = `<button type="button" class="btn skl-single skl-doc-open" data-skl="open-skill" data-key="${esc(p.key)}" data-id="${skill.id}">${libraryLabelHTML(skill.name, skill.description)}</button>`;
  return libraryRowHTML("skl-skill", `data-library-skill="${skill.id}"`, label, `<div class="ctl">${skillToggleHTML(p, skill, v)}</div>`);
}

function packageSectionHTML(kind: "plugins" | "skills", packages: LibraryPackage[], v: SkillLibraryView): string {
  if (!packages.length) return "";
  return '<section class="sgroup skl-section" data-skl-section="' + kind + '" aria-labelledby="skl-' + kind + '">' +
    '<h2 id="skl-' + kind + '">' + esc(t(kind === "plugins" ? "skillLib.plugins" : "skillLib.skills")) + '</h2>' +
    '<div class="slist skl-list">' + packages.map(p => packageHTML(p, v)).join("") + '</div></section>';
}

/** A page's header: the way back and the title (both go back, or the field the title becomes while it is renamed), its
 *  controls at the right end, then the shared close. */
const pageHeadHTML = (title: string, controls: string, headerClose: string, renaming = false): string =>
  `<header class="set-head skl-page-head"><div class="skl-page-title"><span class="back-title">` +
  backButton(t("chooser.back"), ' data-skl="back" data-k="skl-back"', "back-link") +
  (renaming
    ? `<span class="skl-rename" id="set-title">${fieldHTML(t("skillLib.rename"), title, { id: "skl-rename", max: 100 })}</span>`
    : `<h1 class="skl-page-name" id="set-title" tabindex="-1" data-title-back>${esc(title)}</h1>`) + `</span>` +
  `<div class="skl-page-actions">${controls}</div></div>${headerClose}</header>`;

/** The words set off as a quote under a page's title: what it is, then where it came from and its version. */
function aboutHTML(description: string, p?: LibraryPackage): string {
  const source = p?.source ? `<p class="skl-source">${esc(p.source)}${p.version ? ` · ${esc(p.version)}` : ""}</p>` : "";
  return description || source ? `<div class="skl-about">${description ? `<p>${esc(description)}</p>` : ""}${source}</div>` : "";
}

/** What an import left out because its name was taken, and who holds each name: said where the import's result is seen. */
function skippedHTML(v: SkillLibraryView, key?: string): string {
  const skipped = v.skipped;
  if (!skipped?.items.length || (key !== undefined && skipped.key !== key)) return "";
  const items = skipped.items.map(item => `<li>${esc(item.held_by ? t("skillLib.leftOutIn", { p0: item.name, p1: item.held_by }) : item.name)}</li>`).join("");
  return `<div class="skl-skipped" role="status"><p>${esc(t("skillLib.leftOut", { count: skipped.items.length }))}</p><ul>${items}</ul></div>`;
}

/**
 * A package's page, in the list's place: the back arrow and its name, who may use it, an update button and its switch,
 * a quote of its words, where it came from and its version, then its skills, each opening its own page.
 */
function packagePageHTML(p: LibraryPackage, v: SkillLibraryView, headerClose: string, notice: string): string {
  const skills = p.skills.map(skill => pluginSkillHTML(p, skill, v)).join("");
  return `<section class="skl skl-page" data-skl-page="${esc(p.key)}" aria-labelledby="set-title">` +
    `<div class="skl-pack" data-skl-pack="${esc(p.key)}">${pageHeadHTML(p.name, controlsHTML(p, v, true), headerClose)}</div>` + notice + skippedHTML(v, p.key) +
    aboutHTML(p.description, p) + `<div class="slist skl-skills">${skills}</div></section>`;
}

/** A skill's document without its front matter (the name and description stand above it already). */
export const documentBody = (text: string): string => text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").trim();

/**
 * A skill's page, in its package's place: the back arrow and its name, its switch (a skill alone has its package's
 * controls), a quote of its words, then its document drawn as a reply draws Markdown.
 */
function skillPageHTML(p: LibraryPackage, skill: LibrarySkill, v: SkillLibraryView, headerClose: string, notice: string): string {
  const alone = !isPlugin(p);
  const head = pageHeadHTML(skill.name, alone ? controlsHTML(p, v, true)
    : `<div class="ctl">${skillRenameHTML(p, skill, v)}${skillRemoveHTML(p, skill, v)}${skillToggleHTML(p, skill, v)}</div>`, headerClose, !alone && v.renaming === skill.id);
  const doc = v.doc?.id === skill.id ? documentBody(v.doc.text) : null;
  const body = doc !== null ? (doc ? replyContentHTML(doc) : "")
    : v.docFailed ? `<p class="d skl-empty" role="alert">${esc(t("skillLib.failed"))}</p>` : `<p class="d skl-empty">${esc(t("vault.busy"))}</p>`;
  return `<section class="skl skl-page skl-doc-page" data-skl-page="${esc(p.key)}" data-skl-doc="${skill.id}" aria-labelledby="set-title">` +
    (alone ? `<div class="skl-pack" data-skl-pack="${esc(p.key)}">${head}</div>` : head) + notice +
    aboutHTML(skill.description, alone ? p : undefined) + `<div class="skl-doc">${body}</div></section>`;
}

function importHTML(v: SkillLibraryView): string {
  const busy = v.busy ? " disabled" : "";
  // The ways in stand first, so that 貼上文字 stays put when the text takes the link's place under them; one 匯入 sends
  // whichever is on the card, beside the link or under the text.
  const go = btn(esc(t("skillLib.import")), "pri skl-go", ` data-skl="import-go"${busy}`);
  const input = v.pasting
    ? `<textarea id="skl-text" class="mb-fin mb-ta skl-text" rows="5" spellcheck="false" placeholder="${esc(t("skillLib.pasteHint"))}" aria-label="${esc(t("skillLib.pasteHint"))}"${busy}></textarea><div class="skl-go-row">${go}</div>`
    : `<div class="skl-link">${fieldHTML(t("members.profile.source"), "", { id: "skl-source", disabled: v.busy })}${go}</div>`;
  return `<div class="skl-import" data-skl-drop><div class="skl-import-alt">` +
    btn(ico("file") + esc(t("skillLib.file")), "sm", ` data-skl="pick-file"${busy}`) +
    btn(ico("folder") + esc(t("skillLib.folder")), "sm", ` data-skl="pick-folder"${busy}`) +
    btn(ico("pencil") + esc(t("skillLib.paste")), "sm", ` data-skl="paste" aria-expanded="${v.pasting}" aria-controls="skl-text"${busy}`) +
    `</div>${input}${v.busy ? `<p class="d skl-progress" role="status">${esc(t("skillLib.importing"))}</p>` : ""}<p class="d skl-import-hint">${esc(t("skillLib.importHint"))}</p>${v.error ? `<p class="skl-error" role="alert">${esc(v.error)}</p>` : ""}<input type="file" id="skl-file" accept="${ACCEPT}" hidden></div>`;
}

export function skillLibraryHTML(v: SkillLibraryView, { listHeader = "", pageClose = "", notice = "" }:
  { listHeader?: string; pageClose?: string; notice?: string } = {}): string {
  const page = v.page ? v.packages.find(p => p.key === v.page) : undefined;
  const skill = v.skill === null ? undefined : page?.skills.find(item => item.id === v.skill);
  if (page && skill) return skillPageHTML(page, skill, v, pageClose, notice);
  if (hasPage(page)) return packagePageHTML(page, v, pageClose, notice);
  const list = v.failed ? `<p class="d skl-empty" role="alert">${esc(t("skillLib.loadFailed"))}</p>`
    : !v.loaded ? `<p class="d skl-empty">${esc(t("vault.busy"))}</p>`
    : v.packages.length ? packageSectionHTML("plugins", v.packages.filter(isPlugin), v) +
      packageSectionHTML("skills", v.packages.filter(p => !isPlugin(p)), v)
    : `<p class="d skl-empty">${esc(t("skillLib.empty"))}</p>`;
  return listHeader + notice + `<section class="sgroup skl" aria-label="${esc(t("settings.paneSkills"))}">` +
    importHTML(v) + skippedHTML(v) + list + `</section>`;
}

const base64 = (bytes: ArrayBuffer): string => {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let at = 0; at < view.length; at += 0x8000) binary += String.fromCharCode(...view.subarray(at, at + 0x8000));
  return btoa(binary);
};

/** What the core says of a cause besides its kind (members/service.py `_library_error`): the file, the size, the limit, the line. */
interface Detail {
  reason?: string; file?: string; size?: number; limit?: number; line?: number; status?: number; repo?: string; name?: string;
  host?: string; skill?: string; held_by?: string; incoming?: string; why?: string;
}

const bytesText = (bytes = 0): string => {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
};

/** A cause the core names with its reason, in words; null when the kind alone says it. */
function reasonText(kind: string, d: Detail): string | null {
  const file = d.file ?? "";
  switch (`${kind}.${d.reason ?? ""}`) {
    case "size.file": return t("skillLib.sizeFile", { p0: file || "SKILL.md", p1: bytesText(d.size), p2: bytesText(d.limit) });
    case "size.package": return t("skillLib.sizePackage", { p0: file, p2: bytesText(d.limit) });
    case "size.files": return t("skillLib.sizeFiles", { p0: String(d.limit ?? "") });
    case "size.upload": return t("skillLib.sizeUpload", { p0: file, p1: bytesText(d.size), p2: bytesText(d.limit) });
    case "size.listing": case "size.scan": case "size.depth": return t("skillLib.sizeListing");
    case "download.network": return t("skillLib.downNetwork");
    case "download.timeout": return t("skillLib.downTimeout");
    case "download.rate_limit": return t("skillLib.downLimit");
    case "download.status": return t("skillLib.downStatus", { p0: String(d.status || "?") });
    case "download.changed": return t("skillLib.downChanged", { p0: file });
    case "not_found.repo": return t("skillLib.notFoundRepo", { p0: d.repo ?? "" });
    case "not_found.no_skill": return t("skillLib.noSkill");
    case "not_found.ref": case "not_found.path": case "not_found.source": case "not_found.skill":
      return t("skillLib.notFoundPath", { p0: d.name ?? file });
    case "skill.front_matter": return t("skillLib.frontMatter", { p0: file || "SKILL.md", p1: String(d.line ?? 1) });
    case "skill.encoding": return t("skillLib.encoding", { p0: file || "SKILL.md" });
    case "archive.path": case "archive.entry": return t("skillLib.badEntry", { p0: file });
    case "archive.unreadable": return t("skillLib.badArchive");
    case "source.host": return t("skillLib.sourceHost", { p0: d.host ?? "" });
    case "source.linked": return t("skillLib.linkRefused", { p0: file });
    case "source.path": case "source.unreadable": case "io.disk": return t("skillLib.unreadable", { p0: file });
    case "source.redirect": case "source.insecure": case "source.invalid": case "source.empty": case "source.not_skill_file":
    case "source.file_type": return t("skillLib.unsupported");
    default: return null;
  }
}

/** Why an import or a change failed, in the owner's words. */
export function failureText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const kind = /Invalid params: ([a-z_]+): (.*)$/s.exec(raw);
  let detail: Detail = {};
  let message = kind?.[2] ?? "";
  const tail = /\s*\[\[(\{.*\})\]\]\s*$/s.exec(message);
  if (tail) {
    message = message.slice(0, tail.index);
    try { detail = JSON.parse(tail[1]!) as Detail; } catch { /* the kind alone says it */ }
  }
  if (kind?.[1] === "taken") {
    // The core names the skill and the package that holds it, and the package that brings the other when it has one:
    // `a skill named tdd already exists in the package "A" (switched off)`.
    if (detail.reason === "clash" && detail.held_by) {
      const names = { p0: detail.skill ?? "", p1: detail.held_by };
      return detail.incoming ? t("skillLib.duplicateBoth", { ...names, p2: detail.incoming }) : t("skillLib.duplicateIn", names);
    }
    const held = /named (\S+) already exists in the package "(.*)"(?: \(switched off\))?$/s.exec(message);
    if (held) return t("skillLib.duplicateIn", { p0: held[1], p1: held[2] });
    return t("skillLib.duplicate", { p0: /named (\S+)/.exec(message)?.[1] ?? message });
  }
  if (kind) {
    const cause = reasonText(kind[1]!, detail);
    if (cause) return cause;
  }
  return kind && kind[1] in CAUSES ? t(CAUSES[kind[1] as keyof typeof CAUSES]) : t("skillLib.failed");
}

/** `scroller` is what scrolls the tab: the list's place in it is kept while a package's page is open. */
export function createSkillLibrary(root: HTMLElement, redraw: () => void, scroller: () => HTMLElement | null = () => root) {
  const state = emptySkillLibraryView();
  let epoch = 0;
  /** How far the list was scrolled when a package's page took its place, and the package's page when a skill's did. */
  let listScroll = 0, pageScroll = 0;
  /** The members' faces by id, from the roster the rest of the window draws them from; without it a face is its id's own colour. */
  let faces = new Map<number, Face>();
  const load = async (skillId: number | null = null): Promise<void> => {
    const request = ++epoch;
    const roster = Promise.resolve().then(() => membersList()).then(list => list.members, () => null);
    try {
      const result = await core<{ packages: LibraryPackage[]; members: LibraryMember[] }>("skills.library.list", {});
      const team = await roster;
      if (request !== epoch) return;
      state.packages = result.packages; state.members = result.members; state.loaded = true; state.failed = false;
      if (team) faces = new Map(team.map(member => [member.id, member]));
    } catch { if (request === epoch) state.failed = true; }
    if (request !== epoch) return;
    redraw();
    if (skillId === null) return;
    const selected = state.packages.find(pkg => pkg.skills.some(skill => skill.id === skillId));
    if (hasPage(selected)) open(selected.key);
    const row = root.querySelector<HTMLElement>(`[data-library-skill="${skillId}"]`);
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  };
  const byKey = (key: string): LibraryPackage | undefined => state.packages.find(p => p.key === key);
  /** A package as the core now has it, in its place in the list. */
  const replace = (p: LibraryPackage): void => {
    const at = state.packages.findIndex(other => other.key === p.key);
    if (at >= 0) state.packages[at] = p; else state.packages.push(p);
  };
  const change = async (params: Record<string, unknown>): Promise<void> => {
    try { replace((await core<{ package: LibraryPackage }>("skills.library.update", params)).package); }
    catch (error) { toaster.info(failureText(error)); await load(); return; }
    redraw();
  };
  const refresh = async (key: string): Promise<void> => {
    state.refreshing.add(key);
    redraw();
    try { replace((await core<{ package: LibraryPackage }>("skills.library.update", { key, refresh: true })).package); }
    catch (error) { toaster.info(failureText(error)); }
    finally { state.refreshing.delete(key); redraw(); }
  };
  const bring = async (params: Record<string, unknown>): Promise<void> => {
    state.busy = true; state.error = ""; state.skipped = null; redraw();
    try {
      const { package: made, skipped } = await core<{ package: LibraryPackage; skipped?: SkippedSkill[] }>("skills.library.import", params);
      state.pasting = false;
      // Skills whose names were taken are not in the library: the owner is told which, and who holds each name (#313).
      state.skipped = skipped?.length ? { key: made.key, items: skipped } : null;
      await load();
      // A plugin opens on its page, so whom it is for can be chosen at once: a large set reaches nobody until then.
      state.busy = false;
      if (hasPage(byKey(made.key))) open(made.key); else redraw();
    } catch (error) { state.error = failureText(error); state.busy = false; redraw(); }
  };
  /** A package's page takes the list's place, from its top; the list's place is kept for the way back. */
  const open = (key: string): void => {
    closeMenu();
    if (state.skipped && state.skipped.key !== key) state.skipped = null;
    listScroll = scroller()?.scrollTop ?? 0;
    state.page = key;
    redraw();
    const box = scroller();
    if (box) box.scrollTop = 0;
    root.querySelector<HTMLElement>('[data-skl="back"]')?.focus({ preventScroll: true });
  };
  /** Back to the list, where it was left, with the focus on the package's row. */
  const backToList = (): void => {
    const key = state.page;
    if (!key) return;
    closeMenu();
    state.page = null; state.skill = null;
    redraw();
    const box = scroller();
    if (box) box.scrollTop = listScroll;
    root.querySelector<HTMLElement>(`[data-skl="open"][data-key="${CSS.escape(key)}"], [data-skl="open-skill"][data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  };
  /** A skill's page takes its package's place (a plugin's page, or the list for a skill alone), from its top, and its
   *  document is read: until then the page says it is reading, and says so if it cannot. */
  const openSkill = (key: string, id: number): void => {
    const p = byKey(key);
    if (!p?.skills.some(skill => skill.id === id)) return;
    closeMenu();
    if (hasPage(p) && state.page === key) pageScroll = scroller()?.scrollTop ?? 0;
    else if (!state.page) listScroll = scroller()?.scrollTop ?? 0;
    state.page = key; state.skill = id; state.docFailed = false;
    if (state.doc?.id !== id) state.doc = null;
    redraw();
    const box = scroller();
    if (box) box.scrollTop = 0;
    root.querySelector<HTMLElement>('[data-skl="back"]')?.focus({ preventScroll: true });
    void core<{ text: string }>("members.skills.read", { member_id: 0, shared: true, id }).then(answer => {
      if (state.skill !== id) return;
      state.doc = { id, text: typeof answer?.text === "string" ? answer.text : "" }; redraw();
    }, () => {
      if (state.skill !== id) return;
      state.docFailed = true; redraw();
    });
  };
  /** Back from a skill's page to its plugin's page where it was left, the focus on the skill's row; a skill alone goes back
   *  to the list. */
  const backFromSkill = (): void => {
    const key = state.page, id = state.skill;
    if (!key || id === null) return;
    if (!hasPage(byKey(key))) { backToList(); return; }
    closeMenu();
    state.skill = null;
    redraw();
    const box = scroller();
    if (box) box.scrollTop = pageScroll;
    root.querySelector<HTMLElement>(`[data-skl="open-skill"][data-id="${id}"]`)?.focus({ preventScroll: true });
  };
  const back = (): void => {
    const key = state.page, id = state.skill;
    if (!key) return;
    if (id !== null) rememberLayerBack(backFromSkill, () => openSkill(key, id));
    else rememberLayerBack(backToList, () => { if (hasPage(byKey(key))) open(key); });
  };
  const bringFile = async (file: File): Promise<void> => {
    if (file.size > MAX_FILE) { state.error = t("skillLib.tooLarge"); redraw(); return; }
    await bring({ file: { name: file.name, data: base64(await file.arrayBuffer()) } });
  };
  /**
   * Who may use a package: the whole team, or the characters ticked; the menu stays open while names are ticked. Each row
   * leads with who it names, as the @ menu does: a character's face, and for the whole team the team's own picture (its
   * first faces in one square, as the sidebar draws the team, Raphael first); the check, when chosen, stands at the right.
   */
  const chooseAccess = (anchor: HTMLElement, key: string): void => {
    const face = (m: LibraryMember): Face => faces.get(m.id) ?? m;
    const team = (): string => groupFacesHTML([{ id: RAPHAEL_ID, name: "" }, ...state.members.filter(m => m.id !== RAPHAEL_ID)].map(face), 20);
    const parts = (lead: string, name: string, on: boolean): string =>
      `<span class="mlead" aria-hidden="true">${lead}</span><span class="mt">${esc(name)}</span><span class="ck">${on ? ico("check") : ""}</span>`;
    const items = (access: Access): string =>
      `<button type="button" role="menuitemradio" tabindex="-1" data-access="all" aria-checked="${access === "all"}">${parts(team(), t("vault.everyone"), access === "all")}</button>` +
      `<div class="menu-sep" role="separator"></div>` +
      state.members.map(m => {
        const on = access === "all" || access.includes(m.id);
        return `<button type="button" role="menuitemcheckbox" tabindex="-1" data-member="${m.id}" aria-checked="${on}">${parts(faceHTML(face(m), 20), m.name, on)}</button>`;
      }).join("");
    const menu = openPopover(anchor, items(byKey(key)?.access ?? "all"), { className: "menu skl-access-menu", role: "menu", label: t("vault.access") });
    menu.addEventListener("click", event => {
      const pick = (event.target as Element).closest<HTMLElement>("[data-access], [data-member]");
      const p = byKey(key);
      if (!pick || !p) return;
      let access: Access;
      if (pick.dataset.access === "all") access = "all";
      else {
        const id = Number(pick.dataset.member);
        const now = p.access === "all" ? state.members.map(m => m.id) : p.access;
        access = now.includes(id) ? now.filter(other => other !== id) : [...now, id];
        if (state.members.length && access.length === state.members.length) access = "all";
      }
      p.access = access;
      menu.innerHTML = items(access);
      (menu.querySelector<HTMLElement>(pick.dataset.access ? "[data-access]" : `[data-member="${pick.dataset.member}"]`))?.focus();
      const label = anchor.querySelector("span");
      if (label) label.textContent = accessText(access, state.members);
      void change({ key, access });
      if (access === "all") { closeMenu(); anchor.focus({ preventScroll: true }); }
    });
  };
  /** A package's trash, on its page: the red dialog asks, and only its red button deletes the package. */
  const removePackage = async (key: string): Promise<void> => {
    const p = byKey(key);
    if (!p || !(await confirmDelete(p.name, { words: { title: t("confirm.removeTitle", { p0: p.name }), hint: t("skillLib.removeHint"), action: t("skillLib.remove") } }))) return;
    await core("skills.library.delete", { key })
      .then(() => {
        state.packages = state.packages.filter(other => other.key !== key);
        // Deleted from its own page: the list comes back, where it was left.
        if (state.page === key) backToList(); else redraw();
      })
      .catch(error => toaster.info(failureText(error)));
  };
  /** After a package changed under an open page: a package that is no longer a plugin, or a skill that is gone, leaves its page. */
  const settle = (): void => {
    const key = state.page;
    if (key && !hasPage(byKey(key))) backToList();
    else if (key && state.skill !== null && !byKey(key)?.skills.some(skill => skill.id === state.skill)) backFromSkill();
    else redraw();
  };
  /** A pack skill's new name from its page's field: the core keeps it through the package's updates. A taken name says who holds it. */
  const renameSkill = async (key: string, id: number, name: string): Promise<void> => {
    const known = byKey(key)?.skills.find(skill => skill.id === id);
    state.renaming = null;
    if (!known || !name.trim() || name.trim() === known.name) { redraw(); return; }
    await change({ key, rename: { id, name: name.trim() } });
    root.querySelector<HTMLElement>('[data-skl="skill-rename"]')?.focus({ preventScroll: true });
  };
  /** A plugin's skill's trash, on the skill's page: the red dialog asks, as a whole package's does. The package stays, unless it
   *  was its last skill. */
  const removeSkill = async (key: string, id: number): Promise<void> => {
    const known = byKey(key)?.skills.find(skill => skill.id === id);
    if (!known || !(await confirmDelete(known.name, { words: { title: t("confirm.removeTitle", { p0: known.name }), hint: t("skillLib.removeHint"), action: t("skillLib.remove") } }))) return;
    await core<{ package?: LibraryPackage }>("skills.library.delete", { key, skill: id })
      .then(answer => {
        if (answer?.package) replace(answer.package);
        else state.packages = state.packages.filter(other => other.key !== key);
        settle();
      })
      .catch(error => { toaster.info(failureText(error)); void load(); });
  };
  root.addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLElement>("[data-skl]");
    if (!target?.closest(".skl") || !root.contains(target)) return;
    const key = target.dataset.key ?? "";
    switch (target.dataset.skl) {
      case "open": if (hasPage(byKey(key))) open(key); break;
      case "open-skill": openSkill(key, Number(target.dataset.id)); break;
      case "refresh": void refresh(key); break;
      case "back": back(); break;
      case "toggle": {
        const p = byKey(key);
        if (p) { p.enabled = !p.enabled; redraw(); void change({ key, enabled: p.enabled }); }
        break;
      }
      case "skill": {
        const skill = byKey(key)?.skills.find(item => item.id === Number(target.dataset.id));
        if (skill) { skill.enabled = !skill.enabled; redraw(); void change({ key, skill: { id: skill.id, enabled: skill.enabled } }); }
        break;
      }
      case "access": chooseAccess(target, key); break;
      case "remove": void removePackage(key); break;
      case "skill-remove": void removeSkill(key, Number(target.dataset.id)); break;
      case "skill-rename": {
        state.renaming = Number(target.dataset.id);
        redraw();
        const field = root.querySelector<HTMLInputElement>("#skl-rename");
        field?.focus();
        field?.select();
        break;
      }
      case "import-go": {
        const text = root.querySelector<HTMLTextAreaElement>("#skl-text")?.value ?? "";
        const source = root.querySelector<HTMLInputElement>("#skl-source")?.value.trim() ?? "";
        if (state.pasting ? text.trim() : source) void bring(state.pasting ? { text } : { source });
        break;
      }
      case "paste":
        state.pasting = !state.pasting; state.error = ""; redraw();
        root.querySelector<HTMLElement>(state.pasting ? "#skl-text" : "#skl-source")?.focus();
        break;
      case "pick-file": root.querySelector<HTMLInputElement>("#skl-file")?.click(); break;
      case "pick-folder":
        void pickOutputFolder().then(path => { if (path) void bring({ source: `local:${path}` }); }).catch(error => toaster.info(failureText(error)));
        break;
    }
  });
  root.addEventListener("keydown", event => {
    const input = event.target as HTMLElement;
    if (input.id === "skl-rename" && !event.isComposing && (event.key === "Enter" || event.key === "Escape")) {
      event.preventDefault();
      const page = root.querySelector<HTMLElement>("[data-skl-doc]");
      const key = page?.dataset.sklPage ?? "", id = Number(page?.dataset.sklDoc);
      if (event.key === "Enter") void renameSkill(key, id, (input as HTMLInputElement).value);
      else { state.renaming = null; redraw(); root.querySelector<HTMLElement>('[data-skl="skill-rename"]')?.focus({ preventScroll: true }); }
      return;
    }
    if (input.id === "skl-source" && event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      root.querySelector<HTMLElement>('[data-skl="import-go"]')?.click();
    }
    // Esc on a package's page goes back to the list before it closes Settings; a menu open over it takes it first.
    const page = root.querySelector<HTMLElement>(".skl-page");
    const dialog = page?.closest<HTMLElement>(".modal");
    if (event.key === "Escape" && page && !event.defaultPrevented && (!dialog || isTopLayer(dialog))) {
      event.preventDefault();
      back();
    }
  });
  root.addEventListener("focusout", event => {
    // A name left half-typed is dropped, as a field of Settings that was not confirmed.
    if ((event.target as HTMLElement).id === "skl-rename" && state.renaming !== null && root.contains(event.target as Node)) {
      state.renaming = null;
      redraw();
    }
  });
  root.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (input.id !== "skl-file" || !input.files?.[0]) return;
    const file = input.files[0];
    input.value = "";
    void bringFile(file);
  });
  root.addEventListener("dragover", event => {
    if ((event.target as Element).closest?.("[data-skl-drop]") && event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  root.addEventListener("drop", event => {
    if (!(event.target as Element).closest?.("[data-skl-drop]")) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    void bringFile(file);
  });
  return {
    view: (): SkillLibraryView => state,
    load,
    /** After each drawing: a package's page is a step of its own, so a step back (a side button, Alt+Left) returns to the list. */
    painted(): void {
      const page = root.querySelector<HTMLElement>(".skl-page");
      if (page) bindNavLayer(page, back, { step: direction => state.busy || direction === "back" && keepEditedField(page) });
    },
    reset: (): void => { epoch++; state.skipped = null; state.pasting = false; state.error = ""; state.page = null; state.skill = null; state.doc = null; state.renaming = null; },
  };
}
