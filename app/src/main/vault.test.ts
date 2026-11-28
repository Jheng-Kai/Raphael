// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn(), membersList: vi.fn(), connectorsStatus: vi.fn(), connectorsSetKey: vi.fn() }));
vi.mock("./api", () => api);
import { createVault, vaultHTML, type VaultEntry } from "./vault";
import { closeMenu } from "./ui";
import { stepOpenLayer } from "./dismissals";

const entries: VaultEntry[] = [
  { id: "login", kind: "login", label: "<Travel>", hint: "Travel only", origin: "https://travel.example", members: "all" },
  { id: "contact", kind: "contact", label: "Work", hint: "Work deliveries", origin: "", members: [1] },
  { id: "card", kind: "card", label: "Company card", hint: "Business travel", origin: "", members: [1] },
];
afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.resetAllMocks(); });
const setup = async () => {
  api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: false, google_configured: false }); api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Member" }] });
  api.core.mockImplementation(reply);
  const root = document.createElement("div"); document.body.append(root);
  const controller = createVault(root, () => { root.innerHTML = vaultHTML(controller.view()); });
  await controller.load();
  return { root, controller };
};
/** The values the OS vault holds for each entry, as `vault.reveal` gives them to the owner's page. */
const saved: Record<string, Record<string, string>> = {
  login: { username: "ada@example.test", password: "old-secret" },
  contact: { name: "Ada", address: "1 Road", phone: "0912", email: "ada@example.test" },
  card: { name: "Ada", number: "4111111111111111", expiry: "12/30", cvc: "123" },
  key: { value: "sk-saved" },
};
async function reply(method: string, params?: { id?: string }): Promise<unknown> {
  if (method === "vault.list") return { entries };
  if (method === "vault.reveal") return { values: saved[params!.id!] };
  if (method === "connectors.reveal_key") return { key: "comp_saved" };
  return {};
}
/** Opens an entry's page with its pencil, and waits for its values. */
const openPage = async (root: HTMLElement, id: string): Promise<void> => {
  click(root, `[data-vault="edit"][data-id="${id}"]`);
  await vi.waitFor(() => expect(root.querySelector(".vault-form")).not.toBeNull());
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

it("sends private fields only on save and removes them from the DOM and view once the page is left without saving", async () => {
  const { root, controller } = await setup();
  click(root, '[data-vault="new"]'); click(document, '.menu [data-value="contact"]');
  const input = root.querySelector<HTMLInputElement>("#vault-value-address")!;
  input.value = "private-address";
  expect(input.type).toBe("password");
  expect(JSON.stringify(controller.view())).not.toContain("private-address");
  expect(api.core.mock.calls.every(([method]) => method === "vault.list")).toBe(true);
  click(root, '[data-vault="cancel"]');
  click(document, '.vault-unsaved [data-dlg="discard"]');
  expect(root.innerHTML).not.toContain("private-address");
  expect(JSON.stringify(controller.view())).not.toContain("private-address");
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
  api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: false, google_configured: false }); api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Member", avatar: "file:1.png", avatar_url: "data:image/png;base64,AAAA" }] });
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
  await openPage(root, "contact");
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
  api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: false, google_configured: false }); api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Member" }] });
  const withKey: VaultEntry[] = [...entries, { id: "key", kind: "key", label: "OPENROUTER_API_KEY", hint: "Price script", origin: "", members: [1] }];
  api.core.mockImplementation(async (method: string, params?: { id?: string }) => method === "vault.list" ? { entries: withKey } : reply(method, params));
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

