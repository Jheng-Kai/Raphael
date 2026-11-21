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

it("lists the members to choose as rows with no box: the face on the left, pressed and checked at the right when chosen", async () => {
  api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Member", avatar: "file:1.png", avatar_url: "data:image/png;base64,AAAA" }] });
  api.core.mockImplementation(async method => method === "vault.list" ? { entries } : {});
  const root = document.createElement("div"); document.body.append(root);
  const controller = createVault(root, () => { root.innerHTML = vaultHTML(controller.view()); });
  await controller.load();
  click(root, '[data-vault="new"]'); click(document, '.menu [data-value="contact"]');
  root.querySelector<HTMLInputElement>("#vault-value-address")!.value = "private-address";
  click(root, '[data-k="vault-access"]'); click(document, '.menu [data-value="chosen"]');
  const rows = [...root.querySelectorAll<HTMLElement>(".vault-members [data-vault-member]")];
  expect(root.querySelector('.vault input[type="checkbox"]')).toBeNull();
  // Raphael and the member, each a button: the face first, the name, the round check last; none chosen yet.
  expect(rows.map(row => [row.tagName, row.dataset.vaultMember, row.getAttribute("aria-pressed")])).toEqual([["BUTTON", "0", "false"], ["BUTTON", "1", "false"]]);
  expect(rows.map(row => [...row.children].map(part => part.classList[0]))).toEqual(rows.map(() => ["av", "room-row-name", "room-row-mark"]));
  expect(rows[1].querySelector(".mb-av-pic img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  expect(rows.map(row => row.querySelector(".room-row-name")?.textContent)).toEqual(["Raphael", "Member"]);
  // A press chooses the row where it stands, its check drawn at the right, and a second press leaves it out; the typed fields stay.
  rows[1].click();
  expect([rows[1].getAttribute("aria-pressed"), !!rows[1].querySelector(".room-row-mark svg")]).toEqual(["true", true]);
  rows[0].click(); rows[0].click();
  expect([rows[0].getAttribute("aria-pressed"), !!rows[0].querySelector(".room-row-mark svg")]).toEqual(["false", false]);
  expect(root.querySelector<HTMLInputElement>("#vault-value-address")!.value).toBe("private-address");
  click(root, '[data-vault="save"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.add", expect.objectContaining({ members: [1] })));
});

it("draws an edited entry's chosen members as chosen rows", async () => {
  const { root } = await setup();
  click(root, '[data-vault="menu"][data-id="contact"]');
  click(document, '.menu [data-pick="edit"]');
  expect([...root.querySelectorAll<HTMLElement>("[data-vault-member]")].map(row => [row.dataset.vaultMember, row.getAttribute("aria-pressed"), !!row.querySelector(".room-row-mark svg")]))
    .toEqual([["0", "false", false], ["1", "true", true]]);
});

it("confirms only checked preview entries and cancels transient previews on close", async () => {
  const { root, controller } = await setup();
  controller.view().preview = { token: "preview", entries: [{ id: 0, label: "One", origin: "https://one.example" }, { id: 1, label: "Two", origin: "https://two.example" }], rejected: 0 };
  root.innerHTML = vaultHTML(controller.view());
  expect(api.core.mock.calls.every(([method]) => method === "vault.list")).toBe(true);
  // Every entry starts chosen, a row with no box: its label over its site, the whole row filled, its check at the right.
  const rows = [...root.querySelectorAll<HTMLElement>(".vault-preview [data-vault-import]")];
  expect(root.querySelector('.vault input[type="checkbox"]')).toBeNull();
  expect(rows.map(row => [row.tagName, row.getAttribute("aria-pressed"), row.querySelector(".room-row-name")?.textContent, !!row.querySelector(".room-row-mark:last-child svg")]))
    .toEqual([["BUTTON", "true", "Onehttps://one.example", true], ["BUTTON", "true", "Twohttps://two.example", true]]);
  click(root, '[data-vault-import="1"]');
  expect([rows[1].getAttribute("aria-pressed"), !!rows[1].querySelector(".room-row-mark svg")]).toEqual(["false", false]);
  click(root, '[data-vault="confirm"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.import", { token: "preview", members: "all", ids: [0] }));
  controller.view().preview = { token: "close-preview", entries: [], rejected: 0 };
  controller.reset();
  expect(api.core).toHaveBeenCalledWith("vault.cancel", { token: "close-preview" });
});

it("lists a key a member asked for, filters it like the other entries, and offers no way to type one in here", async () => {
  api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Member" }] });
  const withKey: VaultEntry[] = [...entries, { id: "key", kind: "key", label: "OPENROUTER_API_KEY", hint: "Price script", origin: "", members: [1] }];
  api.core.mockImplementation(async method => method === "vault.list" ? { entries: withKey } : {});
  const root = document.createElement("div"); document.body.append(root);
  const controller = createVault(root, () => { root.innerHTML = vaultHTML(controller.view()); });
  await controller.load();
  expect(root.querySelectorAll(".vault-row")).toHaveLength(4);
  click(root, '[data-vault="filter"][data-kind="key"]');
  const row = root.querySelector(".vault-row")!;
  expect(root.querySelectorAll(".vault-row")).toHaveLength(1);
  expect(row.textContent).toContain("OPENROUTER_API_KEY"); expect(row.textContent).toContain("Price script");
  // New offers the three kinds the owner types by hand, never a key.
  click(root, '[data-vault="new"]');
  expect([...document.querySelectorAll<HTMLElement>(".menu [data-value]")].map(item => item.dataset.value)).toEqual(["login", "contact", "card"]);
  closeMenu();
});

it("removes an entry in three presses: ⋯, 移除 that asks in its own place, then the same item again", async () => {
  const { root } = await setup();
  click(root, '[data-vault="menu"][data-id="contact"]');
  const remove = document.querySelector<HTMLElement>('.menu [data-pick="remove"]')!;
  remove.click();
  // The first press asks in the item's place and keeps the same menu open; nothing is removed yet.
  expect(document.querySelector('.menu [data-pick="remove"]')).toBe(remove);
  expect(remove.textContent).toBe("確定移除這筆資料？");
  expect(api.core).not.toHaveBeenCalledWith("vault.remove", expect.anything());
  remove.click();
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.remove", { id: "contact" }));
  expect(document.querySelector('.menu [data-pick="remove"]')).toBeNull();
});

it("shows no Keys tab until a member has asked for a key", async () => {
  const { root } = await setup();
  expect(root.querySelector('[data-vault="filter"][data-kind="key"]')).toBeNull();
});
