// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ brainsCli: vi.fn(), brainsCliLogin: vi.fn(), brainsCliDisconnect: vi.fn(), openExternalUrl: vi.fn(),
  chatgptStatus: vi.fn(async () => ({ signed_in: false })), chatgptSignIn: vi.fn(), chatgptCancel: vi.fn(), chatgptSignOut: vi.fn(), chatgptModels: vi.fn(async () => ({ models: [] })), mainWindowForward: vi.fn(async () => undefined) }));
vi.mock("./api", () => api);
import { createCliBrains, cliBrainsHTML, cliModels, signInFailure } from "./cli-brains";
import { closeMenu } from "./ui";

const CLIS = [
  { id: "claude" as const, name: "Claude Code", disconnected: false, installed: true, logged_in: true, available: true, version: "2.1.69 (Claude Code)", login_command: "claude auth login", models: [{ id: "cli:claude", name: "CLI default" }, { id: "cli:claude:sonnet", name: "sonnet" }] },
  { id: "codex" as const, name: "Codex CLI", disconnected: false, installed: true, logged_in: false, available: false, login_command: "codex login", models: [] },
  { id: "gemini" as const, name: "Antigravity", disconnected: false, installed: false, logged_in: false, available: false, login_command: "agy", models: [] },
];
afterEach(() => { closeMenu(); vi.useRealTimers(); vi.clearAllMocks(); document.body.innerHTML = ""; });
test("detection follows notifications and polls only while Settings is open; unknown auth is not ready", async () => {
  vi.useFakeTimers(); let visible = true;
  api.brainsCli.mockResolvedValue({ clis: CLIS.map((c) => ({ ...c, logged_in: null, available: false })) });
  const controller = createCliBrains({ visible: () => visible, redraw: vi.fn() });
  controller.start(); await vi.advanceTimersByTimeAsync(0);
  expect(cliBrainsHTML(controller.view())).toContain("未登入");
  controller.followEvent({ type: "BrainsChanged" }); await vi.advanceTimersByTimeAsync(0);
  expect(api.brainsCli).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(120_000); expect(api.brainsCli).toHaveBeenCalledTimes(3);
  visible = false; controller.stop();
  controller.followEvent({ type: "BrainsChanged" }); await vi.advanceTimersByTimeAsync(240_000);
  expect(api.brainsCli).toHaveBeenCalledTimes(3);
});
test("subscription cards show readiness and only their applicable action; login and install stay on the card", async () => {
  api.brainsCli.mockResolvedValue({ clis: CLIS }); api.brainsCliLogin.mockResolvedValue({ started: true });
  const root = document.createElement("div"); document.body.append(root);
  const controller = createCliBrains({ visible: () => true, redraw: () => { root.innerHTML = cliBrainsHTML(controller.view()); } });
  await controller.load();
  const cards = root.querySelectorAll(".cli-card:not([data-chatgpt-card])");
  expect(cards).toHaveLength(3);
  expect(cards[0].textContent).toContain("已登入 · v2.1.69");
  expect(cards[0].querySelector('[data-cli-menu="claude"]')).not.toBeNull();
  expect(cards[1].textContent).toContain("未登入"); expect(cards[2].textContent).toContain("未安裝");
  await controller.click(cards[1].querySelector("button")!);
  expect(api.brainsCliLogin).toHaveBeenCalledWith("codex");
  await controller.click(cards[2].querySelector("button")!);
  expect(api.openExternalUrl).toHaveBeenCalledWith("https://antigravity.google/download");
});

test("the shared row menu disconnects once without confirmation and reconnects from the card", async () => {
  api.brainsCli.mockResolvedValue({ clis: CLIS });
  const root = document.createElement("div"); document.body.append(root);
  const controller = createCliBrains({ visible: () => true, redraw: () => { root.innerHTML = cliBrainsHTML(controller.view()); } });
  await controller.load();
  await controller.click(root.querySelector('[data-cli-menu="claude"]')!);
  const action = document.querySelector<HTMLButtonElement>('#app-popover [data-pick="disconnect"]')!;
  expect(action.textContent).toContain("中斷連線");
  api.brainsCli.mockResolvedValue({ clis: CLIS.map(c => c.id === "claude" ? { ...c, available: false, disconnected: true, models: [] } : c) });
  action.click();
  await vi.waitFor(() => expect(root.textContent).toContain("已中斷連線"));
  expect(api.brainsCliDisconnect).toHaveBeenCalledExactlyOnceWith("claude");
  expect(document.querySelector('#app-popover')).toBeNull();
  expect(root.querySelector('[data-cli-menu="claude"]')).toBeNull();
  const connect = root.querySelector<HTMLButtonElement>('[data-cli="claude"]')!;
  expect(connect.textContent).toBe("連線");
  await controller.click(connect);
  expect(api.brainsCliLogin).toHaveBeenCalledExactlyOnceWith("claude");
});

