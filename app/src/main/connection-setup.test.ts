// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import type { ToolkitPlan } from "./plugins-data";

const api = vi.hoisted(() => ({ connectorsToolkit: vi.fn(), openExternalUrl: vi.fn() }));
vi.mock("./api", () => api);
vi.mock("./ui", async original => ({ ...(await original<typeof import("./ui")>()), toaster: { info: vi.fn() }, copyButton: vi.fn().mockResolvedValue(undefined) }));
import { openConnectionSetup } from "./connection-setup";
import { copyButton } from "./ui";

const KEY = "zk-test-0123456789";
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const keyPlan: ToolkitPlan = {
  slug: "acme", name: "Acme", needs: "key", scheme: "API_KEY", redirect_url: null, guide_url: "https://docs.acme.example/keys", app_url: "https://acme.example",
  fields: [{ name: "generic_api_key", label: "API Key", description: "Your Acme key", required: true, secret: true, default: null }],
};
const appPlan: ToolkitPlan = {
  slug: "orbit", name: "Orbit", needs: "own_app", scheme: "OAUTH2", guide_url: "https://developers.orbit.example/apps", app_url: null,
  redirect_url: "https://backend.example/auth/callback",
  fields: [
    { name: "client_id", label: "Client ID", description: "", required: true, secret: false, default: null },
    { name: "client_secret", label: "Client Secret", description: "", required: true, secret: true, default: null },
    { name: "scopes", label: "Scopes", description: "", required: false, secret: false, default: "read" },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.openExternalUrl.mockResolvedValue(undefined);
  setLocale("en");
  document.body.innerHTML = "";
});
afterEach(() => { setLocale("zh-TW"); document.body.innerHTML = ""; });

const dialog = (): HTMLElement => document.querySelector<HTMLElement>(".cn-setup-dialog")!;
const press = (act: string): void => dialog().querySelector<HTMLButtonElement>(`[data-dlg="${act}"]`)!.click();
const field = (name: string): HTMLInputElement => dialog().querySelector<HTMLInputElement>(`[data-setup-field="${name}"]`)!;

async function open(plan: ToolkitPlan, connect = vi.fn().mockResolvedValue({ connected: true }), composioKey?: () => void) {
  api.connectorsToolkit.mockResolvedValue(plan);
  const done = openConnectionSetup({ slug: plan.slug, name: plan.name, needs: plan.needs as "key" | "own_app" }, { connect, composioKey });
  await settle();
  return { done, connect };
}

test("the form for a key says what is needed, where to get it, how, and that Composio keeps it", async () => {
  await open(keyPlan);
  expect(api.connectorsToolkit).toHaveBeenCalledWith("acme");
  expect(dialog().querySelector("h2")?.textContent).toBe("Add Acme");
  expect(dialog().querySelector(".cn-lead")?.textContent).toBe("Acme signs in with your own API key.");
  expect(dialog().querySelector(".cn-keep")?.textContent).toContain("Composio, which keeps it");
  expect(dialog().querySelectorAll(".cn-steps li")).toHaveLength(3);
  expect(field("generic_api_key").type).toBe("password");
  expect(dialog().querySelector(".cn-hint")?.textContent).toBe("Your Acme key");
  expect(dialog().querySelector('[data-dlg="add"]')).toHaveProperty("disabled", false);
  // The guide the catalog gives opens in the browser through the shell's own check of the address.
  press("guide");
  expect(api.openExternalUrl).toHaveBeenCalledWith("https://docs.acme.example/keys");
});

test("a field's description is the provider's English, so only an English window shows it", async () => {
  setLocale("zh-TW");
  await open(keyPlan);
  expect(dialog().querySelector(".cn-hint")).toBeNull();
  expect(dialog().querySelector(".cn-label")?.textContent).toBe("API Key");
});

test("without a guide it says so and offers the service's own page; without either it says to look it up", async () => {
  await open({ ...keyPlan, guide_url: null });
  expect(dialog().querySelector(".cn-where")?.textContent).toContain("The catalog gives no instructions for this");
  expect(dialog().querySelector('[data-dlg="guide"]')).toBeNull();
  press("home");
  expect(api.openExternalUrl).toHaveBeenCalledWith("https://acme.example");
  press("cancel"); await settle();
  await open({ ...keyPlan, guide_url: null, app_url: null });
  expect(dialog().querySelector(".cn-where")?.textContent).toContain("has no address for Acme either");
  expect(dialog().querySelector('[data-dlg="home"], [data-dlg="guide"]')).toBeNull();
});

