// A template reviewed as separate pages: the face, the name, when it was last updated and what it
// is for; then three rows that open pages - 內容 (instructions, personality, memories and skills, each skill opening its own
// page), 例行工作 (each routine opening its description, content, trigger and what an importer is asked) and 整合 (the
// apps it needs). A page has a back arrow and its title in the dialog's head; the dialog's own buttons stay at its foot.
import { getLocale, t } from "./i18n";
import type { Dialog } from "./member-dialogs";
import { connectionName, skillContents, type MemberTemplate } from "./member-templates";
import { routineSentenceHTML } from "./members";
import { appMarkHTML } from "./connector-card";
import { esc, ico, iconButton } from "./ui";

export type ReviewPage = { kind: "main" } | { kind: "context" } | { kind: "skill"; index: number } | { kind: "routines" } | { kind: "routine"; index: number } | { kind: "integrations" };

export interface ReviewOptions {
  face?: string;
  /** Lines that warn before anything else: a third-party template, a secret or an instruction found in it. */
  notes?: { text: string; risk: boolean }[];
}

const box = (label: string, text: string): string => text.trim()
  ? `<section class="tpr-field"><h4>${esc(label)}</h4><div class="tpr-box">${esc(text.trim())}</div></section>` : "";
const row = (go: string, title: string, hint = "", attrs = ""): string =>
  `<button type="button" class="btn tpr-row" data-tpl-go="${esc(go)}"${attrs}><span class="tpr-row-t"><b>${esc(title)}</b>${hint ? `<span>${esc(hint)}</span>` : ""}</span>${ico("right")}</button>`;
const list = (rows: string[]): string => rows.length ? `<div class="tpr-list">${rows.join("")}</div>` : "";
const smallFace = (o: ReviewOptions): string => o.face ? `<span class="tpr-face is-small" aria-hidden="true">${o.face}</span>` : "";

/** The title and body of one page. */
export function reviewPageHTML(template: MemberTemplate, page: ReviewPage, o: ReviewOptions = {}): { title: string; body: string } {
  const skills = template.skills.map((skill) => skillContents(skill.text)).map((skill) => ({ ...skill, name: skill.name || t("template.review.skill") }));
  const memories = (template.memories ?? []).filter((memory) => memory.trim());
  if (page.kind === "context") {
    return { title: t("template.review.context"), body: smallFace(o) + box(t("members.instructions"), template.instructions) +
      box(t("members.personality"), template.personality) +
      (memories.length ? `<section class="tpr-field"><h4>${esc(t("template.review.memories"))}</h4>${memories.map((memory) => `<div class="tpr-box">${esc(memory)}</div>`).join("")}</section>` : "") +
      (skills.length ? `<section class="tpr-field"><h4>${esc(t("template.review.skills"))}</h4>${list(skills.map((skill, index) => row(`skill:${index}`, skill.name)))}</section>` : "") };
  }
  if (page.kind === "skill") {
    const skill = skills[page.index], files = template.skills[page.index]?.files ?? {};
    if (!skill) return reviewPageHTML(template, { kind: "context" }, o);
    return { title: skill.name, body: box(t("template.review.description"), skill.description) + box(t("template.review.content"), skill.body) +
      Object.entries(files).map(([path, content]) => box(path, content)).join("") };
  }
  if (page.kind === "routines") {
    return { title: t("template.review.routines"), body: smallFace(o) + list(template.routines.map((routine, index) => row(`routine:${index}`, routine.title))) };
  }
  if (page.kind === "routine") {
    const routine = template.routines[page.index];
    if (!routine) return reviewPageHTML(template, { kind: "routines" }, o);
    const when = routineSentence(routine);
    // An older template has no line of description: its trigger below already says when it runs, so nothing repeats it.
    return { title: routine.title, body: box(t("template.review.description"), routine.description ?? "") + box(t("template.review.content"), routine.prompt) +
      box(t("template.review.firesOn"), `${routine.fires_on || when}\n${t("template.review.startsPaused")}`) +
      box(t("template.review.ask"), (routine.ask ?? []).map((item) => `· ${item}`).join("\n")) };
  }
  if (page.kind === "integrations") {
    return { title: t("template.review.integrations"), body: smallFace(o) + `<div class="tpr-list">` + template.connections.map((app) =>
      `<div class="tpr-app">${appMarkHTML(app)}<b>${esc(connectionName(app))}</b></div>`).join("") + `</div>` };
  }
  // The first page: who it is, then a row for each part it holds.
  const parts = [template.instructions.trim() ? t("members.instructions") : "", memories.length ? t("template.review.memories") : "", skills.length ? t("template.review.skills") : ""].filter(Boolean);
  const routines = template.routines.length === 0 ? "" : template.routines.length === 1 ? template.routines[0]!.title
    : t("template.review.routinesMore", { p0: template.routines[0]!.title, p1: template.routines.length - 1 });
  const updated = template.updated_at_ms ? t("template.review.updated", { p0: new Date(template.updated_at_ms).toLocaleDateString(getLocale(), { month: "short", day: "numeric" }) }) : "";
  const about = (template.description || template.role || "").trim();
  const notes = (o.notes ?? []).length ? `<div class="tpl-alert${o.notes!.some((note) => note.risk) ? " is-risk" : ""}" role="status">${ico("shield")}<div>${o.notes!.map((note) => `<p>${esc(note.text)}</p>`).join("")}</div></div>` : "";
  return { title: t("store.review"), body: `<div class="tpr-hero">${o.face ? `<span class="tpr-face" aria-hidden="true">${o.face}</span>` : ""}<b>${esc(template.name)}</b>` +
    (updated ? `<small>${esc(updated)}</small>` : "") + (about && about !== template.name ? `<p>${esc(about)}</p>` : "") + `</div>` + notes +
    list([
      parts.length ? row("context", t("template.review.context"), parts.join(t("home.listJoin"))) : "",
      routines ? row("routines", t("template.review.routines"), routines) : "",
      template.connections.length ? row("integrations", t("template.review.integrations"), template.connections.map(connectionName).join(t("home.listJoin"))) : "",
    ].filter(Boolean)) };
}

