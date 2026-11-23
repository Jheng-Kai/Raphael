// Team skills is the Settings tab for shared skill packages. A plugin set, or the skills of one import (a
// repository, an archive, a folder) are one package; a skill imported alone is a package of one. Each package is for the
// whole team or for the characters chosen, as a private key is (vault.ts); a large one reaches nobody until the owner
// chooses. A plugin opens on a page of its own in the tab (its name with a back arrow, who may use it, its
// switch and ⋯ as on its row, then its skills, each with its own switch), and the back arrow, Esc or a step back return to
// the list where it was left; its ⋯ updates it from its source or deletes it.
// The importer is the tab's first card (a tab is its name, then its sections: R-UI-115): a skills.sh or GitHub link or
// owner/repo, or pasted SKILL.md text in its place, a .zip, .tar.gz or .md file picked or dropped on the card, or a folder
// picked in the system's dialog, and one 匯入 (#249). The core does the work: skills.library.* (members/service.py).

import { core, membersList, pickOutputFolder } from "./api";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { isTopLayer } from "./dismissals";
import { openActions } from "./member-column";
import { faceHTML, groupFacesHTML, RAPHAEL_ID } from "./members";
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
/** A member's face as the roster draws it: its slime or its picture. */
type Face = Parameters<typeof faceHTML>[0];
export interface SkillLibraryView {
  packages: LibraryPackage[]; members: LibraryMember[]; loaded: boolean; failed: boolean;
  /** The package whose page is open in the list's place, or null for the list. */
  page: string | null; pasting: boolean; busy: boolean; refreshing: Set<string>; error: string;
}
export const emptySkillLibraryView = (): SkillLibraryView => ({
  packages: [], members: [], loaded: false, failed: false, page: null, pasting: false, busy: false, refreshing: new Set(), error: "",
});

/** The causes the core names (the `MemberError` kind that leads its message, members/service.py `_library_error`), in
 *  words; any other is the plain failure. */
const CAUSES = {
  archive: "skillLib.badArchive", file: "skillLib.badArchive", size: "skillLib.tooLarge", not_found: "skillLib.noSkill",
  name: "skillLib.badName", skill: "skillLib.invalidDocument", source: "skillLib.unsupported", unsupported: "skillLib.unsupported",
} as const satisfies Record<string, MessageKey>;
/** The largest file read here: the core's own package limit (MAX_PACKAGE_BYTES). */
const MAX_FILE = 32 * 1024 * 1024;
const ACCEPT = ".zip,.tar.gz,.tgz,.md";

/** Who may use a package, in a few words: the whole team, nobody yet, the names of one or two, or how many. */
export function accessText(access: Access, members: LibraryMember[]): string {
  if (access === "all") return t("vault.everyone");
  if (!access.length) return t("skillLib.nobody");
  const names = access.map(id => members.find(m => m.id === id)?.name).filter((name): name is string => !!name);
  return names.length <= 2 ? names.join("、") : t("skillLib.people", { count: names.length });
}

/** A package's controls, the same on its row and on its page: who may use it, its ⋯ and its switch. */
function controlsHTML(p: LibraryPackage, v: SkillLibraryView): string {
  const busy = v.refreshing.has(p.key) ? " disabled" : "";
  return `<div class="ctl">` +
    (busy ? `<span class="d skl-refresh-status" role="status">${esc(t("desktop.updating"))}</span>` : "") +
    `<button type="button" class="sel skl-access" data-skl="access" data-key="${esc(p.key)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("vault.access"))}"${busy}>` +
    `<span>${esc(accessText(p.access, v.members))}</span>${ico("down")}</button>` +
    iconBtn("more", t("members.more", { p0: p.name }), ` data-skl="more" data-key="${esc(p.key)}" aria-haspopup="menu" aria-expanded="false"${busy}`) +
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
    : '<div class="skl-single" tabindex="-1" data-library-skill="' + (p.skills[0]?.id ?? "") + '">' + words + '</div>';
  return libraryRowHTML("skl-pack", `data-skl-pack="${esc(p.key)}"`, name, controlsHTML(p, v));
}

function libraryLabelHTML(name: string, description: string, count = ""): string {
  return `<span class="lbl skl-label"><span class="t skl-title"><span class="skl-name">${esc(name)}</span>${count}</span>` +
    (description ? `<span class="d skl-description">${esc(description)}</span>` : "") + "</span>";
}

