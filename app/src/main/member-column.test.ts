// @vitest-environment happy-dom
// The member column (member-column.ts): Raphael at the top, the groups and 未分組, the search, and
// how a row shows a question that waits and a thread with news.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type ColumnHost, columnHTML, createMemberColumn, memberRowHTML } from "./member-column";
import { openNewGroupChat } from "./group-chats";
import { installContextMenus } from "./context-menu";
import { setLocale, t } from "./i18n";
import { closeMenu } from "./ui";
vi.mock("./group-chats", () => ({ createRoomsSection: () => document.createElement("section"), openNewGroupChat: vi.fn() }));
import type { Member, MembersList } from "./types";

const member = (id: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});

const LIST: MembersList = {
  members: [
    member(0, { name: "拉斐爾" }),
    member(1, { name: "進度官", role: "Raphael 專案", group_id: 10 }),
    member(2, { name: "文書", role: "資料整理", group_id: 10, waiting: true, preview: "移動 12 個檔案" }),
    member(3, { name: "日文老師", role: "N2 嚴格版", group_id: 20 }),
    member(4, { name: "行程管家", role: "信箱與行事曆", unread: true }),
  ],
  groups: [
    { id: 10, name: "專案", position: 0, sources: [] },
    { id: 20, name: "學習", position: 1, sources: [] },
  ],
};
const previews = new Map([[1, "PR #17 已開"], [2, "移動 12 個檔案"], [3, "今天的 10 題單字已送出"], [4, "明天 10:00 有會議"]]);
const view = (over: Partial<Parameters<typeof columnHTML>[0]> = {}) => ({
  list: LIST, current: 0, previews, folded: new Set<number>(), fresh: new Set<number>(), ...over,
});
const dom = (html: string): HTMLElement => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
};

