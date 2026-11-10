// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  secretsStatus: vi.fn(),
  secretsSetOpenrouterKey: vi.fn(),
  integrationsCatalog: vi.fn(),
  integrationsConnect: vi.fn(),
  integrationsConnectCancel: vi.fn(),
  connectorsStatus: vi.fn(),
  connectorsCatalog: vi.fn(),
  connectorsConnect: vi.fn(),
  connectorsSetKey: vi.fn(),
  integrationsAdd: vi.fn(),
  servicesStatus: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  brainsCli: vi.fn(),
  chatgptStatus: vi.fn(),
  chatgptSignIn: vi.fn(),
  chatgptCancel: vi.fn(),
  chatgptModels: vi.fn(),
  mainWindowForward: vi.fn(),
  brainsCliLogin: vi.fn(),
  openExternalUrl: vi.fn(),
}));
vi.mock("../api", () => api);
vi.mock("../stage", () => ({ Stage: class { play(): void {} dispose(): void {} } }));

import { setLocale } from "../i18n";
import type { AppContext } from "../types";
import { mountOnboarding } from "./mount";

const WORDS = { "zh-TW": "", en: "", ja: "" };
const entry = (id: string, name: string, over = {}) => ({
  id, name, publisher: "", url: "", category: "", icon: null, popular: true, summary: WORDS, about: WORDS,
  examples: { "zh-TW": [], en: [], ja: [] }, server_id: null as string | null, ...over,
});
const cli = (id: string, over = {}) => ({ id, name: id, installed: true, logged_in: true, disconnected: false, available: true, version: "1.0.0", login_command: "", models: [], ...over });
const option = { id: "builtin", needs_key: false, has_key: false, key_optional: false };
const serviceStatus = () => ({
  search: { enabled: true, service: "builtin", options: [option] },
  read: { enabled: true, service: "builtin", options: [option] },
  pdf: { enabled: true, service: "builtin", options: [option] },
  vision: { enabled: true, model: "", resolved_model: "x", supports_images: true },
});

let root: HTMLElement;
let setDevice: ReturnType<typeof vi.fn>;
let done: ReturnType<typeof vi.fn>;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = async (selector: string): Promise<void> => {
  const target = root.querySelector<HTMLElement>(selector);
  if (!target) throw new Error(`nothing to press: ${selector}`);
  target.click();
  await flush();
};
const open = async (mode: "first" | "rerun" = "first"): Promise<void> => {
  const app = {
    device: () => ({ ui_language: "en", onboarded: false }),
    setDevice,
    onEvent: () => () => {},
  } as unknown as AppContext;
  mountOnboarding(root, { mode, onDone: done as never }, app);
  await flush();
};
const text = (selector: string): string => root.querySelector(selector)?.textContent ?? "";

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = '<div id="ob" class="ob"></div>';
  root = document.getElementById("ob")!;
  setDevice = vi.fn().mockResolvedValue(undefined);
  done = vi.fn();
  for (const fn of Object.values(api)) fn.mockReset();
  api.secretsStatus.mockResolvedValue({ has_key: false });
  api.brainsCli.mockResolvedValue({ clis: [cli("claude"), cli("codex", { available: false }), cli("gemini", { installed: false, available: false })] });
  api.chatgptStatus.mockResolvedValue({ signed_in: false });
  api.integrationsCatalog.mockResolvedValue({ services: [entry("notion", "Notion"), entry("github", "GitHub")] });
  api.connectorsStatus.mockResolvedValue({ composio_configured: true, connectors: [] });
  api.connectorsCatalog.mockResolvedValue({ items: [{ slug: "gmail", name: "Gmail", description: "", logo: "", categories: ["communication"], needs: "sign_in", no_auth: false }], categories: [] });
  api.connectorsConnect.mockResolvedValue({ connected: true, connector: { id: "composio:gmail" } });
  api.integrationsConnect.mockResolvedValue({ connected: true, server: { id: "srv-notion" } });
  api.servicesStatus.mockResolvedValue(serviceStatus());
  api.settingsGet.mockResolvedValue({ settings: {} });
  api.settingsSet.mockResolvedValue({ settings: { web_read_enabled: false } });
  api.mainWindowForward.mockResolvedValue(undefined);
});
afterEach(() => {
  root.replaceChildren();
  setLocale("zh-TW");
});