function libraryRowHTML(className: string, attrs: string, label: string, controls: string): string {
  return `<div class="row skl-entry ${className}" ${attrs}>${label}${controls}</div>`;
}

function pluginSkillHTML(p: LibraryPackage, skill: LibrarySkill, v: SkillLibraryView): string {
  const attrs = ` data-key="${esc(p.key)}" data-id="${skill.id}"`;
  const toggle = tg(skill.enabled, `${t("members.profile.enable")} ${skill.name}`, ` data-skl="skill"${attrs}${p.enabled && !v.refreshing.has(p.key) ? "" : " disabled"}`);
  const more = skill.description
    ? iconBtn("more", t("members.more", { p0: skill.name }), ` data-skl="skill-more"${attrs} aria-haspopup="menu" aria-expanded="false"`)
    : "";
  const label = `<div class="skl-single">${libraryLabelHTML(skill.name, skill.description)}</div>`;
  return libraryRowHTML("skl-skill", `tabindex="-1" data-library-skill="${skill.id}"`, label, `<div class="ctl">${more}${toggle}</div>`);
}

function packageSectionHTML(kind: "plugins" | "skills", packages: LibraryPackage[], v: SkillLibraryView): string {
  if (!packages.length) return "";
  return '<section class="sgroup skl-section" data-skl-section="' + kind + '" aria-labelledby="skl-' + kind + '">' +
    '<h2 id="skl-' + kind + '">' + esc(t(kind === "plugins" ? "skillLib.plugins" : "skillLib.skills")) + '</h2>' +
    '<div class="slist skl-list">' + packages.map(p => packageHTML(p, v)).join("") + '</div></section>';
}

/**
 * A package's page, in the list's place: the back arrow and its name, then who may use it, its ⋯ and its switch,
 * where it came from, then its skills, each with its own switch (off while the package is).
 */
function packagePageHTML(p: LibraryPackage, v: SkillLibraryView, headerClose: string, notice: string): string {
  const skills = p.skills.map(skill => pluginSkillHTML(p, skill, v)).join("");
  const source = p.source ? `<p class="d skl-source">${esc(p.source)}${p.version ? ` · ${esc(p.version)}` : ""}</p>` : "";
  return `<section class="skl skl-page" data-skl-page="${esc(p.key)}" aria-labelledby="set-title">` +
    `<div class="skl-pack" data-skl-pack="${esc(p.key)}"><header class="set-head skl-page-head">` +
    `<div class="skl-page-title"><span class="back-title">` + backButton(t("chooser.back"), ' data-skl="back" data-k="skl-back"', "back-link") +
    `<h1 class="skl-page-name" id="set-title" tabindex="-1" data-title-back>${esc(p.name)}</h1></span>` +
    `<span class="skl-count">${esc(t("skillLib.count", { count: p.skills.length }))}</span>` +
    `<div class="skl-page-actions">` + controlsHTML(p, v) + `</div></div>` + headerClose + `</header></div>` + notice + source +
    (p.description ? `<p class="d skl-about">${esc(p.description)}</p>` : "") +
    `<div class="slist skl-skills">${skills}</div></section>`;
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
    `</div>${input}<p class="d skl-import-hint">${esc(t("skillLib.importHint"))}</p>${v.error ? `<p class="skl-error" role="alert">${esc(v.error)}</p>` : ""}<input type="file" id="skl-file" accept="${ACCEPT}" hidden></div>`;
}

export function skillLibraryHTML(v: SkillLibraryView, { listHeader = "", pageClose = "", notice = "" }:
  { listHeader?: string; pageClose?: string; notice?: string } = {}): string {
  const page = v.page ? v.packages.find(p => p.key === v.page) : undefined;
  if (hasPage(page)) return packagePageHTML(page, v, pageClose, notice);
  const list = v.failed ? `<p class="d skl-empty" role="alert">${esc(t("skillLib.loadFailed"))}</p>`
    : !v.loaded ? `<p class="d skl-empty">${esc(t("vault.busy"))}</p>`
    : v.packages.length ? packageSectionHTML("plugins", v.packages.filter(isPlugin), v) +
      packageSectionHTML("skills", v.packages.filter(p => !isPlugin(p)), v)
    : `<p class="d skl-empty">${esc(t("skillLib.empty"))}</p>`;
  return listHeader + notice + `<section class="sgroup skl" aria-label="${esc(t("settings.paneSkills"))}">` +
    importHTML(v) + list + `</section>`;
}

