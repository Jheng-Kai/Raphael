// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { emptyMessagingView, messagingHTML } from "./messaging";
import { secretCardHTML } from "./secret-card";
import { setLocale } from "./i18n";
import { checkpointsHTML, mountCheckpoints } from "./checkpoint-view";
import * as api from "./api";
import { iconHTML } from "./service-mark";

describe("work chat and private login rows", () => {
  it("uses the same settings rows for all three channels, with separate masked fields", () => {
    setLocale("zh-TW");
    const view = { ...emptyMessagingView(), status: { connected: false, enabled: false, running: false, error: null, bot: null, allowed: [], pending: [] } };
    document.body.innerHTML = messagingHTML({ ...view, channels: { slack: view, discord: view } });
    expect([...document.querySelectorAll("section.msg")].map(el => el.getAttribute("aria-label"))).toEqual(["Telegram", "Slack", "Discord"]);
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(3);
    expect(new Set([...document.querySelectorAll("input")].map(el => el.id)).size).toBe(3);
    for (const kind of ["slack", "discord"]) {
      const section = document.querySelector(`[data-msg-kind="${kind}"]`)!;
      expect(section.querySelector('[data-msg="setup-link"]')).not.toBeNull();
      expect(section.querySelector('.note')?.textContent).not.toMatch(/https?:\/\//);
      const expected = document.createElement("template");
      expected.innerHTML = iconHTML(kind, kind as "slack" | "discord", "md");
      expect(section.querySelector('.msg-name .logo-mono')?.outerHTML).toBe(expected.content.firstElementChild?.outerHTML);
    }
  });
  it("asks for login fields only in the existing secret card", () => {
    document.body.innerHTML = secretCardHTML({ id: "login", name: "https://example.com", secret: "login", login: true, state: "pending", error: null, expires_at_ms: 99, resumed: false });
    expect(document.querySelector(".secret-card [data-login-user]")).not.toBeNull();
    expect(document.querySelector('input[data-secret-input][type="password"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("JSON");
    expect(document.querySelectorAll(".sc-login label > span:first-child")).toHaveLength(2);
    expect(document.querySelector(".sc-login")?.textContent).toContain("帳號");
  });
});

it("shows owner words, line signs and incomplete coverage instead of raw diff headers", () => {
  setLocale("zh-TW");
  const view = { id: "one", member: 2, turn: 7, created: new Date(2026, 9, 24, 9, 59, 45).getTime(), state: "ready",
    partial: true, uncovered: ["/home/cua/workspace/video.mp4", "/home/cua/workspace"], files: [{ path: "/home/cua/team/report.md",
      diff: "--- before\n+++ after\n@@ -1 +1 @@\n-Old <script>\n+New text\n Context" }] };
  document.body.innerHTML = checkpointsHTML([view]);
  expect(document.querySelector("summary")?.textContent).toBe("團隊資料夾 / report.md");
  expect(document.body.textContent).toContain("10/24 09:59");
  expect(document.body.textContent).not.toMatch(/--- before|\+\+\+ after|@@|09:59:45|上午/);
  expect(document.querySelector('.checkpoint-line.is-removed')?.textContent).toContain("− Old <script>");
  expect(document.querySelector('.checkpoint-line.is-added')?.textContent).toContain("+ New text");
  expect(document.querySelector('script')).toBeNull();
  expect(document.body.textContent).toContain("未備份");
  expect(document.body.textContent).toContain("工作資料夾 / video.mp4");
  expect(document.querySelector('.checkpoint-uncovered li:last-child')?.textContent).toBe("工作資料夾");
  document.body.innerHTML = checkpointsHTML([], false, true);
  expect(document.body.textContent).toContain("成員的工作仍照常進行");
  expect(document.querySelector('[data-checkpoint-restore]')).toBeNull();
});

it("reviewing or cancelling never restores; the existing confirmation restores once", async () => {
  const checkpoint = { id: "one", member: 2, turn: 7, created: 1, state: "ready" as const, files: [{ path: "team/a", diff: "-before\n+after" }] };
  vi.spyOn(api, "computerCheckpoints").mockResolvedValue({ checkpoints: [checkpoint], busy: false });
  const restore = vi.spyOn(api, "computerRestore").mockResolvedValue({ restored: ["team/a"], skipped: [] });
  document.body.innerHTML = '<section id="panel"><div class="desktop-actions"></div></section>';
  const panel = document.querySelector<HTMLElement>("#panel")!;
  mountCheckpoints(panel, () => 2).update(true);
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-open]')!.click();
  await vi.waitFor(() => expect(panel.querySelector(".checkpoint pre")?.textContent).toContain("before"));
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-restore]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-dlg="cancel"]')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('[data-dlg="cancel"]')!.click();
  await Promise.resolve();
  expect(restore).not.toHaveBeenCalled();
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-restore]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-dlg="restore"]')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('[data-dlg="restore"]')!.click();
  await vi.waitFor(() => expect(restore).toHaveBeenCalledExactlyOnceWith(2, "one"));
  document.body.innerHTML = checkpointsHTML([checkpoint], true);
  expect(document.querySelector<HTMLButtonElement>('[data-checkpoint-restore]')!.disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBeTruthy();
  vi.restoreAllMocks();
});