it("removes an entry from its page: the trash asks in the red dialog deleting a member uses, and only its red button removes", async () => {
  const { root } = await setup();
  await openPage(root, "contact");
  const trash = root.querySelector<HTMLElement>('.vault-page-head [data-vault="remove"]')!;
  expect(trash.getAttribute("aria-label")).toBe("移除");
  expect(trash.classList.contains("danger")).toBe(true);
  trash.click();
  // The dialog names the entry and says what goes; the trash stays a trash, and nothing is removed yet.
  const dialog = document.querySelector<HTMLElement>(".mb-dialog.mb-delete:not(.is-quiet)")!;
  expect(dialog.querySelector("h2")!.textContent).toBe("移除「Work」？");
  expect(dialog.querySelector(".mb-dlg-body")!.textContent).toBe("移除後，成員就不能再使用這筆資料，也無法復原。");
  expect(root.querySelector("[data-asking]")).toBeNull();
  // 取消 keeps the entry and its page.
  click(dialog, '[data-dlg="cancel"]');
  await Promise.resolve();
  expect(api.core).not.toHaveBeenCalledWith("vault.remove", expect.anything());
  expect(root.querySelector(".vault-page")).not.toBeNull();
  trash.click();
  click(document, '.mb-delete [data-dlg="delete"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.remove", { id: "contact" }));
  await vi.waitFor(() => expect(root.querySelector(".vault-page")).toBeNull());
  // The list has no ⋯ and no menu: each row's pencil opens its page.
  expect(root.querySelector('[data-vault="menu"], [data-overflow]')).toBeNull();
  expect(root.querySelectorAll('.vault-row [data-vault="edit"]')).toHaveLength(3);
});

it("shows no Keys tab until a member has asked for a key", async () => {
  const { root } = await setup();
  expect(root.querySelector('[data-vault="filter"][data-kind="key"]')).toBeNull();
});

it("opens an entry's page with its values as saved, masked behind an eye, and saves them exactly as they then stand", async () => {
  const { root } = await setup();
  const pencil = root.querySelector<HTMLElement>('.vault-row [data-vault="edit"][data-id="login"]')!;
  expect(pencil.getAttribute("aria-label")).toBe("編輯");
  await openPage(root, "login");
  expect(api.core).toHaveBeenCalledWith("vault.reveal", { id: "login" });
  // A page of its own: the way back, the title, its trash; the list and its tabs are gone.
  expect(root.querySelector(".vault-page-head .back-title h1")!.textContent).toBe("<Travel>");
  expect(root.querySelector(".vault-list, .tabs")).toBeNull();
  const username = root.querySelector<HTMLInputElement>("#vault-value-username")!, password = root.querySelector<HTMLInputElement>("#vault-value-password")!;
  expect([username.value, password.value]).toEqual(["ada@example.test", "old-secret"]);
  expect([username.type, password.type]).toEqual(["password", "password"]);
  expect(root.textContent).not.toContain("不變更");
  // The eye shows the value and hides it again, where it stands.
  const eye = root.querySelector<HTMLElement>('[data-vault="reveal"][data-field="password"]')!;
  expect(eye.getAttribute("aria-label")).toBe("顯示");
  eye.click();
  expect(password.type).toBe("text");
  expect(eye.getAttribute("aria-pressed")).toBe("true");
  expect(eye.getAttribute("aria-label")).toBe("隱藏");
  eye.click();
  expect(password.type).toBe("password");
  // The owner deletes the old value, types the new one and saves: the whole set goes, exactly.
  password.value = "new-secret";
  click(root, '[data-vault="save"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.update", expect.objectContaining({ id: "login", exact: true, values: { username: "ada@example.test", password: "new-secret" } })));
  await vi.waitFor(() => expect(root.querySelector(".vault-page")).toBeNull());
  // Nothing changed: no values are sent at all. An emptied field is sent empty.
  await openPage(root, "contact");
  click(root, '[data-vault="save"]');
  await vi.waitFor(() => expect(api.core.mock.calls.filter(([method]) => method === "vault.update")).toHaveLength(2));
  expect(api.core.mock.calls.filter(([method]) => method === "vault.update")[1]![1]).not.toHaveProperty("values");
  await vi.waitFor(() => expect(root.querySelector(".vault-page")).toBeNull());
  await openPage(root, "contact");
  root.querySelector<HTMLInputElement>("#vault-value-phone")!.value = "";
  click(root, '[data-vault="save"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.update", expect.objectContaining({ id: "contact", exact: true, values: { ...saved.contact, phone: "" } })));
});

it("goes back to the list from its arrow, and forgets what the page held", async () => {
  const { root, controller } = await setup();
  await openPage(root, "card");
  expect(controller.paged()).toBe(true);
  click(root, '.vault-page-head [data-k="vault-back"]');
  expect(root.querySelector(".vault-page")).toBeNull();
  expect(controller.paged()).toBe(false);
  expect(controller.view().values).toBeUndefined();
});

it("edits a key's value as its other fields, and never offers to type a new key in here", async () => {
  api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: false, google_configured: false }); api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Member" }] });
  const withKey: VaultEntry[] = [...entries, { id: "key", kind: "key", label: "OPENROUTER_API_KEY", hint: "Price script", origin: "", members: [1] }];
  api.core.mockImplementation(async (method: string, params?: { id?: string }) => method === "vault.list" ? { entries: withKey } : reply(method, params));
  const root = document.createElement("div"); document.body.append(root);
  const controller = createVault(root, () => { root.innerHTML = vaultHTML(controller.view()); });
  await controller.load();
  await openPage(root, "key");
  const value = root.querySelector<HTMLInputElement>("#vault-value-value")!;
  expect([value.type, value.value]).toEqual(["password", "sk-saved"]);
  value.value = "sk-new";
  click(root, '[data-vault="save"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.update", expect.objectContaining({ id: "key", label: "OPENROUTER_API_KEY", exact: true, values: { value: "sk-new" } })));
});

it("lists the Composio key as a key of the whole team, shows it masked, replaces it through Composio's own check, and removes it with a question that says what goes (#320)", async () => {
  const gmail = { id: "composio:gmail", kind: "composio", name: "Gmail", description: "", logo: "", status: "ACTIVE", enabled: true, accounts: [], enabled_tools: [], disabled_tools: [] };
  api.membersList.mockResolvedValue({ members: [{ id: 1, name: "Member" }] });
  api.connectorsStatus.mockResolvedValue({ connectors: [gmail], composio_configured: true, google_configured: false });
  api.core.mockImplementation(reply);
  const root = document.createElement("div"); document.body.append(root);
  const changed = vi.fn();
  const controller = createVault(root, () => { root.innerHTML = vaultHTML(controller.view()); }, changed);
  await controller.load();
  const row = root.querySelector('[data-vault-row="composio"]')!;
  expect(row.textContent).toContain("Composio");
  expect(row.textContent).toContain("整個團隊");
  click(root, '[data-vault="filter"][data-kind="key"]');
  expect([...root.querySelectorAll(".vault-row")].map(item => item.getAttribute("data-vault-row"))).toEqual(["composio"]);
  // Its page is the key alone, as saved, masked: no name, hint or access; it says the apps must be connected again.
  await openPage(root, "composio");
  expect(api.core).toHaveBeenCalledWith("connectors.reveal_key");
  const page = root.querySelector('[data-vault-system="composio"]')!;
  expect(page.querySelector("#vault-label, #vault-hint, [data-k='vault-access']")).toBeNull();
  expect(page.querySelector('[data-k="vault-composio-note"]')).not.toBeNull();
  const field = page.querySelector<HTMLInputElement>("#vault-value-value")!;
  expect([field.type, field.value]).toEqual(["password", "comp_saved"]);
  // A key Composio refuses is said in words, keeps what was typed, and changes nothing.
  api.connectorsSetKey.mockRejectedValueOnce(new Error("auth"));
  field.value = "comp_bad";
  click(root, '[data-vault="save"]');
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("Composio"));
  expect(root.querySelector<HTMLInputElement>("#vault-value-value")!.value).toBe("comp_bad");
  expect(changed).not.toHaveBeenCalled();
  // A good key is saved and Connect apps is told.
  api.connectorsSetKey.mockResolvedValueOnce({ configured: true });
  root.querySelector<HTMLInputElement>("#vault-value-value")!.value = " comp_good ";
  click(root, '[data-vault="save"]');
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(api.connectorsSetKey).toHaveBeenLastCalledWith("comp_good");
  await vi.waitFor(() => expect(root.querySelector('[data-vault-system="composio"]')).toBeNull());
  // Removing it asks what it ends, then removes the key.
  await openPage(root, "composio");
  root.querySelector<HTMLElement>('.vault-page-head [data-vault="remove"]')!.click();
  const dialog = document.querySelector<HTMLElement>(".mb-dialog.mb-delete")!;
  expect(dialog.querySelector("h2")!.textContent).toBe("移除「Composio」？");
  expect(dialog.querySelector(".mb-dlg-body")!.textContent).toBe("移除後，透過 Composio 連結的應用程式都會中斷，之後需要重新填入金鑰並連結。");
  api.connectorsSetKey.mockResolvedValueOnce({ configured: false });
  click(dialog, '[data-dlg="delete"]');
  await vi.waitFor(() => expect(api.connectorsSetKey).toHaveBeenLastCalledWith(""));
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  expect(api.core).not.toHaveBeenCalledWith("vault.remove", expect.anything());
});

it("opens the Composio key's page when a card leads here, and nothing without a saved key (#320)", async () => {
  const { root, controller } = await setup();
  await controller.editComposio();
  expect(root.querySelector('[data-vault-system="composio"]')).toBeNull();
  api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: true, google_configured: false });
  await controller.editComposio();
  expect(root.querySelector<HTMLInputElement>('[data-vault-system="composio"] #vault-value-value')!.value).toBe("comp_saved");
  expect(root.querySelector('[data-k="vault-composio-note"]')).toBeNull();
});

