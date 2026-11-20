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
  expect(open).toHaveBeenCalledWith(1);
});

test("finished work the owner has not opened is listed last under 完成, work that went wrong waits with the others, each row with its dot", async () => {
  const { button } = mount(() => people([], { 1: "done", 2: "failed", 3: "message" }));
  await flush();
  expect(button.dataset.level).toBe("needs");
  button.click();
  const rows = [...document.querySelectorAll<HTMLElement>(".menu-choice")];
  expect(rows.map(row => row.dataset.value)).toEqual(["2", "1", "3"]);
  expect(rows.map(row => row.querySelector<HTMLElement>(".status-row-dot")?.dataset.kind)).toEqual(["failed", "done", "done"]);
  expect([...document.querySelectorAll(".menu-head")].map(head => head.textContent)).toEqual(["等你", "完成"]);
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
