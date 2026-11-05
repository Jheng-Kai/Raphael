// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { exportMemberTemplate, previewTemplate, starterTemplate, templateContents } from "./member-templates";
import { openMemberCreator } from "./member-creator";
import type { Member } from "./types";
import { t } from "./i18n";

const api = vi.hoisted(() => ({core: vi.fn(), memberTemplateFile: vi.fn(), connectorsConnect: vi.fn(), membersUpdate: vi.fn(), toolsetsList: vi.fn(), integrationsCatalog: vi.fn(), openExternalUrl: vi.fn()}));
vi.mock("./api", () => api);
beforeEach(() => {document.body.innerHTML = ""; vi.clearAllMocks(); api.core.mockImplementation(async (_method, params) => ({template: params.template}));});

test("the creator opens eight local slime recipes without installing anything", () => {
  const create = vi.fn();
  const maker = openMemberCreator({groupId: null, taken: [], create});
  maker.el.querySelector<HTMLButtonElement>('[data-dlg="templates"]')!.click();
  expect(document.querySelectorAll(".template-gallery [data-index]")).toHaveLength(8);
  expect(document.querySelectorAll(".template-gallery svg.slime")).toHaveLength(8);
  expect(api.core).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
});

test("preview shows skills, paused routines and a disabled card per requested connection until import", async () => {
  const create = vi.fn(async () => ({id: 9, name: "Developer", tools: []}) as unknown as Member);
  await previewTemplate(starterTemplate(3), "slime:diablo", create, null, vi.fn());
  expect(api.core).toHaveBeenCalledWith("members.template", expect.objectContaining({action: "preview"}));
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="connect"]')!.disabled).toBe(true);
  const dialog = document.querySelector(".template-preview")!;
  expect(dialog.textContent!.split(t("template.noGrants"))).toHaveLength(2);
  expect(dialog.querySelector(".mb-dlg-act")!.firstElementChild!.matches("[data-template-notice]")).toBe(true);
  expect(dialog.querySelectorAll(".card-status, .card-well")).toHaveLength(0);
  expect(dialog.querySelectorAll(".list .row")).toHaveLength(2);
  expect(dialog.querySelector(".list .ctl")!.textContent).toBe(t("template.developerGoal"));
  expect(dialog.querySelectorAll(".list")[1].textContent).toContain(t("computer.routinePaused"));
  expect(create).not.toHaveBeenCalled(); expect(api.connectorsConnect).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-dlg="import"]')!.click();
  for (let i=0;i<12;i++) await Promise.resolve();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({template: starterTemplate(3), avatar:"slime:diablo"}));
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="connect"]')!.disabled).toBe(false);
  expect(api.connectorsConnect).not.toHaveBeenCalled();
  api.toolsetsList.mockResolvedValue({groups:[{id:"composio:github",name:"GitHub",enabled:true,status:"ready"}]});
  api.membersUpdate.mockResolvedValue({});
  document.querySelector<HTMLButtonElement>('[data-dlg="connect"]')!.click();
  for (let i=0;i<12;i++) await Promise.resolve();
  expect(api.membersUpdate).toHaveBeenCalledWith(9,{tools:["composio:github"]});
  expect(dialog.querySelectorAll(".card-status")).toHaveLength(1);
  expect(dialog.querySelector(".card-status")!.textContent).toBe(t("conn.signedIn"));
  expect(api.connectorsConnect).not.toHaveBeenCalled();
});

test("preview uses catalogue brand names and preserves unknown custom connection ids", async () => {
  const template = {...starterTemplate(0), connections:["gmail", "github", "composio:googlecalendar", "my-private-server", "constructor"]};
  await previewTemplate(template, "slime:rimuru", vi.fn(), null, vi.fn());
  expect([...document.querySelectorAll('[data-template-connection] .card-title')].map(el => el.textContent)).toEqual(["Gmail", "GitHub", "Google Calendar", "my-private-server", "constructor"]);
  expect([...document.querySelectorAll('[data-dlg="connect"]')].map(el => (el as HTMLElement).dataset.app)).toEqual(template.connections);
});

