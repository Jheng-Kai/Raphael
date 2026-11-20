// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import { setSlimeState } from "./slime";
import { mountStatusLight } from "./status-light";
import type { Member } from "./types";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const people = (waiting: number[] = []) => [1, 2, 3].map(id => ({ id, name: `m${id}`, waiting: waiting.includes(id) }) as unknown as Member);

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
  expect(button.getAttribute("aria-label")).toBe("沒有成員在工作");
  setSlimeState(1, "working");
  await flush();
  expect(button.dataset.level).toBe("busy");
  expect(button.getAttribute("aria-label")).toBe("1 個成員在工作");
  setSlimeState(2, "blocked");
  await flush();
  expect(button.dataset.level).toBe("needs");
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

test("the title pill draws no dot of its own, and its arrow hides while the details panel is open", () => {
  const css = ["conversations.css", "desktop-viewer.css"].map(file => readFileSync(join(__dirname, file), "utf8")).join(" ");
  expect(css).not.toContain("is-computer-active");
  expect(css).toContain('.page-agent[data-det="open"] .btn.conversation-trigger:is(:hover, :focus-visible) .mb-pill-go { opacity: 0; }');
});
