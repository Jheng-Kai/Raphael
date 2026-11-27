// @vitest-environment happy-dom
// Raphael is not one of the owner's slimes: id 0 is the app's guide and keeper, with its own fixed name and look, and the
// sidebar lists slimes only. The chief of staff is the first slime's role (a real member), and there may be none.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
vi.mock("./group-chats", () => ({ createRoomsSection: () => document.createElement("section"), openNewGroupChat: vi.fn() }));
import { crownPrimary, crownedId } from "./crown";
import { columnHTML, memberRowHTML } from "./member-column";
import { setLocale } from "./i18n";
import { faceHTML, memberMatches, memberOf, memberRole, memberSections, memberSlime, orderedMembers, pinReplacements, primaryIdOf, raphaelOf } from "./members";
import { mentionTargets } from "./team-mentions";
import { RAPHAEL_SLIME, raphaelName } from "./raphael";
import { setAvatar } from "./avatar";
import type { Member, MembersList } from "./types";

const member = (id: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});
const RAPHAEL = member(0, { name: "拉斐爾", position: -1, raphael: true, chief: false });
const SLIMES = [member(3, { name: "日文老師", role: "N2", group_id: 20 }), member(4, { name: "行程管家" }), member(5, { name: "文書", group_id: 20 })];
const roster = (primary: number | null | undefined, slimes = SLIMES): MembersList => ({
  members: [RAPHAEL, ...slimes.map(m => ({ ...m, chief: m.id === primary }))],
  groups: [{ id: 20, name: "學習", position: 0, sources: [] }],
  ...(primary === undefined ? {} : { team_context: { primary_id: primary, chief_id: primary, members: slimes.map(m => ({ id: m.id, name: m.name, role: m.role, blurb: "" })) } as unknown as MembersList["team_context"] }),
});
const dom = (html: string): HTMLElement => { const el = document.createElement("div"); el.innerHTML = html; return el; };
const view = (list: MembersList | null) => ({ list, current: 0, previews: new Map<number, string>(), folded: new Set<number>(), fresh: new Set<number>() });
const rows = (el: HTMLElement): number[] => [...el.querySelectorAll<HTMLElement>("[data-member]")].map(row => Number(row.dataset.member));

beforeEach(() => { setLocale("zh-TW"); crownPrimary({ members: [], team_context: null }); });
afterEach(() => { setAvatar(null); setLocale("zh-TW"); });

describe("the chief of staff is a slime or nobody", () => {
  test("the primary is the chief slime's id, and null for no roster, no slime, Raphael or someone the list lacks", () => {
    expect(primaryIdOf(null)).toBeNull();
    expect(primaryIdOf(roster(undefined))).toBeNull();
    expect(primaryIdOf(roster(null))).toBeNull();
    expect(primaryIdOf(roster(0))).toBeNull();
    expect(primaryIdOf(roster(99))).toBeNull();
    expect(primaryIdOf(roster(4))).toBe(4);
    expect(primaryIdOf({ members: [RAPHAEL], groups: [], team_context: { primary_id: null } as unknown as MembersList["team_context"] })).toBeNull();
  });

  test("the crown follows it: a slime's, never Raphael's, and nobody's when there is none", () => {
    crownPrimary(roster(4));
    expect(crownedId()).toBe(4);
    crownPrimary(roster(null));
    expect(crownedId()).toBeNull();
    crownPrimary(roster(0));
    expect(crownedId()).toBeNull();
    crownPrimary({ members: [{ id: 0 }], team_context: { primary_id: null } });
    expect(crownedId()).toBeNull();
  });

  test("its label is the role the core flagged, and Raphael has none", () => {
    expect(memberRole({ id: 4, role: "Research", chief: true })).toBe("幕僚長");
    expect(memberRole({ id: 4, role: "Research" })).toBe("Research");
    expect(memberRole({ id: 0, role: "" })).toBe("");
    expect(memberMatches(RAPHAEL, "幕僚長")).toBe(false);
  });

  test("the pickers list slimes only, the chief first, and offer to replace a pinned tile with nobody it already is", () => {
    expect(orderedMembers(roster(4)).map(m => m.id)).toEqual([4, 3, 5]);
    expect(orderedMembers(roster(null)).map(m => m.id)).toEqual([3, 5, 4]);
    expect(orderedMembers(roster(undefined, [])).map(m => m.id)).toEqual([]);
    expect(orderedMembers(null)).toEqual([]);
    expect(memberSections(roster(4), "", 4).flatMap(section => section.members.map(m => m.id))).toEqual([3, 5]);
    expect(memberSections(roster(4)).flatMap(section => section.members.map(m => m.id))).not.toContain(0);
    expect(pinReplacements(roster(4)).map(m => m.id)).toEqual([3, 5]);
    expect(pinReplacements(roster(null)).map(m => m.id)).toEqual([3, 5, 4]);
  });
});

