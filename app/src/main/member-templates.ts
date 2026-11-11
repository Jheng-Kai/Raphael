// Local colleague recipes for common team roles.
import * as api from "./api";
import { cardDisclosureHTML, cardHTML } from "./card";
import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { parseTemplateFile, templateErrorText } from "./template-file";
import { slimeFaceHTML } from "./slime";
import { NAME_MAX, cleanName, routineSentenceHTML } from "./members";
import { SERVICE_ICONS } from "./service-icons";
import type { Member, NewMember, Routine } from "./types";
import { appMarkHTML } from "./connector-card";
import { btn, esc, ico, toaster } from "./ui";

export interface TemplateSkill { text: string; files?: Record<string, string> }
/** What a routine runs and when; it starts paused, and an importer is asked nothing. */
export interface TemplateRoutine { title: string; prompt: string; schedule: Routine["schedule"]; when: Exclude<Routine["when"], undefined> }
/**
 * The recipe a shared member is: exactly the fields core/src/raphael_core/members/templates.py accepts, which refuses any other
 * (core/tests/fixtures/member-template/full.raphael-member pins both sides). Memory and history are never part of it.
 */
export interface MemberTemplate {
  format: "raphael-member"; version: 1;
  name: string; role: string; personality: string; instructions: string; reply_style: "full" | "conversational";
  skills: TemplateSkill[];
  routines: TemplateRoutine[];
  connections: string[];
  /** What it is for, in a sentence the member wrote for strangers (optional). */
  description?: string;
}
const STARTERS = [
  ["coordinator", "rimuru", ""], ["researcher", "souei", ""], ["writer", "shuna", ""], ["developer", "diablo", "github"],
  ["planner", "benimaru", "googlecalendar"], ["analyst", "hakurou", ""], ["editor", "shion", ""], ["inbox", "gobta", "gmail"],
] as const;

export function starterTemplate(index: number): MemberTemplate {
  const [id, , app] = STARTERS[index];
  const keys = {
    coordinator: ["template.coordinator", "template.coordinatorGoal"], researcher: ["template.researcher", "template.researcherGoal"],
    writer: ["template.writer", "template.writerGoal"], developer: ["template.developer", "template.developerGoal"],
    planner: ["template.planner", "template.plannerGoal"], analyst: ["template.analyst", "template.analystGoal"],
    editor: ["template.editor", "template.editorGoal"], inbox: ["template.inbox", "template.inboxGoal"],
  } as const;
  const name = t(keys[id][0]), goal = t(keys[id][1]);
  return {format: "raphael-member", version: 1, name, role: name, personality: "", instructions: goal, reply_style: "full",
    skills: [{text: `---\nname: ${name}\ndescription: ${goal}\n---\n${t("template.method")}`}],
    routines: [{title: t("template.daily"), prompt: goal, schedule: {kind: "daily", time: "09:00"}, when: null}],
    connections: app ? [app] : []};
}

export function openTemplateGallery(create: (member: NewMember) => Promise<Member | null>, groupId: number | null, done: () => void): void {
  const dialog = openDialog({title: t("template.gallery"), body: `<p>${esc(t("template.galleryHelp"))}</p><div class="template-gallery">` +
    STARTERS.map(([, avatar], index) => btn(slimeFaceHTML({id: -index - 1, avatar: `slime:${avatar}`}, 54) + `<span>${esc(starterTemplate(index).name)}</span>`, "template-starter", ` data-dlg="starter" data-index="${index}"`)).join("") + `</div>`,
    actions: {secondary: btn(esc(t("template.open")), "", ' data-dlg="open"')},
    onAct(action, button) {
      if (action === "starter") void previewTemplate(starterTemplate(Number(button.dataset.index)), `slime:${STARTERS[Number(button.dataset.index)][1]}`, create, groupId, () => {dialog.close(); done();});
      if (action === "open") void api.memberTemplateFile("open").then(text => {
        if (text !== null) return previewTemplateFile(text, create, groupId, () => {dialog.close(); done();});
      }).catch(error => toaster.info(templateErrorText(error)));
    }});
}

/**
 * The import review of a template file's text, as the owner chose it in the file dialog or opened it from the file manager:
 * a file that is no template, comes from a newer Raphael or is damaged says so in the owner's words, and nothing is added
 * before the owner presses 加入.
 */
