// @vitest-environment happy-dom
// 換成其他成員 on a pinned tile (member-actions.ts): the member chosen takes the tile's place, the old one goes back
// to its folder, in one press and with no question.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ membersUpdate: vi.fn(async () => ({})), settingsSet: vi.fn(), settingsGet: vi.fn(), core: vi.fn(), membersSetPrimary: vi.fn(), membersDelete: vi.fn() }));
vi.mock("./api", () => api);
vi.mock("./chat-ask", () => ({ askInChat: vi.fn() }));

import { createMemberActions } from "./member-actions";
import { pinReplacements } from "./members";
import type { Member, MembersList } from "./types";

const member = (id: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});
const list = (patch: Record<number, Partial<Member>> = {}, extra: Partial<MembersList> = {}): MembersList => ({
  members: [member(0, { name: "拉斐爾" }), member(1, { group_id: 10, pinned: true }), member(2, { group_id: 10 }), member(3, { group_id: 20, pinned: true }), member(4, { group_id: 20 }), member(5)]
    .map(m => ({ ...m, ...patch[m.id] })),
  groups: [{ id: 10, name: "專案", position: 0, sources: [] }, { id: 20, name: "學習", position: 1, sources: [] }],
  ...extra,
});

const pick = (id: number): void => document.querySelector<HTMLElement>(`.mb-primary-picker [data-id="${id}"]`)!.click();
const shown = (): string[] => [...document.querySelectorAll<HTMLElement>(".mb-primary-picker [data-id]")].map(el => el.dataset.id!);
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

let current: MembersList;
const load = vi.fn(async () => {});
const actions = () => createMemberActions({ list: () => current, current: () => 0, select: vi.fn(), load, update: vi.fn(async () => true), deleted: vi.fn() });

beforeEach(() => { current = list(); api.membersUpdate.mockClear(); api.membersDelete.mockClear(); api.settingsGet.mockClear(); load.mockClear(); });
afterEach(() => { document.body.innerHTML = ""; });

describe("who a pinned tile can be replaced with", () => {
  test("members that are not pinned, hidden or the primary, and never Raphael", () => {
    expect(pinReplacements(list()).map(m => m.id)).toEqual([2, 4, 5]);
    expect(pinReplacements(list({ 4: { hidden: true } })).map(m => m.id)).toEqual([2, 5]);
    expect(pinReplacements(list({}, { team_context: { primary_id: 2 } } as Partial<MembersList>)).map(m => m.id)).toEqual([4, 5]);
    expect(pinReplacements(list({ 0: { pinned: true } })).map(m => m.id)).toEqual([2, 4, 5]);
  });
});

describe("換成其他成員 on a pinned tile", () => {
  test("lists the members that are not pinned in the existing picker, under the action's own title", async () => {
    const done = actions().memberAction(3, "replace-pinned");
    expect(document.querySelector(".mb-primary-picker h2")!.textContent).toBe("換成其他成員");
    expect(shown()).toEqual(["2", "4", "5"]);
    document.querySelector<HTMLElement>('.mb-primary-picker [data-dlg="close"]')!.click();
    await done;
    expect(api.membersUpdate).not.toHaveBeenCalled();
  });

  test("one press puts the member chosen at the tile's position, then sends the old one back unpinned, with no confirmation", async () => {
    const done = actions().memberAction(3, "replace-pinned");
    pick(5);
    await done;
    expect(document.querySelector(".mb-dialog")).toBeNull();
    expect(api.membersUpdate.mock.calls).toEqual([[5, { pinned: true, position: 3 }], [3, { pinned: false }]]);
    // The old member's folder and position are not written: it returns to where it was before it was pinned.
    expect(JSON.stringify(api.membersUpdate.mock.calls)).not.toContain("group_id");
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("doing it again the other way round undoes it", async () => {
    const first = actions().memberAction(3, "replace-pinned");
    pick(4);
    await first;
    current = list({ 3: { pinned: false }, 4: { pinned: true, position: 3 } });
    const second = actions().memberAction(4, "replace-pinned");
    pick(3);
    await second;
    expect(api.membersUpdate.mock.calls.slice(2)).toEqual([[3, { pinned: true, position: 3 }], [4, { pinned: false }]]);
  });

  test("nothing happens when the tile is no longer pinned or the member chosen has been pinned meanwhile", async () => {
    const stale = actions().memberAction(3, "replace-pinned");
    current = list({ 3: { pinned: false } });
    pick(5);
    await stale;
    const other = actions().memberAction(1, "replace-pinned");
    current = list({ 5: { pinned: true } });
    pick(5);
    await other;
    expect(api.membersUpdate).not.toHaveBeenCalled();
  });

  test("Raphael's tile is not replaceable", async () => {
    current = list({ 0: { pinned: true } });
    await actions().memberAction(0, "replace-pinned");
    expect(document.querySelector(".mb-primary-picker")).toBeNull();
    expect(api.membersUpdate).not.toHaveBeenCalled();
  });

  test("a refused write is told and the roster is read again", async () => {
    api.membersUpdate.mockRejectedValueOnce(new Error("no"));
    const done = actions().memberAction(3, "replace-pinned");
    pick(2);
    await done;
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("deleting a member", () => {
  test("asks nothing about its computer, reads no settings and sends only the member", async () => {
    const deleted = vi.fn();
    api.membersDelete.mockResolvedValueOnce({ deleted: true });
    const done = createMemberActions({ list: () => current, current: () => 0, select: vi.fn(), load, update: vi.fn(async () => true), deleted }).deleteMember(2);
    await flush();
    const dialog = document.querySelector<HTMLElement>(".mb-dialog")!;
    expect(dialog.querySelector("h2")!.textContent).toBe("刪除「成員2」？");
    expect(dialog.querySelectorAll("p")).toHaveLength(1);
    expect(dialog.querySelector(".row, .tg, [role=switch], [data-remove-computer]")).toBeNull();
    expect(api.membersDelete).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('[data-dlg="delete"]')!.click();
    await done;
    expect(api.membersDelete.mock.calls).toEqual([[2]]);
    expect(api.settingsGet).not.toHaveBeenCalled();
    expect(deleted).toHaveBeenCalledWith(2);
  });

  test("Cancel deletes nothing", async () => {
    const done = actions().deleteMember(2);
    await flush();
    document.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();
    await done;
    expect(api.membersDelete).not.toHaveBeenCalled();
  });
});
