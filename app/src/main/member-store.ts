// Catalogue browsing uses the existing member-template preview and install boundary.
import "./member-store.css";
import * as api from "./api";
import { t } from "./i18n";
import { type Dialog, openDialog } from "./member-dialogs";
import { openTemplateGallery, previewTemplate } from "./member-templates";
import { slimeFaceHTML } from "./slime";
import type { Member, NewMember } from "./types";
import { btn, esc } from "./ui";
import { findsName } from "./find-match";

export interface CatalogEntry {
  id: string; name: string; creator: string; category: string; summary: string; avatar: string; featured: boolean;
}
const categories = ["engineering", "sales", "marketing", "design", "personal", "hr", "product", "operations"] as const;
const categoryKeys = {engineering:"store.engineering",sales:"store.sales",marketing:"store.marketing",design:"store.design",personal:"store.personal",hr:"store.hr",product:"store.product",operations:"store.operations"} as const;

/**
 * The store, on a page of its own where the conversation stands (the sidebar's + › 商店). It is no part of 新增成員, which asks only a
 * name (member-creator.ts); the starter templates and 開啟檔案 are one button beside the search, for they too are ready-made members.
 */
export function openMemberStore(o: { groupId: number | null; create(member: NewMember): Promise<Member | null> }): Dialog {
  const dialog = openDialog({ title: t("store.title"), cls: "store-dialog", body: `<section class="member-store"></section>`, actions: {}, onAct() {} });
  dialog.el.closest(".mb-scrim")!.classList.add("store-scrim");
  mountMemberStore(dialog.el.querySelector<HTMLElement>(".member-store")!, o.create, o.groupId, () => dialog.close());
  dialog.el.querySelector<HTMLElement>("[data-store-search]")!.focus({ preventScroll: true });
  return dialog;
}

export function mountMemberStore(root: HTMLElement, create: (member: NewMember) => Promise<Member | null>, groupId: number | null, done: () => void): void {
  let entries: CatalogEntry[] = [], category = "", query = "", offline = false, closed = false;
  root.innerHTML =
    `<div class="store-bar"><label class="mp-label">${esc(t("store.search"))}<input class="mb-fin" data-store-search type="search"></label>${btn(esc(t("template.gallery")), "", ' data-dlg="templates"')}</div>` +
    `<div class="store-categories" role="group" aria-label="${esc(t("store.categories"))}">${["", ...categories].map(id => btn(esc(id ? t(categoryKeys[id as typeof categories[number]]) : t("store.all")), "sm", ` data-dlg="category" data-category="${id}" aria-pressed="${!id}"`)).join("")}</div>` +
    `<div class="store-results" aria-live="polite"><p class="note">${esc(t("store.loading"))}</p></div>`;
  root.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("[data-dlg]");
    if (!button) return;
    const action = button.dataset.dlg;
    if (action === "category") {category = button.dataset.category!; draw();}
    if (action === "templates") openTemplateGallery(create, groupId, done);
    if (action === "store-preview") {
      const entry = entries.find(e => e.id === button.dataset.id)!;
      void previewTemplate(null, `slime:${entry.avatar}`, create, groupId, done, entry.id);
    }
  });
  function draw(): void {
    if (!root.isConnected) return;
    for (const chip of root.querySelectorAll<HTMLElement>("[data-category]")) chip.setAttribute("aria-pressed", String(chip.dataset.category === category));
    const filtered = entries.filter(e => (!category || e.category === category) && (`${e.name} ${e.creator} ${e.summary}`.toLocaleLowerCase().includes(query) || findsName([e.name, e.creator], query)));
    const card = (e: CatalogEntry): string => `<article class="store-entry">${slimeFaceHTML({id:-1,avatar:`slime:${e.avatar}`}, 54)}<div><h3>${esc(e.name)}</h3><p class="note">${esc(t("store.creator", {p0:e.creator}))}</p><p class="store-summary" title="${esc(e.summary)}">${esc(e.summary)}</p></div>${btn(esc(t("template.import")), "sm", ` data-dlg="store-preview" data-id="${esc(e.id)}"`)}</article>`;
    const featured = !category && !query ? filtered.filter(e => e.featured) : [];
    // A store with no key to check its catalogue by is not open yet (the core says so): nothing to browse, and no pretence of a network failure.
    for (const control of root.querySelectorAll<HTMLElement>(".mp-label, .store-categories")) control.hidden = closed;    if (closed) { root.querySelector(".store-results")!.innerHTML = `<p class="note" data-store-closed>${esc(t("store.notOpen"))}</p>`; return; }
    root.querySelector(".store-results")!.innerHTML = (offline ? `<p class="note">${esc(t(entries.length ? "store.cached" : "store.empty"))}</p>` : "") +
      (featured.length ? `<h3>${esc(t("store.featured"))}</h3><div class="store-featured">${featured.map(card).join("")}</div>` : "") +
      (filtered.length ? `<h3>${esc(t("store.all"))}</h3><div class="store-grid">${filtered.map(card).join("")}</div>` : offline ? "" : `<p class="note">${esc(t("store.empty"))}</p>`);
  }
  root.querySelector<HTMLInputElement>("[data-store-search]")!.addEventListener("input", event => {query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase(); draw();});
  void api.core<{entries: CatalogEntry[]; offline: boolean; open?: boolean}>("members.template", {action:"catalog"}).then(result => {entries = result.entries; offline = result.offline; closed = result.open === false; draw();}).catch(() => {offline = true; draw();});
}