it("keeps 儲存 in the page's header, never under the fields, and asks before a change that is not saved is left", async () => {
  const { root, controller } = await setup();
  await openPage(root, "login");
  // The header holds the way back, the title, the trash and 儲存; nothing stands below the fields.
  const head = root.querySelector<HTMLElement>(".vault-page > .set-head")!;
  expect([...head.querySelectorAll<HTMLElement>("[data-vault]")].map(el => el.dataset.vault)).toEqual(["cancel", "remove", "save"]);
  expect(root.querySelector(".vault-form .vault-actions, .vault-form [data-vault='save']")).toBeNull();
  // Nothing changed: the way back leaves at once.
  click(root, '.vault-page-head [data-k="vault-back"]');
  expect(root.querySelector(".vault-page")).toBeNull();
  expect(document.querySelector(".vault-unsaved")).toBeNull();
  // A changed value: the way back asks. Its × stays on the page with what was typed.
  await openPage(root, "login");
  root.querySelector<HTMLInputElement>("#vault-value-password")!.value = "typed";
  click(root, '.vault-page-head [data-k="vault-back"]');
  const dialog = document.querySelector<HTMLElement>(".mb-dialog.vault-unsaved")!;
  expect(dialog.querySelector("h2")!.textContent).toBe("要儲存變更嗎？");
  expect([...dialog.querySelectorAll<HTMLElement>(".mb-dlg-act .btn")].map(b => b.textContent)).toEqual(["不儲存", "儲存"]);
  // A second way out pressed while it asks opens no second dialog.
  controller.leave();
  expect(document.querySelectorAll(".vault-unsaved")).toHaveLength(1);
  click(dialog, '[data-dlg="close"]');
  expect(root.querySelector<HTMLInputElement>("#vault-value-password")!.value).toBe("typed");
  expect(api.core).not.toHaveBeenCalledWith("vault.update", expect.anything());
  // 儲存 saves it, then leaves; and whatever was to follow (another pane, Settings closing) follows.
  const then = vi.fn();
  controller.leave(then);
  click(document, '.vault-unsaved [data-dlg="save"]');
  await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("vault.update", expect.objectContaining({ id: "login", values: { username: "ada@example.test", password: "typed" } })));
  await vi.waitFor(() => expect(then).toHaveBeenCalledTimes(1));
  expect(root.querySelector(".vault-page")).toBeNull();
  // A changed name, then 不儲存: nothing is sent, and the page is left.
  await openPage(root, "contact");
  root.querySelector<HTMLInputElement>("#vault-label")!.value = "Renamed";
  expect(controller.dirty()).toBe(true);
  controller.leave(then);
  click(document, '.vault-unsaved [data-dlg="discard"]');
  expect(then).toHaveBeenCalledTimes(2);
  expect(root.querySelector(".vault-page")).toBeNull();
  expect(api.core.mock.calls.filter(([method]) => method === "vault.update")).toHaveLength(1);
});