test.each(["\n", "\r\n"])("skill preview separates quoted and folded metadata from expandable body (%j)", newline => {
  const text = ["---", 'name: "Check sources"', "description: >-", "  Check sources", "  before publishing.", "---", "# Method", "Keep this body.", "---", "name: body example"].join(newline);
  const template = {...starterTemplate(0), skills:[{text,files:{"scripts/check.py":"print('<checked>')"}}]};
  document.body.innerHTML = templateContents(template);
  const skill = document.querySelector('.template-skill')!;
  expect(skill.querySelector('.t')!.textContent).toBe("Check sources");
  expect(skill.querySelector('.val')!.textContent).toBe("Check sources before publishing.");
  const detail = skill.querySelector<HTMLElement>('.card-detail')!;
  expect(detail.hidden).toBe(true);
  expect(detail.querySelector('.template-text')!.textContent).toBe(["# Method", "Keep this body.", "---", "name: body example"].join(newline));
  expect(detail.textContent).toContain("print('<checked>')");
  const toggle = skill.querySelector<HTMLButtonElement>('[data-card-disclosure]')!;
  toggle.click();
  expect(detail.hidden).toBe(false); expect(toggle.getAttribute('aria-expanded')).toBe("true");
  toggle.click(); expect(detail.hidden).toBe(true);
  expect(template.skills[0].text).toBe(text);
});

test("skill text without a complete frontmatter block stays intact", () => {
  for (const text of ["# Plain method\nname: body example", "---\nname: Unclosed\nKeep every line."]) {
    document.body.innerHTML = templateContents({...starterTemplate(0),skills:[{text}]});
    expect(document.querySelector('.template-skill .t')!.textContent).toBe(t("template.skill"));
    expect(document.querySelector('.template-skill .template-text')!.textContent).toBe(text);
  }
});

test("skill delimiters accept the whitespace allowed by the skill store", () => {
  const text = ' \t--- \t\nname: Check sources\ndescription: Check before publishing\n \t--- \t\nKeep this body.';
  document.body.innerHTML = templateContents({...starterTemplate(0),skills:[{text}]});
  expect(document.querySelector('.template-skill .t')!.textContent).toBe('Check sources');
  expect(document.querySelector('.template-skill .template-text')!.textContent).toBe('Keep this body.');
});

test("store filtering stays local and install carries catalogue identity", async () => {
  const create = vi.fn(async () => null);
  api.core.mockImplementation(async (_method, p) => p.action === "catalog" ? {entries:[
    {id:"research",name:"Research",creator:"Example",summary:"Check sources",category:"engineering",avatar:"souei",featured:true},
    {id:"writer",name:"Writer",creator:"Example",summary:"Clear articles",category:"marketing",avatar:"shuna",featured:false},
  ],offline:false} : {template:starterTemplate(3),findings:[]});
  const maker = openMemberCreator({groupId:null, taken:[], create, store:true});
  for (let i=0;i<6;i++) await Promise.resolve();
  const input = document.querySelector<HTMLInputElement>("[data-store-search]")!;
  input.value = "Writer"; input.dispatchEvent(new Event("input"));
  expect(document.querySelectorAll(".store-entry")).toHaveLength(1);
  expect(api.core).toHaveBeenCalledTimes(1);
  const heading = maker.el.querySelector(".mb-dlg-head h2");
  const tabs = maker.el.querySelector(".cr-tabs .tabs.plain.fill")!;
  expect(tabs.querySelectorAll(".tab")).toHaveLength(2);
  expect(tabs.querySelector('[data-tab="store"]')!.getAttribute("aria-selected")).toBe("true");
  maker.el.querySelector<HTMLButtonElement>('[data-tab="maker"]')!.click();
  maker.el.querySelector<HTMLInputElement>("#mb-new-name")!.value = "Draft member";
  maker.el.querySelector<HTMLButtonElement>('[data-tab="store"]')!.click();
  expect(maker.el.querySelector(".mb-dlg-head h2")).toBe(heading);
  expect(document.querySelectorAll(".cr-dialog")).toHaveLength(1);
  expect(maker.el.querySelector<HTMLInputElement>("#mb-new-name")!.value).toBe("Draft member");
  expect(input.value).toBe("Writer");
  expect(api.core).toHaveBeenCalledTimes(1);
  input.value = ""; input.dispatchEvent(new Event("input"));
  document.querySelector<HTMLButtonElement>('[data-category="engineering"]')!.click();
  expect(document.querySelectorAll(".store-entry")).toHaveLength(1);
  document.querySelector<HTMLButtonElement>('[data-dlg="store-preview"]')!.click();
  for (let i=0;i<8;i++) await Promise.resolve();
  expect(create).not.toHaveBeenCalled();
  expect(api.core).toHaveBeenLastCalledWith("members.template", {action:"catalog-preview",catalog_id:"research"});
  document.querySelector<HTMLButtonElement>('[data-dlg="import"]')!.click();
  for (let i=0;i<8;i++) await Promise.resolve();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({catalog_id:"research"}));
});

