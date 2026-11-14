// The order of the sidebar (member-order.ts): what the window draws for a row dropped is what the core will answer.
// The numbering is the core's (members/store.py `_move`); core/tests/members/test_service.py has the same table.
import { describe, expect, test } from "vitest";
import { movedGroup, movedMember, withoutPlaces } from "./member-order";
import type { Member, MembersList } from "./types";

const member = (id: number, group_id: number | null, position: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id, model: "", tools: null, position, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});
// Raphael, then folders 1 (members 1-3), 2 (4-5) and none (6), numbered 0..5 as the core numbers them.
const list = (): MembersList => ({
  members: [member(0, null, -1), member(1, 1, 0), member(2, 1, 1), member(3, 1, 2), member(4, 2, 3), member(5, 2, 4), member(6, null, 5)],
  groups: [{ id: 1, name: "學習", position: 0, sources: [] }, { id: 2, name: "工作", position: 1, sources: [] }],
});
const ids = (moved: { list: MembersList } | null, group?: number | null): number[] =>
  moved!.list.members.filter(m => m.id !== 0 && (group === undefined || m.group_id === group)).map(m => m.id);
const places = (moved: { list: MembersList }): Record<number, number> => Object.fromEntries(moved.list.members.filter(m => m.id !== 0).map(m => [m.id, m.position]));

describe("a member dropped", () => {
  test("down its folder takes a place among all the members, and every place is numbered again", () => {
    const moved = movedMember(list(), 1, 1, 3)!;
    expect(moved.position).toBe(1);
    expect(ids(moved, 1)).toEqual([2, 1, 3]);
    expect(places(moved)).toEqual({ 2: 0, 1: 1, 3: 2, 4: 3, 5: 4, 6: 5 });
  });

  test("last in its folder goes after the folder's last member, not to the end of everyone", () => {
    const moved = movedMember(list(), 1, 1)!;
    expect(moved.position).toBe(2);
    expect(ids(moved, 1)).toEqual([2, 3, 1]);
    expect(places(moved)).toEqual({ 2: 0, 3: 1, 1: 2, 4: 3, 5: 4, 6: 5 });
  });

  test("into another folder changes its folder and stands before the member it was dropped on", () => {
    const moved = movedMember(list(), 2, 2, 5)!;
    expect(moved.position).toBe(3);
    expect(ids(moved, 1)).toEqual([1, 3]);
    expect(ids(moved, 2)).toEqual([4, 2, 5]);
    expect(moved.list.members.find(m => m.id === 2)!.group_id).toBe(2);
    expect(places(moved)).toEqual({ 1: 0, 3: 1, 4: 2, 2: 3, 5: 4, 6: 5 });
  });

  test("into an empty folder, or out of every folder, goes last in it", () => {
    const empty: MembersList = { ...list(), groups: [...list().groups, { id: 3, name: "生活", position: 2, sources: [] }] };
    const into = movedMember(empty, 6, 3)!;
    expect(ids(into, 3)).toEqual([6]);
    expect(into.position).toBe(5);
    const out = movedMember(list(), 1, null)!;
    expect(ids(out, null)).toEqual([6, 1]);
    expect(out.list.members.find(m => m.id === 1)!.group_id).toBeNull();
  });

  test("is listed as the core lists it: Raphael first, then the pinned ones, then everyone by place", () => {
    const base = list();
    base.members.find(m => m.id === 5)!.pinned = true;
    const moved = movedMember(base, 1, 1, 3)!;
    expect(moved.list.members.map(m => m.id)).toEqual([0, 5, 2, 1, 3, 4, 6]);
  });

  test("where it already stands, or to a folder or a member there is not, changes nothing", () => {
    expect(movedMember(list(), 2, 1, 3)).toBeNull();
    expect(movedMember(list(), 3, 1)).toBeNull();
    expect(movedMember(list(), 6, null)).toBeNull();
    expect(movedMember(list(), 1, 9)).toBeNull();
    expect(movedMember(list(), 0, 1)).toBeNull();
    expect(movedMember(list(), 99, 1)).toBeNull();
  });

  test("leaves the list it was given as it was", () => {
    const base = list(), before = JSON.stringify(base);
    movedMember(base, 1, 2, 5);
    movedGroup(base, 2, 1);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("a folder dropped", () => {
  test("goes before another and the folders are numbered again", () => {
    const moved = movedGroup(list(), 2, 1)!;
    expect(moved.position).toBe(0);
    expect(moved.list.groups.map(g => [g.id, g.position])).toEqual([[2, 0], [1, 1]]);
  });

  test("goes last for no folder, and not where it already stands", () => {
    expect(movedGroup(list(), 1, null)!.list.groups.map(g => g.id)).toEqual([2, 1]);
    expect(movedGroup(list(), 1, 2)).toBeNull();
    expect(movedGroup(list(), 2, null)).toBeNull();
    expect(movedGroup(list(), 7, null)).toBeNull();
  });
});

describe("what a list says besides the order", () => {
  test("is the same for a list in another order, in other folders and with another roster revision", () => {
    const base: MembersList = { ...list(), team_context: { schema_version: 1, revision: "a", self_id: 0, count: 7, primary_id: 0, chief_id: 0, inventory_state: "ready", room_member_ids: null, members: [{ id: 0, name: "拉", role: "", blurb: "" }, { id: 1, name: "一", role: "", blurb: "" }], apps: [], connected: 0 } };
    const moved = movedMember(base, 1, 2, 5)!;
    const other: MembersList = { ...moved.list, team_context: { ...base.team_context!, revision: "b", members: [...base.team_context!.members].reverse() } };
    expect(withoutPlaces(other)).toBe(withoutPlaces(base));
  });

  test("differs for a name, a preview, a pin and a change of apps", () => {
    const base = list();
    for (const change of [{ name: "新名字" }, { preview: "新的一行" }, { pinned: true }, { unread: true }]) {
      const next = list();
      Object.assign(next.members[2], change);
      expect(withoutPlaces(next)).not.toBe(withoutPlaces(base));
    }
    const renamed = list();
    renamed.groups[0].name = "改名";
    expect(withoutPlaces(renamed)).not.toBe(withoutPlaces(base));
    const grown = list();
    grown.members.push(member(7, null, 6));
    expect(withoutPlaces(grown)).not.toBe(withoutPlaces(base));
  });
});