it("a step back (a side button, Alt+Left) leaves an entry's page, and asks first when it holds a change", async () => {
  const { root, controller } = await setup();
  await openPage(root, "card");
  controller.painted();
  expect(stepOpenLayer("back")).toBe(true);
  expect(root.querySelector(".vault-page")).toBeNull();
  await openPage(root, "card");
  controller.painted();
  root.querySelector<HTMLInputElement>("#vault-value-cvc")!.value = "999";
  expect(stepOpenLayer("back")).toBe(true);
  expect(document.querySelector(".vault-unsaved")).not.toBeNull();
  expect(root.querySelector(".vault-page")).not.toBeNull();
});

it("draws a page again with what was typed when Settings is drawn again for another reason", async () => {
  const { root, controller } = await setup();
  await openPage(root, "contact");
  root.querySelector<HTMLInputElement>("#vault-value-phone")!.value = "0999";
  root.querySelector<HTMLInputElement>("#vault-hint")!.value = "Typed hint";
  controller.keep();
  root.innerHTML = vaultHTML(controller.view());
  expect(root.querySelector<HTMLInputElement>("#vault-value-phone")!.value).toBe("0999");
  expect(root.querySelector<HTMLInputElement>("#vault-hint")!.value).toBe("Typed hint");
  // Left without saving, nothing typed stays.
  controller.leave();
  click(document, '.vault-unsaved [data-dlg="discard"]');
  expect(controller.view().draft).toBeNull();
});
