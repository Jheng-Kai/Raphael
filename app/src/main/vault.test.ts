// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn(), membersList: vi.fn() }));
vi.mock("./api", () => api);
import { createVault, vaultHTML, type VaultEntry } from "./vault";
import { closeMenu } from "./ui";

const entries: VaultEntry[] = [
  { id: "login", kind: "login", label: "<Travel>", hint: "Travel only", origin: "https://travel.example", members: "all" },
  { id: "contact", kind: "contact", label: "Work", hint: "Work deliveries", origin: "", members: [1] },
  { id: "card", kind: "card", label: "Company card", hint: "Business travel", origin: "", members: [1] },
];
afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.resetAllMocks(); });
const setup = async () => {
  api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Member" }] });
  api.core.mockImplementation(async method => method === "vault.list" ? { entries } : {});
  const root = document.createElement("div"); document.body.append(root);
  const controller = createVault(root, () => { root.innerHTML = vaultHTML(controller.view()); });
  await controller.load();
  return { root, controller };
};
const click = (root: ParentNode, selector: string) => root.querySelector<HTMLElement>(selector)!.click();

it("escapes labels and hints while preserving filter counts", async () => {
  const { root } = await setup();
  expect(root.innerHTML).toContain("&lt;Travel&gt;");
  expect(root.querySelectorAll(".vault-row")).toHaveLength(3);
  expect(root.querySelector('.tabs.plain[role="tablist"]')).not.toBeNull();
  expect(root.querySelector(".tabs.seg")).toBeNull();
  click(root, '[data-vault="filter"][data-kind="card"]');
  expect(root.querySelectorAll(".vault-row")).toHaveLength(1);
  expect(root.querySelector('[data-kind="card"]')?.getAttribute("aria-selected")).toBe("true");
  expect(root.querySelector('[data-kind="login"] .n')?.textContent).toBe("1");
});

it("sends private fields only on save and removes them from the DOM and view on cancel", async () => {
  const { root, controller } = await setup();
  click(root, '[data-vault="new"]'); click(document, '.menu [data-value="contact"]');
  const input = root.querySelector<HTMLInputElement>("#vault-value-address")!;
  input.value = "private-address";
  expect(input.type).toBe("password");
  expect(JSON.stringify(controller.view())).not.toContain("private-address");
  expect(api.core.mock.calls.every(([method]) => method === "vault.list")).toBe(true);
  click(root, '[data-vault="cancel"]');
  expect(root.innerHTML).not.toContain("private-address");
  expect(root.querySelector("#vault-value-address")).toBeNull();
});

it("keeps typed private values when selecting member access and saves chosen IDs", async () => {
  const { root } = await setup();
  click(root, '[data-vault="new"]'); click(document, '.menu [data-value="contact"]');
  root.querySelector<HTMLInputElement>("#vault-label")!.value = "Work";
  root.querySelector<HTMLInputElement>("#vault-value-address")!.value = "private-address";
  click(root, '[data-k="vault-access"]'); click(document, '.menu [data-value="chosen"]');
  expect(root.querySelector<HTMLInputElement>("#vault-value-address")!.value).toBe("private-address");
  click(root, '[data-vault-member="1"]'); click(root, '[data-vault="save"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.add", expect.objectContaining({ members: [1], values: expect.objectContaining({ address: "private-address" }) })));
});

it("confirms only checked preview entries and cancels transient previews on close", async () => {
  const { root, controller } = await setup();
  controller.view().preview = { token: "preview", entries: [{ id: 0, label: "One", origin: "https://one.example" }, { id: 1, label: "Two", origin: "https://two.example" }], rejected: 0 };
  root.innerHTML = vaultHTML(controller.view());
  expect(api.core.mock.calls.every(([method]) => method === "vault.list")).toBe(true);
  click(root, '[data-vault-import="1"]'); click(root, '[data-vault="confirm"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.import", { token: "preview", members: "all", ids: [0] }));
  controller.view().preview = { token: "close-preview", entries: [], rejected: 0 };
  controller.reset();
  expect(api.core).toHaveBeenCalledWith("vault.cancel", { token: "close-preview" });
});
