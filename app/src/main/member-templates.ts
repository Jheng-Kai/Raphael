// Local colleague recipes inspired by Grok Bot; see core/packaging/licenses/NOTICES.md.
import * as api from "./api";
import { cardDisclosureHTML, cardHTML } from "./card";
import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { slimeFaceHTML } from "./slime";
import { routineSentenceHTML } from "./members";
import { SERVICE_ICONS } from "./service-icons";
import type { Member, NewMember, Routine } from "./types";
import { btn, esc, row, toaster } from "./ui";

export interface MemberTemplate {
  format: "raphael-member"; version: 1;
  name: string; role: string; personality: string; instructions: string; reply_style: "full" | "conversational";
  skills: { text: string; files?: Record<string, string> }[];
  routines: Pick<Routine, "title" | "prompt" | "schedule" | "when">[];
  connections: string[];
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
        if (text !== null) return previewTemplate(JSON.parse(text), "slime:rimuru", create, groupId, () => {dialog.close(); done();});
      }).catch(error => toaster.info(describeError(error)));
    }});
}

export interface ScanFinding { kind: "secret" | "injection"; path: string }

function scanLocation(warning: ScanFinding): string {
  const field = warning.path.split(".")[1]?.split("[")[0] || "";
  const labels: Record<string, string> = {name:t("members.name"), role:t("members.role"), instructions:t("members.instructions"), personality:t("members.personality"), skills:t("store.skills"), routines:t("template.routines"), connections:t("template.connections")};
  const index = /\[(\d+)\]/.exec(warning.path);
  return (labels[field] || t("store.facts")) + (index ? ` ${Number(index[1]) + 1}` : "");
}

