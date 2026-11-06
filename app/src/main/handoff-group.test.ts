// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { setLocale, t } from "./i18n";
import { handoffGroupHTML } from "./handoff-line";
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

test.each(["zh-TW", "en", "ja"])("%s counts the messages and names unique people in localized list order", locale => {
  setLocale(locale);
  const el = dom(draw([task(1, 1), task(2, 1), task(3, 2), task(4, 3), task(5, 4)]));
  const line = el.querySelector<HTMLButtonElement>("button[data-handoff-group][data-act='peer-chat']")!;
  expect(line).not.toBeNull();
  expect(line.textContent).toContain("5");
  expect(line.querySelectorAll(".event-person")).toHaveLength(3);
  expect(line.textContent?.match(/Person 1/g)).toHaveLength(1);
  expect(line.textContent).not.toContain("Person 4");
  expect(line.querySelector(".event-state")).toBeNull();
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(["Person 1", "Person 2", "Person 3", t("handoff.groupOthers", { p0: 1 })]);
  expect(line.textContent).toContain(list);
  expect(line.dataset.peerKeys).toBe("1 2 3 4 5");
  // The line is the whole record in the thread: what was said opens in the conversation between members.
  expect(el.querySelector(".handoff-detail, details")).toBeNull();
});

test.each(["zh-TW", "en", "ja"])("%s shows only the highest priority group state", locale => {
  setLocale(locale);
  const first = { ...task(1, 1, "waiting"), waiting_owner: 2 };
  const state = (tasks: HandoffView[]): string | null | undefined => dom(draw(tasks)).querySelector("[data-handoff-group] .event-state")?.textContent;
  const words = { "zh-TW": ["等待你回答", "未完成", "進行中"], en: ["Waiting for you", "Incomplete", "In progress"], ja: ["回答待ち", "未完了", "進行中"] }[locale]!;
  expect(state([first, task(2, 2, "running"), task(3, 3, "failed")])).toBe(words[0]);
  expect(state([task(1, 1, "failed"), task(2, 2, "running"), task(3, 3, "withheld")])).toBe(words[1]);
  expect(state([task(1, 1, "queued"), task(2, 2, "waiting"), task(3, 3, "running")])).toBe(words[2]);
  expect(state([task(1), task(2)])).toBeUndefined();
});

test("Latin names before a Chinese join have a CSS gap without changing localized text", () => {
  const el = dom(draw([task(1), task(2), task(3), task(4)]));
  const last = el.querySelectorAll("[data-handoff-group] .event-person")[2]!;
  expect(last.classList.contains("is-word-gap")).toBe(true);
  expect(last.nextSibling?.textContent).toBe("和其他 1 位 的 4 則訊息");
});

test("one exchange counts both sides as Grok Bot's line and keeps its own state while unfinished", () => {
  const line = (view: HandoffView): HTMLElement => dom(handoffGroupHTML([{ task: view, face: "" }])).firstElementChild as HTMLElement;
  const asked = { ...task(1), mode: "consult" as const, request: "Sample question" };
  expect(line(asked).textContent).toBe("與 Person 1 的 2 則訊息");
  expect(line(asked).dataset.handoff).toBe("1");
  const running = line({ ...asked, state: "running", result: "" });
  expect(running.querySelector(".event-line > span")?.textContent).toBe("與 Person 1 的 1 則訊息");
  expect(running.querySelector(".event-state")?.textContent).toBe("執行中");
  expect(line({ ...asked, state: "running", waiting_owner: 1 }).querySelector(".event-state")?.textContent).toBe(t("ownerQuestion.waiting", { p0: 1 }));
  setLocale("en");
  expect(line({ ...asked, state: "running", result: "" }).querySelector(".event-line > span")?.textContent).toBe("1 message with Person 1");
});

test("shared diff keeps the same line node as new work arrives", () => {
  const thread = document.createElement("ol"), drawn = new WeakMap<Element, string>(); document.body.append(thread);
  const tasks = [task(1), task(2)];
  const update = (): boolean => patchThread(thread, [{ key: "turn:1", html: draw(tasks) }], drawn);
  update();
  const line = thread.querySelector<HTMLElement>("[data-handoff-group]")!;
  const owner = thread.querySelector('.me'), answer = thread.querySelector('.ra');
  tasks[0] = { ...tasks[0], result: "Updated result" }; tasks.push(task(3)); update();
  expect(thread.querySelector("[data-handoff-group]")).toBe(line);
  expect(line.dataset.peerKeys).toBe("1 2 3");
  expect(line.textContent).toContain("3");
  expect(thread.querySelector('.me')).toBe(owner);
  expect(thread.querySelector('.ra')).toBe(answer);
});
