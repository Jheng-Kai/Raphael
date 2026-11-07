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
const serviceStatus = (voiceOn = false) => ({
  search: { enabled: true, service: "builtin", options: [option] },
  read: { enabled: true, service: "builtin", options: [option] },
  pdf: { enabled: true, service: "builtin", options: [option] },
  voice: { enabled: voiceOn, service: "fish", options: [{ ...option, id: "fish", needs_key: true }], fish_voice_set: false },
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
  });

  test("walks the three choices in order in one card, with no progress bar", async () => {
    await open();
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("tools");
    expect(root.querySelectorAll(".ob-card")).toHaveLength(1);
    expect(root.querySelector(".ob-card .ob-aside .slime-surface")).not.toBeNull();
    expect(root.querySelector(".ob-bar-steps")).toBeNull();
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("services");
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("abilities");
    await press('[data-ob="back"]');
    expect(root.dataset.step).toBe("services");
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
  test("shows the accounts as the settings do, and the key as a field until one is saved", async () => {
    await open();
    await press('[data-ob="next"]');
    expect([...root.querySelectorAll(".ob-item")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["chatgpt", "claude", "codex", "gemini", "openrouter"]);
    expect(root.querySelector('[data-item="claude"] .dot.ok')).not.toBeNull();
    expect(root.querySelector("#ob-key-input")).not.toBeNull();
  });

  test("a key that is checked and valid is kept, the field goes and the key is not left on the page", async () => {
    api.secretsSetOpenrouterKey.mockResolvedValue({ valid: true, label: "my-key" });
    await open();
    await press('[data-ob="next"]');
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
    expect([...root.querySelectorAll(".ob-item")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["gmail", "notion", "github"]);
  });

  test("a managed app signs in through the managed connector and says connected", async () => {
    await toServices();
    await press('[data-item="gmail"] [data-ob="conn-login"]');
    expect(api.connectorsConnect).toHaveBeenCalledWith("gmail");
    expect(root.querySelector('[data-item="gmail"] .dot.ok')).not.toBeNull();
    expect(root.querySelector('[data-item="notion"] [data-ob="conn-login"]')).not.toBeNull();
  });

  test("a built-in app signs in through the store's own call", async () => {
    await toServices();
    await press('[data-item="notion"] [data-ob="conn-login"]');
    expect(api.integrationsConnect).toHaveBeenCalledWith({ catalog_id: "notion" });
    expect(root.querySelector('[data-item="notion"] .dot.ok')).not.toBeNull();
  });

  test("a sign-in that did not come through is told, a cancelled one is not", async () => {
    api.integrationsConnect.mockResolvedValueOnce({ connected: false, error: "denied" });
    await toServices();
    await press('[data-item="notion"] [data-ob="conn-login"]');
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    api.integrationsConnect.mockResolvedValueOnce({ connected: false, error: "cancelled" });
    await press('[data-item="github"] [data-ob="conn-login"]');
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  test("a catalog that cannot be read offers another try", async () => {
    api.integrationsCatalog.mockRejectedValueOnce(new Error("down"));
    await toServices();
    expect(root.querySelector('[data-ob="conn-reload"]')).not.toBeNull();
    await press('[data-ob="conn-reload"]');
    expect(root.querySelector(".ob-item")).not.toBeNull();
  });

  test("without Composio the built-in apps are enough", async () => {
    api.connectorsStatus.mockResolvedValue({ composio_configured: false, connectors: [] });
    await toServices();
    expect([...root.querySelectorAll(".ob-item")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["notion", "github"]);
    expect(api.connectorsCatalog).not.toHaveBeenCalled();
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
