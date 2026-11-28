// @vitest-environment happy-dom
import { navInputs, pressLayer } from "../test-support/nav-layer-input";
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
  providersKinds: vi.fn(),
  providersList: vi.fn(),
  providersTest: vi.fn(),
  providersAdd: vi.fn(),
  chatgptStatus: vi.fn(),
  chatgptSignIn: vi.fn(),
  chatgptCancel: vi.fn(),
  chatgptModels: vi.fn(),
  mainWindowForward: vi.fn(),
  brainsCliLogin: vi.fn(),
  openExternalUrl: vi.fn(),
  membersList: vi.fn(),
  membersUpdate: vi.fn(),
  membersCreate: vi.fn(),
}));
vi.mock("../api", () => api);
// The picker of the window's language answers at once with the language the test names.
const chosen = vi.hoisted(() => ({ language: "fr" }));
vi.mock("../language-picker", async (original) => ({
  ...(await original<typeof import("../language-picker")>()),
  openLanguagePicker: (_button: unknown, _choices: unknown, _current: unknown, pick: (value: string) => void) => pick(chosen.language),
}));

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
const open = async (): Promise<void> => {
  const app = {
    device: () => ({ ui_language: "en", onboarded: false }),
    setDevice,
    onEvent: () => () => {},
  } as unknown as AppContext;
  mountOnboarding(root, { onDone: done as never }, app);
  await flush();
};
const text = (selector: string): string => root.querySelector(selector)?.textContent ?? "";
/** The first slime's name, typed as the owner types it (its way on waits for one). */
const nameFirst = (name: string): void => {
  const field = root.querySelector<HTMLInputElement>("#ob-first-name")!;
  field.value = name;
  field.dispatchEvent(new Event("input", { bubbles: true }));
};
/** From the welcome past the first slime, named, to the AI tools. */
const toTools = async (): Promise<void> => {
  await press('[data-ob="next"]');
  nameFirst("Mochi");
  await press('[data-ob="next"]');
};

test.each(navInputs)("%s can retrace guide steps, and back at the first step leaves the guide where it is", async input => {
  await open();
  pressLayer(input, "forward");
  expect(root.dataset.step).toBe("welcome");
  await press('[data-ob="next"]');
  pressLayer(input);
  expect(root.dataset.step).toBe("welcome");
  pressLayer(input, "forward");
  expect(root.dataset.step).toBe("slime");
  pressLayer(input);
  pressLayer(input);
  // One stray press never skips the first-run guide (R-NAV-02).
  expect(root.dataset.step).toBe("welcome");
  expect(done).not.toHaveBeenCalled();
  expect(setDevice).not.toHaveBeenCalledWith({ onboarded: true });
});

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = '<div id="ob" class="ob"></div>';
  root = document.getElementById("ob")!;
  setDevice = vi.fn().mockResolvedValue(undefined);
  done = vi.fn();
  for (const fn of Object.values(api)) fn.mockReset();
  api.secretsStatus.mockResolvedValue({ has_key: false });
  api.brainsCli.mockResolvedValue({ clis: [cli("claude"), cli("codex", { available: false }), cli("gemini", { installed: false, available: false })] });
  api.providersKinds.mockResolvedValue({ kinds: [] });
  api.providersList.mockResolvedValue({ providers: [] });
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
  api.membersList.mockResolvedValue({ members: [{ id: 0, name: "Raphael", avatar: "" }], groups: [] });
  api.membersUpdate.mockResolvedValue({ member: { id: 0 } });
  api.membersCreate.mockResolvedValue({ member: { id: 7, chief: true }, routine_offer: null });
});
afterEach(() => {
  root.replaceChildren();
  setLocale("zh-TW");
});

test("the guide connects a provider by testing its form before saving and updates the tool tile", async () => {
  const kind = { kind: "openai", name: "OpenAI", group: "official", fields: ["key"], available: true };
  const provider = { id: "p1", kind: "openai", name: "OpenAI", has_key: true, enabled: true, status: "ok", models: 1 };
  api.providersKinds.mockResolvedValue({ kinds: [kind] });
  api.providersTest.mockResolvedValue({ ok: true, models: 1, found: [{ id: "gpt-x", name: "GPT X" }] });
  api.providersAdd.mockResolvedValue({ provider });
  await open(); await toTools();
  await press('[data-pv="add"][data-id="openai"]');
  const key = root.querySelector<HTMLInputElement>('input[type="password"]')!;
  key.value = "guide-key";
  key.dispatchEvent(new Event("input", { bubbles: true }));
  await press('[data-pv="connect"]');
  expect(api.providersTest).toHaveBeenCalledExactlyOnceWith({ kind: "openai", key: "guide-key" });
  expect(api.providersAdd).toHaveBeenCalledExactlyOnceWith({ kind: "openai", key: "guide-key" });
  expect(api.providersTest.mock.invocationCallOrder[0]).toBeLessThan(api.providersAdd.mock.invocationCallOrder[0]);
  expect(text(".pv-model-list")).toContain("GPT X");
  await press('[data-pv="close"]');
  expect(root.querySelector('[data-pv="open"][data-id="p1"]')).not.toBeNull();
});

