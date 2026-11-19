import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ConnectionGroup, StoreService } from "./types";

const api = vi.hoisted(() => ({
  connectorsStatus: vi.fn(),
  toolsetsList: vi.fn(),
  integrationsCatalog: vi.fn(),
  integrationsAudit: vi.fn(),
  integrationsConnect: vi.fn(),
  integrationsConnectCancel: vi.fn(),
  integrationsDisconnect: vi.fn(),
  integrationsInventory: vi.fn(),
  membersList: vi.fn(),
  membersSkillsList: vi.fn(),
  openLink: vi.fn(),
}));
vi.mock("./api", () => api);

import { connectionsHTML, createConnections } from "./connections";

const words = (zh: string, en: string, ja: string) => ({ "zh-TW": zh, en, ja });
const github: StoreService = {
  id: "github", name: "GitHub", publisher: "GitHub", url: "https://api.githubcopilot.com/mcp/", category: "developer", icon: "github",
  popular: false, auth: "device", server_id: null,
  summary: words("程式庫", "Repos", "リポジトリ"), about: words("說明", "About", "説明"),
  examples: { "zh-TW": ["一", "二"], en: ["one", "two"], ja: ["いち", "に"] },
};
const connected: ConnectionGroup = {
  id: "gh1", name: "GitHub", enabled: true, status: "ready", error: null, auth: "device", catalog_id: "github", transport: "http",
  command: "", url: github.url, env: [], headers: [], args: [], tool_count: 0, enabled_count: 0, write_count: 0, read_count: 0,
  checked_at_ms: 1, tools: [],
};

const host = { visible: () => true, redraw: vi.fn(), tryPrompt: vi.fn() };
const button = (conn: string, extra: Record<string, string> = {}): Element =>
  ({ closest: () => ({ dataset: { conn, ...extra } }) }) as unknown as Element;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  host.redraw.mockReset();
  api.toolsetsList.mockResolvedValue({ groups: [] });
  api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: false });
  api.integrationsCatalog.mockResolvedValue({ services: [github] });
  api.integrationsAudit.mockResolvedValue({ entries: [] });
  api.integrationsInventory.mockResolvedValue({ state: "complete", count: 0, apps: [] });
  api.membersList.mockResolvedValue({ members: [], groups: [] });
  api.membersSkillsList.mockResolvedValue({ skills: [] });
  api.integrationsConnectCancel.mockResolvedValue({ cancelled: true });
  api.openLink.mockResolvedValue(undefined);
});

describe("a device service in the apps' dialog", () => {
  test("adding it from its page asks the core, and the page waits with 取消 (the code is the window's own dialog)", async () => {
    api.integrationsConnect.mockReturnValue(new Promise(() => undefined));
    const c = createConnections(host);
    await c.load();
    c.click(button("open-store", { id: "github" }));
    c.click(button("join", { id: "github" }));
    expect(api.integrationsConnect).toHaveBeenCalledWith({ catalog_id: "github" });
    const html = connectionsHTML(c.view());
    expect(html).toContain("請在瀏覽器登入…");
    expect(html).toContain('data-conn="cancel-login"');
  });

  test("its dialog has a button that opens GitHub's list of authorised apps", async () => {
    api.toolsetsList.mockResolvedValue({ groups: [connected] });
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "gh1" }));
    const html = connectionsHTML(c.view());
    expect(html).toContain('data-conn="open-grants"');
    expect(html).toContain("到 GitHub 移除授權");
    c.click(button("open-grants", { id: "gh1" }));
    await settle();
    expect(api.openLink).toHaveBeenCalledWith("https://github.com/settings/applications");
  });

  test("a token that GitHub turned away offers the sign-in again", async () => {
    const revoked: ConnectionGroup = { ...connected, status: "error", error: "auth" };
    api.toolsetsList.mockResolvedValue({ groups: [revoked] });
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "gh1" }));
    expect(connectionsHTML(c.view())).toContain('data-conn="relogin"');
    api.integrationsConnect.mockReturnValue(new Promise(() => undefined));
    c.click(button("relogin", { id: "gh1" }));
    expect(api.integrationsConnect).toHaveBeenCalledWith({ id: "gh1" });
  });
});