test("secret findings block export and publish before any native action", async () => {
  const template = {...starterTemplate(3),instructions:"password: synthetic-secret"};
  api.core.mockResolvedValue({template,findings:[{kind:"secret",path:"template.instructions"}]});
  await exportMemberTemplate(1);
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="export"]')!.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="publish"]')!.disabled).toBe(true);
  expect(api.memberTemplateFile).not.toHaveBeenCalled();
  expect(api.openExternalUrl).not.toHaveBeenCalled();
});

test("scan warnings name the visible section without exposing internal translation-like paths", async () => {
  const template = starterTemplate(3);
  api.core.mockResolvedValue({template,findings:[{kind:"injection",path:"template.instructions"}]});
  await previewTemplate(template, "slime:diablo", vi.fn(), null, vi.fn());
  const warning = document.querySelector('.template-preview .note[role="status"]')!;
  expect(warning).not.toBeNull();
  expect(warning.textContent).not.toContain("template.");
  expect(warning.textContent).not.toMatch(/[。.]\s*·/);
  expect(warning.textContent).toContain(t("store.injection", {p0:t("members.instructions")}));
  expect(warning.querySelectorAll("p")).toHaveLength(2);
  expect(warning.compareDocumentPosition(document.querySelector(".template-field")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("export rechecks the reviewed generation before file save", async () => {
  const template = starterTemplate(0);
  api.core.mockResolvedValue({template,findings:[]});
  await exportMemberTemplate(1);
  expect(api.memberTemplateFile).not.toHaveBeenCalled();
  api.core.mockResolvedValue({template:{...template,instructions:"Changed after review"}});
  document.querySelector<HTMLButtonElement>('[data-dlg="export"]')!.click();
  for (let i=0;i<8;i++) await Promise.resolve();
  expect(api.memberTemplateFile).not.toHaveBeenCalled();
});

test("publishing prepares the reviewed local recipe before opening the owner browser", async () => {
  const template = starterTemplate(0);
  const url = "https://github.com/Jheng-Kai/raphael-catalog/compare/main...main?quick_pull=1";
  api.core.mockImplementation(async (_method, p) => p.action === "review" ? {template,findings:[]} : {folder:"C:\\Raphael\\template-exports\\sample",url});
  await exportMemberTemplate(1);
  expect(api.openExternalUrl).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-dlg="publish"]')!.click();
  for (let i=0;i<8;i++) await Promise.resolve();
  expect(api.core).toHaveBeenLastCalledWith("members.template", {action:"publish",template});
  expect(api.openExternalUrl).toHaveBeenCalledWith(url);
  expect(api.memberTemplateFile).not.toHaveBeenCalled();
});
