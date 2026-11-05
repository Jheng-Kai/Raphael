// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { threadItems } from "./conversation";
import { emptyTimelineState, turnHTML } from "./timeline";
import type { AgentTurn } from "./types";

const at = new Date(2026, 10, 5, 7).getTime();
const failure = "Codex CLI 在回答完成前停止了。";
const turn = (id: number, extra = {}): AgentTurn => ({ id, session_id: `calm-${id}`, created_at_ms: at, question: "請再檢查範例資料。", source: "app", route: "answer", prefix: "", text: failure, detail: null, status: "error", model: "cli:codex", cost_usd: 0, steps: [], messages: [], ...extra } as AgentTurn);

test("calm threads have one divider per calendar day and no hour in its label", () => {
  const days = threadItems([turn(1), turn(2, {created_at_ms: at + 3600000}), turn(3, {created_at_ms: at + 86400000})], at).filter(item => item.kind === "day");
  expect(days).toHaveLength(2);
  expect(days.every(item => item.kind === "day" && !/\d{2}:\d{2}/.test(item.label))).toBe(true);
});

test("routine failures keep their origin and rerun in the reply without a duplicate event", () => {
  const item = turn(1, {source:"routine", question:"NHK Easy News 每日摘要", routine:{id:2,title:"NHK Easy News 每日摘要"}, task:{id:9,state:"failed"}, messages:[{seq:1,kind:"event",text:failure,at_ms:at}]});
  document.body.innerHTML = turnHTML(item, emptyTimelineState(), false, {face:()=>"", regenerateTurnId:1});
  expect(document.querySelector(".chat-message .routine-run-link")?.textContent).toContain("NHK Easy News");
  expect(document.querySelector('.chat-message .message-actions [data-act="rerun"]')?.getAttribute("data-task")).toBe("9");
  expect(document.querySelector(".task-actions,.timeline-event,.sys")).toBeNull();
  expect(document.body.textContent?.split(failure).length).toBe(2);
});
