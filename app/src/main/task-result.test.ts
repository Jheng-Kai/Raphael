// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { SHOWN_FILES, taskResultHTML } from "./task-result";
import type { FileCheckpoint } from "./api";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

const file = (name: string, extra: Partial<FileCheckpoint["files"][number]> = {}) => ({ path: `/home/cua/workspace/${name}`, diff: "", ...extra });
const checkpoint = (files: FileCheckpoint["files"], extra: Partial<FileCheckpoint> = {}): FileCheckpoint => ({ id: "result", turn: 1, created: 1, state: "ready", review_token: "a".repeat(64), files, ...extra });
const draw = (files: FileCheckpoint["files"], extra: Partial<FileCheckpoint> = {}): HTMLElement => {
  document.body.innerHTML = taskResultHTML(1, [checkpoint(files, extra)]);
  return document.querySelector<HTMLElement>("[data-task-result]")!;
};
const words = (node: ParentNode): string => (node.textContent ?? "").replace(/\s+/g, " ").trim();

test("a checkpoint card replaces the separate done state while a task without files keeps it", async () => {
  const api = await import("./api"), { mountTaskResults } = await import("./task-result");
  const result = checkpoint([file("review.txt", { diff: "@@ -0,0 +1 @@\n+review" })], { turn: 7 });
  vi.spyOn(api, "computerCheckpoints").mockResolvedValue({ checkpoints: [result], busy: false });
  const thread = document.createElement("ol"); document.body.replaceChildren(thread);
  thread.innerHTML = '<li><div data-task-result-slot="7"></div><div class="task-actions">Done</div></li><li><div data-task-result-slot="8"></div><div class="task-actions">Done</div></li>';
  mountTaskResults(thread, () => 1, vi.fn()).sync();
  await vi.waitFor(() => expect(thread.querySelector('[data-task-result="7"]')).not.toBeNull());
  expect(thread.querySelector<HTMLElement>("li:first-child .task-actions")?.hidden).toBe(true);
  expect(thread.querySelector<HTMLElement>("li:last-child .task-actions")?.hidden).toBe(false);
  expect(thread.querySelector("[data-task-file]")?.textContent).toContain("review.txt");
});

test("only checkpoint-backed file changes produce a task result card and exact counts", () => {
  expect(taskResultHTML(1, [])).toBe("");
  expect(taskResultHTML(2, [checkpoint([file("a.txt")])])).toBe("");
  const card = draw([{ path: "/home/cua/workspace/note.txt", diff: "--- before\n+++ after\n@@ -1 +1,2 @@\n-old\n+new\n+line" }]);
  expect(words(card)).toContain("+2 −1");
  expect(card.querySelector("[data-task-files]")).not.toBeNull();
  expect(card.querySelector("[data-task-restore]")).not.toBeNull();
});

test("a finished result has no status pill, no dot and no old words (owner, 2026-11-14)", () => {
  const card = draw([file("report.md", { diff: "@@ -1 +1 @@\n-a\n+b" })]);
  expect(card.querySelector(".card-status, .card-head i")).toBeNull();
  expect(words(card)).not.toMatch(/完成|工作結果|還原檔案|顯示內容/);
  // It is still a card of the shared shell: a title, rows and its own buttons.
  expect(card.classList.contains("conversation-card")).toBe(true);
  expect(card.getAttribute("aria-label")).toBe("改了 1 個檔案");
});

test("the title says what happened to the files", () => {
  expect(words(draw([file("a.txt", { change: "changed", added: 1, removed: 1 }), file("b.txt", { change: "added", added: 2, removed: 0 }), file("c.txt", { change: "removed", added: 0, removed: 2 })]).querySelector(".card-title")!)).toBe("改了 3 個檔案");
  expect(words(draw([file("a.txt", { change: "added", added: 1, removed: 0 }), file("b.png", { change: "added" })]).querySelector(".card-title")!)).toBe("新增了 2 個檔案");
  expect(words(draw([file("a.txt", { change: "removed", added: 0, removed: 1 })]).querySelector(".card-title")!)).toBe("刪除了 1 個檔案");
});

test("a file that has no text to count says what happened to it, never +0 −0", () => {
  const card = draw([
    file("photo.png", { change: "added" }), file("old.pdf", { change: "removed" }), file("deck.pptx", { change: "changed" }),
    file("mode-only.sh", { change: "changed", added: 0, removed: 0 }), file("edit.txt", { change: "changed", added: 2, removed: 0, diff: "@@ -1 +1,3 @@\n a\n+b\n+c" }),
  ]);
  const state = (name: string): string => words([...card.querySelectorAll(".tr-file")].find(row => row.querySelector(".tr-name")!.textContent === name)!.querySelector(".tr-state")!);
  expect(state("photo.png")).toBe("新增");
  expect(state("old.pdf")).toBe("刪除");
  expect(state("deck.pptx")).toBe("已修改");
  expect(state("mode-only.sh")).toBe("已修改");
  expect(state("edit.txt")).toBe("+2");
  expect(words(card)).not.toMatch(/\+0|−0/);
});

