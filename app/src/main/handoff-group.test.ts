// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { setLocale, t } from "./i18n";
import { handoffLineHTML } from "./handoff-line";
import { patchThread } from "./thread-diff";
import { emptyTimelineState, turnHTML } from "./timeline";
import type { AgentTurn, HandoffView } from "./types";

afterEach(() => { setLocale("zh-TW"); document.body.replaceChildren(); });
const task = (id: number, member = id, state = "done"): HandoffView => ({ task_id: id, source_turn_id: 1, work_turn_id: id + 100,
  member_id: member, member_name: `Person ${member}`, from_member_id: 0, stage_id: "", mode: "work", state, reason: null,
  created_at_ms: 1, ready_at_ms: 1, dispatch_policy: "immediate", result: "Sample result", evidence: [] });
const draw = (handoffs: HandoffView[]): string => turnHTML({ id: 1, created_at_ms: 1, question: "Sample request", text: "Sample answer",
  route: "answer", prefix: "", detail: null, status: "done", session_id: "sample", source: "app", cost_usd: 0, model: "sample",
  steps: [], handoffs } as AgentTurn, emptyTimelineState(), false, { face: () => "", memberFace: () => '<i class="sample-face"></i>' });
const dom = (html: string): HTMLElement => { const el = document.createElement("div"); el.innerHTML = html; return el; };

test.each(["zh-TW", "en", "ja"])("%s groups receipts by count and unique people in localized list order", locale => {
  setLocale(locale);
  const el = dom(draw([task(1, 1), task(2, 1), task(3, 2), task(4, 3), task(5, 4)]));
  const group = el.querySelector<HTMLDetailsElement>("[data-handoff-group]")!;
  expect(group).not.toBeNull();
  expect(group.open).toBe(false);
  const summary = group.querySelector("summary")!;
  expect(summary.textContent).toContain("5");
  expect(summary.querySelectorAll(".event-person")).toHaveLength(3);
  expect(summary.textContent?.match(/Person 1/g)).toHaveLength(1);
  expect(summary.textContent).not.toContain("Person 4");
  expect(summary.querySelector(".event-state")).toBeNull();
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(["Person 1", "Person 2", "Person 3", t("handoff.groupOthers", { p0: 1 })]);
  expect(summary.textContent).toContain(list);
  expect(group.querySelectorAll("[data-handoff]")).toHaveLength(5);
});

test.each(["zh-TW", "en", "ja"])("%s shows only the highest priority group state", locale => {
  setLocale(locale);
  const first = { ...task(1, 1, "waiting"), waiting_owner: 2 };
  const state = (tasks: HandoffView[]): string | null | undefined => dom(draw(tasks)).querySelector("[data-handoff-group] > summary .event-state")?.textContent;
  const words = { "zh-TW": ["等待你回答", "未完成", "進行中"], en: ["Waiting for you", "Incomplete", "In progress"], ja: ["回答待ち", "未完了", "進行中"] }[locale]!;
  expect(state([first, task(2, 2, "running"), task(3, 3, "failed")])).toBe(words[0]);
  expect(state([task(1, 1, "failed"), task(2, 2, "running"), task(3, 3, "withheld")])).toBe(words[1]);
  expect(state([task(1, 1, "queued"), task(2, 2, "waiting"), task(3, 3, "running")])).toBe(words[2]);
  expect(state([task(1), task(2)])).toBeUndefined();
});

test("Latin names before a Chinese join have a CSS gap without changing localized text", () => {
  const el = dom(draw([task(1), task(2), task(3), task(4)]));
  const last = el.querySelectorAll("[data-handoff-group] > summary .event-person")[2]!;
  expect(last.classList.contains("is-word-gap")).toBe(true);
  expect(last.nextSibling?.textContent).toBe("和其他 1 位");
});

test("one receipt is unchanged", () => {
  const single = task(1);
  expect(dom(draw([single])).querySelector("[data-handoff]")?.outerHTML).toBe(handoffLineHTML(single, '<i class="sample-face"></i>', { author: t("rooms.owner"), text: "Sample request" }));
});

test("shared diff preserves every receipt's disclosure and the same group node as new work arrives", () => {
  const thread = document.createElement("ol"), drawn = new WeakMap<Element, string>(); document.body.append(thread);
  const tasks = [task(1), task(2)];
  const update = (): boolean => patchThread(thread, [{ key: "turn:1", html: draw(tasks) }], drawn);
  update();
  const group = thread.querySelector<HTMLDetailsElement>("[data-handoff-group]")!;
  expect(group).not.toBeNull();
  group.open = true;
  const receipt = thread.querySelector<HTMLDetailsElement>("[data-handoff='1']")!; receipt.open = true;
  const owner = thread.querySelector('.me'), answer = thread.querySelector('.ra');
  tasks[0] = { ...tasks[0], result: "Updated result" }; tasks.push(task(3)); update();
  expect(thread.querySelector("[data-handoff-group]")).toBe(group);
  expect(group.open).toBe(true);
  expect(thread.querySelector("[data-handoff='1']")).toBe(receipt);
  expect(receipt.open).toBe(true);
  expect(receipt.textContent).toContain("Updated result");
  expect(thread.querySelector('.me')).toBe(owner);
  expect(thread.querySelector('.ra')).toBe(answer);
  const solo = document.createElement("ol"), cache = new WeakMap<Element, string>();
  patchThread(solo, [{ key: "solo", html: `<li>${handoffLineHTML(task(8), "")}</li>` }], cache);
  solo.querySelector("details")!.open = true;
  patchThread(solo, [{ key: "solo", html: `<li>${handoffLineHTML({ ...task(8), result: "Changed" }, "")}</li>` }], cache);
  expect(solo.querySelector("details")!.open).toBe(true);
});
