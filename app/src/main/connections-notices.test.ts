// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "./i18n";

const api = vi.hoisted(() => ({
  connectorsStatus: vi.fn(), connectorsTools: vi.fn(), connectorsConnect: vi.fn(),
  toolsetsList: vi.fn(), integrationsCatalog: vi.fn(), integrationsAudit: vi.fn(), integrationsInventory: vi.fn(),
  membersList: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("./ui", async (original) => ({ ...(await original<typeof import("./ui")>()), toaster: { info: vi.fn() } }));
import { connectionsHTML, createConnections } from "./connections";
import { toaster } from "./ui";

const controls: ReturnType<typeof createConnections>[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  setLocale("zh-TW");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  api.connectorsStatus.mockResolvedValue({ composio_configured: true, connectors: [{
    id: "composio:notion", kind: "composio", name: "Notion", status: "ACTIVE", enabled: true,
    enabled_tools: ["NOTION_SEARCH"], disabled_tools: [], accounts: [{ status: "ACTIVE" }],
  }] });
  api.connectorsTools.mockResolvedValue({ items: [{ slug: "NOTION_SEARCH", name: "Search", description: "Search pages", enabled: true, kind: "read" }] });
  api.toolsetsList.mockResolvedValue({ groups: [] });
  api.integrationsCatalog.mockResolvedValue({ services: [] });
  api.integrationsAudit.mockResolvedValue({ entries: [] });
  api.integrationsInventory.mockResolvedValue({ state: "complete", count: 1, apps: [{ id: "composio:notion", name: "Notion", state: "ready", enabled: true, connected: true, tools: 1 }] });
  api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Ada" }], groups: [] });
});
afterEach(() => {
  for (const control of controls.splice(0)) control.reset();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  const control = createConnections({ visible: () => true, redraw: () => { root.innerHTML = connectionsHTML(control.view()); }, tryPrompt: vi.fn(), root });
  controls.push(control);
  const click = (action: string) => {
    const button = root.querySelector(`[data-conn="${action}"]`);
    expect(button, action).not.toBeNull();
    control.click(button!);
  };
  await control.load();
  await vi.waitFor(() => expect(root.querySelector('[data-conn="connected"]')).not.toBeNull());
  click("connected");
  await vi.waitFor(() => expect(root.querySelector('[data-conn="open"]')).not.toBeNull());
  return { root, control, click };
}

it.each([
  ["toolkit_not_allowed", "Composio 尚未允許這個應用程式登入，請重試連結。"],
  ["denied", "你在瀏覽器上拒絕了，所以沒有加入。"],
  ["timeout", "太久沒有登入，已經停止。"],
  ["network", "沒有登入成功：網路連不上，請確認網路與服務狀態後重新連線。"],
])("renders %s beside the app accounts, without a toast", async (error, words) => {
  api.connectorsConnect.mockResolvedValue({ connected: false, error });
  const { root, click } = await mount();
  click("open"); click("relogin");
  await vi.waitFor(() => expect(root.querySelector('.cs-page .note[role="alert"]')?.textContent).toBe(words));
  // told at the top of the app's page, before its accounts and its actions, on the page itself
  const alert = root.querySelector('.cs-page .note[role="alert"]')!;
  expect(alert.compareDocumentPosition(root.querySelector(".cs-page .cs-acct")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(alert.compareDocumentPosition(root.querySelector('.cs-page .action-row [data-conn="relogin"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(root.querySelector(".cs-dialog, .cs-scrim")).toBeNull();
  expect(toaster.info).not.toHaveBeenCalled();
});

it("clears the failure immediately on retry and reports success on the page", async () => {
  api.connectorsConnect.mockResolvedValueOnce({ connected: false, error: "denied" });
  const { root, control, click } = await mount();
  click("open"); click("relogin");
  await vi.waitFor(() => expect(control.view().loginError).not.toBeNull());
  let finish!: (result: { connected: boolean }) => void;
  api.connectorsConnect.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  click("relogin");
  expect(root.querySelector('.cs-page .note[role="alert"]')).toBeNull();
  expect(control.view().loginError).toBeNull();
  finish({ connected: true });
  await vi.waitFor(() => expect(root.querySelector('.cs-page [role="status"][data-cs-notice]')?.textContent).toBe("已重新登入 Notion"));
  expect(control.view().loginError).toBeNull();
  expect(toaster.info).not.toHaveBeenCalled();
});

it("drops visible and pending failures when the page is left, including reopening the same app", async () => {
  api.connectorsConnect.mockResolvedValueOnce({ connected: false, error: "denied" });
  const { root, control, click } = await mount();
  click("open"); click("relogin");
  await vi.waitFor(() => expect(control.view().loginError).not.toBeNull());
  click("back");
  expect(control.view().loginError).toBeNull();
  click("open");
  expect(root.querySelector('.cs-page .note[role="alert"]')).toBeNull();
  let finish!: (result: { connected: boolean; error: string }) => void;
  api.connectorsConnect.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  click("relogin"); click("back"); click("open");
  finish({ connected: false, error: "timeout" });
  await vi.waitFor(() => expect(control.view().login).toBeNull());
  expect(control.view().loginError).toBeNull();
  expect(root.querySelector('.cs-page .note[role="alert"]')).toBeNull();
  expect(toaster.info).not.toHaveBeenCalled();
});
