// Local colleague recipes inspired by Grok Bot; see core/packaging/licenses/NOTICES.md.
import * as api from "./api";
import { cardHTML } from "./card";
import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { slimeFaceHTML } from "./slime";
import type { Member, NewMember } from "./types";
import { btn, esc, row, toaster } from "./ui";

export interface MemberTemplate {
  format: "raphael-member"; version: 1;
  name: string; role: string; personality: string; instructions: string; reply_style: "full" | "conversational";
  skills: { text: string; files?: Record<string, string> }[];
  routines: { title: string; prompt: string; schedule: { kind: "daily"; time: string }; when: null }[];
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

export async function previewTemplate(raw: unknown, avatar: string, create: (member: NewMember) => Promise<Member | null>, groupId: number | null, done: () => void): Promise<void> {
  try {
    const {template} = await api.core<{template: MemberTemplate}>("members.template", {action: "preview", template: raw});
    let made: Member | null = null, busy = false;
    const connected = new Set<string>();
    const body = (): string => cardHTML({title: template.role || template.name, status: "ready", hideStatus: true, attrs: " data-member-template", body: template.instructions,
      content: `<label class="mp-label">${esc(t("members.name"))}<input class="mb-fin" data-template-name maxlength="24" value="${esc(made?.name || template.name)}"${made ? " disabled" : ""}></label>` +
        `<h3>${esc(t("members.profile.skillsTitle"))}</h3><div class="list">${template.skills.map(skill => row(esc(/^name:\s*(.+)$/m.exec(skill.text)?.[1] || t("template.skill")), "", `<span class="val">${esc(/^description:\s*(.+)$/m.exec(skill.text)?.[1] || "")}</span>`)).join("") || esc(t("template.none"))}</div>` +
        `<h3>${esc(t("template.routines"))}</h3><div class="list">${template.routines.map(r => row(esc(r.title), "", `<span class="val">${esc(t("computer.routinePaused"))}</span>`)).join("") || esc(t("template.none"))}</div>` +
        `<h3>${esc(t("template.connections"))}</h3>${template.connections.map(app => cardHTML({title: app, status: "done", statusText: t("conn.signedIn"), hideStatus: !connected.has(app), attrs: ` data-template-connection="${esc(app)}" data-connected="${connected.has(app)}"`, body: made ? t("template.connectHelp") : undefined, actions: btn(esc(t(connected.has(app) ? "conn.signedIn" : "template.connect")), "sm", ` data-dlg="connect" data-app="${esc(app)}"${!made || busy || connected.has(app) ? " disabled" : ""}`)})).join("") || `<p>${esc(t("template.none"))}</p>`}`});
    const dialog = openDialog({title: t("template.preview"), cls: "template-preview", body: body(),
      actions: {secondary: `<p class="note" data-template-notice>${esc(t("template.noGrants"))}</p>` + btn(esc(t("common.close")), "", ' data-dlg="close"'), primary: {label: esc(t("template.import")), attrs: ' data-dlg="import"'}}, canClose: () => !busy,
      onAct(action, button) {
        if (action === "close") return dialog.close();
        if (busy) return;
        const run = async (): Promise<void> => {
          busy = true; button.setAttribute("disabled", "");
          if (action === "import" && !made) {
            const name = dialog.el.querySelector<HTMLInputElement>("[data-template-name]")!.value.trim();
            made = await create({name, template, avatar, group_id: groupId});
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
  const {template} = await api.core<{template: MemberTemplate}>("members.template", {action: "export", id});
  await api.memberTemplateFile("save", JSON.stringify(template, null, 2));
}
