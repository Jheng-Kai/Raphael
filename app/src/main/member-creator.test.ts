// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { openMemberCreator } from "./member-creator";
import { SLIME_GROUPS } from "./slime";
import { t } from "./i18n";
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

test("it is one small dialog: the head, the slime, the name, the shared picker, then 取消 and 建立, and nothing else", () => {
  const { $, dialog } = open();
  const order = [".mb-dlg-head", ".cr-face", "#mb-new-name", ".cr-picker .mb-slime-tabs", ".cr-picker .mb-slime-panels", ".mb-dlg-act"].map(selector => $(selector));
  order.slice(1).forEach((element, at) => expect(order[at]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
  expect($(".mb-dlg-head h2").textContent).toBe(t("members.newMember"));
  expect($(".mb-dlg-head").querySelector('[data-dlg="close"]')).not.toBeNull();
  expect($(".cr-face svg.slime")).not.toBeNull();
  // The picker is the popover's own component: its tabs, in its order, six groups.
  expect([...dialog.el.querySelectorAll<HTMLElement>('.cr-picker [role="tab"]')].map(tab => tab.dataset.slimeTab)).toEqual([...SLIME_GROUPS]);
  expect($(".cr-name")).toBe($("#mb-new-name"));
  expect([...dialog.el.querySelectorAll(".mb-dlg-act .btn")].map(button => button.textContent)).toEqual([t("common.cancel"), t("members.create")]);
  expect(document.activeElement?.id).toBe("mb-new-name");
  expect(dialog.el.querySelector('input[type="file"], img, textarea, [data-dlg="templates"], [data-tab]')).toBeNull();
  expect(dialog.el.querySelectorAll("input")).toHaveLength(1);
  expect($<HTMLInputElement>("#mb-new-name").placeholder).toBe(t("members.name"));
});

test("it opens on the group of the slime that is chosen, with that one marked", () => {
  const { $ } = open();
  const chosen = $<HTMLElement>('.cr-picker [role="tab"][aria-selected="true"]');
  expect(chosen.dataset.slimeTab).toBe("colors");
  expect($('.cr-picker [data-slime-group="colors"]').hasAttribute("data-active")).toBe(true);
  expect(document.querySelectorAll('.cr-picker [aria-pressed="true"]')).toHaveLength(1);
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
  expect($("#mb-new-name").getAttribute("aria-invalid")).toBe("true");
  expect($<HTMLElement>(".field-error").hidden).toBe(false);
  expect($(".field-error").textContent).toBe(t("members.nameTaken", { p0: "日文 老師" }));
  expect(document.querySelector(".mb-scrim")).not.toBeNull();
  type("日文 老師二");
  expect($("#mb-new-name").hasAttribute("aria-invalid")).toBe(false);
  expect($<HTMLElement>(".field-error").hidden).toBe(true);
});

test("a tab shows its group and moves nothing, a slime is drawn large and is the member's, and only one is chosen", async () => {
  const { $, dialog, type, create } = open({ groupId: 2 });
  const before = $(".cr-face").innerHTML;
  $<HTMLElement>('[role="tab"][data-slime-tab="characters"]').click();
  expect($('[data-slime-group="characters"]').hasAttribute("data-active")).toBe(true);
  expect($('[data-slime-group="colors"]').hasAttribute("inert")).toBe(true);
  expect($(".cr-face").innerHTML).toBe(before);
  $('[data-slime-character="shion"]').click();
  expect($('[data-slime-character="shion"]').getAttribute("aria-pressed")).toBe("true");
  expect($(".cr-face").innerHTML).not.toBe(before);
  expect(dialog.el.querySelectorAll('.cr-picker [aria-pressed="true"]')).toHaveLength(1);
  type(" 紫苑 ");
  $('[data-dlg="create"]').click();
  await flush();
  expect(create).toHaveBeenCalledWith({ name: "紫苑", group_id: 2, avatar: "slime:shion", greet: true });
  expect(document.querySelector(".mb-scrim")).toBeNull();
});

test("Enter in the name makes it when there is a name, and does nothing before", async () => {
  const { $, type, create } = open();
  const press = (): void => { $("#mb-new-name").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); };
  press();
  await flush();
  expect(create).not.toHaveBeenCalled();
  type("Mia");
  press();
  await flush();
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]![0].avatar).toMatch(/^slime:/);
});

test("while it is being made it says so and cannot be closed, and a failure leaves it open with the name to try again", async () => {
  let finish!: (member: Member | null) => void;
  const create = vi.fn(() => new Promise<Member | null>(resolve => { finish = resolve; }));
  const { $, type } = open({ create });
  type("Mia");
  $('[data-dlg="create"]').click();
  expect($('[data-dlg="create"]').textContent).toBe(t("members.creating"));
  expect($<HTMLButtonElement>('[data-dlg="cancel"]').disabled).toBe(true);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector(".mb-scrim")).not.toBeNull();
  finish(null);
  await flush();
  expect(document.querySelector(".mb-scrim")).not.toBeNull();
  expect($<HTMLButtonElement>('[data-dlg="create"]').disabled).toBe(false);
  expect($('[data-dlg="create"]').textContent).toBe(t("members.create"));
  expect($<HTMLInputElement>("#mb-new-name").value).toBe("Mia");
});

test("Escape, the × and 取消 close it", () => {
  for (const close of [
    () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    () => document.querySelector<HTMLElement>('.mb-dlg-head [data-dlg="close"]')!.click(),
    () => document.querySelector<HTMLElement>('.mb-dlg-act [data-dlg="cancel"]')!.click(),
  ]) {
    open();
    close();
    expect(document.querySelector(".mb-scrim")).toBeNull();
  }
});