test("a developer app shows the address to register, copies it, and asks for the id and the masked secret", async () => {
  await open(appPlan);
  expect(dialog().querySelector(".cn-lead")?.textContent).toContain("needs a developer app of your own");
  expect(dialog().querySelector<HTMLInputElement>(".cn-redirect input")?.value).toBe("https://backend.example/auth/callback");
  expect(dialog().querySelector<HTMLInputElement>(".cn-redirect input")?.readOnly).toBe(true);
  press("copy"); await settle();
  expect(copyButton).toHaveBeenCalledWith(expect.any(HTMLElement), "https://backend.example/auth/callback");
  expect([field("client_id").type, field("client_secret").type, field("scopes").type]).toEqual(["text", "password", "text"]);
  expect(field("scopes").placeholder).toBe("read");
  expect(dialog().textContent).toContain("optional");
});

test("a required field left empty is asked for and nothing is sent", async () => {
  const { connect } = await open(keyPlan);
  press("add");
  expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Some fields are still empty.");
  expect(connect).not.toHaveBeenCalled();
});

test("what is typed goes to the core in one call, the secret is emptied at once, and the dialog closes when it is added", async () => {
  let finish!: (value: { connected: boolean }) => void;
  const connect = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { done } = await open(appPlan, connect);
  field("client_id").value = " cid-test ";
  field("client_secret").value = KEY;
  press("add");
  expect(connect).toHaveBeenCalledWith({ client_id: "cid-test", client_secret: KEY, scopes: "" });
  expect(field("client_secret").value).toBe(""); // gone from the page while the call is under way
  expect(field("client_id").disabled).toBe(true);
  expect(dialog().querySelector("[data-setup-status]")?.textContent).toContain("Your browser is open");
  // Under way it cannot be dismissed: the call cannot be taken back.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(dialog()).not.toBeNull();
  finish({ connected: true });
  expect(await done).toBe(true);
  expect(document.querySelector(".cn-setup-dialog")).toBeNull();
  expect(document.body.innerHTML).not.toContain(KEY);
});

test.each([
  ["key_rejected", "Acme did not accept this key"],
  ["needs_key", "Some fields are still empty."],
  ["denied", "You declined in the browser"],
  ["busy", "Another sign-in is under way"],
  ["something_else", "Connection did not finish"],
])("a failure (%s) is told in the form and the form can be tried again", async (error, words) => {
  const connect = vi.fn().mockResolvedValue({ connected: false, error });
  const { done } = await open(keyPlan, connect);
  field("generic_api_key").value = KEY;
  press("add"); await settle();
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(words);
  expect(field("generic_api_key").value).toBe("");
  expect(field("generic_api_key").disabled).toBe(false);
  expect(dialog().querySelector('[data-dlg="add"]')).toHaveProperty("disabled", false);
  expect(dialog().querySelector('[data-dlg="add"]')?.textContent).toBe("Add");
  expect(document.body.innerHTML).not.toContain(KEY);
  press("cancel");
  expect(await done).toBe(false);
});

test("a missing Composio key is told with a button to the place that adds it", async () => {
  const composioKey = vi.fn();
  const connect = vi.fn().mockRejectedValue(new Error("missing_key"));
  const { done } = await open(keyPlan, connect, composioKey);
  field("generic_api_key").value = KEY;
  press("add"); await settle();
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain("no working Composio key");
  expect(dialog().querySelector('[data-dlg="composio"]')?.textContent).toBe("Add Composio key");
  press("composio");
  expect(composioKey).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".cn-setup-dialog")).toBeNull();
  expect(await done).toBe(false);
});

test("when what the app needs cannot be read it says so and tries again on request", async () => {
  api.connectorsToolkit.mockRejectedValueOnce(new Error("network"));
  const done = openConnectionSetup({ slug: "acme", name: "Acme", needs: "key" }, { connect: vi.fn() });
  await settle();
  expect(dialog().textContent).toContain("Could not read what Acme needs");
  expect(dialog().querySelector('[data-dlg="add"]')).toHaveProperty("disabled", true);
  api.connectorsToolkit.mockResolvedValue(keyPlan);
  press("retry"); await settle();
  expect(field("generic_api_key")).not.toBeNull();
  expect(dialog().querySelector('[data-dlg="add"]')).toHaveProperty("disabled", false);
  press("cancel");
  expect(await done).toBe(false);
});