describe("the column, drawn", () => {
  test("remembering a conversation never selects it while another page is visible", () => {
    const el = dom(columnHTML(view({active:false})));
    expect(el.querySelector('[aria-current="true"]')).toBeNull();
    expect(dom(columnHTML(view({active:true}))).querySelector('[aria-current="true"]')?.getAttribute('data-member')).toBe('0');
  });
  test("rows show no time, whatever the last message's timestamp, as Grok Bot's", () => {
    for (const last_at of [new Date(2026, 9, 24, 13, 45).getTime(), null, NaN, 1e20]) expect(dom(memberRowHTML(member(1, { last_at }), view())).querySelector("time")).toBeNull();
  });

  test("Raphael leads the column as an ordinary row with his bare emblem", () => {
    const el = dom(columnHTML(view()));
    const chief = el.querySelector<HTMLElement>(".mb-chief")!;
    expect(el.firstElementChild?.querySelector(".mb-chief")).toBe(chief);
    expect(chief.classList.contains("mb-row")).toBe(true);
    expect(chief.querySelector(".mb-pin, time")).toBeNull();
    expect(chief.dataset.member).toBe("0");
    expect(chief.querySelector("b")?.textContent).toBe("拉斐爾");
    expect(chief.querySelector(".av")!.getAttribute("style")).toBe("--av:40px");
    expect(chief.innerHTML).not.toMatch(/管理員|mb-av|badge/);
    expect(chief.getAttribute("aria-current")).toBe("true");
  });

  test("the primary swaps with Raphael in its group, with default and missing choices unchanged", () => {
    const ids = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-member]")].map(row => Number(row.dataset.member));
    const roster = (primary_id: number): MembersList => ({ ...LIST, team_context: { primary_id } as MembersList["team_context"] });
    for (const primary of [0, 99]) expect(ids(dom(columnHTML(view({ list: roster(primary) }))))).toEqual([0, 1, 2, 3, 4]);
    const el = dom(columnHTML(view({ list: roster(3) })));
    expect(ids(el)).toEqual([3, 1, 2, 0, 4]);
    expect(el.querySelector('[data-group="20"] [data-member="0"] .av')).not.toBeNull();
    expect(el.querySelector('[data-group="20"] [data-member="0"] .mb-av')).toBeNull();
    expect(el.querySelector('[data-member-more="0"]')).not.toBeNull();
    expect(el.querySelector('.mb-chief')?.getAttribute('data-member')).toBe('3');
    expect(el.querySelector('.mb-chief .av')?.getAttribute('style')).toBe('--av:40px');
    expect(el.querySelector('[data-member-more="3"]')).not.toBeNull();
    expect(el.querySelector('.mb-star')).toBeNull();
    expect(LIST.members[3].group_id).toBe(20);
  });

  test("a pinned primary is a tile and Raphael takes its group slot", () => {
    const list = { ...LIST, members: LIST.members.map(m => m.id === 1 ? { ...m, pinned: true } : m), team_context: { primary_id: 1 } } as MembersList;
    const el = dom(columnHTML(view({ list })));
    expect(el.querySelector('.mb-pinned [data-member="1"]')).not.toBeNull();
    expect(el.querySelector('.mb-pinned [data-member="0"]')).toBeNull();
    expect(el.querySelector('.mb-chief')?.getAttribute('data-member')).toBe('1');
    expect(el.querySelectorAll('[data-member="0"]')).toHaveLength(1);
    expect(el.querySelector('[data-member="0"] .mb-av')).toBeNull();
  });

  test("only owner-created groups have headers, followed by ungrouped rows", () => {
    const el = dom(columnHTML(view()));
    expect([...el.querySelectorAll(".mb-gname")].map((n) => n.textContent)).toEqual(["專案", "學習"]);
    const ids = (group: string) => [...el.querySelectorAll(`[data-group="${group}"] .mb-row`)].map((n) => (n as HTMLElement).dataset.member);
    expect(ids("10")).toEqual(["1", "2"]);
    expect(ids("20")).toEqual(["3"]);
    expect(ids("none")).toEqual(["4"]);
    // 未分組 has no menu, the groups have one
    expect(el.querySelector('[data-group="none"] [data-group-more]')).toBeNull();
    expect(el.querySelector('[data-group="10"] [data-group-more]')).not.toBeNull();
  });

  test("a row: the picture, the name, the reserved time and the last line", () => {
    const row = dom(columnHTML(view())).querySelector<HTMLElement>('[data-member="1"]')!;
    expect(row.querySelector(".mb-row-t b")!.textContent).toBe("進度官");
    expect(row.querySelector(".mb-row-t i")).toBeNull();
    expect(row.querySelector(".mb-row-p")!.textContent).toBe("PR #17 已開");
    expect(row.querySelector(".mb-row-p")!.classList.contains("is-wait")).toBe(false);
    expect(row.querySelector(".mb-dot")).toBeNull();
    expect(row.querySelector(".mb-av-slime svg.slime")).not.toBeNull();
  });

  test("a question that waits: the line in gold, 「等你處理：…」, and a gold dot", () => {
    const row = dom(columnHTML(view())).querySelector<HTMLElement>('[data-member="2"]')!;
    const line = row.querySelector(".mb-row-p")!;
    expect(line.textContent).toBe("等你處理：移動 12 個檔案");
    expect(line.classList.contains("is-wait")).toBe(true);
    expect(row.querySelector(".mb-dot.is-wait")!.getAttribute("aria-label")).toBe("等你處理");
  });

  test("a thread with news: a dot of the accent", () => {
    const row = dom(columnHTML(view())).querySelector<HTMLElement>('[data-member="4"]')!;
    expect(row.querySelector(".mb-dot.is-unread")!.getAttribute("aria-label")).toBe("有新訊息");
    expect(row.querySelector(".mb-row-p")!.classList.contains("is-wait")).toBe(false);
  });

  test("the open member's row is the current one; a new member's row fades in", () => {
    const el = dom(columnHTML(view({ current: 3, fresh: new Set([3]) })));
    expect(el.querySelector('[data-member="3"]')!.getAttribute("aria-current")).toBe("true");
    expect(el.querySelector('[data-member="0"]')!.getAttribute("aria-current")).toBe("false");
    expect(el.querySelector('[data-member-item="3"]')!.classList.contains("is-new")).toBe(true);
    expect(el.querySelector('[data-member-item="1"]')!.classList.contains("is-new")).toBe(false);
  });

  test("a folded group keeps its header, its body folded and out of the keyboard's way", () => {
    const el = dom(columnHTML(view({ folded: new Set([10]) })));
    const section = el.querySelector<HTMLElement>('[data-group="10"]')!;
    expect(section.dataset.open).toBe("false");
    expect(section.querySelector(".mb-gbody")!.hasAttribute("inert")).toBe(true);
    expect(section.querySelector("[data-group-fold]")!.getAttribute("aria-expanded")).toBe("false");
  });

});