it("full permission restores directly without opening a confirmation", async () => {
  const checkpoint = { id: "one", member: 2, turn: 7, created: 1, state: "ready" as const, files: [{ path: "team/a", diff: "-before\n+after" }] };
  vi.spyOn(api, "computerCheckpoints").mockResolvedValue({ checkpoints: [checkpoint], busy: false, confirmation_required: false });
  const restore = vi.spyOn(api, "computerRestore").mockResolvedValue({ restored: ["team/a"], skipped: [] });
  document.body.innerHTML = '<section id="panel"><div class="desktop-actions"></div></section>';
  const panel = document.querySelector<HTMLElement>("#panel")!;
  mountCheckpoints(panel, () => 2).update(true);
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-open]')!.click();
  await vi.waitFor(() => expect(panel.querySelector(".checkpoint")).not.toBeNull());
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-restore]')!.click();
  await vi.waitFor(() => expect(restore).toHaveBeenCalledExactlyOnceWith(2, "one", false));
  expect(document.querySelector(".mb-confirm")).toBeNull();
  vi.restoreAllMocks();
});

it.each([true, false])("rechecks confirmation policy at the restore click: %s", async required => {
  const checkpoint = { id: "one", member: 2, turn: 7, created: 1, state: "ready" as const, files: [{ path: "team/a", diff: "-before\n+after" }] };
  vi.spyOn(api, "computerCheckpoints").mockResolvedValueOnce({ checkpoints: [checkpoint], busy: false, confirmation_required: !required })
    .mockResolvedValue({ checkpoints: [checkpoint], busy: false, confirmation_required: required });
  const restore = vi.spyOn(api, "computerRestore").mockResolvedValue({ restored: ["team/a"], skipped: [] });
  document.body.innerHTML = '<section id="panel"><div class="desktop-actions"></div></section>';
  const panel = document.querySelector<HTMLElement>("#panel")!;
  mountCheckpoints(panel, () => 2).update(true);
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-open]')!.click();
  await vi.waitFor(() => expect(panel.querySelector(".checkpoint")).not.toBeNull());
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-restore]')!.click();
  if (required) {
    await vi.waitFor(() => expect(document.querySelector('.mb-confirm')).not.toBeNull());
    expect(restore).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-dlg="cancel"]')!.click();
  } else {
    await vi.waitFor(() => expect(restore).toHaveBeenCalledExactlyOnceWith(2, "one", false));
    expect(document.querySelector('.mb-confirm')).toBeNull();
  }
  await Promise.resolve();
  vi.restoreAllMocks();
});

it("restores the reviewed version after a policy refresh and names later edits it keeps", async () => {
  const checkpoint = { id: "one", turn: 7, created: 1, state: "ready", review_token: "0".repeat(64),
    files: [{ path: "/home/cua/team/report.md", diff: "-before\n+after" }] };
  vi.spyOn(api, "computerCheckpoints").mockResolvedValueOnce({ checkpoints: [checkpoint], busy: false, confirmation_required: false })
    .mockResolvedValue({ checkpoints: [{ ...checkpoint, review_token: "1".repeat(64) }], busy: false, confirmation_required: false });
  const restore = vi.spyOn(api, "computerRestore").mockResolvedValue({ restored: [], skipped: ["/home/cua/team/report.md"] });
  document.body.innerHTML = '<section id="panel"><div class="desktop-actions"></div></section>';
  const panel = document.querySelector<HTMLElement>("#panel")!;
  mountCheckpoints(panel, () => 2).update(true);
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-open]')!.click();
  await vi.waitFor(() => expect(panel.querySelector('.checkpoint')).not.toBeNull());
  panel.querySelector<HTMLButtonElement>('[data-checkpoint-restore]')!.click();
  await vi.waitFor(() => expect(restore).toHaveBeenCalledExactlyOnceWith(2, "one", false, "0".repeat(64)));
  await vi.waitFor(() => expect(panel.querySelector('.checkpoint-uncovered')?.textContent).toContain("團隊資料夾 / report.md"));
  expect(panel.textContent).toContain("後來有修改，已保留");
  vi.restoreAllMocks();
});
