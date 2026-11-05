// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { previewTemplate, starterTemplate } from "./member-templates";
import { openMemberCreator } from "./member-creator";
import type { Member } from "./types";
import { t } from "./i18n";

const api = vi.hoisted(() => ({core: vi.fn(), memberTemplateFile: vi.fn(), connectorsConnect: vi.fn(), membersUpdate: vi.fn(), toolsetsList: vi.fn(), integrationsCatalog: vi.fn()}));
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
  expect(dialog.querySelectorAll(".list > .row")).toHaveLength(2);
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
