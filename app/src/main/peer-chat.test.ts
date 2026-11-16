// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { handoffGroupHTML } from "./handoff-line";
import { catalogs, LOCALES, setLocale, t } from "./i18n";
import { openPeerChat, peerLines, peerTasks, type PeerPeople } from "./peer-chat";
import type { HandoffView } from "./types";

afterEach(() => { setLocale("zh-TW"); document.body.replaceChildren(); });
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-07T12:00:00+08:00");
const task = (id: number, patch: Partial<HandoffView> = {}): HandoffView => ({ task_id: id, source_turn_id: 1, work_turn_id: id + 100,
  member_id: 2, member_name: "Second", from_member_id: 1, stage_id: "", mode: "consult", state: "done", reason: null,
  created_at_ms: NOW - 60_000, finished_at_ms: NOW - 30_000, ready_at_ms: NOW, dispatch_policy: "immediate",
  request: `Question ${id}`, result: `Answer ${id}`, evidence: [], ...patch });
const people: PeerPeople = (id, fallback) => ({ name: id === 1 ? "First" : fallback || `Member ${id}`, face: `<i class="face-${id}"></i>`, accent: id === 1 ? "#123456" : "#654321" });
const mount = (all: () => HandoffView[]): { column: HTMLElement; line: HTMLButtonElement } => {
  const column = document.createElement("section"); column.className = "mb-chat";
  column.innerHTML = `<ol>${handoffGroupHTML(all().filter(view => view.task_id === 3).map(view => ({ task: view, face: "" })))}</ol>`;
  document.body.append(column);
  return { column, line: column.querySelector("button")! };
};

test("an exchange is two messages: what one member sent, then the other's answer or the state it stands at", () => {
  expect(peerLines([task(1)]).map(line => [line.from, line.text, line.state])).toEqual([[1, "Question 1", undefined], [2, "Answer 1", undefined]]);
  expect(peerLines([task(2, { state: "running", result: "" })]).map(line => [line.from, line.text, line.state])).toEqual([[1, "Question 2", undefined], [2, "", "執行中"]]);
  const files = peerLines([task(4, { mode: "work", result: "", evidence: [{ kind: "artifact", uri: "out/report.html", digest: "", verdict: "verified" }] })]);
  expect(files[1]!.files).toEqual(["report.html"]);
});

test("the view takes the exchanges between the same members at the same time, oldest first, and none with others", () => {
  const MIN = 60_000;
  const all = [task(3), task(2, { created_at_ms: NOW - 20 * MIN, finished_at_ms: NOW - 15 * MIN }), task(1, { created_at_ms: NOW - 2 * DAY, finished_at_ms: NOW - 2 * DAY }), task(5, { member_id: 7, member_name: "Other" })];
  const found = peerTasks("3", all)!;
  expect(found.host).toBe(1);
  expect(peerLines(found.tasks).map(line => line.text)).toEqual(["Question 2", "Answer 2", "Question 3", "Answer 3"]);
  expect(peerTasks("9", all)).toBeNull();
});

test("an exchange long after the last is a conversation of its own: each line opens only its own time", () => {
  const MIN = 60_000;
  // A daily routine's exchange: yesterday's and today's are two conversations, not one.
  const yesterday = task(1, { created_at_ms: NOW - DAY, finished_at_ms: NOW - DAY + MIN });
  const today = task(2, { created_at_ms: NOW - 2 * MIN, finished_at_ms: NOW - MIN });
  expect(peerTasks("1", [yesterday, today])!.tasks.map(view => view.task_id)).toEqual([1]);
  expect(peerTasks("2", [yesterday, today])!.tasks.map(view => view.task_id)).toEqual([2]);
  // A line that counts both opens both; an exchange that is still going on keeps the next one in its conversation.
  expect(peerTasks("1 2", [yesterday, today])!.tasks.map(view => view.task_id)).toEqual([1, 2]);
  const running = task(4, { created_at_ms: NOW - 3 * 60 * MIN, finished_at_ms: null, state: "running", result: "" });
  const later = task(5, { created_at_ms: NOW - MIN, finished_at_ms: null, state: "running", result: "" });
  expect(peerTasks("5", [running, later])!.tasks.map(view => view.task_id)).toEqual([4, 5]);
  // An answer arriving 31 minutes after the last one moved starts the next conversation; at 30 it is the same one.
  const first = task(6, { created_at_ms: NOW - 60 * MIN, finished_at_ms: NOW - 50 * MIN });
  expect(peerTasks("7", [first, task(7, { created_at_ms: NOW - 20 * MIN, finished_at_ms: NOW - 19 * MIN })])!.tasks.map(view => view.task_id)).toEqual([6, 7]);
  expect(peerTasks("8", [first, task(8, { created_at_ms: NOW - 19 * MIN, finished_at_ms: NOW - 18 * MIN })])!.tasks.map(view => view.task_id)).toEqual([8]);
});