test("counts from the core win over the shortened text, and an older checkpoint is counted from its text", () => {
  expect(words(draw([file("log.txt", { change: "changed", added: 3000, removed: 4, diff: "@@ -1 +1,2 @@\n-a\n+b" })]).querySelector(".tr-state")!)).toBe("+3000 −4");
  expect(words(draw([{ path: "/home/cua/team/old.txt", diff: "--- before\n+++ after\n@@ -1,2 +0,0 @@\n-one\n-two" }]).querySelector(".tr-state")!)).toBe("刪除");
  expect(words(draw([{ path: "/home/cua/team/old.txt", diff: "--- before\n+++ after\n@@ -0,0 +1 @@\n+one" }]).querySelector(".tr-state")!)).toBe("新增");
});

test("fifty-three files list five and fold the other forty-eight under one line", () => {
  const many = Array.from({ length: 53 }, (_, index) => file(`file-${String(index).padStart(2, "0")}.png`, { change: "changed" }));
  const card = draw(many);
  expect(SHOWN_FILES).toBe(5);
  expect(words(card.querySelector(".card-title")!)).toBe("改了 53 個檔案");
  expect(card.querySelectorAll(":scope > .tr-files .tr-file")).toHaveLength(5);
  const toggle = card.querySelector<HTMLElement>("[data-card-disclosure]")!;
  expect(words(toggle)).toBe("還有 48 個檔案");
  expect(card.querySelector<HTMLElement>(".card-detail")!.hidden).toBe(true);
  expect(card.querySelectorAll(".card-detail .tr-file")).toHaveLength(48);
  toggle.click();
  expect(card.querySelector<HTMLElement>(".card-detail")!.hidden).toBe(false);
  expect(words(toggle)).toBe("收合");
  // Five files or fewer need no fold at all.
  expect(draw(many.slice(0, 5)).querySelector("[data-card-disclosure]")).toBeNull();
});

test("a row names the file and its folder, and opens under itself only where there is text to read", () => {
  const card = draw([
    { path: "/home/cua/team/notes/report.md", diff: "--- before\n+++ after\n@@ -1 +1 @@\n-舊\n+新", change: "changed", added: 1, removed: 1 },
    { path: "/home/cua/workspace/photo.png", diff: "", change: "added" },
  ]);
  const [report, photo] = [...card.querySelectorAll<HTMLElement>(".tr-file")];
  expect(words(report.querySelector(".tr-name")!)).toBe("report.md");
  expect(words(report.querySelector(".tr-dir")!)).toBe("團隊資料夾 / notes");
  expect(report.tagName).toBe("DETAILS");
  expect(report.textContent).toContain("+ 新");
  expect(words(photo.querySelector(".tr-dir")!)).toBe("工作資料夾");
  expect(photo.tagName).toBe("DIV");
  expect(photo.querySelector("summary, pre")).toBeNull();
});

test("the two buttons say what they do", () => {
  const card = draw([file("a.txt", { change: "changed", added: 1, removed: 0 })]);
  const buttons = [...card.querySelectorAll<HTMLElement>(".card-actions button")];
  // The first in the markup is the primary (the first Tab stop); the row puts it rightmost.
  expect(buttons.map(button => [words(button), button.classList.contains("pri")])).toEqual([["開啟檔案變更", true], ["復原這些變更", false]]);
  expect(buttons[0].hasAttribute("data-task-files")).toBe(true);
  expect(buttons[1].getAttribute("data-task-restore")).toBe("result");
});

test("an undone result says so, keeps its rows and offers no second undo", () => {
  const card = draw([file("a.txt", { change: "added", added: 1, removed: 0 }), file("b.txt", { change: "changed", added: 1, removed: 1 })], { state: "restored" });
  expect(words(card.querySelector(".card-title")!)).toBe("已復原 2 個檔案的變更");
  expect(card.classList.contains("is-restored")).toBe(true);
  expect(card.querySelector("[data-task-restore]")).toBeNull();
  expect(card.querySelectorAll(".tr-file")).toHaveLength(2);
  expect(card.querySelector("[data-task-files]")).not.toBeNull();
});