describe("the sidebar never lists Raphael", () => {
  test("the chief leads as the one crowned row and the others follow in their folders", () => {
    crownPrimary(roster(4));
    const el = dom(columnHTML(view(roster(4))));
    expect(rows(el)).toEqual([4, 3, 5]);
    expect(el.querySelector(".mb-chief")?.getAttribute("data-member")).toBe("4");
    expect(el.querySelector('.mb-chief .slime-crown')).not.toBeNull();
    expect(el.querySelector('[data-member="0"], [data-member-more="0"], [data-member-item="0"]')).toBeNull();
  });

  test("a Raphael the list calls pinned or hidden is still not a row, a tile or a folder entry", () => {
    const list = roster(4);
    list.members[0] = { ...RAPHAEL, pinned: true, hidden: true };
    const el = dom(columnHTML(view(list)));
    expect(el.querySelector('[data-member="0"]')).toBeNull();
    expect(el.querySelector(".mb-pinned")).toBeNull();
    expect(el.querySelector(".mb-hidden")?.hasAttribute("data-empty")).toBe(true);
  });

  test("with no chief nobody leads and no row wears a crown, and with no slime the column is empty", () => {
    const el = dom(columnHTML(view(roster(null))));
    expect(el.querySelector(".mb-chief")).toBeNull();
    expect(rows(el)).toEqual([3, 5, 4]);
    expect(el.querySelector(".slime-crown")).toBeNull();
    const empty = dom(columnHTML(view(roster(null, []))));
    expect(rows(empty)).toEqual([]);
    expect(rows(dom(columnHTML(view(null))))).toEqual([]);
  });

  test("a row is a slime's: the chief's has no quick-ask conversation list or other member-0 mark", () => {
    const row = dom(memberRowHTML(SLIMES[1], { ...view(roster(4)) }));
    expect(row.querySelector('[data-member="4"]')).not.toBeNull();
    expect(row.querySelector("[data-slot=conversations]")).toBeNull();
  });
});

describe("Raphael's own name and face", () => {
  test("it is called the language's Raphael name, whatever the list says", () => {
    expect(raphaelName()).toBe("拉斐爾");
    setLocale("en");
    expect(raphaelName()).toBe("Raphael");
    expect(raphaelOf(null).name).toBe("Raphael");
    expect(memberOf(null, 0)?.name).toBe("Raphael");
    expect(memberOf(roster(4), 0)?.raphael).toBe(true);
  });

  test("its face is the first blue slime, never a picture, the owner's photo or a slime it was dressed in", () => {
    setAvatar({ url: "data:image/png;base64,AAAA", crop: { x: 0, y: 0, zoom: 1 } });
    for (const raphael of [{ id: 0, name: "" }, { id: 0, name: "x", avatar: "slime:horns-red" }, { id: 0, name: "x", avatar: "file:me.png", avatar_url: "data:image/png;base64,AAAA" }]) {
      const html = faceHTML(raphael, 40);
      expect(html).toContain("mb-av-slime");
      expect(html).toContain("#3DB5FF");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("av-custom");
    }
    expect(memberSlime({ id: 0, avatar: "slime:horns-red" })).toBe(RAPHAEL_SLIME);
    expect(memberSlime({ id: 4, avatar: "slime:horns-red" })).toBe("slime:horns-red");
  });
});

describe("@-mentions keep Raphael by its names", () => {
  test("it is an address beside the slimes though the team's roster lists slimes only, after them", () => {
    const targets = mentionTargets(roster(4)).filter(target => target.kind === "member");
    expect(targets.map(target => target.id)).toEqual([4, 3, 5, 0]);
    expect(targets.find(target => target.id === 0)?.aliases).toEqual(expect.arrayContaining(["拉斐爾", "Raphael"]));
    expect(mentionTargets(roster(undefined, [])).filter(target => target.kind === "member").map(target => target.id)).toEqual([0]);
    // A room's members are the slimes it names: Raphael is not one.
    expect(mentionTargets(roster(4), [4, 3]).filter(target => target.kind === "member").map(target => target.id)).toEqual([4, 3]);
  });
});