test("work a member handed itself is never a conversation between members", () => {
  const own = task(6, { member_id: 1, member_name: "First", from_member_id: 1, mode: "work", own_work: true } as Partial<HandoffView>);
  expect(peerLines([own])).toEqual([]);
  expect(peerTasks("6", [own, task(3)])).toBeNull();
  expect(peerTasks("3", [own, task(3)])!.tasks.map(view => view.task_id)).toEqual([3]);
  // Nor does it have a line in its own conversation, where the work itself goes on.
  expect(handoffGroupHTML([{ task: own, face: "" }])).toBe("");
  expect(handoffGroupHTML([{ task: own, face: "" }, { task: task(3), face: "" }])).toContain('data-peer-keys="3"');
});

test("a line opens the conversation in place: the pill, faces and coloured names, day dividers and Close chat", () => {
  // One conversation across midnight: 23:50 to 00:11, a divider for each day.
  const MIDNIGHT = NOW - DAY / 2, MIN = 60_000;
  const all = [task(3, { created_at_ms: MIDNIGHT + 10 * MIN, finished_at_ms: MIDNIGHT + 11 * MIN }), task(1, { created_at_ms: MIDNIGHT - 10 * MIN, finished_at_ms: MIDNIGHT - 5 * MIN })];
  const { column, line } = mount(() => all);
  line.focus();
  const view = openPeerChat(column, line, () => all, people)!;
  expect(column.querySelector(":scope > .peer-chat")).toBe(view.el);
  expect(column.hasAttribute("data-peer-open")).toBe(true);
  expect(view.el.getAttribute("aria-label")).toBe("First ⇄ Second");
  expect(view.el.querySelector(".peer-pill")!.textContent).toBe("FirstSecond");
  expect(view.el.querySelectorAll(".peer-pill .peer-swap svg")).toHaveLength(1);
  expect([...view.el.querySelectorAll(".peer-thread > .day")].map(day => day.textContent)).toHaveLength(2);
  expect([...view.el.querySelectorAll<HTMLElement>(".peer-line")].map(row => row.dataset.peerFrom)).toEqual(["1", "2", "1", "2"]);
  const names = [...view.el.querySelectorAll<HTMLElement>(".peer-who")];
  expect(names.map(name => name.textContent)).toEqual(["First", "Second", "First", "Second"]);
  expect(names[0]!.getAttribute("style")).toContain("#123456");
  expect(view.el.querySelector(".peer-line .face-1")).not.toBeNull();
  expect(document.activeElement).toBe(view.el.querySelector(".peer-close"));
  view.el.querySelector<HTMLButtonElement>(".peer-close")!.click();
  expect(column.querySelector(".peer-chat")).toBeNull();
  expect(column.hasAttribute("data-peer-open")).toBe(false);
  expect(document.activeElement).toBe(line);
});

test("Esc closes it, an answer that arrives redraws it, and leaving the conversation closes it", () => {
  let all = [task(3, { state: "running", result: "", finished_at_ms: null })];
  const { column, line } = mount(() => all);
  let closed = 0;
  const view = openPeerChat(column, line, () => all, people, () => closed++)!;
  expect(view.el.querySelector(".peer-state")!.textContent).toBe("執行中");
  all = [task(3)];
  view.update();
  expect(view.el.querySelector(".peer-state")).toBeNull();
  expect(view.el.textContent).toContain("Answer 3");
  all = [];
  view.update();
  expect(column.querySelector(".peer-chat")).toBeNull();
  expect(closed).toBe(1);
  all = [task(3)];
  const again = openPeerChat(column, line, () => all, people)!;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(again.el.isConnected).toBe(false);
});

test("each ending the core gives has its own line in every language, and one nothing gives has none", () => {
  const ENDINGS = { artifact_unreadable: "handoff.unreadableArtifact", child_work_incomplete: "handoff.childWorkOpen", missing_artifact: "handoff.missingArtifact",
    artifact_changed: "handoff.changedArtifact", work_without_action: "handoff.noAction", missing_terminal: "handoff.invalidFinal" } as const;
  const states = (reason: string): string => peerLines([task(1, { mode: "work", state: "failed", result: "", reason })])[1]!.state!;
  for (const locale of LOCALES) {
    setLocale(locale.id);
    for (const [reason, key] of Object.entries(ENDINGS)) {
      const line = catalogs[locale.id][key];
      expect(states(reason), `${locale.id} ${reason}`).toBe(`${t("handoff.failed")} · ${line}`);
      if (locale.id !== "en") expect(line, `${locale.id} ${key} is not English`).not.toBe(catalogs.en[key]);
    }
    // A reason the app has no line for stands on the state alone, never on the code.
    expect(states("dangling_mention")).toBe(t("handoff.failed"));
    expect(states("something_else")).toBe(t("handoff.failed"));
  }
});

test("a member that said it was finished while work it handed on was open says so, in words a first-time user can read", () => {
  setLocale("en");
  expect(peerLines([task(1, { mode: "work", state: "failed", result: "", reason: "child_work_incomplete" })])[1]!.state)
    .toBe("Incomplete · Stopped while work it handed on was still running");
  expect(peerLines([task(2, { mode: "work", state: "failed", result: "", reason: "artifact_unreadable" })])[1]!.state)
    .toBe("Incomplete · The file is there but cannot be opened");
});