describe("the column, used", () => {
  let host: ColumnHost & Record<string, ReturnType<typeof vi.fn>>;
  let stopContextMenus: () => void;
  beforeEach(() => {
    stopContextMenus = installContextMenus(document);
    document.body.innerHTML = "";
    localStorage.clear();
    host = {
      view: () => ({ list: LIST, current: 0, previews, fresh: new Set() }),
      select: vi.fn(), newMember: vi.fn(), newGroup: vi.fn(), moveMember: vi.fn(), deleteMember: vi.fn(),
      renameGroup: vi.fn(), editSources: vi.fn(), deleteGroup: vi.fn(), memberAction: vi.fn(),
    } as never;
  });
  afterEach(() => stopContextMenus());
  const mount = () => {
    const column = createMemberColumn(host);
    document.body.append(column.el);
    column.draw();
    return column;
  };

  test("a folder folded in the list stays folded in the rail", () => {
    localStorage.setItem("raphael.sidebar.folders", "[10]");
    document.documentElement.setAttribute("data-sidebar-collapsed", "");
    const column = mount();
    document.documentElement.removeAttribute("data-sidebar-collapsed");
    const folder = column.el.querySelector<HTMLElement>('.mb-sec[data-group="10"]')!;
    expect(folder.dataset.open).toBe("false");
    expect(folder.querySelector(".mb-gbody")!.hasAttribute("inert")).toBe(true);
    expect(column.el.querySelector<HTMLElement>('.mb-sec[data-group="20"]')!.dataset.open).toBe("true");
  });

  test("a click on a row opens that member's thread", () => {
    const column = mount();
    column.el.querySelector<HTMLElement>('[data-member="3"] .mb-row-t')!.click();
    expect(host.select).toHaveBeenCalledWith(3);
    column.el.querySelector<HTMLElement>(".mb-chief")!.click();
    expect(host.select).toHaveBeenLastCalledWith(0);
  });

  test("search and plus stand side by side at the top, and search opens a card of every member with 新增成員 at its foot", () => {
    const column = mount();
    expect([...column.el.querySelectorAll(".mb-top [data-col]")].map(button => button.getAttribute("data-col"))).toEqual(["search", "add"]);
    expect(column.el.querySelector("input")).toBeNull();
    column.el.querySelector<HTMLElement>('[data-col="search"]')!.click();
    const card = document.querySelector<HTMLElement>("#app-popover.side-search")!;
    const input = card.querySelector<HTMLInputElement>(".side-search-input")!;
    expect(document.activeElement).toBe(input);
    const rows = () => [...card.querySelectorAll<HTMLElement>(".side-search-row")].map(row => row.dataset.member);
    expect(rows()).toEqual(["0", "1", "2", "3", "4"]);
    expect(card.querySelector('[data-member="1"] .side-search-main span')!.textContent).toBe("PR #17 已開");
    input.value = "信箱"; input.dispatchEvent(new Event("input"));
    expect(rows()).toEqual(["4"]);
    input.value = "沒有這個人"; input.dispatchEvent(new Event("input"));
    expect(card.querySelector(".mb-none")!.textContent).toBe("沒有相符的成員");
    input.value = "老師"; input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(host.select).toHaveBeenCalledWith(3);
    expect(document.getElementById("app-popover")).toBeNull();
    column.el.querySelector<HTMLElement>('[data-col="search"]')!.click();
    document.querySelector<HTMLElement>("#app-popover [data-search-new]")!.click();
    expect(host.newMember).toHaveBeenCalledWith(null);
    expect(document.getElementById("app-popover")).toBeNull();
  });

  test("the persistent plus tooltip follows language changes with its accessible label", () => {
    const column = mount();
    try {
      for (const locale of ["en", "ja", "zh-TW"]) {
        setLocale(locale); column.draw();
        const add = column.el.querySelector<HTMLElement>('[data-col="add"]')!;
        expect(add.title).toBe(t("members.add"));
        expect(add.getAttribute("aria-label")).toBe(add.title);
      }
    } finally { setLocale("zh-TW"); }
  });

  test("the search card from Ctrl+Shift+F opens a member, closes, and closes the drawer behind it", () => {
    const column = mount(), anchor = document.createElement("button"), drawer = vi.fn();
    window.addEventListener("raphael:close-sidebar", drawer);
    try {
      document.body.append(anchor); column.openSearch(anchor);
      expect(document.activeElement).toBe(document.querySelector("#app-popover input"));
      document.querySelector<HTMLButtonElement>('#app-popover [data-member="3"]')!.click();
      expect(host.select).toHaveBeenCalledWith(3);
      expect(document.getElementById("app-popover")).toBeNull();
      expect(drawer).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("raphael:close-sidebar", drawer); }
  });

  test("＋ offers 新增成員 and 新增分組", () => {
    const column = mount();
    column.el.querySelector<HTMLElement>('[data-col="add"]')!.click();
    const items = [...document.querySelectorAll<HTMLElement>("#app-popover [data-pick]")];
    expect(items.map(b => b.dataset.pick)).toEqual(["member", "group", "group-chat", "member-store"]);
    items[0].click();
    expect(host.newMember).toHaveBeenCalled();
  });

  test("the plus menu retains group creation and opens the shared group chat creator", () => {
    const column = mount();
    column.el.querySelector<HTMLElement>('[data-col="add"]')!.click();
    document.querySelector<HTMLElement>('#app-popover [data-pick="group"]')!.click();
    expect(host.newGroup).toHaveBeenCalled();
    column.el.querySelector<HTMLElement>('[data-col="add"]')!.click();
    document.querySelector<HTMLElement>('#app-popover [data-pick="group-chat"]')!.click();
    expect(openNewGroupChat).toHaveBeenCalled();
  });

  test("a row's menu is grouped as Grok's, ending with 刪除, and a right click gives the same", () => {
    const column = mount();
    column.el.querySelector<HTMLElement>('[data-member-more="2"]')!.click();
    const menu = document.querySelector<HTMLElement>("#app-popover")!;
    expect([...menu.children].map(node => node.matches('[role="separator"]') ? "|" : (node as HTMLElement).dataset.pick)).toEqual(["pin", "move", "unread", "|", "edit", "|", "export-template", "|", "hide", "delete"]);
    expect(menu.querySelector('[data-pick="delete"]')!.classList.contains("danger")).toBe(true);
    column.el.querySelector<HTMLElement>('[data-member-more="2"]')!.click();
    document.querySelector<HTMLElement>('#app-popover [data-pick="delete"]')!.click();
    expect(host.deleteMember).toHaveBeenCalledWith(2);
    column.el.querySelector<HTMLElement>('[data-member-more="2"]')!.click();
    document.querySelector<HTMLElement>('#app-popover [data-pick="hide"]')!.click();
    expect(host.memberAction).toHaveBeenCalledWith(2, "hide");
    column.el.querySelector('[data-member="1"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 50 }));
    document.querySelector<HTMLElement>('#app-popover [data-pick="move"]')!.click();
    expect(host.moveMember).toHaveBeenCalledWith(1, null, document.querySelector('#app-popover [data-pick="move"]'));
  });

  test("only the primary's menu hands the primary on, with 換成其他成員 last, and the primary cannot be deleted or moved from it", () => {
    const shape = () => [...document.querySelector("#app-popover")!.children].map(node => node.matches('[role="separator"]') ? "|" : (node as HTMLElement).dataset.pick);
    let column = mount();
    column.el.querySelector<HTMLElement>('[data-member-more="0"]')!.click();
    expect(shape()).toEqual(["pin", "|", "primary"]);
    expect(document.querySelector('#app-popover [data-pick="primary"]')!.textContent).toBe("換成其他成員");
    document.querySelector<HTMLElement>('#app-popover [data-pick="primary"]')!.click();
    expect(host.memberAction).toHaveBeenCalledWith(0, "primary");
    column.el.remove();
    host.view = () => ({ list: { ...LIST, team_context: { primary_id: 1 } } as MembersList, current: 0, previews, fresh: new Set() });
    column = mount();
    column.el.querySelector<HTMLElement>('[data-member-more="1"]')!.click();
    expect(shape()).toEqual(["pin", "unread", "|", "edit", "|", "export-template", "|", "hide", "primary"]);
    closeMenu();
    column.el.querySelector<HTMLElement>('[data-member-more="0"]')!.click();
    expect(shape()).toEqual(["pin"]);
    closeMenu();
    column.el.querySelector<HTMLElement>('[data-member-more="2"]')!.click();
    expect(shape()).not.toContain("primary");
  });

  test("a group's menu gives 重新命名, 看的地方 and 刪除", () => {
    const column = mount();
    column.el.querySelector<HTMLElement>('[data-group-more="10"]')!.click();
    expect([...document.querySelectorAll("#app-popover [data-pick]")].map((b) => b.textContent)).toEqual(["重新命名", "看的地方", "刪除"]);
    document.querySelector<HTMLElement>('#app-popover [data-pick="rename"]')!.click();
    expect(host.renameGroup).toHaveBeenCalledWith(10);
  });

  test("a group folds and opens where it is", () => {
    const column = mount();
    const fold = column.el.querySelector<HTMLElement>('[data-group-fold="10"]')!;
    fold.click();
    expect(column.el.querySelector<HTMLElement>('[data-group="10"]')!.dataset.open).toBe("false");
    column.draw();
    expect(column.el.querySelector<HTMLElement>('[data-group="10"]')!.dataset.open).toBe("false");
    column.el.querySelector<HTMLElement>('[data-group-fold="10"]')!.click();
    expect(column.el.querySelector<HTMLElement>('[data-group="10"]')!.dataset.open).toBe("true");
  });

  test("the whole group heading folds except its menu and a completed drag", () => {
    const column = mount();
    const section = column.el.querySelector<HTMLElement>('[data-group="10"]')!;
    const name = section.querySelector<HTMLElement>('.mb-gname')!;
    name.click(); expect(section.dataset.open).toBe('false');
    section.querySelector<HTMLElement>('[data-group-more]')!.click();
    expect(section.dataset.open).toBe('false');
    document.querySelector<HTMLElement>('#app-popover [data-pick=rename]')!.click();
    name.click(); expect(section.dataset.open).toBe('true');
    name.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    name.dispatchEvent(new Event('dragend', { bubbles: true }));
    name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); expect(section.dataset.open).toBe('true');
    name.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    name.dispatchEvent(new Event('dragend', { bubbles: true }));
    section.querySelector<HTMLElement>('[data-group-fold]')!.click(); expect(section.dataset.open).toBe('false');
  });

  test("member drops and folder reorder use the shared persistence callbacks", () => {
    const column = mount();
    host.dropMember = vi.fn().mockResolvedValue(undefined);
    host.reorderGroup = vi.fn().mockResolvedValue(undefined);
    const drag = (source: string, destination: string): void => {
      column.el.querySelector(source)!.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
      column.el.querySelector(destination)!.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    };
    drag('[data-member-item="3"]', '[data-group="10"] [data-member-item="1"]');
    expect(host.dropMember).toHaveBeenCalledWith(3, 10, 1);
    drag('[data-group="20"] .mb-gname', '[data-group="10"] .mb-gname');
    expect(host.reorderGroup).toHaveBeenCalledWith(20, 10);
  });
});