describe("the guide", () => {
  test("opens on the welcome, with nothing to go back to on a first run", async () => {
    await open();
    expect(root.dataset.step).toBe("welcome");
    expect(root.querySelector('[data-ob="back"]')).toBeNull();
    expect(text('[data-ob="next"]')).toBe("Start");
    expect(root.querySelector(".ob-card canvas.ob-emb")).not.toBeNull();
    expect(root.querySelector(".ob-aside, .ob-top")).toBeNull();
  });

  test("walks the three choices in order in one card, with no progress bar and no side", async () => {
    await open();
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("tools");
    expect(root.querySelectorAll(".ob-card")).toHaveLength(1);
    expect(root.querySelector(".ob-card canvas.ob-emb")).toBeNull();
    expect(root.querySelector(".ob-card .ob-floaters .slime-surface")).not.toBeNull();
    expect(root.querySelector(".ob-aside, .ob-bar-steps")).toBeNull();
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("services");
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("abilities");
    await press('[data-ob="back"]');
    expect(root.dataset.step).toBe("services");
  });

  test("under every step a wide primary pill and, once there is a step to go back to, a grey Back pill", async () => {
    await open();
    expect(root.querySelectorAll(".ob-foot .btn")).toHaveLength(1);
    await press('[data-ob="next"]');
    expect(text('[data-ob="next"]')).toBe("Next");
    expect(text('.ob-foot [data-ob="back"].ob-back')).toBe("Back");
    expect(root.querySelector(".ob-foot .btn.pri")).not.toBeNull();
  });

  test("a first run saves onboarded once, on the last step, and tells who opened it", async () => {
    await open();
    for (let i = 0; i < 3; i++) await press('[data-ob="next"]');
    expect(setDevice).not.toHaveBeenCalled();
    expect(text('[data-ob="next"]')).toBe("Start using Raphael");
    await press('[data-ob="next"]');
    expect(setDevice).toHaveBeenCalledTimes(1);
    expect(setDevice).toHaveBeenCalledWith({ onboarded: true });
    expect(done).toHaveBeenCalledWith({ finished: true });
    expect(root.children).toHaveLength(0);
  });

  test("a rerun saves nothing and can be left from its welcome", async () => {
    await open("rerun");
    for (let i = 0; i < 3; i++) await press('[data-ob="next"]');
    await press('[data-ob="next"]');
    expect(setDevice).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith({ finished: true });
    await open("rerun");
    await press('[data-ob="back"]');
    expect(done).toHaveBeenLastCalledWith({ finished: false });
  });

  test("a failed save keeps the guide open and says why", async () => {
    setDevice.mockRejectedValue(new Error("disk full"));
    await open();
    for (let i = 0; i < 4; i++) await press('[data-ob="next"]');
    expect(done).not.toHaveBeenCalled();
    expect(root.querySelector('[data-ob="next"]')!.hasAttribute("disabled")).toBe(false);
  });
});

describe("step 1: the AI tools", () => {
  test("shows the accounts as the settings do, and the key's field once 連線 is pressed", async () => {
    await open();
    await press('[data-ob="next"]');
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["chatgpt", "claude", "codex", "openrouter", "gemini"]);
    expect(root.querySelector('[data-item="claude"].on .ob-tick')).not.toBeNull();
    expect(root.querySelector("#ob-key-input")).toBeNull();
    await press('[data-item="openrouter"] [data-ob="key-replace"]');
    expect(root.querySelector("#ob-key-input")).not.toBeNull();
  });

  test("the search narrows the tools in place and keeps its caret", async () => {
    await open();
    await press('[data-ob="next"]');
    const find = root.querySelector<HTMLInputElement>("#ob-tools-find")!;
    find.value = "open";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["openrouter"]);
    expect(root.querySelector("#ob-tools-find")).toBe(find);
  });

  test("a key that is checked and valid is kept, the field goes and the key is not left on the page", async () => {
    api.secretsSetOpenrouterKey.mockResolvedValue({ valid: true, label: "my-key" });
    await open();
    await press('[data-ob="next"]');
    await press('[data-item="openrouter"] [data-ob="key-replace"]');
    const input = root.querySelector<HTMLInputElement>("#ob-key-input")!;
    input.value = "sk-or-v1-secret";
    await press('[data-ob="key-paste"]');
    expect(api.secretsSetOpenrouterKey).toHaveBeenCalledWith("sk-or-v1-secret");
    expect(root.querySelector("#ob-key-input")).toBeNull();
    expect(text('[data-item="openrouter"] .ds')).toContain("my-key");
    expect(root.innerHTML).not.toContain("sk-or-v1-secret");
  });

  test("a refused key is told and the field stays", async () => {
    api.secretsSetOpenrouterKey.mockResolvedValue({ valid: false, reason: "invalid" });
    await open();
    await press('[data-ob="next"]');
    await press('[data-item="openrouter"] [data-ob="key-replace"]');
    root.querySelector<HTMLInputElement>("#ob-key-input")!.value = "nope";
    await press('[data-ob="key-paste"]');
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.querySelector("#ob-key-input")).not.toBeNull();
  });

  test("a command-line tool that is installed but signed out connects through the account controller", async () => {
    api.brainsCliLogin.mockResolvedValue({ started: true });
    await open();
    await press('[data-ob="next"]');
    await press('[data-cli="codex"]');
    expect(api.brainsCliLogin).toHaveBeenCalledWith("codex");
  });

  test("a tool that is not installed opens its install page", async () => {
    api.openExternalUrl.mockResolvedValue(undefined);
    await open();
    await press('[data-ob="next"]');
    await press('[data-cli="gemini"]');
    expect(api.openExternalUrl).toHaveBeenCalledWith(expect.stringContaining("antigravity"));
  });
});

