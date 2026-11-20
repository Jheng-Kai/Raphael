// 團隊技能庫, a tab of Settings (#280): every shared skill, in packages. A plugin set, or the skills of one import (a
// repository, an archive, a folder) are one package; a skill imported alone is a package of one. Each package is for the
// whole team or for the characters chosen, as a private key is (vault.ts); a large one reaches nobody until the owner
// chooses. Its row opens its skills, each with its own switch; its ⋯ updates it from its source or deletes it.
// The importer is the tab's first card (a tab is its name, then its sections: R-UI-115): a skills.sh or GitHub link or
// owner/repo, or pasted SKILL.md text in its place, a .zip, .tar.gz or .md file picked or dropped on the card, or a folder
// picked in the system's dialog, and one 匯入 (#249). The core does the work: skills.library.* (members/service.py).

import { core, pickOutputFolder } from "./api";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { openActions } from "./member-column";
import { btn, closeMenu, esc, fieldHTML, ico, iconBtn, openPopover, tg, toaster } from "./ui";
import "./skill-library.css";

export type Access = "all" | number[];
export interface LibrarySkill { id: number; name: string; description: string; enabled: boolean }
export interface LibraryPackage {
  key: string; name: string; kind: "plugin" | "pack" | "single"; source: string; description: string; version: string;
  enabled: boolean; access: Access; updatable: boolean; skills: LibrarySkill[];
}
export interface LibraryMember { id: number; name: string }
export interface SkillLibraryView {
  packages: LibraryPackage[]; members: LibraryMember[]; loaded: boolean; failed: boolean;
  open: Set<string>; pasting: boolean; busy: boolean; error: string;
}
export const emptySkillLibraryView = (): SkillLibraryView => ({
  packages: [], members: [], loaded: false, failed: false, open: new Set(), pasting: false, busy: false, error: "",
});

/** The causes the core names (the `MemberError` kind that leads its message, members/service.py `_library_error`), in
 *  words; any other is the plain failure. */