test.each(["paste", "file"])("the guide accepts a service account by %s in the provider dialog", async (method) => {
  const kind = { kind: "vertex", name: "Vertex AI", group: "official", fields: ["service_account", "project", "location"], available: true };
  const provider = { id: "p2", kind: "vertex", name: "Vertex AI", has_key: true, enabled: true, status: "ok", models: 0 };
  const account = '{"client_email":"test@example.com","private_key":"guide-account"}';
  api.providersKinds.mockResolvedValue({ kinds: [kind] });
  api.providersTest.mockResolvedValue({ ok: true, models: 0, found: [] });
  api.providersAdd.mockResolvedValue({ provider });
  await open(); await toTools();
  await press('[data-pv="add"][data-id="vertex"]');
  const project = root.querySelector<HTMLInputElement>('[id$="-project"]')!;
  project.value = "guide-project";
  project.dispatchEvent(new Event("input", { bubbles: true }));
  if (method === "paste") {
    const field = root.querySelector<HTMLTextAreaElement>(".pv-account textarea")!;
    field.value = account;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const field = root.querySelector<HTMLInputElement>(".pv-file")!;
    Object.defineProperty(field, "files", { value: [new File([account], "service.json")] });
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
  }
  expect(text(".pv-setup")).toContain("Configured");
  await press('[data-pv="connect"]');
  expect(api.providersTest).toHaveBeenCalledExactlyOnceWith({ kind: "vertex", service_account: account, project: "guide-project", location: "us-central1" });
  expect(root.querySelector("#pv-model-search")).not.toBeNull();
});