describe("step 2: the services", () => {
  const toServices = async (): Promise<void> => {
    await open();
    await press('[data-ob="next"]');
    await press('[data-ob="next"]');
  };

  test("offers the popular apps of the store, managed ones first among the popular", async () => {
    await toServices();
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["gmail", "notion", "github"]);
  });

  test("a managed app signs in through the managed connector and says connected", async () => {
    await toServices();
    await press('[data-item="gmail"][data-ob="conn-login"]');
    expect(api.connectorsConnect).toHaveBeenCalledWith("gmail");
    expect(root.querySelector('[data-item="gmail"].on .ob-tick')).not.toBeNull();
    expect(root.querySelector('[data-item="notion"][data-ob="conn-login"]')).not.toBeNull();
  });

  test("a built-in app signs in through the store's own call", async () => {
    await toServices();
    await press('[data-item="notion"][data-ob="conn-login"]');
    expect(api.integrationsConnect).toHaveBeenCalledWith({ catalog_id: "notion" });
    expect(root.querySelector('[data-item="notion"].on .ob-tick')).not.toBeNull();
  });

  test("a sign-in that did not come through is told, a cancelled one is not", async () => {
    api.integrationsConnect.mockResolvedValueOnce({ connected: false, error: "denied" });
    await toServices();
    await press('[data-item="notion"][data-ob="conn-login"]');
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    api.integrationsConnect.mockResolvedValueOnce({ connected: false, error: "cancelled" });
    await press('[data-item="github"][data-ob="conn-login"]');
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  test("the search narrows the tiles in place and keeps what was typed through a sign-in", async () => {
    await toServices();
    const find = root.querySelector<HTMLInputElement>("#ob-find")!;
    find.value = "git";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["github"]);
    expect(root.querySelector("#ob-find")).toBe(find);
    await press('[data-item="github"][data-ob="conn-login"]');
    expect(root.querySelector<HTMLInputElement>("#ob-find")!.value).toBe("git");
    expect(root.querySelector('[data-item="github"].on .ob-tick')).not.toBeNull();
    expect(root.querySelector('[data-item="notion"]')).toBeNull();
    const again = root.querySelector<HTMLInputElement>("#ob-find")!;
    again.value = "zzz";
    again.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector(".ob-tile")).toBeNull();
    expect(text("[data-ob-services] .ob-state")).toBe("No service matches");
  });

  test("a catalog that cannot be read offers another try", async () => {
    api.integrationsCatalog.mockRejectedValueOnce(new Error("down"));
    await toServices();
    expect(root.querySelector('[data-ob="conn-reload"]')).not.toBeNull();
    await press('[data-ob="conn-reload"]');
    expect(root.querySelector(".ob-tile")).not.toBeNull();
  });

  test("a store that never answers offers another try instead of spinning on (owner, 2026-11-08)", async () => {
    vi.useFakeTimers();
    try {
      api.integrationsCatalog.mockReturnValueOnce(new Promise(() => {}));
      const opened = toServices();
      await vi.advanceTimersByTimeAsync(100);
      await opened;
      expect(root.querySelector("#ob-conn .spin")).not.toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(root.querySelector('[data-ob="conn-reload"]')).not.toBeNull();
      root.querySelector<HTMLElement>('[data-ob="conn-reload"]')!.click();
      await vi.advanceTimersByTimeAsync(100);
      expect(root.querySelector(".ob-tile")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("取消 stops the wait at once, even when the login never answers", async () => {
    api.integrationsConnect.mockReturnValueOnce(new Promise(() => {}));
    api.integrationsConnectCancel.mockResolvedValue({ cancelled: false });
    await toServices();
    await press('[data-item="notion"][data-ob="conn-login"]');
    expect(root.querySelector('[data-item="notion"] [data-ob="conn-cancel"]')).not.toBeNull();
    await press('[data-ob="conn-cancel"]');
    expect(api.integrationsConnectCancel).toHaveBeenCalled();
    expect(root.querySelector('[data-ob="conn-cancel"]')).toBeNull();
    expect(root.querySelector('button.ob-tile[data-item="github"]')!.hasAttribute("disabled")).toBe(false);
  });

  test("without Composio its card comes first, then the built-in apps that need none (owner, 2026-11-09)", async () => {
    api.connectorsStatus.mockResolvedValue({ composio_configured: false, connectors: [] });
    await toServices();
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["composio", "notion", "github"]);
    expect(text("[data-ob-services-title]")).toBe("Works without Composio");
    expect(api.connectorsCatalog).not.toHaveBeenCalled();
  });

  test("Composio's key is typed in its card; once saved its apps join the list and the card goes", async () => {
    api.connectorsStatus.mockResolvedValueOnce({ composio_configured: false, connectors: [] });
    api.connectorsSetKey.mockResolvedValue({ configured: true });
    await toServices();
    await press('[data-ob="composio-open"]');
    const field = root.querySelector<HTMLInputElement>('#ob-composio-input[type="password"]')!;
    expect(document.activeElement).toBe(field);
    field.value = "ak_synthetic";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(api.connectorsSetKey).toHaveBeenCalledWith("ak_synthetic");
    expect(root.querySelector(".ob-composio")).toBeNull();
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["gmail", "notion", "github"]);
  });

  test("a refused Composio key is told beside its field, which stays open", async () => {
    api.connectorsStatus.mockResolvedValue({ composio_configured: false, connectors: [] });
    api.connectorsSetKey.mockRejectedValue(new Error("consumer_key"));
    await toServices();
    await press('[data-ob="composio-open"]');
    root.querySelector<HTMLInputElement>("#ob-composio-input")!.value = "ck_synthetic";
    await press('[data-ob="composio-paste"]');
    expect(root.querySelector('.ob-composio [role="alert"]')!.textContent).toContain("ck_");
    expect(root.querySelector("#ob-composio-input")!.getAttribute("aria-invalid")).toBe("true");
    await press('[data-ob="composio-cancel"]');
    expect(root.querySelector("#ob-composio-input")).toBeNull();
    expect(root.querySelector('[data-ob="composio-open"]')).not.toBeNull();
  });

  test("a search finds n8n; its address and key, typed in its tile, add it as the owner's own server (owner, 2026-11-09)", async () => {
    api.integrationsAdd.mockResolvedValue({ server: { id: "srv-n8n" } });
    await toServices();
    expect(root.querySelector('[data-item="n8n"]')).toBeNull();
    const find = root.querySelector<HTMLInputElement>("#ob-find")!;
    find.value = "n8n";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["n8n"]);
    await press('[data-ob="server-open"][data-service="n8n"]');
    await press('[data-ob="server-add"]');
    expect(api.integrationsAdd).not.toHaveBeenCalled();
    expect(text('[role="alert"]')).toBe("Enter an address");
    root.querySelector<HTMLInputElement>("#ob-server-url")!.value = "https://flows.example.test/mcp-server/http";
    root.querySelector<HTMLInputElement>("#ob-server-token")!.value = "synthetic-token";
    await press('[data-ob="server-add"]');
    expect(api.integrationsAdd).toHaveBeenCalledWith({
      name: "n8n", transport: "http", url: "https://flows.example.test/mcp-server/http",
      headers: [{ name: "Authorization", value: "Bearer synthetic-token" }],
    });
    expect(root.querySelector('[data-item="n8n"].on .ob-tick')).not.toBeNull();
    expect(root.querySelector("#ob-server-token")).toBeNull();
  });
});

