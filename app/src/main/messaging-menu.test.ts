// @vitest-environment happy-dom
// R-UI-56: removing a person from Telegram waits in the ⋯ of their row.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ telegramStatus: vi.fn(), telegramRemoveUser: vi.fn() }));
vi.mock("./api", () => api);

import { installContextMenus, uncoveredOverflows } from "./context-menu";
import { createMessaging, messagingHTML } from "./messaging";
import { closeMenu } from "./ui";

const big = "1234567890123456789";
const status = { connected: true, enabled: true, running: true, error: null, bot: { username: "raph_bot" }, allowed: [{ user_id: big, name: "Ann" }], pending: [] };

let stop: () => void;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  stop = installContextMenus(document);
  api.telegramStatus.mockResolvedValue(status);
  api.telegramRemoveUser.mockResolvedValue({ ...status, allowed: [] });
});
afterEach(() => {
  stop();
  closeMenu();
});

test("removing a person waits in their row's ⋯, a right click opens it, and it sends the id as the text it is, however large", async () => {
  const root = document.getElementById("root")!;
  const panel = createMessaging({ visible: () => true, redraw: () => { root.innerHTML = messagingHTML({ ...panel.view(), expanded: true }); } });
  root.addEventListener("click", (event) => panel.click(event.target as Element));
  await panel.load();
  expect(root.textContent).not.toContain("移除");
  expect(uncoveredOverflows(root)).toEqual([]);

  const row = root.querySelector<HTMLElement>('[data-msg="user-menu"]')!.closest(".msg-sub")!;
  row.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 200 }));
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 200 }));
  const item = document.querySelector<HTMLElement>('#app-popover [data-pick="remove"]')!;
  expect(item.textContent).toContain("移除 Ann");
  expect(api.telegramRemoveUser).not.toHaveBeenCalled();

  item.click();
  await vi.waitFor(() => expect(api.telegramRemoveUser).toHaveBeenCalledWith(big));
  panel.reset();
});
