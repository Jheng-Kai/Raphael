// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { taskResultHTML } from "./task-result";

test("a checkpoint card replaces the separate done state while a task without files keeps it", async () => {
  const api=await import("./api"), {mountTaskResults}=await import("./task-result");
  const checkpoint={id:"result",turn:7,created:1,state:"ready",files:[{path:"/home/cua/workspace/review.txt",diff:"@@ -0,0 +1 @@\n+review"}]};
  vi.spyOn(api,"computerCheckpoints").mockResolvedValue({checkpoints:[checkpoint],busy:false});
  const thread=document.createElement("ol");document.body.replaceChildren(thread);
  thread.innerHTML='<li><div data-task-result-slot="7"></div><div class="task-actions">Done</div></li><li><div data-task-result-slot="8"></div><div class="task-actions">Done</div></li>';
  mountTaskResults(thread,()=>1,vi.fn()).sync();
  await vi.waitFor(()=>expect(thread.querySelector('[data-task-result="7"]')).not.toBeNull());
  expect(thread.querySelector<HTMLElement>("li:first-child .task-actions")?.hidden).toBe(true);
  expect(thread.querySelector<HTMLElement>("li:last-child .task-actions")?.hidden).toBe(false);
  const detail=thread.querySelector<HTMLElement>(".card-detail")!;detail.hidden=false;
  expect(detail.textContent).toContain("review.txt");
  vi.restoreAllMocks();
});
test("only checkpoint-backed file changes produce a task result card and exact counts", () => {
  expect(taskResultHTML(1, [])).toBe("");
  const html = taskResultHTML(1, [{ id: "checkpoint", turn: 1, created: 1, state: "ready", files: [{ path: "/home/cua/workspace/note.txt", diff: "--- before\n+++ after\n@@ -1 +1,2 @@\n-old\n+new\n+line" }] }]);
  document.body.innerHTML = html;
  expect(document.querySelector(".conversation-card .card-status.is-done")).not.toBeNull();
  expect(document.body.textContent).toContain("+2 −1");
  expect(document.querySelector("[data-task-files]")).not.toBeNull();
  expect(document.querySelector("[data-task-restore]")).not.toBeNull();
});

test("room and private card renderers expose the same checkpoint-backed result slot", async () => {
  const { conversationCardsHTML } = await import("./timeline");
  expect(conversationCardsHTML({ id: 7, member_id: 2, task: { state: "done" } } as never)).toContain('data-task-result-slot="7" data-task-member="2"');
});

test("the shared checkpoint view can open an explicit task result while the computer is offline", async () => {
 const api = await import("./api"); const { mountCheckpoints } = await import("./checkpoint-view");
 const { vi } = await import("vitest"); vi.spyOn(api,"computerCheckpoints").mockResolvedValue({checkpoints:[],busy:false});
 const panel=document.createElement("div");panel.innerHTML='<div class="desktop-actions"></div>'; document.body.append(panel);
 const view=mountCheckpoints(panel,()=>1);view.update(false); await view.show();view.update(false);
 expect(panel.querySelector<HTMLElement>(".desktop-checkpoints")?.hidden).toBe(false); vi.restoreAllMocks();panel.remove();
});


test("diff content that begins with header-like signs still counts as changed lines", () => {
 document.body.innerHTML=taskResultHTML(1,[{id:"edge",turn:1,created:1,state:"ready",files:[{path:"/home/cua/workspace/signs.txt",diff:"--- before\n+++ after\n@@ -1 +1 @@\n---content\n+++content"}]}]);
 expect(document.querySelector('.card-body')?.textContent).toContain('+1 \u22121');
});
