// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "./api";
import { openMemberCreator } from "./member-creator";
import { SLIME_CHARACTER_COUNT, SLIME_COLOR_COUNT } from "./slime";
import type { Member, NewMember } from "./types";

vi.mock("./api", () => ({ membersCommandsSave: vi.fn(async () => ({})) }));

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

test("it opens on the slime, every colour and character, a name and starts to build from, and asks nothing else", () => {
  const { $, dialog } = open();
  expect($(".cr-face svg.slime")).not.toBeNull();
  expect(dialog.el.querySelectorAll(".cr-colors [data-slime-color]")).toHaveLength(SLIME_COLOR_COUNT);
  expect(dialog.el.querySelectorAll(".cr-characters [data-slime-character]")).toHaveLength(SLIME_CHARACTER_COUNT);
  expect(dialog.el.querySelectorAll(".cr-suggestion").length).toBeGreaterThan(3);
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
  expect(api.membersCommandsSave).not.toHaveBeenCalled();
});

test("a start names the member, looks the part, brings its job and command, and pressing it again takes that back", async () => {
  const { $, type, create } = open();
  const card = $('[data-preset="research"]');
  const name = $<HTMLInputElement>("#mb-new-name"), start = $<HTMLButtonElement>('[data-dlg="create"]');
  card.click();
  expect(card.getAttribute("aria-pressed")).toBe("true");
  expect(name.value).toBe("研究夥伴");
  expect(start.disabled).toBe(false);
  expect(document.activeElement?.id).toBe("mb-new-name");
  card.click();
  expect(name.value).toBe("");
  expect(start.disabled).toBe(true);
  type("Mia");
  card.click();
  expect(name.value).toBe("Mia");
  start.click();
  await flush();
  const sent = create.mock.calls[0]![0];
  expect(sent.name).toBe("Mia");
  expect(sent.role).toBe("研究夥伴");
  expect(sent.instructions).toContain("第一手");
  expect(sent.avatar).toMatch(/^slime:/);
  expect(api.membersCommandsSave).toHaveBeenCalledWith(7, expect.objectContaining({ name: "research" }));
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
