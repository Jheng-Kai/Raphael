// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ connectorsStatus:vi.fn(), toolsetsList:vi.fn(), integrationsCatalog:vi.fn(), integrationsAudit:vi.fn(), integrationsTest:vi.fn(), integrationsDisconnect:vi.fn(), integrationsInventory:vi.fn(), membersList:vi.fn(), membersSkillsList:vi.fn() }));
vi.mock("./api", () => api);
import { connectionsHTML, createConnections } from "./connections";
import { pressLayer, navInputs } from "./test-support/nav-layer-input";
import { closeMenu } from "./ui";
import type { ConnectionGroup } from "./types";
afterEach(() => { closeMenu(); document.body.replaceChildren(); });
it.each(navInputs)("opens server actions and retraces the editor and app views with %s", async input => {
  const group = {id:"own",name:"Workspace",command:"npx",args:["workspace"],transport:"stdio",url:"",env:[],headers:[],tools:[],enabled:false,status:"disabled",auth:"none",catalog_id:null} as unknown as ConnectionGroup;
  api.toolsetsList.mockResolvedValue({groups:[group]}); api.integrationsCatalog.mockResolvedValue({services:[]}); api.integrationsAudit.mockResolvedValue({entries:[]});
  api.connectorsStatus.mockResolvedValue({connectors:[],composio_configured:false});
  api.integrationsInventory.mockResolvedValue({state:"complete",count:0,apps:[]}); api.membersList.mockResolvedValue({members:[],groups:[]}); api.membersSkillsList.mockResolvedValue({skills:[]});
  const root = document.createElement("div"); document.body.append(root);
  const control = createConnections({visible:()=>true,redraw:()=>{root.innerHTML=connectionsHTML(control.view()); control.painted();},tryPrompt:vi.fn(),root});
  await control.load();
  control.click(root.querySelector('[data-conn="connected"]')!);
  expect(root.querySelector('.cs-linked [data-conn="enable"]')).not.toBeNull();
  expect(root.querySelector('[data-conn="edit-server"]')).toBeNull();
  control.click(root.querySelector('[data-conn="open"]')!);
  control.click(root.querySelector('[data-conn="server-menu"]')!);
  const menu = document.querySelector('[role="menu"]')!;
  expect(Array.from(menu.querySelectorAll('button')).map(button=>button.textContent)).toEqual(["測試","編輯伺服器","刪除"]);
  expect(menu.querySelector('[data-conn="disconnect"]')?.classList.contains("danger")).toBe(true);
  menu.querySelector<HTMLButtonElement>('[data-conn="edit-server"]')!.click();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(control.view().form?.id).toBe("own");
  for (const expected of ["connected/group:own", "connected", ""]) {
    pressLayer(input);
    expect(control.navView()).toBe(expected);
  }
  for (const expected of ["connected", "connected/group:own", "connected/form:own"]) {
    pressLayer(input, "forward");
    expect(control.navView()).toBe(expected);
  }
  control.click(root.querySelector('[data-conn="form-cancel"]')!);
  control.click(root.querySelector('[data-conn="open"]')!);
  control.click(root.querySelector('[data-conn="server-menu"]')!);
  // 刪除 closes the menu and asks in the red dialog naming the server; 取消 deletes nothing.
  document.querySelector<HTMLButtonElement>('.menu [data-conn="disconnect"]')!.click();
  await vi.waitFor(() => expect(document.querySelector(".mb-delete h2")?.textContent).toBe("刪除「Workspace」？"));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  document.querySelector<HTMLElement>('.mb-delete [data-dlg="cancel"]')!.click();
  await Promise.resolve();
  expect(api.integrationsDisconnect).not.toHaveBeenCalled();
});
