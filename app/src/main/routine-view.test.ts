// @vitest-environment happy-dom
import { beforeEach, expect, test } from "vitest";
import { setLocale } from "./i18n";
import { routineViewHTML } from "./routine-view";
import { delegatedTurn, ownerTurn } from "./conversation";
import type { AgentTurn, Routine } from "./types";

const routine = (fields: Partial<Routine> = {}): Routine => ({
  id: 4, member_id: 1, title: "每日新聞", prompt: "做新聞頁面", schedule: { kind: "daily", time: "08:00" }, enabled: true,
  last_run: 1792803600000, next_run: 1792890000000, ...fields,
});
const view = (fields: Partial<Routine>): Document => {
  document.body.innerHTML = routineViewHTML(routine(fields), []);
  return document;
};

beforeEach(() => setLocale("en"));

test("a routine whose last run did not work says so with the reason, as a status with a dot", () => {
  const status = view({ last_error: "A step this run needed was refused, so it did not finish.", last_failed: true }).querySelector(".rv-status.is-failed");
  expect(status?.textContent).toContain("A step this run needed was refused");
  expect(status?.querySelector(".st.err .dot.err")).not.toBeNull();
});

test("a routine paused for a reason of the app is not shown as a failed run", () => {
  const status = view({ last_error: "Paused after 30 days without owner activity." }).querySelector(".rv-status");
  expect(status?.textContent).toContain("Paused after 30 days");
  expect(status?.classList.contains("is-failed")).toBe(false);
  expect(status?.querySelector(".st")).toBeNull();
});

test("a routine that works has no status line", () => {
  expect(view({ last_failed: false }).querySelector(".rv-status")).toBeNull();
});

test("a brief another member handed over is not the owner's message", () => {
  const turn = (fields: Partial<AgentTurn>): AgentTurn => ({ id: 1, question: "主人要求你每天檢查", route: "answer", source: "app", member_id: 5, peer_id: null, ...fields }) as AgentTurn;
  expect(delegatedTurn(turn({ route: "worker", source: "worker", peer_id: 0 }))).toBe(true);
  expect(delegatedTurn(turn({ route: "delegate", peer_id: 0 }))).toBe(true);
  expect(delegatedTurn(turn({ route: "worker", peer_id: 5 }))).toBe(false);
  expect(delegatedTurn(turn({}))).toBe(false);
  expect(ownerTurn(turn({}))).toBe(true);
  expect(ownerTurn(turn({ route: "worker", peer_id: 0 }))).toBe(false);
  expect(ownerTurn(turn({ route: "routine", source: "routine" }))).toBe(false);
});
