// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { openMemberCreator } from "./member-creator";
import { SLIME_CHARACTER_COUNT, SLIME_COLOR_COUNT } from "./slime";
import type { Member, NewMember } from "./types";

const made = { id: 7, name: "Mia" } as Member;
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function open(over: Partial<Parameters<typeof openMemberCreator>[0]> = {}) {
  const create = vi.fn(async (_member: NewMember): Promise<Member | null> => made);
  const dialog = openMemberCreator({ groupId: null, taken: ["拉斐爾", "文書"], create, ...over });
  const $ = <T extends HTMLElement>(selector: string): T => dialog.el.querySelector<T>(selector)!;
  const type = (text: string): void => { const name = $<HTMLInputElement>("#mb-new-name"); name.value = text; name.dispatchEvent(new Event("input")); };
  return { dialog, create, $, type };
}

beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

test("it opens on the slime, every colour and character and a name, and asks nothing else", () => {
  const { $, dialog } = open();
  expect($(".cr-face svg.slime")).not.toBeNull();
  expect(dialog.el.querySelectorAll(".cr-colors [data-slime-color]")).toHaveLength(SLIME_COLOR_COUNT);
  expect(dialog.el.querySelectorAll(".cr-characters [data-slime-character]")).toHaveLength(SLIME_CHARACTER_COUNT);
  expect(document.activeElement?.id).toBe("mb-new-name");
  expect(dialog.el.querySelector('input[type="file"], img')).toBeNull();
  expect(dialog.el.querySelectorAll("input, textarea")).toHaveLength(1);
});

test("there is nothing to press until it has a name, and a taken name is not sent", async () => {
  const { $, type, create } = open({ taken: ["日文 老師"] });
  const start = $<HTMLButtonElement>('[data-dlg="create"]');
  expect(start.disabled).toBe(true);
  type("日文   老師");
  expect(start.disabled).toBe(false);
  start.click();
  await flush();
  expect(create).not.toHaveBeenCalled();
  expect(document.querySelector(".mb-scrim")).not.toBeNull();
});

test("the chosen slime is drawn and is the member's, and only one is chosen", async () => {
  const { $, dialog, type, create } = open({ groupId: 2 });
  $('[data-slime-color="coral"]').click();
  expect($('[data-slime-color="coral"]').getAttribute("aria-pressed")).toBe("true");
  $('[data-slime-character="shion"]').click();
  expect($('[data-slime-character="shion"]').getAttribute("aria-pressed")).toBe("true");
  expect(dialog.el.querySelectorAll('[data-slime-color][aria-pressed="true"]')).toHaveLength(0);
  type(" 紫苑 ");
  $('[data-dlg="create"]').click();
  await flush();
  expect(create).toHaveBeenCalledWith({ name: "紫苑", group_id: 2, avatar: "slime:shion", greet: true });
  expect(document.querySelector(".mb-scrim")).toBeNull();
});

test("while it is being made it cannot be closed, and a failure leaves it open to try again", async () => {
  let finish!: (member: Member | null) => void;
  const create = vi.fn(() => new Promise<Member | null>(resolve => { finish = resolve; }));
  const { $, type } = open({ create });
  type("Mia");
  $('[data-dlg="create"]').click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector(".mb-scrim")).not.toBeNull();
  finish(null);
  await flush();
  expect(document.querySelector(".mb-scrim")).not.toBeNull();
  expect($<HTMLButtonElement>('[data-dlg="create"]').disabled).toBe(false);
});

test("Escape closes it", () => {
  open();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector(".mb-scrim")).toBeNull();
});

test("choosing a tab hands the focus over without scrolling the page, so the tab row stays where it was clicked", () => {
  const { dialog, $ } = open({ store: true });
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  try {
    $<HTMLElement>('[data-tab="maker"]').click();
    expect(document.activeElement?.id).toBe("mb-new-name");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focus.mock.calls.every(call => (call[0] as FocusOptions | undefined)?.preventScroll === true)).toBe(true);
  } finally { focus.mockRestore(); dialog.close(); }
});
