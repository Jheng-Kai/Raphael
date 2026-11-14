// @vitest-environment happy-dom
// The one light of a sidebar row (sidebar-light.ts): which dot a member, a group chat or a pinned face wears, and nothing
// for a member that is only thinking (owner, 2026-11-14).
import { afterEach, describe, expect, test, vi } from "vitest";
import { type Light, type LightSource, LIGHTS, lightClass, lightHTML, lightName, lightOf, strongest } from "./sidebar-light";
import { columnHTML } from "./member-column";
import { setLocale } from "./i18n";
import { stableMember } from "./members";
vi.mock("./group-chats", () => ({ createRoomsSection: () => document.createElement("section"), openNewGroupChat: vi.fn() }));
import type { Member, MembersList } from "./types";

afterEach(() => setLocale("zh-TW"));

describe("which light a row wears", () => {
  test("a member that is thinking or working has none, nothing new to read", () => {
    for (const activity of ["thinking", "working", "searching", "computer", "waiting", "idle"]) {
      expect(lightOf({ activity, unread: false, waiting: false }), activity).toBeNull();
    }
    expect(lightOf({})).toBeNull();
  });

  test("a message that has come is white, and it stays white while the member thinks again", () => {
    expect(lightOf({ unread: true, unread_kind: "message", activity: "idle" })).toBe("message");
    expect(lightOf({ unread: true, unread_kind: "message", activity: "thinking" })).toBe("message");
    // A core that does not say what the news is (an older one) still says there is some.
    expect(lightOf({ unread: true })).toBe("message");
  });

  test("a task or a routine that ended well is green", () => {
    expect(lightOf({ unread: true, unread_kind: "done", activity: "idle" })).toBe("done");
  });

  test("work that went wrong is red, from the news or from a run that failed unseen", () => {
    expect(lightOf({ unread: true, unread_kind: "failed" })).toBe("failed");
    expect(lightOf({ unread: false, activity: "error" })).toBe("failed");
  });

  test("a question or an approval that waits is orange and outranks everything", () => {
    expect(lightOf({ waiting: true })).toBe("waiting");
    expect(lightOf({ activity: "blocked" })).toBe("waiting");
    for (const kind of ["message", "done", "failed"] as const) {
      expect(lightOf({ waiting: true, unread: true, unread_kind: kind, activity: "error" }), kind).toBe("waiting");
    }
  });

  test("the order is waiting, failed, done, message", () => {
    expect(LIGHTS).toEqual(["waiting", "failed", "done", "message"]);
    expect(strongest(["message", "done"])).toBe("done");
    expect(strongest(["message", null, "failed", "done"])).toBe("failed");
    expect(strongest(["message", "waiting", "failed"])).toBe("waiting");
    expect(strongest([null, null])).toBeNull();
    expect(strongest([])).toBeNull();
  });

  test("opening the conversation reads white, green and red, and an orange question stays while it waits", () => {
    const rows: LightSource[] = [
      { unread: true, unread_kind: "message" },
      { unread: true, unread_kind: "done" },
      { unread: true, unread_kind: "failed" },
      { activity: "error" },
      { unread: true, unread_kind: "done", activity: "thinking" },
    ];
    for (const row of rows) expect(lightOf(row, true), JSON.stringify(row)).toBeNull();
    expect(lightOf({ waiting: true, unread: true, unread_kind: "failed" }, true)).toBe("waiting");
    expect(lightOf({ activity: "blocked" }, true)).toBe("waiting");
  });
});

describe("the dot, drawn", () => {
  const html = (light: Light | null): HTMLElement => {
    const host = document.createElement("div");
    host.innerHTML = lightHTML(light);
    return host;
  };

  test("no light draws nothing", () => {
    expect(lightHTML(null)).toBe("");
  });

  test("each light is one still dot that names itself and keeps the class its colour is set by", () => {
    const names = { waiting: "等你處理", failed: "需要你看一下", done: "已完成", message: "有新訊息" } as const;
    const classes = { waiting: "is-wait", failed: "is-failed", done: "is-done", message: "is-unread" } as const;
    for (const light of LIGHTS) {
      const dot = html(light).querySelector<HTMLElement>(".mb-dot")!;
      expect(dot.getAttribute("role"), light).toBe("img");
      expect(dot.getAttribute("aria-label"), light).toBe(names[light]);
      expect(dot.classList.contains(classes[light]), light).toBe(true);
      expect(lightClass(light)).toBe(classes[light]);
      expect(dot.dataset.light).toBe(light);
      expect(dot.hasAttribute("title"), "a tooltip would only repeat the name").toBe(false);
      expect(dot.children).toHaveLength(0);
    }
  });

  test("the names are in the language of the window", () => {
    setLocale("en");
    expect(LIGHTS.map(lightName)).toEqual(["Waiting for you", "Needs a look", "Finished", "New messages"]);
  });

  const member = (id: number, more: Partial<Member> = {}): Member => ({
    id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
  });
  const LIST: MembersList = {
    members: [
      member(0, { name: "拉斐爾" }),
      member(1, { name: "思考中", activity: "thinking" }),
      member(2, { name: "回覆了", unread: true, unread_kind: "message", preview: "好了" }),
      member(3, { name: "做完了", unread: true, unread_kind: "done" }),
      member(4, { name: "失敗了", unread: true, unread_kind: "failed" }),
      member(5, { name: "等你", waiting: true, unread: true, unread_kind: "message" }),
      member(6, { name: "釘選的", pinned: true, unread: true, unread_kind: "done" }),
    ],
    groups: [],
  };
  const column = (current = 0): HTMLElement => {
    const el = document.createElement("div");
    el.innerHTML = columnHTML({ list: LIST, current, previews: new Map(), folded: new Set(), fresh: new Set() });
    return el;
  };
  const dot = (el: HTMLElement, id: number): string | null =>
    el.querySelector<HTMLElement>(`[data-member="${id}"] .mb-dot`)?.dataset.light ?? null;

  test("a thinking member's row has no dot, the others have the light they earn, and a pinned face has the same one", () => {
    const el = column();
    expect(dot(el, 1)).toBeNull();
    expect([2, 3, 4, 5, 6].map((id) => dot(el, id))).toEqual(["message", "done", "failed", "waiting", "done"]);
    expect(el.querySelector('.mb-tile[data-member="6"] .mb-dot.is-done')).not.toBeNull();
    for (const id of [0, 1]) expect(el.querySelectorAll(`[data-member="${id}"] .mb-dot`)).toHaveLength(0);
    for (const row of el.querySelectorAll(".mb-row")) expect(row.querySelectorAll(".mb-dot").length).toBeLessThanOrEqual(1);
  });

  test("the row of the open conversation keeps only a waiting question's dot", () => {
    for (const id of [2, 3, 4]) expect(dot(column(id), id), String(id)).toBeNull();
    expect(dot(column(5), 5)).toBe("waiting");
    // A page that is not the conversation reads nothing.
    const el = document.createElement("div");
    el.innerHTML = columnHTML({ list: LIST, current: 2, active: false, previews: new Map(), folded: new Set(), fresh: new Set() });
    expect(dot(el, 2)).toBe("message");
  });

  test("what changes with the news never draws the panel again", () => {
    const a = stableMember({ ...member(2), unread: true, unread_kind: "message" as const });
    const b = stableMember({ ...member(2), unread: false, unread_kind: "done" as const });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