describe("the guide", () => {
  test("the language chosen on the welcome is the language dictation listens for, not a fixed 繁體中文 (R-DEFAULT-03)", async () => {
    await open();
    for (const [language, spoken] of [["fr", "fr-FR"], ["ja", "ja-JP"], ["en", "en-US"], ["zh-TW", "zh-TW"]] as const) {
      chosen.language = language;
      api.settingsSet.mockClear();
      await press('[data-ob="lang"]');
      expect(setDevice).toHaveBeenLastCalledWith({ ui_language: language });
      expect(api.settingsSet).toHaveBeenCalledWith("languages", [spoken]);
    }
    // A core that cannot take it leaves the default; the window's language is changed all the same.
    chosen.language = "de";
    api.settingsSet.mockRejectedValueOnce(new Error("the core is not running"));
    await press('[data-ob="lang"]');
    expect(setDevice).toHaveBeenLastCalledWith({ ui_language: "de" });
  });

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
    await toTools();
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

  test("the foot is the welcome's pill alone, and then on every step a pair of round buttons, the way back before the way on", async () => {
    await open();
    const foot = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".ob-foot .btn")];
    expect(foot().map((control) => control.dataset.ob)).toEqual(["next"]);
    // The welcome's row is its one worded pill, not the steps' pair.
    expect(root.querySelector(".ob-foot .ob-actions")!.classList.contains("ob-pair")).toBe(false);
    expect(text('[data-ob="next"]')).toBe("Start");
    for (const step of ["slime", "tools", "services", "abilities"]) {
      if (step === "tools") nameFirst("Mochi");
      await press('[data-ob="next"]');
      expect(root.dataset.step).toBe(step);
      // Exactly two controls, the way back first and the primary after it (also the tab order), in the row that keeps
      // them together in the middle.
      const [back, primary, ...more] = foot();
      expect(more).toHaveLength(0);
      expect(root.querySelector(".ob-foot .ob-actions")!.classList.contains("ob-pair")).toBe(true);
      expect(back!.dataset.ob).toBe("back");
      expect(primary!.dataset.ob).toBe("next");
      expect(primary!.classList.contains("pri")).toBe(true);
      // Neither has words: each is a drawing, named for assistive tech and in its tooltip.
      for (const control of [back!, primary!]) {
        expect(control.classList.contains("icon")).toBe(true);
        expect(control.textContent).toBe("");
        expect(control.querySelectorAll("svg.i")).toHaveLength(1);
        expect(control.getAttribute("title")).toBe(control.getAttribute("aria-label"));
      }
      expect(back!.getAttribute("aria-label")).toBe("Back");
      expect(primary!.getAttribute("aria-label")).toBe(step === "abilities" ? "Start using Raphael" : "Next");
      // Back uses the shared round control and the forward action has its own icon.
      expect(back!.classList.contains("back-button")).toBe(true);
      expect(primary!.classList.contains("ob-tri")).toBe(step !== "abilities");
      expect(back!.querySelector("svg.i")!.innerHTML).not.toBe(primary!.querySelector("svg.i")!.innerHTML);
    }
  });

  test("the back button goes back one step, and the way on keeps its name", async () => {
    await open();
    await toTools();
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("services");
    expect(root.querySelector('[data-ob="next"]')!.getAttribute("aria-label")).toBe("Next");
    await press('.ob-foot [data-ob="back"]');
    expect(root.dataset.step).toBe("tools");
    await press('.ob-foot [data-ob="back"]');
    expect(root.dataset.step).toBe("slime");
    // What was typed stays when the owner comes back to it.
    expect(root.querySelector<HTMLInputElement>("#ob-first-name")!.value).toBe("Mochi");
    await press('.ob-foot [data-ob="back"]');
    expect(root.dataset.step).toBe("welcome");
    expect(root.querySelector('[data-ob="back"]')).toBeNull();
  });

  test("a first run saves onboarded once, on the last step, and tells who opened it", async () => {
    await open();
    await toTools();
    for (let i = 0; i < 2; i++) await press('[data-ob="next"]');
    expect(setDevice).not.toHaveBeenCalled();
    expect(root.querySelector('[data-ob="next"]')!.getAttribute("aria-label")).toBe("Start using Raphael");
    await press('[data-ob="next"]');
    expect(setDevice).toHaveBeenCalledTimes(1);
    expect(setDevice).toHaveBeenCalledWith({ onboarded: true });
    expect(done).toHaveBeenCalledWith({ finished: true });
    expect(root.children).toHaveLength(0);
  });

  test("a failed save keeps the guide open and says why", async () => {
    setDevice.mockRejectedValue(new Error("disk full"));
    await open();
    await toTools();
    for (let i = 0; i < 3; i++) await press('[data-ob="next"]');
    expect(done).not.toHaveBeenCalled();
    expect(root.querySelector('[data-ob="next"]')!.hasAttribute("disabled")).toBe(false);
  });
});