const CAUSES = {
  archive: "skillLib.badArchive", file: "skillLib.badArchive", size: "skillLib.tooLarge", not_found: "skillLib.noSkill",
  name: "skillLib.badName", source: "skillLib.unsupported", unsupported: "skillLib.unsupported",
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

function packageHTML(p: LibraryPackage, v: SkillLibraryView): string {
  const open = v.open.has(p.key), count = p.skills.length;
  const head = `<div class="row skl-pack" data-skl-pack="${esc(p.key)}">` +
    `<button type="button" class="btn skl-open" data-skl="open" data-key="${esc(p.key)}" aria-expanded="${open}">` +
    `${ico(open ? "down" : "right")}<span class="skl-name">${esc(p.name)}</span>` +
    (count > 1 ? `<span class="skl-count">${esc(t("skillLib.count", { count }))}</span>` : "") + `</button>` +
    `<div class="ctl">` +
    `<button type="button" class="sel skl-access" data-skl="access" data-key="${esc(p.key)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("vault.access"))}">` +
    `<span>${esc(accessText(p.access, v.members))}</span>${ico("down")}</button>` +
    tg(p.enabled, `${t("members.profile.enable")} ${p.name}`, ` data-skl="toggle" data-key="${esc(p.key)}"`) +
    iconBtn("more", t("members.more", { p0: p.name }), ` data-skl="more" data-key="${esc(p.key)}" aria-haspopup="menu" aria-expanded="false"`) +
    `</div></div>`;
  if (!open) return head;
  // A package of one: its description is the skill's, and its switch is the package's.
  const skills = count > 1 ? p.skills.map(skill => `<div class="row skl-skill">` +
    `<div class="lbl"><div class="t">${esc(skill.name)}</div>${skill.description ? `<div class="d">${esc(skill.description)}</div>` : ""}</div>` +
    `<div class="ctl">${tg(skill.enabled, `${t("members.profile.enable")} ${skill.name}`, ` data-skl="skill" data-key="${esc(p.key)}" data-id="${skill.id}"${p.enabled ? "" : " disabled"}`)}</div></div>`).join("")
    : (p.skills[0]?.description || p.description ? `<p class="d skl-about">${esc(p.skills[0]?.description || p.description)}</p>` : "");
  const source = p.source ? `<p class="d skl-source">${esc(p.source)}${p.version ? ` · ${esc(p.version)}` : ""}</p>` : "";
  return head + `<div class="skl-skills">${source}${skills}</div>`;
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
    btn(ico("pencil") + esc(t("skillLib.paste")), "sm", ` data-skl="paste" aria-pressed="${v.pasting}"${busy}`) +
    `</div>${input}<input type="file" id="skl-file" accept="${ACCEPT}" hidden></div>`;
}

export function skillLibraryHTML(v: SkillLibraryView): string {
  const list = v.failed ? `<p class="d skl-empty" role="alert">${esc(t("skillLib.loadFailed"))}</p>`
    : !v.loaded ? `<p class="d skl-empty">${esc(t("vault.busy"))}</p>`
    : v.packages.length ? `<div class="slist skl-list">${v.packages.map(p => packageHTML(p, v)).join("")}</div>`
    : `<p class="d skl-empty">${esc(t("skillLib.empty"))}</p>`;
  return `<section class="sgroup skl" aria-label="${esc(t("settings.paneSkills"))}">` +
    importHTML(v) + (v.error ? `<p class="notice skl-error" role="alert">${esc(v.error)}</p>` : "") + list + `</section>`;
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

export function createSkillLibrary(root: HTMLElement, redraw: () => void) {
  const state = emptySkillLibraryView();
  let epoch = 0;
  const load = async (): Promise<void> => {
    const request = ++epoch;
    try {
      const result = await core<{ packages: LibraryPackage[]; members: LibraryMember[] }>("skills.library.list", {});
      if (request !== epoch) return;
      state.packages = result.packages; state.members = result.members; state.loaded = true; state.failed = false;
    } catch { if (request === epoch) state.failed = true; }
    if (request === epoch) redraw();
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
  const bring = async (params: Record<string, unknown>): Promise<void> => {
    state.busy = true; state.error = ""; redraw();
    try {
      const { package: made } = await core<{ package: LibraryPackage }>("skills.library.import", params);
      state.pasting = false;
      // It opens, so whom it is for can be chosen at once: a large set reaches nobody until then.
      state.open.add(made.key);
      toaster.info(t("skillLib.imported", { p0: made.name }));
      await load();
    } catch (error) { state.error = failureText(error); }
    finally { state.busy = false; redraw(); }
  };
  const bringFile = async (file: File): Promise<void> => {
    if (file.size > MAX_FILE) { state.error = t("skillLib.tooLarge"); redraw(); return; }
    await bring({ file: { name: file.name, data: base64(await file.arrayBuffer()) } });
  };
  /** Who may use a package: the whole team, or the characters ticked; the menu stays open while names are ticked. */
  const chooseAccess = (anchor: HTMLElement, key: string): void => {
    const items = (access: Access): string =>
      `<button type="button" role="menuitemradio" tabindex="-1" data-access="all" aria-checked="${access === "all"}"><span class="ck">${access === "all" ? ico("check") : ""}</span><span class="mt">${esc(t("vault.everyone"))}</span></button>` +
      `<div class="menu-sep" role="separator"></div>` +
      state.members.map(m => {
        const on = access === "all" || access.includes(m.id);
        return `<button type="button" role="menuitemcheckbox" tabindex="-1" data-member="${m.id}" aria-checked="${on}"><span class="ck">${on ? ico("check") : ""}</span><span class="mt">${esc(m.name)}</span></button>`;
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
  const more = (anchor: HTMLElement, key: string): void => {
    const p = byKey(key);
    if (!p) return;
    openActions(anchor, [
      ...(p.updatable ? [{ id: "refresh", label: t("skillLib.update"), icon: "refresh" as const }] : []),
      { id: "delete", label: t("skillLib.remove"), icon: "trash", ask: t("skillLib.removeAsk") },
    ], picked => {
      if (picked === "refresh") void core<{ package: LibraryPackage }>("skills.library.update", { key, refresh: true })
        .then(result => { replace(result.package); toaster.info(t("skillLib.updated", { p0: result.package.name })); redraw(); })
        .catch(error => toaster.info(failureText(error)));
      else void core("skills.library.delete", { key })
        .then(() => { state.packages = state.packages.filter(other => other.key !== key); state.open.delete(key); redraw(); })
        .catch(error => toaster.info(failureText(error)));
    });
  };
  root.addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLElement>("[data-skl]");
    if (!target || !root.querySelector(".skl")?.contains(target)) return;
    const key = target.dataset.key ?? "";
    switch (target.dataset.skl) {
      case "open":
        if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
        redraw(); break;
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
  return { view: (): SkillLibraryView => state, load, reset: (): void => { epoch++; state.pasting = false; state.error = ""; } };
}
