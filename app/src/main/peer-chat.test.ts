// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { handoffGroupHTML } from "./handoff-line";
import { setLocale } from "./i18n";
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

test("the view takes every exchange between the same members, oldest first, and none with others", () => {
  const all = [task(3), task(1, { created_at_ms: NOW - 2 * DAY, finished_at_ms: NOW - 2 * DAY }), task(5, { member_id: 7, member_name: "Other" })];
  const found = peerTasks("3", all)!;
  expect(found.host).toBe(1);
  expect(peerLines(found.tasks).map(line => line.text)).toEqual(["Question 1", "Answer 1", "Question 3", "Answer 3"]);
  expect(peerTasks("9", all)).toBeNull();
});

test("a line opens the conversation in place: the pill, faces and coloured names, day dividers and Close chat", () => {
  const all = [task(3), task(1, { created_at_ms: NOW - 2 * DAY, finished_at_ms: NOW - 2 * DAY })];
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
