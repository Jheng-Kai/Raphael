// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { previewTemplate, previewTemplateFile, starterTemplate, templateContents } from "./member-templates";
import { NAME_MAX } from "./members";
import { openMemberCreator } from "./member-creator";
import type { Member } from "./types";
import { catalogs, t } from "./i18n";

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
  // One row per skill and per routine.
  const rows = dialog.querySelectorAll(".tpl-row");
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector(".tpl-row-t > span")!.textContent).toBe(t("template.developerGoal"));
  expect(rows[1].textContent).toContain(t("computer.routinePaused"));
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
  const skill = document.querySelector('.tpl-row')!;
  expect(skill.querySelector('.tpl-row-t > b')!.textContent).toBe("Check sources");
  expect(skill.querySelector('.tpl-row-t > span')!.textContent).toBe("Check sources before publishing.");
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

test("a skill row is [data-tpl-skill] and holds the one disclosure that opens its full text (the look scene template-skill-expanded presses it)", () => {
  // The scene pressed `.template-skill [data-card-disclosure]`, a class the rows lost when they became Grok Bot's cards of rows,
  // and failed on every run since; the row is now named by its own attribute.
  document.body.innerHTML = templateContents({...starterTemplate(0),skills:[{text:["---", "name: Check sources", "description: Check", "---", "Keep this body."].join("\n")}]});
  expect(document.querySelector('.template-skill')).toBeNull();
  const disclosures = document.querySelectorAll('[data-tpl-skill] [data-card-disclosure]');
  expect(disclosures).toHaveLength(1);
  expect(disclosures[0]!.closest('[data-tpl-skill]')!.querySelector<HTMLElement>('.card-detail')!.hidden).toBe(true);
});

test("skill text without a complete frontmatter block stays intact", () => {
  for (const text of ["# Plain method\nname: body example", "---\nname: Unclosed\nKeep every line."]) {
    document.body.innerHTML = templateContents({...starterTemplate(0),skills:[{text}]});
    expect(document.querySelector('.tpl-row .tpl-row-t > b')!.textContent).toBe(t("template.skill"));
    expect(document.querySelector('.tpl-row .template-text')!.textContent).toBe(text);
  }
});

