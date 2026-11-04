// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ membersList: vi.fn(), membersUpdate: vi.fn(), roomsList: vi.fn(), roomsUpdate: vi.fn() }));
vi.mock("./api", () => api);
import { createHiddenMembers } from "./hidden-members";
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
beforeEach(() => { api.roomsList.mockReset().mockResolvedValue({ rooms: [] }); });
test("General settings restore a hidden member and refresh the list", async () => {
  const root = document.createElement("div"); root.innerHTML = "<section data-hidden-members></section>";
  const controller = createHiddenMembers(); controller.mount(root);
  api.membersList.mockResolvedValueOnce({members: [{id: 3, name: "Mia", hidden: true}, {id: 4, name: "Alex", hidden: false}]})
    .mockResolvedValue({members: [{id: 3, name: "Mia", hidden: false}]});
  api.membersUpdate.mockResolvedValue({}); await controller.load();
  expect(root.textContent).toContain("Mia"); expect(root.textContent).not.toContain("Alex");
  root.querySelector<HTMLButtonElement>("[data-restore-member]")!.click(); await flush();
  expect(api.membersUpdate).toHaveBeenCalledWith(3, {hidden: false});
  expect(root.querySelector("[data-restore-member]")).toBeNull();
});
test("a group chat hidden from the sidebar is listed there too and comes back with one press", async () => {
  const root = document.createElement("div"); root.innerHTML = "<section data-hidden-members></section>";
  const controller = createHiddenMembers(); controller.mount(root);
  api.membersList.mockResolvedValue({members: []});
  api.roomsList.mockResolvedValueOnce({rooms: [{id: 7, name: "Project room", hidden: true}, {id: 8, name: "Open room", hidden: false}]})
    .mockResolvedValue({rooms: [{id: 7, name: "Project room", hidden: false}]});
  api.roomsUpdate.mockResolvedValue({}); await controller.load();
  expect(root.textContent).toContain("Project room"); expect(root.textContent).not.toContain("Open room");
  root.querySelector<HTMLButtonElement>('[data-restore-room="7"]')!.click(); await flush();
  expect(api.roomsUpdate).toHaveBeenCalledWith(7, {hidden: false});
  expect(root.querySelector("[data-restore-room]")).toBeNull();
  expect(root.textContent).toContain("沒有隱藏的成員或群組");
});
test("a stale read cannot replace a newer hidden member list", async () => {
  let resolve!: (value: unknown) => void;
  api.membersList.mockReset().mockReturnValueOnce(new Promise(done => resolve = done))
    .mockResolvedValueOnce({members: [{id: 4, name: "Alex", hidden: true}]});
  const root = document.createElement("div"); root.innerHTML = "<section data-hidden-members></section>";
  const controller = createHiddenMembers(); controller.mount(root);
  const first = controller.load(); await controller.load(); resolve({members: [{id: 3, name: "Mia", hidden: true}]}); await first;
  expect(root.textContent).toContain("Alex"); expect(root.textContent).not.toContain("Mia");
});

test("a failed hidden member read is visible and its retry reloads the real list", async () => {
  api.membersList.mockReset().mockRejectedValueOnce(new Error("synthetic"))
    .mockResolvedValueOnce({members: [{id: 3, name: "Mia", hidden: true}]});
  const root = document.createElement("div"); root.innerHTML = "<section data-hidden-members></section>";
  const controller = createHiddenMembers(); controller.mount(root); await controller.load();
  expect(root.textContent).toContain("目前無法讀取已隱藏的成員");
  expect(root.querySelector("[title]")).toBeNull();
  root.querySelector<HTMLButtonElement>("[data-hidden-retry]")!.click(); await flush();
  expect(root.textContent).toContain("Mia");
  expect(root.textContent).not.toContain("目前無法讀取");
});