export function previewTemplateFile(text: string, create: (member: NewMember) => Promise<Member | null>, groupId: number | null, done: () => void): Promise<void> {
  let raw: unknown;
  try { raw = parseTemplateFile(text); }
  catch (error) { toaster.info(templateErrorText(error)); return Promise.resolve(); }
  return previewTemplate(raw, "slime:rimuru", create, groupId, done);
}

export interface ScanFinding { kind: "secret" | "injection"; path: string }

function scanLocation(warning: ScanFinding): string {
  const field = warning.path.split(".")[1]?.split("[")[0] || "";
  const labels: Record<string, string> = {name:t("members.name"), role:t("members.role"), instructions:t("members.instructions"), personality:t("members.personality"), skills:t("store.skills"), routines:t("template.routines"), connections:t("template.connections")};
  const index = /\[(\d+)\]/.exec(warning.path);
  return (labels[field] || t("store.facts")) + (index ? ` ${Number(index[1]) + 1}` : "");
}

/** Reuse the local service catalogue's brand spelling, preserving custom server ids. */
export function connectionName(id: string): string {
  const key = id.replace(/^composio:/i, "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(SERVICE_ICONS, key) ? SERVICE_ICONS[key as keyof typeof SERVICE_ICONS].title : id;
}

/** Read plain skill metadata using the same scalar forms accepted by the skill store. */
export function skillContents(text: string): { name: string; description: string; body: string } {
  const frontmatter = /^\uFEFF?[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/.exec(text);
  const values: Record<string, string> = {};
  let field = "";
  for (const line of (frontmatter?.[1] || "").split(/\r?\n/)) {
    if (field && /^\s/.test(line)) { values[field] += " " + line.trim(); continue; }
    field = "";
    const entry = /^(name|description):\s*(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, value] = entry;
    if (/^[|>]-?$/.test(value)) { values[key] = ""; field = key; }
    else values[key] = value.replace(/^["']|["']$/g, "");
  }
  return {name: values.name?.trim() || t("template.skill"), description: values.description?.trim() || "", body: frontmatter ? text.slice(frontmatter[0].length) : text};
}

/**
 * What a member template holds: who it is, then each part as a
 * short card of rows: the instructions and personality as a few lines that open in full, one row per skill (its name and
 * one line; its text behind 顯示內容), one row per routine (its name and when), the apps it needs by their marks. A
 * warning stands at the top only when there is something to warn of: a third-party template being added, or a secret
 * or an injected instruction found in it.
 */
/** The warnings a review shows first: a third-party template, a secret or an injected instruction found in it. */
export function reviewNotes(warnings: ScanFinding[] = [], thirdParty = false): { text: string; risk: boolean }[] {
  const risks = [...new Set(warnings.map(w => t(w.kind === "secret" ? "store.secret" : "store.injection", {p0:scanLocation(w)})))];
  return [...(thirdParty ? [{ text: t("store.thirdParty"), risk: false }] : []), ...risks.map(text => ({ text, risk: true }))];
}

export function templateContents(template: MemberTemplate, warnings: ScanFinding[] = [], o: { thirdParty?: boolean; face?: string } = {}): string {
  const full = (text: string): string => `<pre class="template-text">${esc(text || t("template.none"))}</pre>`;
  const risks = [...new Set(warnings.map(w => t(w.kind === "secret" ? "store.secret" : "store.injection", {p0:scanLocation(w)})))];
  const notes = [...(o.thirdParty ? [t("store.thirdParty")] : []), ...risks];
  const alert = notes.length ? `<div class="tpl-alert${risks.length ? " is-risk" : ""}" role="status">${ico("shield")}<div>${notes.map(text => `<p>${esc(text)}</p>`).join("")}</div></div>` : "";
  const text = (label: string, value: string): string => value.trim()
    ? `<section class="tpl-sec"><h4>${esc(label)}</h4><div class="tpl-card"><p class="tpl-quote" data-tpl-text>${esc(value.trim())}</p>` +
      (value.trim().split(/\n/).length > 4 || value.trim().length > 220 ? btn(esc(t("chat.showAll")), "tpl-more", ' data-tpl-more aria-expanded="false"') : "") + `</div></section>`
    : "";
  const count = (label: string, n: number): string => `<h4>${esc(label)}<span class="tpl-count num">${n}</span></h4>`;
  const skills = template.skills.length ? `<section class="tpl-sec">${count(t("store.skills"), template.skills.length)}<div class="tpl-card">` +
    template.skills.map((skill, index) => {
      const {name, description, body} = skillContents(skill.text);
      return `<div class="tpl-row" data-tpl-skill>${ico("steps")}<div class="tpl-row-t"><b>${esc(name)}</b>${description ? `<span>${esc(description)}</span>` : ""}` +
        cardDisclosureHTML(`template-skill-${index}`, full(body) + Object.entries(skill.files || {}).map(([path, content]) => `<div class="template-field"><h4>${esc(path)}</h4>${full(content)}</div>`).join("")) + `</div></div>`;
    }).join("") + `</div><p class="tpl-foot">${esc(t("store.arriveOff"))}</p></section>` : "";
  const routines = template.routines.length ? `<section class="tpl-sec">${count(t("template.routines"), template.routines.length)}<div class="tpl-card">` +
    template.routines.map((r, index) => `<div class="tpl-row" data-tpl-routine>${ico("repeat")}<div class="tpl-row-t"><b>${esc(r.title)}</b><span>${routineSentenceHTML(r)} · ${esc(t("computer.routinePaused"))}</span>` +
      // A prompt that only repeats the instructions shown above opens nothing new, so it has no disclosure.
      (r.prompt.trim() && r.prompt.trim() !== template.instructions.trim() ? cardDisclosureHTML(`template-routine-${index}`, full(r.prompt)) : "") + `</div></div>`).join("") + `</div></section>` : "";
  const apps = template.connections.length ? `<section class="tpl-sec"><h4>${esc(t("template.connections"))}</h4><div class="tpl-apps">` +
    template.connections.map(app => `<span class="tpl-app">${appMarkHTML(app)}<span>${esc(connectionName(app))}</span></span>`).join("") + `</div></section>` : "";
  return `<div class="tpl-hero">${o.face ? `<span class="tpl-face" aria-hidden="true">${o.face}</span>` : ""}<b>${esc(template.name)}</b>${template.role && template.role !== template.name ? `<span>${esc(template.role)}</span>` : ""}</div>` +
    alert + text(t("members.instructions"), template.instructions) + text(t("members.personality"), template.personality) + skills + routines + apps;
}

// 顯示全部 opens a long instruction or personality in full, and 收起 closes it again.
if (typeof document !== "undefined") document.addEventListener("click", event => {
  const more = (event.target as Element).closest?.<HTMLElement>("[data-tpl-more]");
  if (!more) return;
  const open = more.getAttribute("aria-expanded") !== "true";
  more.setAttribute("aria-expanded", String(open));
  more.textContent = t(open ? "chat.showLess" : "chat.showAll");
  more.parentElement?.querySelector("[data-tpl-text]")?.toggleAttribute("data-open", open);
});

export async function previewTemplate(raw: unknown, avatar: string, create: (member: NewMember) => Promise<Member | null>, groupId: number | null, done: () => void, catalogId?: string): Promise<void> {
  try {
    const {template, findings = []} = await api.core<{template: MemberTemplate; findings?: ScanFinding[]}>("members.template", catalogId ? {action: "catalog-preview", catalog_id: catalogId} : {action: "preview", template: raw});
    let made: Member | null = null, busy = false, typed = template.name, empty = false;
    const connected = new Set<string>();
    // The name to give it, then what it holds, in the dialog itself rather than inside another card. The
    // name is at most what the core takes of any member (NAME_MAX), and what the owner typed stays when adding it is refused.
    const body = (): string => `<div class="tpl-import" data-member-template>` +
      `<label class="mp-label">${esc(t("members.name"))}<input class="mb-fin" data-template-name maxlength="${NAME_MAX}" value="${esc(made?.name || typed)}"${made ? " disabled" : ""}${empty ? ' aria-invalid="true"' : ""}></label>` +
      (empty ? `<p class="note field-error" role="alert">${esc(t("members.nameEmpty"))}</p>` : "") +
      templateContents({...template, connections: []}, findings, {thirdParty: true}) +
      (template.connections.length ? `<section class="tpl-sec"><h4>${esc(t("template.connections"))}</h4>${template.connections.map(app => cardHTML({title: connectionName(app), status: "done", statusText: t("conn.signedIn"), hideStatus: !connected.has(app), attrs: ` data-template-connection="${esc(app)}" data-connected="${connected.has(app)}"`, body: made ? t("template.connectHelp") : undefined, actions: btn(esc(t(connected.has(app) ? "conn.signedIn" : "template.connect")), "sm", ` data-dlg="connect" data-app="${esc(app)}"${!made || busy || connected.has(app) ? " disabled" : ""}`)})).join("")}</section>` : "") + `</div>`;
    const dialog = openDialog({title: t("template.preview"), cls: "template-preview", body: body(),
      // Its × closes it; no 「關閉」 beside 加入.
      actions: {secondary: `<p class="note" data-template-notice>${esc(t("template.noGrants"))}</p>`, primary: {label: esc(t("template.import")), attrs: ' data-dlg="import"'}}, canClose: () => !busy,
      onAct(action, button) {
        if (action === "close") return dialog.close();
        if (busy) return;
        const run = async (): Promise<void> => {
          busy = true; button.setAttribute("disabled", "");
          if (action === "import" && !made) {
            typed = dialog.el.querySelector<HTMLInputElement>("[data-template-name]")!.value;
            const name = cleanName(typed);
            empty = !name;
            if (empty) return;
            made = await create({name, template, avatar, group_id: groupId, ...(catalogId ? {catalog_id: catalogId} : {})});
            if (made) {done(); dialog.el.querySelector('[data-dlg="import"]')?.remove();}
          } else if (action === "connect" && made) {
            const app = button.dataset.app!;
            const id = await connectTemplateApp(app);
            const tools = [...new Set([...(made.tools || []), id])];
            await api.membersUpdate(made.id, {tools}); made = {...made, tools}; connected.add(app);
          }
        };
        void run().catch(error => toaster.info(describeError(error))).finally(() => {
          busy = false;
          if (dialog.el.isConnected) {
            dialog.el.querySelector(".mb-dlg-body")!.innerHTML = body();
            dialog.el.querySelector("[data-template-notice]")!.textContent = t(made ? "template.imported" : "template.noGrants");
            button.removeAttribute("disabled");
          }
        });
      }});
    // Typing a name again takes the complaint back.
    dialog.el.addEventListener("input", event => {
      const field = event.target as Element;
      if (!empty || !field.matches?.("[data-template-name]")) return;
      empty = false;
      field.removeAttribute("aria-invalid");
      dialog.el.querySelector(".field-error")?.remove();
    });
  } catch (error) {toaster.info(templateErrorText(error, catalogId ? "store" : "file"));}
}

async function connectTemplateApp(name: string): Promise<string> {
  const same = (text: string): boolean => text.toLocaleLowerCase() === name.toLocaleLowerCase();
  const {groups} = await api.toolsetsList();
  const existing = groups.find(group => same(group.id) || same(group.name));
  if (existing?.enabled && existing.status === "ready") return existing.id;
  if (existing && !existing.source) {
    const result = await api.integrationsConnect({id: existing.id});
    if (!result.connected) throw new Error(result.error);
    return result.server.id;
  }
  if (existing?.source === "google" || name === "google") {
    const result = await api.connectorsGoogleConnect();
    if (!result.connected) throw new Error(result.error || t("plugins.connectFailed"));
    return "google";
  }
  const {services} = await api.integrationsCatalog();
  const service = services.find(item => same(item.id) || same(item.name));
  if (service && !service.source) {
    const result = await api.integrationsConnect({catalog_id:service.id});
    if (!result.connected) throw new Error(result.error);
    return result.server.id;
  }
  const slug = existing?.id.replace(/^composio:/, "") || service?.id || name.toLowerCase().replace(/^composio:/, "").replace(/\s+/g, "");
  const result = await api.connectorsConnect(slug);
  if (!result.connected) throw new Error(result.error || t("plugins.connectFailed"));
  return `composio:${slug}`;
}