test("skill delimiters accept the whitespace allowed by the skill store", () => {
  const text = ' \t--- \t\nname: Check sources\ndescription: Check before publishing\n \t--- \t\nKeep this body.';
  document.body.innerHTML = templateContents({...starterTemplate(0),skills:[{text}]});
  expect(document.querySelector('.tpl-row .tpl-row-t > b')!.textContent).toBe('Check sources');
  expect(document.querySelector('.tpl-row .template-text')!.textContent).toBe('Keep this body.');
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

test("scan warnings name the visible section without exposing internal translation-like paths", async () => {
  const template = starterTemplate(3);
  api.core.mockResolvedValue({template,findings:[{kind:"injection",path:"template.instructions"}]});
  await previewTemplate(template, "slime:diablo", vi.fn(), null, vi.fn());
  const warning = document.querySelector('.template-preview .tpl-alert[role="status"]')!;
  expect(warning).not.toBeNull();
  expect(warning.textContent).not.toContain("template.");
  expect(warning.textContent).not.toMatch(/[。.]\s*·/);
  expect(warning.textContent).toContain(t("store.injection", {p0:t("members.instructions")}));
  expect(warning.querySelectorAll("p")).toHaveLength(2);
  expect(warning.compareDocumentPosition(document.querySelector(".tpl-sec")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
// Notepad saves a template with this mark in front of it.
const BOM = String.fromCharCode(0xfeff);
const said = (): string => document.body.textContent ?? "";

test("the name field takes what a member's name can be and no more, the core's NAME_MAX", async () => {
  await previewTemplate(starterTemplate(0), "slime:rimuru", vi.fn(), null, vi.fn());
  expect(document.querySelector<HTMLInputElement>("[data-template-name]")!.maxLength).toBe(NAME_MAX);
});

test("an empty name is refused in the field, nothing is added, and typing again takes the complaint back", async () => {
  const create = vi.fn(async () => ({id: 9, name: "Developer", tools: []}) as unknown as Member);
  await previewTemplate(starterTemplate(3), "slime:diablo", create, null, vi.fn());
  const field = document.querySelector<HTMLInputElement>("[data-template-name]")!;
  field.value = "   ";
  document.querySelector<HTMLButtonElement>('[data-dlg="import"]')!.click();
  await flush();
  expect(create).not.toHaveBeenCalled();
  const again = document.querySelector<HTMLInputElement>("[data-template-name]")!;
  expect(again.getAttribute("aria-invalid")).toBe("true");
  expect(document.querySelector(".field-error")!.textContent).toBe(t("members.nameEmpty"));
  expect(document.querySelector<HTMLButtonElement>('[data-dlg="import"]')!.disabled).toBe(false);
  again.value = "Dev";
  again.dispatchEvent(new Event("input", {bubbles: true}));
  expect(again.hasAttribute("aria-invalid")).toBe(false);
  expect(document.querySelector(".field-error")).toBeNull();
});

test("a name the owner typed stays in the field when adding it was refused", async () => {
  const create = vi.fn(async () => null);
  await previewTemplate(starterTemplate(3), "slime:diablo", create, null, vi.fn());
  document.querySelector<HTMLInputElement>("[data-template-name]")!.value = "我的開發者";
  document.querySelector<HTMLButtonElement>('[data-dlg="import"]')!.click();
  await flush();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({name: "我的開發者"}));
  expect(document.querySelector<HTMLInputElement>("[data-template-name]")!.value).toBe("我的開發者");
});

test("a template file the owner opens is read with or without a byte-order mark", async () => {
  const text = JSON.stringify({...starterTemplate(0), description: "x"});
  for (const file of [text, BOM + text]) {
    document.body.innerHTML = "";
    api.core.mockClear();
    await previewTemplateFile(file, vi.fn(), null, vi.fn());
    expect(api.core).toHaveBeenCalledWith("members.template", {action: "preview", template: JSON.parse(text)});
    expect(document.querySelector(".template-preview")).not.toBeNull();
  }
});

test.each([
  ["not json at all", "template.file.notTemplate"],
  ["{\"format\":\"something-else\",\"version\":1}", "template.file.notTemplate"],
  ["{\"format\":\"raphael-member\",\"version\":2}", "template.file.newer"],
  ["{\"format\":\"raphael-member\",\"version\":1,\"name\":\"cut off", "template.file.damaged"],
] as const)("a file that cannot be a template says what is wrong in the owner's words (%s)", async (file, key) => {
  await previewTemplateFile(file, vi.fn(), null, vi.fn());
  expect(api.core).not.toHaveBeenCalled();
  expect(document.querySelector(".template-preview")).toBeNull();
  expect(said()).toContain(t(key));
  expect(said()).not.toMatch(/JSON|Unexpected|SyntaxError|Invalid params/);
});

test.each([
  ["[-32602] Invalid params: Invalid member template fields", "template.file.damaged"],
  ["[-32602] Invalid params: Remove private credentials from the member recipe first", "template.file.secret"],
  ["[-32602] Invalid params: Member template is too large", "template.file.tooLarge"],
] as const)("a template the core refuses is told in the owner's words, never the core's (%s)", async (refusal, key) => {
  api.core.mockRejectedValue(new Error(refusal));
  await previewTemplateFile(JSON.stringify(starterTemplate(0)), vi.fn(), null, vi.fn());
  expect(said()).toContain(t(key));
  expect(said()).not.toContain("Invalid params");
});

test("the creator's 開啟 button reads a Notepad file with a mark and shows a bad one plainly", async () => {
  const maker = openMemberCreator({groupId: null, taken: [], create: vi.fn()});
  maker.el.querySelector<HTMLButtonElement>('[data-dlg="templates"]')!.click();
  api.memberTemplateFile.mockResolvedValueOnce(BOM + JSON.stringify(starterTemplate(0)));
  document.querySelector<HTMLButtonElement>('[data-dlg="open"]')!.click();
  await flush();
  expect(document.querySelector(".template-preview")).not.toBeNull();
  document.querySelector<HTMLElement>(".template-preview .mb-dlg-head [data-dlg=close]")?.click();
  api.memberTemplateFile.mockResolvedValueOnce("{broken");
  document.querySelector<HTMLButtonElement>('[data-dlg="open"]')!.click();
  await flush();
  expect(said()).toContain(t("template.file.damaged"));
});

test("a store that is not open says so plainly, asks nothing of any entry and shows no search", async () => {
  api.core.mockImplementation(async () => ({entries: [], offline: false, open: false}));
  const maker = openMemberCreator({groupId: null, taken: [], create: vi.fn(), store: true});
  await flush();
  expect(maker.el.querySelector("[data-store-closed]")!.textContent).toBe(t("store.notOpen"));
  expect(maker.el.querySelector<HTMLElement>(".store-categories")!.hidden).toBe(true);
  expect(maker.el.querySelectorAll(".store-entry")).toHaveLength(0);
  expect(api.core).toHaveBeenCalledTimes(1);
});

test("an entry the store cannot give says so in the owner's words", async () => {
  api.core.mockRejectedValue(new Error("[-32602] Invalid params: The store is not open yet"));
  await previewTemplate(null, "slime:souei", vi.fn(), null, vi.fn(), "research");
  expect(said()).toContain(t("store.notOpen"));
  document.body.innerHTML = "";
  api.core.mockRejectedValue(new Error("[-32602] Invalid params: Template unavailable offline"));
  await previewTemplate(null, "slime:souei", vi.fn(), null, vi.fn(), "research");
  expect(said()).toContain(t("store.unavailable"));
});

test("every starter's name, in every language, fits what the core takes of a member name", () => {
  const long: string[] = [];
  for (const [locale, messages] of Object.entries(catalogs)) {
    for (const key of ["coordinator", "researcher", "writer", "developer", "planner", "analyst", "editor", "inbox"] as const) {
      const name = messages[`template.${key}` as const];
      if ([...name].length > NAME_MAX) long.push(`${locale} ${key}: ${name}`);
    }
  }
  expect(long).toEqual([]);
});
