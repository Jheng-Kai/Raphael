// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { exportMemberTemplate, previewTemplate, starterTemplate } from "./member-templates";
import { openMemberStore } from "./member-store";
import { openMemberCreator } from "./member-creator";
import type { Member } from "./types";

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
  expect(api.connectorsConnect).not.toHaveBeenCalled();
});

test("store filtering stays local and install carries catalogue identity", async () => {
  const create = vi.fn(async () => null);
  api.core.mockImplementation(async (_method, p) => p.action === "catalog" ? {entries:[
    {id:"research",name:"Research",creator:"Example",summary:"Check sources",category:"engineering",avatar:"souei",featured:true},
    {id:"writer",name:"Writer",creator:"Example",summary:"Clear articles",category:"marketing",avatar:"shuna",featured:false},
  ],offline:false} : {template:starterTemplate(3),findings:[]});
  openMemberStore(create, null, vi.fn());
  for (let i=0;i<6;i++) await Promise.resolve();
  const input = document.querySelector<HTMLInputElement>("[data-store-search]")!;
  input.value = "Writer"; input.dispatchEvent(new Event("input"));
  expect(document.querySelectorAll(".store-entry")).toHaveLength(1);
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