/** A routine's schedule in words, as plain text. */
function routineSentence(routine: MemberTemplate["routines"][number]): string {
  const host = document.createElement("span");
  host.innerHTML = routineSentenceHTML(routine);
  return host.textContent ?? "";
}

const pageOf = (go: string): ReviewPage => {
  const [kind, index] = go.split(":");
  return kind === "skill" || kind === "routine" ? { kind, index: Number(index) } as ReviewPage : { kind } as ReviewPage;
};
const parentOf = (page: ReviewPage): ReviewPage => page.kind === "skill" ? { kind: "context" } : page.kind === "routine" ? { kind: "routines" } : { kind: "main" };

/** Runs the pages inside `dialog`: its head shows the page's title and, below the first page, a back arrow. */
export function mountTemplateReview(dialog: Dialog, template: MemberTemplate, o: ReviewOptions = {}): void {
  const head = dialog.el.querySelector<HTMLElement>(".mb-dlg-head")!, title = head.querySelector("h2")!, body = dialog.el.querySelector<HTMLElement>(".mb-dlg-body")!;
  dialog.el.classList.add("tpr");
  let page: ReviewPage = { kind: "main" };
  const show = (next: ReviewPage, focus = false): void => {
    page = next;
    const { title: words, body: html } = reviewPageHTML(template, page, o);
    dialog.el.dataset.page = page.kind;
    title.textContent = words;
    head.querySelector("[data-tpl-back]")?.remove();
    if (page.kind !== "main") head.insertAdjacentHTML("afterbegin", iconButton("left", t("template.review.back"), " data-tpl-back"));
    body.innerHTML = html;
    body.scrollTop = 0;
    if (focus) (head.querySelector<HTMLElement>("[data-tpl-back]") ?? body.querySelector<HTMLElement>("[data-tpl-go]"))?.focus();
  };
  dialog.el.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest("[data-tpl-back]")) { show(parentOf(page), true); return; }
    const go = target.closest<HTMLElement>("[data-tpl-go]");
    if (go?.dataset.tplGo) show(pageOf(go.dataset.tplGo), true);
  });
  show(page);
}
