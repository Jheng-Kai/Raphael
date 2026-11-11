// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { setLocale } from "./i18n";
import { roomBoardHTML, roomReportHTML } from "./room-meeting";
import type { HandoffView, RoomMessage } from "./types";

const task: HandoffView = { task_id: 7, source_turn_id: 8, work_turn_id: 9, member_id: 2, member_name: "Alice",
  from_member_id: 2, stage_id: "S2-03", title: "Review", state: "done", reason: null, created_at_ms: 1, ready_at_ms: 1,
  dispatch_policy: "immediate", mode: "work", result: "Stored result excerpt", evidence: [
    {id:51,kind:"artifact",uri:"review.txt",digest:"123456789012abcdef",verdict:"verified"},
  ] };

test("report cards show the public summary, evidence and a private-turn destination", () => {
  setLocale("en");
  const message = {id:10,text:"Public summary",report:task} as RoomMessage;
  const node = document.createElement("div"); node.innerHTML=roomReportHTML(message);
  expect(node.textContent).toContain("Public summary");
  expect(node.textContent).toContain("Alice · Review");
  expect(node.textContent).not.toContain("S2-03");
  expect(node.textContent).not.toContain("Stored result excerpt");
  expect(node.textContent).toContain("review.txt");
  expect(node.textContent).not.toContain("123456789012");
  expect(node.querySelector('.team-file[data-room-act="artifact-open"][data-task="7"][data-evidence="51"]:not([disabled])')).not.toBeNull();
  expect(node.querySelector('[data-room-act="private-work"][data-member="2"][data-turn="9"]')).not.toBeNull();
  expect(node.querySelector('[data-owner-question]')).toBeNull();
});

test("the board projects owner waiting and safely displays pinned decisions", () => {
  setLocale("en");
  const node=document.createElement("div");
  node.innerHTML=roomBoardHTML([{...task,state:"waiting",waiting_owner:1}], [{id:11,member_id:0,text:"<img src=x>"}]);
  expect(node.textContent).toContain("Alice");
  expect(node.textContent).toContain("Review");
  expect(node.textContent).not.toContain("S2-03");
  expect(node.textContent).toContain("<img src=x>");
  expect(node.querySelector("img")).toBeNull();
  expect(node.querySelector('[data-room-board]')).not.toBeNull();
});

test("queued follow-up work does not hide the member's running stage", () => {
  setLocale("en");
  const node=document.createElement("div");
  node.innerHTML=roomBoardHTML([task,{...task,task_id:8,state:"running",title:"Current stage",result:""},
    {...task,task_id:9,state:"queued",title:"Later stage",result:""}],[]);
  expect(node.querySelectorAll(".room-board-member")).toHaveLength(1);
  expect(node.textContent).toContain("Current stage");
  expect(node.textContent).not.toContain("Later stage");
  expect(node.querySelector(".card-status")?.textContent).toContain("Running");
});