async function restoreSetup(confirmationRequired: boolean) {
  const api = await import("./api"), { mountTaskResults } = await import("./task-result");
  const result = checkpoint([file("a.txt", { change: "changed", added: 1, removed: 0, diff: "@@ -1 +1,2 @@\n a\n+b" })], { turn: 7 });
  const list = vi.spyOn(api, "computerCheckpoints").mockResolvedValue({ checkpoints: [result], busy: false, confirmation_required: confirmationRequired });
  const restore = vi.spyOn(api, "computerRestore").mockResolvedValue({ restored: [result.files[0].path], skipped: [] });
  const thread = document.createElement("ol"); document.body.replaceChildren(thread);
  thread.innerHTML = '<li><div data-task-result-slot="7"></div></li>';
  mountTaskResults(thread, () => 1, vi.fn()).sync();
  await vi.waitFor(() => expect(thread.querySelector("[data-task-restore]")).not.toBeNull());
  return { thread, list, restore };
}

test("undoing the changes asks first, in words that say the effect, and does nothing on Cancel", async () => {
  const { thread, restore } = await restoreSetup(true);
  thread.querySelector<HTMLElement>("[data-task-restore]")!.click();
  await vi.waitFor(() => expect(document.querySelector(".mb-confirm")).not.toBeNull());
  const dialog = document.querySelector<HTMLElement>(".mb-confirm")!;
  expect(words(dialog.querySelector("h2")!)).toBe("復原這些變更？");
  expect(words(dialog)).toContain("新增的檔案會刪除，刪掉的會補回，改過的會改回原樣");
  expect(words(dialog)).toContain("你之後自己改過的檔案會保留");
  expect(restore).not.toHaveBeenCalled();
  dialog.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();
  await vi.waitFor(() => expect(document.querySelector(".mb-confirm")).toBeNull());
  expect(restore).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(thread.querySelector<HTMLButtonElement>("[data-task-restore]")!.disabled).toBe(false));
});

test("the confirmed undo restores the reviewed checkpoint once", async () => {
  const { thread, restore } = await restoreSetup(true);
  thread.querySelector<HTMLElement>("[data-task-restore]")!.click();
  await vi.waitFor(() => expect(document.querySelector(".mb-confirm")).not.toBeNull());
  expect(words(document.querySelector('.mb-confirm [data-dlg="restore"]')!)).toBe("復原這些變更");
  document.querySelector<HTMLElement>('.mb-confirm [data-dlg="restore"]')!.click();
  await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  expect(restore).toHaveBeenCalledWith(1, "result", true, "a".repeat(64));
});

test("the permission mode that allows everything undoes without a dialog, as it always has", async () => {
  const { thread, restore } = await restoreSetup(false);
  thread.querySelector<HTMLElement>("[data-task-restore]")!.click();
  await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(1, "result", false, "a".repeat(64)));
  expect(document.querySelector(".mb-confirm")).toBeNull();
});

test("an undo that fails says so beside a retry instead of a pill", async () => {
  const api = await import("./api");
  const { thread, restore } = await restoreSetup(false);
  restore.mockRejectedValueOnce(new Error("busy"));
  thread.querySelector<HTMLElement>("[data-task-restore]")!.click();
  await vi.waitFor(() => expect(thread.querySelector(".card-failure")).not.toBeNull());
  expect(words(thread.querySelector(".card-failure p")!)).toBe("沒能復原這些變更，請再試一次。");
  expect(thread.querySelector("[data-card-retry]")).not.toBeNull();
  expect(api.computerRestore).toHaveBeenCalledTimes(1);
});

test("room and private card renderers expose the same checkpoint-backed result slot", async () => {
  const { conversationCardsHTML } = await import("./timeline");
  expect(conversationCardsHTML({ id: 7, member_id: 2, task: { state: "done" } } as never)).toContain('data-task-result-slot="7" data-task-member="2"');
}, 30000);

test("the shared checkpoint view can open an explicit task result while the computer is offline", async () => {
  const api = await import("./api"); const { mountCheckpoints } = await import("./checkpoint-view");
  vi.spyOn(api, "computerCheckpoints").mockResolvedValue({ checkpoints: [], busy: false });
  const panel = document.createElement("div"); panel.innerHTML = '<div class="desktop-actions"></div>'; document.body.append(panel);
  const view = mountCheckpoints(panel, () => 1); view.update(false); await view.show(); view.update(false);
  expect(panel.querySelector<HTMLElement>(".desktop-checkpoints")?.hidden).toBe(false);
});

test("diff content that begins with header-like signs still counts as changed lines", () => {
  const card = draw([{ path: "/home/cua/workspace/signs.txt", diff: "--- before\n+++ after\n@@ -1 +1 @@\n---content\n+++content" }]);
  expect(words(card.querySelector(".tr-state")!)).toBe("+1 −1");
});