test.each([
  ["[-32603] ChatGPT sign-in was declined", "你沒有同意"],
  ["[-32603] ChatGPT sign-in timed out; try signing in again", "等太久了"],
  ["[-32603] ChatGPT could not connect", "連不上 OpenAI"],
  ["[-32603] ChatGPT credentials could not be saved", "Windows 認證管理員"],
  ["[-32603] ChatGPT sign-in browser could not open", "打不開瀏覽器"],
  ["[-32603] ChatGPT identity validation failed", "沒有通過驗證"],
  ["[-32603] ChatGPT operation failed", "沒有完成"],
])("a sign-in that stopped says what to do about it: %s", (reason, words) => {
  expect(signInFailure(reason)).toContain(words);
});

test("cancelling a sign-in is no failure, whatever shape the rejection takes", () => {
  expect(signInFailure("[-32603] ChatGPT sign-in cancelled")).toBe("");
  expect(signInFailure(new Error("ChatGPT sign-in cancelled"))).toBe("");
});

test("a sign-in brings the window forward, tells the owner once what it means, and a failed one says why on the card", async () => {
  api.brainsCli.mockResolvedValue({ clis: CLIS });
  const root = document.createElement("div"); document.body.append(root);
  const controller = createCliBrains({ visible: () => true, redraw: () => { root.innerHTML = cliBrainsHTML(controller.view()); } });
  await controller.load();
  api.chatgptSignIn.mockRejectedValueOnce("[-32603] ChatGPT could not connect");
  await controller.click(root.querySelector('[data-chatgpt="sign-in"]')!);
  expect(root.querySelector('[role="alert"]')!.textContent).toContain("連不上 OpenAI");
  api.chatgptSignIn.mockResolvedValueOnce({ signed_in: true, plan_scope_granted: true, first_sign_in: true });
  api.chatgptStatus.mockResolvedValue({ signed_in: true, email: "owner@example.test", plan_scope_granted: true } as never);
  await controller.click(root.querySelector('[data-chatgpt="sign-in"]')!);
  expect(api.mainWindowForward).toHaveBeenCalledTimes(2);
  expect(api.chatgptModels).toHaveBeenCalledOnce();
  expect(root.querySelector('[role="alert"]')).toBeNull();
  expect(root.textContent).toContain("owner@example.test");
  expect(document.querySelector(".mb-confirm")!.textContent).toContain("你正在使用 ChatGPT 方案");
  api.openExternalUrl.mockResolvedValueOnce(undefined);
  document.querySelector<HTMLButtonElement>('.mb-confirm [data-dlg="usage"]')!.click();
  expect(api.openExternalUrl).toHaveBeenCalledWith("https://chatgpt.com/settings/usage");
  expect(document.querySelector(".mb-confirm")).toBeNull();
  api.chatgptStatus.mockResolvedValue({ signed_in: false });
});

test("model rows obey the core availability even when stale models and login remain", () => {
  expect(cliModels(CLIS.map(c => ({ ...c, available: false, disconnected: true })))).toEqual([]);
  expect(cliModels(CLIS.map(c => ({ ...c, available: false })), false)).toHaveLength(1);
});

test("loading and failed discovery offer no install actions; a failed login leaves a retryable real button", async () => {
  const root = document.createElement("div");
  const controller = createCliBrains({ visible: () => true, redraw: () => { root.innerHTML = cliBrainsHTML(controller.view()); } });
  root.innerHTML = cliBrainsHTML(controller.view());
  expect(root.querySelector("button")).toBeNull();
  api.brainsCli.mockRejectedValueOnce(new Error("fixture detection failure"));
  await controller.load();
  expect(root.querySelector("button")).toBeNull();
  api.brainsCli.mockResolvedValue({ clis: CLIS }); await controller.load();
  api.brainsCliLogin.mockRejectedValueOnce(new Error("fixture login failure"));
  await controller.click(root.querySelector<HTMLButtonElement>('[data-cli="codex"]')!);
  expect(root.querySelector('[role="alert"]')).not.toBeNull();
  expect(root.querySelector<HTMLButtonElement>('[data-cli="codex"]')!.disabled).toBe(false);
  expect(root.textContent).not.toContain("fixture login failure");
});
