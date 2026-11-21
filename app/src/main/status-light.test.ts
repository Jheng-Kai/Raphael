// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import { setSlimeState } from "./slime";
import { mountStatusLight } from "./status-light";
import type { Member } from "./types";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const people = (waiting: number[] = [], unread: Record<number, "message" | "done" | "failed"> = {}) =>
  [1, 2, 3].map(id => ({ id, name: `m${id}`, waiting: waiting.includes(id), unread: id in unread, unread_kind: unread[id] ?? null }) as unknown as Member);

afterEach(() => {
  for (const id of [1, 2, 3]) setSlimeState(id, "idle");
  document.body.replaceChildren();
});

function mount(roster: () => readonly Member[], open = vi.fn()) {
  setLocale("zh-TW");
  const button = document.createElement("button");
  button.innerHTML = '<span class="status-dot"></span>';
  document.body.append(button);
  const light = mountStatusLight(button, { roster, face: member => `<span class="av">${member.id}</span>`, open });
  return { button, light, open };
}

test("the status light is one wordless dot: idle with no member at work, busy while one works, the warning colour while one waits", async () => {
  let roster = people();
  const { button, light } = mount(() => roster);
  expect(button.dataset.level).toBe("idle");
  expect(button.textContent?.trim()).toBe("");
  expect(button.getAttribute("aria-label")).toBe("沒有人在工作");
  setSlimeState(1, "working");
  await flush();
  expect(button.dataset.level).toBe("busy");
  expect(button.getAttribute("aria-label")).toBe("m1正在工作");
  setSlimeState(2, "blocked");
  await flush();
  expect(button.dataset.level).toBe("needs");
  expect(button.getAttribute("aria-label")).toBe("m2在等你");
  setSlimeState(3, "working");
  await flush();
  expect(button.getAttribute("aria-label")).toBe("m2在等你");
  setSlimeState(2, "idle");
  await flush();
  expect(button.getAttribute("aria-label")).toBe("m1等 1 位正在工作");
  setSlimeState(3, "idle");
  setSlimeState(2, "idle");
  roster = people([3]);
  light.draw();
  await flush();
  expect(button.dataset.level).toBe("needs");
});

test("a press lists the members at work, the ones waiting for the owner first, and picking one opens its conversation", async () => {
  const { button, open } = mount(() => people([3]));
  setSlimeState(1, "working");
  await flush();
  button.click();
  const rows = [...document.querySelectorAll<HTMLElement>(".menu-choice")];
  expect(rows.map(row => row.dataset.value)).toEqual(["3", "1"]);
  expect(rows.every(row => row.querySelector(".av"))).toBe(true);
  rows[1]!.click();
  expect(open).toHaveBeenCalledWith(1, null);
});

test("finished work the owner has not opened is listed before 工作中 under 完成, work that went wrong waits with the others, each row with its dot", async () => {
  const { button } = mount(() => [...people([], { 1: "done", 2: "failed" }), ...people([], { 3: "message" }).filter(member => member.id === 3).map(member => ({ ...member, id: 4 }))]);
  setSlimeState(3, "working");
  await flush();
  expect(button.dataset.level).toBe("needs");
  button.click();
  const rows = [...document.querySelectorAll<HTMLElement>(".menu-choice")];
  expect(rows.map(row => row.dataset.value)).toEqual(["2", "1", "4", "3"]);
  expect(rows.map(row => row.querySelector<HTMLElement>(".status-row-dot")?.dataset.kind)).toEqual(["failed", "done", "done", "busy"]);
  expect([...document.querySelectorAll(".menu-head")].map(head => head.textContent)).toEqual(["等你", "完成", "工作中"]);
});

test("with only finished work left the label names who finished", async () => {
  const { button } = mount(() => people([], { 3: "done" }));
  await flush();
  expect(button.dataset.level).toBe("done");
  expect(button.getAttribute("aria-label")).toBe("m3完成了");
});

test("the title pill draws no dot of its own, and its arrow hides while the details panel is open", () => {
  const css = ["conversations.css", "desktop-viewer.css"].map(file => readFileSync(join(__dirname, file), "utf8")).join(" ");
  expect(css).not.toContain("is-computer-active");
  expect(css).toContain('.page-agent[data-det="open"] .btn.conversation-trigger:is(:hover, :focus-visible) .mb-pill-go { opacity: 0; }');
});

test("opening the status menu keeps the dot until every finished conversation is opened", async () => {
  let roster = people([], { 1: "done", 2: "done" });
  const { button, light } = mount(() => roster, vi.fn(id => {
    roster = roster.map(member => member.id === id ? { ...member, unread: false } : member);
    light.draw();
  }));
  button.click();
  expect(button.dataset.dot).toBe("done");
  expect(document.querySelectorAll('.status-row-dot[data-kind="done"]')).toHaveLength(2);
  document.querySelector<HTMLElement>('.menu-choice[data-value="1"]')!.click();
  await flush();
  expect(button.dataset.dot).toBe("done");
  button.click();
  expect(document.querySelectorAll('.status-row-dot[data-kind="done"]')).toHaveLength(1);
  document.querySelector<HTMLElement>('.menu-choice[data-value="2"]')!.click();
  await flush();
  expect(button.dataset.dot).toBeUndefined();
  roster = people([], { 1: "done" });
  light.draw(); await flush();
  expect(button.dataset.dot).toBe("done");
});

test("waiting cards keep their dot until their conversation opens and a new card lights it again", async () => {
  let roster = people([3], { 2: "failed" }).map(member => member.id === 3 ? {
    ...member, main_conversation_id: 30, waiting_cards: [{ id: "first", conversation_id: 31 }],
  } : member);
  const { button, light } = mount(() => roster);
  expect(button.dataset.dot).toBe("needs");
  light.opened(3, 30);
  await flush();
  expect(button.dataset.dot).toBe("needs");
  light.opened(3, 31);
  await flush();
  expect(button.dataset.dot).toBe("failed");
  expect(button.dataset.level).toBe("needs");
  roster = roster.map(member => member.id === 3 ? {
    ...member, waiting_cards: [...member.waiting_cards!, { id: "second", conversation_id: 31 }],
  } : member);
  light.draw(); await flush();
  expect(button.dataset.dot).toBe("needs");
  light.opened(3, 31);
  roster = roster.map(member => ({ ...member, unread: false }));
  await flush();
  expect(button.dataset.dot).toBeUndefined();
});

test("work under way never lights the status icon", async () => {
  let roster = people();
  const { button, light } = mount(() => roster);
  expect(button.dataset.dot).toBeUndefined();
  setSlimeState(1, "working");
  await flush();
  expect(button.dataset.dot).toBeUndefined();
  roster = people([], { 1: "done" });
  light.draw(); await flush();
  expect(button.dataset.dot).toBeUndefined();
});