const base64 = (bytes: ArrayBuffer): string => {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let at = 0; at < view.length; at += 0x8000) binary += String.fromCharCode(...view.subarray(at, at + 0x8000));
  return btoa(binary);
};

/** Why an import or a change failed, in the owner's words. */
export function failureText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const kind = /Invalid params: ([a-z_]+): (.*)$/s.exec(raw);
  if (kind?.[1] === "taken") return t("skillLib.duplicate", { p0: /named (\S+)/.exec(kind[2])?.[1] ?? kind[2] });
  return kind && kind[1] in CAUSES ? t(CAUSES[kind[1] as keyof typeof CAUSES]) : t("skillLib.failed");
}

/** `scroller` is what scrolls the tab: the list's place in it is kept while a package's page is open. */
export function createSkillLibrary(root: HTMLElement, redraw: () => void, scroller: () => HTMLElement | null = () => root) {
  const state = emptySkillLibraryView();
  let epoch = 0;
  /** How far the list was scrolled when a package's page took its place. */
  let listScroll = 0;
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
    state.busy = true; state.error = ""; redraw();
    try {
      const { package: made } = await core<{ package: LibraryPackage }>("skills.library.import", params);
      state.pasting = false;
      await load();
      // A plugin opens on its page, so whom it is for can be chosen at once: a large set reaches nobody until then.
      state.busy = false;
      if (hasPage(byKey(made.key))) open(made.key); else redraw();
    } catch (error) { state.error = failureText(error); state.busy = false; redraw(); }
  };
  /** A package's page takes the list's place, from its top; the list's place is kept for the way back. */
  const open = (key: string): void => {
    closeMenu();
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
    state.page = null;
    redraw();
    const box = scroller();
    if (box) box.scrollTop = listScroll;
    root.querySelector<HTMLElement>(`[data-skl="open"][data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  };
  const back = (): void => {
    const key = state.page;
    if (!key) return;
    rememberLayerBack(backToList, () => { if (hasPage(byKey(key))) open(key); });
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
  const showDetails = (anchor: HTMLElement, name: string, description: string): void => {
    const details = openPopover(anchor, `<div class="skl-details"><strong>${esc(name)}</strong><p>${esc(description)}</p></div>`, {
      className: "menu", role: "dialog", label: t("card.details"),
      navigation: { restore: () => {
        const { skl, key, id } = anchor.dataset;
        return () => {
          const trigger = anchor.isConnected ? anchor : [...root.querySelectorAll<HTMLElement>("[data-skl]")].find(el =>
            el.dataset.skl === skl && el.dataset.key === key && el.dataset.id === id);
          if (trigger) showDetails(trigger, name, description);
        };
      } },
    });
    details.focus({ preventScroll: true });
  };
  const more = (anchor: HTMLElement, key: string): void => {
    const p = byKey(key);
    if (!p) return;
    openActions(anchor, [
      ...(descriptionOf(p) ? [{ id: "details", label: t("card.details"), icon: "info" as const }] : []),
      ...(p.updatable ? [{ id: "refresh", label: t("skillLib.update"), icon: "refresh" as const }] : []),
      { id: "delete", label: t("skillLib.remove"), icon: "trash", ask: t("skillLib.removeAsk") },
    ], picked => {
      if (picked === "details") showDetails(anchor, p.name, descriptionOf(p));
      else if (picked === "refresh") void refresh(key);
      else void core("skills.library.delete", { key })
        .then(() => {
          state.packages = state.packages.filter(other => other.key !== key);
          // Deleted from its own page: the list comes back, where it was left.
          if (state.page === key) backToList(); else redraw();
        })
        .catch(error => toaster.info(failureText(error)));
    });
  };
  root.addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLElement>("[data-skl]");
    if (!target?.closest(".skl") || !root.contains(target)) return;
    const key = target.dataset.key ?? "";
    switch (target.dataset.skl) {
      case "open": if (hasPage(byKey(key))) open(key); break;
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
      case "more": more(target, key); break;
      case "skill-more": {
        const skill = byKey(key)?.skills.find(item => item.id === Number(target.dataset.id));
        if (skill?.description) openActions(target, [{ id: "details", label: t("card.details"), icon: "info" }],
          () => showDetails(target, skill.name, skill.description));
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
    reset: (): void => { epoch++; state.pasting = false; state.error = ""; state.page = null; },
  };
}