/** Reuse the local service catalogue's brand spelling, preserving custom server ids. */
function connectionName(id: string): string {
  const key = id.replace(/^composio:/i, "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(SERVICE_ICONS, key) ? SERVICE_ICONS[key as keyof typeof SERVICE_ICONS].title : id;
}

/** Read plain skill metadata using the same scalar forms accepted by the skill store. */
function skillContents(text: string): { name: string; description: string; body: string } {
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

export function templateContents(template: MemberTemplate, warnings: ScanFinding[] = []): string {
  const full = (text: string): string => `<pre class="template-text">${esc(text || t("template.none"))}</pre>`;
  const risks = [...new Set(warnings.map(w => t(w.kind === "secret" ? "store.secret" : "store.injection", {p0:scanLocation(w)})))];
  return `<div class="note template-warnings" role="status"><p>${esc(t("store.thirdParty"))}</p>` +
    (warnings.some(w => w.kind === "injection") ? "" : `<p>${esc(t("store.injectionNote"))}</p>`) + risks.map(text => `<p>${esc(text)}</p>`).join("") + `</div>` +
    `<section class="template-section"><h3>${esc(t("store.facts"))}</h3><div class="template-field"><h4>${esc(t("members.instructions"))}</h4>${full(template.instructions)}</div><div class="template-field"><h4>${esc(t("members.personality"))}</h4>${full(template.personality)}</div></section>` +
    `<section class="template-section"><h3>${esc(t("store.skills"))}</h3><p class="note">${esc(t("store.arriveOff"))}</p><div class="list">` +
    (template.skills.map((skill, index) => {
      const {name, description, body} = skillContents(skill.text);
      return `<div class="template-skill">` + row(esc(name), "", `<span class="val">${esc(description)}</span>`) +
        cardDisclosureHTML(`template-skill-${index}`, full(body) + Object.entries(skill.files || {}).map(([path, content]) => `<div class="template-field"><h4>${esc(path)}</h4>${full(content)}</div>`).join("")) + `</div>`;
    }).join("") || esc(t("template.none"))) + `</div></section>` +
    `<section class="template-section"><h3>${esc(t("template.routines"))}</h3><div class="list">` + (template.routines.map(r => row(esc(r.title), "", `<span class="val">${routineSentenceHTML(r)} · ${esc(t("computer.routinePaused"))}</span>`) + full(r.prompt)).join("") || esc(t("template.none"))) + `</div></section>`;
}

export async function previewTemplate(raw: unknown, avatar: string, create: (member: NewMember) => Promise<Member | null>, groupId: number | null, done: () => void, catalogId?: string): Promise<void> {
  try {
    const {template, findings = []} = await api.core<{template: MemberTemplate; findings?: ScanFinding[]}>("members.template", catalogId ? {action: "catalog-preview", catalog_id: catalogId} : {action: "preview", template: raw});
    let made: Member | null = null, busy = false;
    const connected = new Set<string>();
    const body = (): string => cardHTML({title: template.role || template.name, status: "ready", hideStatus: true, attrs: " data-member-template",
      content: `<label class="mp-label">${esc(t("members.name"))}<input class="mb-fin" data-template-name maxlength="24" value="${esc(made?.name || template.name)}"${made ? " disabled" : ""}></label>` +
        templateContents(template, findings) +
        `<section class="template-section"><h3>${esc(t("template.connections"))}</h3>${template.connections.map(app => cardHTML({title: connectionName(app), status: "done", statusText: t("conn.signedIn"), hideStatus: !connected.has(app), attrs: ` data-template-connection="${esc(app)}" data-connected="${connected.has(app)}"`, body: made ? t("template.connectHelp") : undefined, actions: btn(esc(t(connected.has(app) ? "conn.signedIn" : "template.connect")), "sm", ` data-dlg="connect" data-app="${esc(app)}"${!made || busy || connected.has(app) ? " disabled" : ""}`)})).join("") || `<p>${esc(t("template.none"))}</p>`}</section>`});
    const dialog = openDialog({title: t("template.preview"), cls: "template-preview", body: body(),
      actions: {secondary: `<p class="note" data-template-notice>${esc(t("template.noGrants"))}</p>` + btn(esc(t("common.close")), "", ' data-dlg="close"'), primary: {label: esc(t("template.import")), attrs: ' data-dlg="import"'}}, canClose: () => !busy,
      onAct(action, button) {
        if (action === "close") return dialog.close();
        if (busy) return;
        const run = async (): Promise<void> => {
          busy = true; button.setAttribute("disabled", "");
          if (action === "import" && !made) {
            const name = dialog.el.querySelector<HTMLInputElement>("[data-template-name]")!.value.trim();
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
  } catch (error) {toaster.info(describeError(error));}
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

export async function exportMemberTemplate(id: number): Promise<void> {
  const {template, findings = []} = await api.core<{template: MemberTemplate; findings: ScanFinding[]}>("members.template", {action: "review", id});
  let busy = false;
  const blocked = findings.some(w => w.kind === "secret");
  const dialog = openDialog({title: t("store.review"), cls: "template-preview template-export-review", body: templateContents(template, findings) +
    `<h3>${esc(t("template.connections"))}</h3><p>${esc(template.connections.map(connectionName).join(", ") || t("template.none"))}</p>`,
    actions: {secondary: btn(esc(t("store.publish")), "", ` data-dlg="publish"${blocked ? " disabled" : ""}`), primary: {label: esc(t("store.export")), attrs: ` data-dlg="export"${blocked ? " disabled" : ""}`}},
    canClose: () => !busy,
    onAct(action, button) {
      if (busy || blocked || !["export", "publish"].includes(action)) return;
      busy = true; button.setAttribute("disabled", "");
      void (async () => {
        if (action === "export") {
          const result = await api.core<{template: MemberTemplate}>("members.template", {action: "export", id});
          // The exact reviewed generation is the one the owner agreed to share.
          if (JSON.stringify(result.template) !== JSON.stringify(template)) throw new Error(t("store.changed"));
          await api.memberTemplateFile("save", JSON.stringify(template, null, 2));
        } else {
          const result = await api.core<{folder: string; url: string}>("members.template", {action: "publish", template});
          const note = document.createElement("p"); note.className = "note"; note.textContent = t("store.prepared", {p0: result.folder});
          dialog.el.querySelector(".mb-dlg-body")!.append(note);
          await api.openExternalUrl(result.url);
        }
      })().catch(error => toaster.info(describeError(error))).finally(() => {busy = false; button.removeAttribute("disabled");});
    }});
}