describe("step 3: the abilities", () => {
  const toAbilities = async (): Promise<void> => {
    await open();
    for (let i = 0; i < 3; i++) await press('[data-ob="next"]');
  };

  test("each ability is Settings › Tools' own row: what it uses now and its switch, which changes the same setting", async () => {
    await toAbilities();
    expect(root.querySelector('.svc-item[data-id="read"] .svc-now')).not.toBeNull();
    expect(root.querySelector('[data-svc="toggle"][data-id="read"]')!.getAttribute("aria-checked")).toBe("true");
    await press('[data-svc="toggle"][data-id="read"]');
    expect(api.settingsSet).toHaveBeenCalledWith("web_read_enabled", false);
  });

  test("an ability opens the choice of its service in the card, as in Settings", async () => {
    await toAbilities();
    await press('[data-svc="open"][data-id="search"]');
    expect(root.querySelector(".ob-card #svc-dialog")).not.toBeNull();
  });

  test("the guide can be finished even when the abilities could not be read", async () => {
    api.servicesStatus.mockRejectedValue(new Error("down"));
    await toAbilities();
    expect(root.querySelector('[data-svc-section] [role="alert"]')).not.toBeNull();
    await press('[data-ob="next"]');
    expect(done).toHaveBeenCalledWith({ finished: true });
  });
});