describe("the first slime", () => {
  test("its name is the owner's to give: the built-in one is never in the field, and the way on waits for one", async () => {
    await open();
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("slime");
    expect(root.querySelector("h2")!.textContent).toBe("Name your first slime");
    const field = root.querySelector<HTMLInputElement>("#ob-first-name")!;
    expect(field.value).toBe("");
    expect(field.maxLength).toBe(16);
    const next = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('[data-ob="next"]')!;
    expect(next().disabled).toBe(true);
    nameFirst("   ");
    expect(next().disabled).toBe(true);
    nameFirst("Mochi");
    expect(next().disabled).toBe(false);
    expect(root.querySelector(".ob-first-face .slime-surface")).not.toBeNull();
  });

  test("its look starts as the first blue slime, and a press in the members' picker dresses it at once", async () => {
    await open();
    await press('[data-ob="next"]');
    expect(root.querySelector('.ob-first-picker [aria-pressed="true"]')!.getAttribute("data-slime-character")).toBe("blue-plain");
    const before = root.querySelector(".ob-first-face")!.innerHTML;
    await press('.ob-first-picker [data-slime-character="horns-red"]');
    expect(root.querySelector(".ob-first-face")!.innerHTML).not.toBe(before);
    expect(root.querySelector('.ob-first-picker [data-slime-character="horns-red"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  test("Enter does the same as the way on: the first slime is made with the name and the slime chosen", async () => {
    await open();
    await press('[data-ob="next"]');
    await press('.ob-first-picker [data-slime-character="horns-red"]');
    nameFirst("  Mochi  ");
    root.querySelector<HTMLInputElement>("#ob-first-name")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(api.membersCreate).toHaveBeenCalledExactlyOnceWith({ name: "Mochi", avatar: "slime:horns-red" });
    expect(root.dataset.step).toBe("tools");
    // Back and on again with nothing changed sends nothing again.
    await press('.ob-foot [data-ob="back"]');
    await press('[data-ob="next"]');
    expect(api.membersCreate).toHaveBeenCalledTimes(1);
    expect(api.membersUpdate).not.toHaveBeenCalled();
  });

  test("a save that ends after the owner went back, and came here again, does not move the new visit on", async () => {
    let saved!: (value: unknown) => void;
    api.membersCreate.mockReturnValue(new Promise(resolve => { saved = resolve; }));
    await open();
    await press('[data-ob="next"]');
    nameFirst("Mochi");
    await press('[data-ob="next"]');
    await press('.ob-foot [data-ob="back"]');
    expect(root.dataset.step).toBe("welcome");
    await press('[data-ob="next"]');
    expect(root.dataset.step).toBe("slime");
    saved({ member: { id: 7 }, routine_offer: null });
    await flush();
    expect(root.dataset.step).toBe("slime");
    // The name can be changed again once the save is done.
    expect(root.querySelector<HTMLInputElement>("#ob-first-name")!.disabled).toBe(false);
  });

  test("forward by the mouse past the first slime keeps a changed name first, as the way on does", async () => {
    await open();
    await toTools();
    pressLayer("mouse");
    expect(root.dataset.step).toBe("slime");
    nameFirst("Kiri");
    pressLayer("mouse", "forward");
    await flush();
    expect(api.membersUpdate).toHaveBeenLastCalledWith(7, { name: "Kiri", avatar: "slime:blue-plain" });
    expect(root.dataset.step).toBe("tools");
  });

  test("a refused name keeps the step and says why", async () => {
    api.membersCreate.mockRejectedValue(new Error("the core is not running"));
    await open();
    await toTools();
    expect(root.dataset.step).toBe("slime");
    expect(root.querySelector<HTMLButtonElement>('[data-ob="next"]')!.disabled).toBe(false);
  });

  test("a name the owner already gave stands in the field, and its slime in the picker", async () => {
    api.membersList.mockResolvedValue({ members: [{ id: 0, name: "Raphael", avatar: "", raphael: true }, { id: 4, name: "Mochi", avatar: "slime:horns-red", chief: true }], groups: [], team_context: { primary_id: 4 } });
    await open();
    await press('[data-ob="next"]');
    expect(root.querySelector<HTMLInputElement>("#ob-first-name")!.value).toBe("Mochi");
    expect(root.querySelector('.ob-first-picker [aria-pressed="true"]')!.getAttribute("data-slime-character")).toBe("horns-red");
    await press('[data-ob="next"]');
    expect(api.membersUpdate).not.toHaveBeenCalled();
    expect(api.membersCreate).not.toHaveBeenCalled();
    expect(root.dataset.step).toBe("tools");
  });
});

describe("step 1: the AI tools", () => {
  test("shows the accounts as the settings do, and asks for no OpenRouter key of its own", async () => {
    await open();
    await toTools();
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["chatgpt", "claude", "codex", "gemini"]);
    expect(root.querySelector('[data-item="claude"].on .ob-tick')).not.toBeNull();
    expect(root.querySelector('#ob-key-input, [data-ob="key-replace"]')).toBeNull();
    expect(api.secretsSetOpenrouterKey).not.toHaveBeenCalled();
  });

  test("the search narrows the tools in place and keeps its caret", async () => {
    await open();
    await toTools();
    const find = root.querySelector<HTMLInputElement>("#ob-tools-find")!;
    find.value = "clau";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...root.querySelectorAll(".ob-tile")].map((el) => (el as HTMLElement).dataset.item)).toEqual(["claude"]);
    expect(root.querySelector("#ob-tools-find")).toBe(find);
  });

  test("a command-line tool that is installed but signed out connects through the account controller", async () => {
    api.brainsCliLogin.mockResolvedValue({ started: true });
    await open();
    await toTools();
    await press('[data-cli="codex"]');
    expect(api.brainsCliLogin).toHaveBeenCalledWith("codex");
  });

  test("a tool that is not installed opens its install page", async () => {
    api.openExternalUrl.mockResolvedValue(undefined);
    await open();
    await toTools();
    await press('[data-cli="gemini"]');
    expect(api.openExternalUrl).toHaveBeenCalledWith(expect.stringContaining("antigravity"));
  });
});

describe("step 2: the services", () => {
  const toServices = async (): Promise<void> => {
    await open();
    await toTools();
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

  test("a store that never answers offers another try instead of spinning on", async () => {
    vi.useFakeTimers();
    try {
      api.integrationsCatalog.mockReturnValueOnce(new Promise(() => {}));
      const opened = toServices();
      await vi.advanceTimersByTimeAsync(100);
      await opened;
      expect(root.querySelector("#ob-conn .spin")).not.toBeNull();
      // It waits as long as the core would (SERVICES_WAIT_MS, R-LIMIT-02), then offers another try.
      await vi.advanceTimersByTimeAsync(600_000);
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

  test("without Composio its card comes first, then the built-in apps that need none", async () => {
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

  test("a search finds n8n, its address and key, typed in its tile, add it as the owner's own server", async () => {
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
    await toTools();
    for (let i = 0; i < 2; i++) await press('[data-ob="next"]');
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

describe("the first slime is a real member, and the chief of staff", () => {
  test("the way on creates it with the name and the slime chosen, and saves nothing as Raphael's", async () => {
    await open();
    await press('[data-ob="next"]');
    await press('.ob-first-picker [data-slime-character="horns-red"]');
    nameFirst("  Mochi  ");
    await press('[data-ob="next"]');
    expect(api.membersCreate).toHaveBeenCalledExactlyOnceWith({ name: "Mochi", avatar: "slime:horns-red" });
    expect(api.membersUpdate).not.toHaveBeenCalled();
    expect(root.dataset.step).toBe("tools");
  });

  test("back and on again with nothing changed sends nothing, and a changed name updates the slime it made instead of making another", async () => {
    await open();
    await press('[data-ob="next"]');
    nameFirst("Mochi");
    await press('[data-ob="next"]');
    await press('.ob-foot [data-ob="back"]');
    await press('[data-ob="next"]');
    expect(api.membersCreate).toHaveBeenCalledTimes(1);
    expect(api.membersUpdate).not.toHaveBeenCalled();
    await press('.ob-foot [data-ob="back"]');
    nameFirst("Kiri");
    await press('.ob-first-picker [data-slime-character="horns-red"]');
    await press('[data-ob="next"]');
    expect(api.membersCreate).toHaveBeenCalledTimes(1);
    expect(api.membersUpdate).toHaveBeenCalledExactlyOnceWith(7, { name: "Kiri", avatar: "slime:horns-red" });
  });

  test("a chief slime the owner already has stands in the step and is the one updated, and Raphael's own name never is", async () => {
    api.membersList.mockResolvedValue({ members: [{ id: 0, name: "Raphael", avatar: "", raphael: true }, { id: 4, name: "Mochi", avatar: "slime:horns-red", chief: true }], groups: [], team_context: { primary_id: 4 } });
    await open();
    await press('[data-ob="next"]');
    expect(root.querySelector<HTMLInputElement>("#ob-first-name")!.value).toBe("Mochi");
    expect(root.querySelector('.ob-first-picker [aria-pressed="true"]')!.getAttribute("data-slime-character")).toBe("horns-red");
    await press('[data-ob="next"]');
    expect(api.membersCreate).not.toHaveBeenCalled();
    expect(api.membersUpdate).not.toHaveBeenCalled();
    await press('.ob-foot [data-ob="back"]');
    nameFirst("Kiri");
    await press('[data-ob="next"]');
    expect(api.membersCreate).not.toHaveBeenCalled();
    expect(api.membersUpdate).toHaveBeenCalledExactlyOnceWith(4, { name: "Kiri", avatar: "slime:horns-red" });
  });

  test("with no slime yet the field starts empty, though Raphael is in the roster, and the words call it a slime", async () => {
    api.membersList.mockResolvedValue({ members: [{ id: 0, name: "Raphael", avatar: "", raphael: true }], groups: [], team_context: { primary_id: null } });
    await open();
    await press('[data-ob="next"]');
    expect(root.querySelector<HTMLInputElement>("#ob-first-name")!.value).toBe("");
    expect(root.querySelector('.ob-first-picker [aria-pressed="true"]')!.getAttribute("data-slime-character")).toBe("blue-plain");
    expect(text("h2")).toBe("Name your first slime");
    expect(text(".ob-first").toLowerCase()).not.toContain("raphael");
  });

  test("a name Raphael bears is refused before the core is asked, and the step stays", async () => {
    await open();
    await press('[data-ob="next"]');
    nameFirst("Raphael");
    await press('[data-ob="next"]');
    expect(api.membersCreate).not.toHaveBeenCalled();
    expect(root.dataset.step).toBe("slime");
  });
});
