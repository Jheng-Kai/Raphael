// @vitest-environment happy-dom
// The member settings page (member-settings.ts): a cover, the face across it, the name and role in place, and one tinted
// list per section. Every member has the same kinds, Raphael too: memory, tools, skills and commands, personality and
// instructions, notifications (owner, 2026-11-09). Long texts are one line until pressed, and every change is a call the
// panel and the old dialog already made.
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppContext, Member, MemberPatch, MembersList } from "./types";

const api = vi.hoisted(() => ({
  core: vi.fn(),
  membersSkillsList: vi.fn(),
  membersSkillsRead: vi.fn(),
  membersSkillsUpdate: vi.fn(),
  membersSkillsImport: vi.fn(),
  membersSkillsDelete: vi.fn(),
  membersCommandsList: vi.fn(),
  membersCommandsSave: vi.fn(),
  membersCommandsDelete: vi.fn(),
  membersVoices: vi.fn(),
  membersToolChoices: vi.fn(),
  membersSetAvatar: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  avatarPick: vi.fn(),
}));
vi.mock("./api", () => api);

import { createMemberSettings, type MemberSettings } from "./member-settings";
import { setLocale, t } from "./i18n";

const member = (id: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});
const LIST: MembersList = {
  members: [member(0, { name: "拉斐爾" }), member(3, { name: "日文老師", role: "N2 嚴格版", group_id: 20, instructions: "每天出 10 題\n第二行", personality: "嚴厲但耐心" }), member(4, { name: "行程管家" })],
  groups: [{ id: 20, name: "學習", position: 0, sources: [] }, { id: 21, name: "專案", position: 1, sources: [] }],
};
const SKILLS = [
  { id: 1, member_id: 3, name: "research-summary", description: "整理來源", enabled: true, source: "learned", provenance: "learned", learned_at: "2026-10-29T10:00:00" },
  { id: 2, member_id: -1, name: "shared-skill", description: "", enabled: false, source: "local:C:/x/skill", shared: true },
];
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

let current = 3;
let list = LIST;
let host: { update: Mock<(id: number, patch: MemberPatch) => Promise<boolean>>; back: Mock<() => void>; refreshList: Mock<() => void> };
let page: MemberSettings;

async function open(id = 3): Promise<HTMLElement> {
  current = id;
  host = { update: vi.fn(async (_id: number, _patch: MemberPatch) => true), back: vi.fn<() => void>(), refreshList: vi.fn<() => void>() };
  page = createMemberSettings({
    app: { onEvent: vi.fn() } as unknown as AppContext,
    member: () => list.members.find((m) => m.id === current)!,
    list: () => list,
    update: host.update,
    refreshList: host.refreshList,
    back: host.back,
  });
  document.body.append(page.el);
  page.open();
  await flush();
  return page.el;
}
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => page.el.querySelector<T>(selector)!;
const press = async (selector: string): Promise<void> => { $(selector).click(); await flush(); };
const blur = (field: HTMLElement): void => { field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); };
/** Chooses a kind in the column on the left. */
const cat = (id: string): Promise<void> => press(`[data-ms="cat"][data-cat="${id}"]`);
const kinds = (): string[] => [...page.el.querySelectorAll<HTMLElement>('.ms-nav [data-ms="cat"]')].map((b) => b.dataset.cat!);
const sections = (): string[] => [...page.el.querySelectorAll<HTMLElement>(".ms-section[data-k]")].map((s) => s.dataset.k!);

beforeEach(() => {
  document.body.innerHTML = "";
  setLocale("zh-TW");
  current = 3;
  list = LIST;
  for (const fn of Object.values(api)) fn.mockReset();
  api.membersSkillsList.mockResolvedValue({ skills: SKILLS, undo: null });
  api.membersSkillsRead.mockResolvedValue({ skill: { ...SKILLS[0], revision: "h1" }, text: "---\nname: research-summary\n---\n整理來源。" });
  api.membersSkillsUpdate.mockResolvedValue({});
  api.membersSkillsImport.mockResolvedValue({ skill: SKILLS[0] });
  api.membersSkillsDelete.mockResolvedValue({});
  api.membersCommandsList.mockResolvedValue({ commands: [{ id: 5, name: "weekly", description: "每週整理", template: "整理本週：{input}" }] });
  api.membersCommandsSave.mockResolvedValue({});
  api.membersCommandsDelete.mockResolvedValue({});
  api.membersVoices.mockResolvedValue({ configured: true, voices: [{ id: "v1", name: "Helix" }, { id: "v2", name: "Nova" }] });
  api.membersToolChoices.mockResolvedValue({ tools: ["read_file"], connections: [{ id: "gmail", name: "Gmail", enabled: true }, { id: "notion", name: "Notion", enabled: true }, { id: "slack", name: "Slack", enabled: false }] });
  api.settingsGet.mockResolvedValue({ settings: { tts_fish_voice: "v2" } });
  api.settingsSet.mockImplementation(async (_key: string, value: string) => ({ settings: { tts_fish_voice: value } }));
  api.core.mockImplementation(async (method: string, params: { space?: string }) => {
    if (method === "memory.get" || method === "memory.update") {
      const shared = params?.space === "shared";
      return { text: shared ? "主人住台北\n" : "在背單字\n\n每週三複習\n", revision: "r1", chars: 9, entries: shared ? 1 : 2, limit: shared ? 1375 : 2200, summary: null };
    }
    return {};
  });
});

describe("the page of a member", () => {
  test("a cover, the face across its edge, the name and the role in place, then the kinds on the left and one kind shown", async () => {
    await open();
    expect(page.isOpen()).toBe(true);
    expect($(".ms-cover").dataset.pattern).toBe("dots");
    expect($('.ms-cover > [data-ms="cover"]').classList.contains("icon")).toBe(true);
    expect(page.el.style.getPropertyValue("--ms-tint")).not.toBe("");
    expect(page.el.getAttribute("aria-label")).toBe(t("computer.settings"));
    // The face is the button of the picture picker, with the same pencil as the panel's.
    const face = $(".ms-id > .mb-face-edit");
    expect(face.dataset.ms).toBe("avatar");
    expect(face.querySelector('.mb-face-pencil[aria-hidden="true"] svg.i')).not.toBeNull();
    expect($<HTMLInputElement>("#ms-name").value).toBe("日文老師");
    expect($<HTMLInputElement>("#ms-role").value).toBe("N2 嚴格版");
    // The kinds stand in a column on the left, in the owner's order (owner, 2026-11-09); the first is shown, and only it.
    expect(kinds()).toEqual(["memory", "tools", "skills", "soul", "notify"]);
    expect($('[data-cat="memory"]').getAttribute("aria-current")).toBe("page");
    await cat("soul");
    expect(sections()).toEqual(["ms-personality", "ms-instructions"]);
    for (const section of page.el.querySelectorAll(".ms-section[data-k]")) expect(section.querySelector(":scope > .ms-head > h2")!.textContent!.length, section.getAttribute("data-k")!).toBeGreaterThan(0);
    // What the panel beside the page shows is not here: routines and messaging. The model is chosen at the composer
    // alone, members have no voice, and the group is the sidebar's.
    expect(page.el.querySelector('[data-cat="routines"], [data-cat="messaging"], .member-msg, [data-cat="model"], [data-cat="voice"], [data-cat="general"], [data-slot="model"]')).toBeNull();
  });

  test("Raphael has the same kinds as every member, and only his name and role are not typed", async () => {
    await open(0);
    expect(page.el.querySelector("#ms-name, #ms-role")).toBeNull();
    expect($(".ms-name").textContent).toBe("拉斐爾");
    expect(page.el.style.getPropertyValue("--ms-tint")).toBe("var(--raphael-color)");
    expect(kinds()).toEqual(["memory", "tools", "skills", "soul", "notify"]);
    expect(api.membersToolChoices).toHaveBeenCalled();
    expect(api.membersSkillsList).toHaveBeenCalledWith(0);
    expect(api.membersCommandsList).toHaveBeenCalledWith(0);
    await cat("soul");
    await press('[data-ms="edit"][data-field="personality"]');
    const box = $<HTMLTextAreaElement>("#ms-personality");
    box.value = "沉著";
    blur(box); await flush();
    expect(host.update).toHaveBeenCalledWith(0, { personality: "沉著" });
    await cat("notify");
    await press('[data-ms="notify"]');
    expect(host.update).toHaveBeenLastCalledWith(0, { notify: true });
  });

  test("it holds no word-button where an icon says it, in any kind: edits are pencils, adds are pluses", async () => {
    await open();
    for (const kind of kinds()) {
      await cat(kind);
      for (const button of page.el.querySelectorAll<HTMLElement>(".ms-section button.btn")) {
        if (button.matches(".icon, .ms-open")) continue;
        throw new Error(`a text button in ${kind}: ${button.textContent}`);
      }
      expect([...page.el.querySelectorAll<HTMLElement>("button")].some(button => /^(編輯|Edit)$/.test(button.textContent ?? ""))).toBe(false);
      // The panel's old rows stay where the sidebar's menu has them: nothing hides a member from here.
      expect(page.el.textContent).not.toContain("從側欄隱藏");
    }
    await cat("soul");
    expect([...page.el.querySelectorAll<HTMLElement>('[data-ms="edit"]')].every(button => button.querySelector("svg.i") !== null)).toBe(true);
    await cat("skills");
    expect($('[data-ms="skill-add"]').classList.contains("icon")).toBe(true);
    expect($('[data-ms="command-add"]').classList.contains("icon")).toBe(true);
  });

  test("the cover's round button offers its patterns and a picture from this PC, and a pattern or no cover is one update", async () => {
    await open();
    await press('[data-ms="cover"]');
    const swatches = [...document.querySelectorAll<HTMLElement>("#app-popover .ms-swatch")];
    expect(swatches.map((swatch) => swatch.dataset.cover)).toEqual(["dots", "grid", "lines", "glow", "plain"]);
    expect(swatches[0]!.getAttribute("aria-checked")).toBe("true");
    expect(swatches.every((swatch) => (swatch.getAttribute("aria-label") ?? "").length > 0)).toBe(true);
    expect(document.querySelector('#app-popover [data-cover-act="upload"]')).not.toBeNull();
    expect(document.querySelector('#app-popover [data-cover-act="remove"]')).toBeNull();
    swatches[1]!.click();
    expect(host.update).toHaveBeenCalledWith(3, { cover: "pattern:grid" });
    // A picture is shown as the cover, and its menu can take it off.
    list = { ...LIST, members: LIST.members.map(m => m.id === 3 ? { ...m, cover: { kind: "image" as const, url: "data:image/png;base64,AAAA" } } : m) };
    page.draw();
    expect($(".ms-cover").dataset.pattern).toBe("image");
    expect($<HTMLImageElement>(".ms-cover > img.ms-cover-img").getAttribute("src")).toBe("data:image/png;base64,AAAA");
    await press('[data-ms="cover"]');
    document.querySelector<HTMLElement>('#app-popover [data-cover-act="remove"]')!.click();
    expect(host.update).toHaveBeenLastCalledWith(3, { cover: null });
  });

  // Owner, 2026-11-09: 「上方圖片要跟 Notion 類似 要可以上下調整圖片位置」.
  test("a cover picture is shown where the owner put it, and 調整位置 moves it with 取消 and 儲存位置", async () => {
    list = { ...LIST, members: LIST.members.map(m => m.id === 3 ? { ...m, cover: { kind: "image" as const, url: "data:image/png;base64,AAAA", position: 30 } } : m) };
    await open();
    expect($<HTMLImageElement>(".ms-cover-img").style.objectPosition).toBe("50% 30%");
    await press('[data-ms="cover"]');
    document.querySelector<HTMLElement>('#app-popover [data-cover-act="reposition"]')!.click();
    await flush();
    expect($(".ms-cover").hasAttribute("data-repositioning")).toBe(true);
    expect(page.el.querySelector('[data-ms="cover"]')).toBeNull();
    expect($('[data-ms="cover-save"]').textContent).toBe(t("memberSettings.savePosition"));
    // Nothing moved: saving changes nothing; Escape leaves the move, and the picture stays where it was.
    await press('[data-ms="cover-save"]');
    expect(host.update).not.toHaveBeenCalled();
    expect($(".ms-cover").hasAttribute("data-repositioning")).toBe(false);
    await press('[data-ms="cover"]');
    document.querySelector<HTMLElement>('#app-popover [data-cover-act="reposition"]')!.click();
    await flush();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect($(".ms-cover").hasAttribute("data-repositioning")).toBe(false);
    expect(host.back).not.toHaveBeenCalled();
    expect($<HTMLImageElement>(".ms-cover-img").style.objectPosition).toBe("50% 30%");
  });

  test("personality and instructions are one line each; a press opens the box in place and blur saves it", async () => {
    await open();
    await cat("soul");
    expect($('[data-ms="edit"][data-field="personality"]').textContent).toContain("嚴厲但耐心");
    // Only the first line of a long text is shown.
    expect($('[data-ms="edit"][data-field="instructions"]').textContent).toContain("每天出 10 題");
    expect($('[data-ms="edit"][data-field="instructions"]').textContent).not.toContain("第二行");
    expect(page.el.querySelector("textarea")).toBeNull();
    await press('[data-ms="edit"][data-field="personality"]');
    const box = $<HTMLTextAreaElement>("#ms-personality");
    expect(box.maxLength).toBe(2000);
    expect(document.activeElement).toBe(box);
    box.value = "  親切。\n直接稱呼你。  ";
    blur(box); await flush();
    expect(host.update).toHaveBeenCalledWith(3, { personality: "親切。\n直接稱呼你。" });
    // closed again after the save
    expect(page.el.querySelector("#ms-personality")).toBeNull();
    // unchanged text is not saved
    host.update.mockClear();
    await press('[data-ms="edit"][data-field="instructions"]');
    blur($("#ms-instructions")); await flush();
    expect(host.update).not.toHaveBeenCalled();
    await press('[data-ms="edit"][data-field="instructions"]');
    $<HTMLTextAreaElement>("#ms-instructions").value = "每天出 20 題";
    blur($("#ms-instructions")); await flush();
    expect(host.update).toHaveBeenCalledWith(3, { instructions: "每天出 20 題" });
  });

  test("an empty long field says 未填寫, stored text is escaped, and Escape in the box puts the old text back", async () => {
    list = { ...LIST, members: LIST.members.map(m => m.id === 3 ? { ...m, personality: "", instructions: "</textarea><script>x()</script>" } : m) };
    await open();
    await cat("soul");
    expect($('[data-ms="edit"][data-field="personality"] .ms-label').textContent).toBe(t("members.notSet"));
    expect(page.el.querySelector("script")).toBeNull();
    await press('[data-ms="edit"][data-field="instructions"]');
    const box = $<HTMLTextAreaElement>("#ms-instructions");
    expect(box.value).toBe("</textarea><script>x()</script>");
    box.value = "changed";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(box.value).toBe("</textarea><script>x()</script>");
    expect(host.back).not.toHaveBeenCalled();
  });

  test("the name saves on blur; a blank or a taken one goes back; the role saves too", async () => {
    await open();
    const name = $<HTMLInputElement>("#ms-name");
    name.value = "老師";
    blur(name); await flush();
    expect(host.update).toHaveBeenCalledWith(3, { name: "老師" });
    host.update.mockClear();
    name.value = "行程管家"; blur(name); await flush();
    name.value = " "; blur(name); await flush();
    expect(host.update).not.toHaveBeenCalled();
    expect(name.value).toBe("日文老師");
    const role = $<HTMLInputElement>("#ms-role");
    role.value = "N1 寬鬆版"; blur(role); await flush();
    expect(host.update).toHaveBeenCalledWith(3, { role: "N1 寬鬆版" });
  });

  test("a focused name keeps its draft and caret while the remote role updates", async () => {
    await open();
    const name = $<HTMLInputElement>("#ms-name");
    name.focus(); name.value = "Draft name"; name.setSelectionRange(2, 4);
    list = { ...LIST, members: LIST.members.map(m => m.id === 3 ? { ...m, role: "New remote role" } : m) };
    page.draw();
    expect($<HTMLInputElement>("#ms-role").value).toBe("New remote role");
    expect(document.activeElement).toBe(name);
    expect(name.value).toBe("Draft name");
    expect(name.selectionStart).toBe(2);
  });

  test("the draft switch stands under the apps in 工具 and writes draft_first, Raphael's too", async () => {
    await open();
    await cat("tools");
    const draft = $('[data-k="ms-draft"] [data-ms="draft"]');
    expect(draft.getAttribute("aria-checked")).toBe("true");
    draft.click();
    expect(host.update).toHaveBeenLastCalledWith(3, { draft_first: false });
    page.close();
    await open(0);
    await cat("tools");
    await press('[data-ms="draft"]');
    expect(host.update).toHaveBeenCalledWith(0, { draft_first: false });
  });
});

describe("the memory", () => {
  // Owner, 2026-11-09: 「個別角色不用顯示共同記憶 共同記憶只需要顯示在設定即可」.
  test("is the first kind, read as the page opens, and shows the member's own memory alone, as cards", async () => {
    await open();
    expect(page.el.dataset.view).toBe("main");
    expect(api.core).toHaveBeenCalledWith("memory.get", { space: "own", member_id: 3 });
    expect(api.core).not.toHaveBeenCalledWith("memory.get", { space: "shared" });
    const documents = [...page.el.querySelectorAll<HTMLElement>("[data-mem-section]")];
    expect(documents.map((s) => [s.dataset.memSpace, s.getAttribute("aria-label")])).toEqual([["own", "日文老師的記憶"]]);
    expect(documents[0]!.querySelectorAll("details.mem-entry")).toHaveLength(2);
    expect(documents[0]!.textContent).toContain("在背單字");
    // The edit is a pencil here too.
    const edit = documents[0]!.querySelector<HTMLElement>('[data-mem="edit"]')!;
    expect(edit.classList.contains("icon")).toBe(true);
    expect(edit.textContent).toBe("");
    edit.click();
    const box = $<HTMLTextAreaElement>('[data-mem-space="own"] textarea.mem-body');
    expect(box.value).toBe("在背單字\n\n每週三複習");
    box.value = "在背單字";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    $<HTMLElement>('[data-mem-space="own"] [data-mem="save"]').click();
    await flush();
    expect(api.core).toHaveBeenCalledWith("memory.update", { space: "own", member_id: 3, text: "在背單字", revision: "r1" });
    expect($('[data-cat="memory"]').getAttribute("aria-current")).toBe("page");
  });

  test("Raphael's own memory is his, and only it", async () => {
    await open(0);
    expect(api.core).toHaveBeenCalledWith("memory.get", { space: "own", member_id: 0 });
    expect([...page.el.querySelectorAll("[data-mem-section]")].map((s) => s.getAttribute("aria-label"))).toEqual(["拉斐爾的記憶"]);
  });
});

describe("skills and commands", () => {
  test("skills are names with switches; the switch calls the core and a press opens the skill's own view", async () => {
    await open();
    await cat("skills");
    const rows = [...page.el.querySelectorAll<HTMLElement>('[data-k^="ms-skill:"]')];
    expect(rows.map((row) => row.querySelector(".ms-label")!.textContent)).toEqual(["research-summary", "shared-skill"]);
    expect(rows.map((row) => row.querySelector('[role="switch"]')!.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(rows[0]!.textContent).not.toContain("整理來源");
    await press('[data-ms="skill-toggle"][data-id="2"]');
    expect(api.membersSkillsUpdate).toHaveBeenCalledWith(3, 2, true);
    await press('[data-ms="skill-open"][data-id="1"]');
    expect(api.membersSkillsRead).toHaveBeenCalledWith(3, 1);
    expect(page.el.dataset.view).toBe("skill");
    const text = $<HTMLTextAreaElement>("#ms-skill-text");
    expect(text.value).toContain("整理來源。");
    expect($(".ms-meta").textContent).toContain("整理來源");
    text.value = "---\nname: research-summary\n---\n改過。";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    await press('[data-ms="skill-save"]');
    expect(api.core).toHaveBeenCalledWith("members.skills.update", { member_id: 3, id: 1, text: "---\nname: research-summary\n---\n改過。", expected_hash: "h1" });
    expect(page.el.dataset.view).toBe("main");
  });

  test("a shared skill is read only; deleting one of its own waits for a second press", async () => {
    await open();
    await cat("skills");
    api.membersSkillsRead.mockResolvedValueOnce({ skill: { ...SKILLS[1] }, text: "shared text" });
    await press('[data-ms="skill-open"][data-id="2"]');
    expect($<HTMLTextAreaElement>("#ms-skill-text").disabled).toBe(true);
    expect(page.el.querySelector('[data-ms="skill-save"], [data-ms="skill-more"]')).toBeNull();
    await press('[data-ms="back"]');
    await press('[data-ms="skill-open"][data-id="1"]');
    await press('[data-ms="skill-more"]');
    const item = document.querySelector<HTMLElement>("#app-popover [data-confirm-item]")!;
    item.click();
    expect(api.membersSkillsDelete).not.toHaveBeenCalled();
    item.click(); await flush();
    expect(api.membersSkillsDelete).toHaveBeenCalledWith(3, 1);
  });

  test("a skill is added from a link under the plus, and an empty list says so in one line", async () => {
    api.membersSkillsList.mockResolvedValue({ skills: [], undo: "undo-1" });
    await open();
    await cat("skills");
    expect($("[data-k='ms-skills'] .ms-empty").textContent).toBe(t("members.profile.noSkills"));
    expect($('[data-ms="skill-undo"]')).not.toBeNull();
    await press('[data-ms="skill-add"]');
    const source = $<HTMLInputElement>("#ms-skill-source");
    expect(document.activeElement).toBe(source);
    source.value = "https://github.com/example/skills";
    source.dispatchEvent(new Event("input", { bubbles: true }));
    await press('[data-ms="skill-import"]');
    expect(api.membersSkillsImport).toHaveBeenCalledWith(3, "https://github.com/example/skills");
  });

  test("a command opens its own view; a new one needs a name and {input}", async () => {
    await open();
    await cat("skills");
    expect($('[data-ms="command-open"]').textContent).toContain("/weekly");
    await press('[data-ms="command-open"]');
    expect(page.el.dataset.view).toBe("command");
    expect($<HTMLInputElement>("#ms-command-name").value).toBe("weekly");
    await press('[data-ms="back"]');
    await press('[data-ms="command-add"]');
    const field = (id: string, value: string): void => { const el = $<HTMLInputElement>(id); el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); };
    field("#ms-command-name", "Daily");
    field("#ms-command-template", "no placeholder");
    await press('[data-ms="command-save"]');
    expect(api.membersCommandsSave).not.toHaveBeenCalled();
    field("#ms-command-template", "每日：{input}");
    field("#ms-command-description", "每天");
    await press('[data-ms="command-save"]');
    expect(api.membersCommandsSave).toHaveBeenCalledWith(3, { name: "daily", description: "每天", template: "每日：{input}" });
    expect(page.el.dataset.view).toBe("main");
  });
});

describe("tools and notifications", () => {
  // Owner, 2026-11-09: 「工具的部分都要放上 Icon 比較容易一眼就看出來我們開放甚麼工具給他」.
  test("the apps that are on are rows with their own mark and a switch, and turning one off from 「all」 lists the rest", async () => {
    await open();
    await cat("tools");
    expect([...page.el.querySelectorAll<HTMLElement>('[data-ms="tool"]')].map((s) => [s.dataset.id, s.getAttribute("aria-checked")])).toEqual([["gmail", "true"], ["notion", "true"]]);
    for (const row of page.el.querySelectorAll<HTMLElement>(".ms-row.ms-app")) expect(row.firstElementChild!.classList.contains("mono"), row.textContent!).toBe(true);
    await press('[data-ms="tool"][data-id="gmail"]');
    expect(host.update).toHaveBeenCalledWith(3, { tools: ["read_file", "notion"] });
  });

  test("a member limited to some apps shows only those on, and all on again is the default (null)", async () => {
    list = { ...LIST, members: LIST.members.map(m => m.id === 3 ? { ...m, tools: ["read_file", "notion"] } : m) };
    await open();
    await cat("tools");
    expect([...page.el.querySelectorAll<HTMLElement>('[data-ms="tool"]')].map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    await press('[data-ms="tool"][data-id="gmail"]');
    expect(host.update).toHaveBeenCalledWith(3, { tools: null });
  });

  test("no connected app is one quiet line", async () => {
    api.membersToolChoices.mockResolvedValue({ tools: [], connections: [] });
    await open();
    await cat("tools");
    expect($("[data-k='ms-tools'] .ms-empty").textContent).toBe(t("memberSettings.noTools"));
  });

  // Owner, 2026-11-09: 「我們正式版是不會有語音的…語音語通知可以把語言拿掉就好 通知留著」.
  test("notifications are one switch, and no member has a voice to choose", async () => {
    await open();
    await cat("notify");
    expect(sections()).toEqual(["ms-notify"]);
    const row = $("[data-k='ms-notify'] .ms-row");
    expect(row.querySelector(".ms-label")!.textContent).toBe(t("members.profile.notify"));
    expect(row.querySelector('[data-ms="notify"]')!.getAttribute("role")).toBe("switch");
    await press('[data-ms="notify"]');
    expect(host.update).toHaveBeenLastCalledWith(3, { notify: true });
    for (const kind of kinds()) {
      await cat(kind);
      expect(page.el.querySelector('[data-ms="voice"]'), kind).toBeNull();
    }
    expect(api.membersVoices).not.toHaveBeenCalled();
  });
});

describe("going back", () => {
  test("the arrow and Escape go back to the conversation, in a view they step out to the page first", async () => {
    await open();
    await press('[data-ms="back"]');
    expect(host.back).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(host.back).toHaveBeenCalledTimes(2);
    await cat("skills");
    await press('[data-ms="command-open"]');
    expect(page.el.dataset.view).toBe("command");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(page.el.dataset.view).toBe("main");
    // Back on the page, the kind that was open is still the one shown.
    expect($('[data-cat="skills"]').getAttribute("aria-current")).toBe("page");
    expect(host.back).toHaveBeenCalledTimes(2);
  });

  test("Escape leaves a field with its old text and keeps the page; a shown menu keeps its own Escape", async () => {
    await open();
    const name = $<HTMLInputElement>("#ms-name");
    name.focus(); name.value = "typing";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(name.value).toBe("日文老師");
    expect(host.back).not.toHaveBeenCalled();
    await press('[data-ms="cover"]');
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(host.back).not.toHaveBeenCalled();
  });

  test("close() hides it at once without a step back, and it opens fresh for the next member", async () => {
    await open();
    await cat("skills");
    page.close();
    expect(page.isOpen()).toBe(false);
    expect(page.el.hidden).toBe(true);
    current = 4;
    page.open(); await flush();
    expect(page.el.dataset.view).toBe("main");
    expect($('[data-cat="memory"]').getAttribute("aria-current")).toBe("page");
    expect($<HTMLInputElement>("#ms-name").value).toBe("行程管家");
    expect(host.back).not.toHaveBeenCalled();
  });

  test("a late read for the member left cannot fill the next member's page", async () => {
    let finish!: (value: unknown) => void;
    api.membersSkillsList.mockReturnValueOnce(new Promise((done) => { finish = done; }));
    await open();
    current = 4; page.close(); page.open(); await flush();
    finish({ skills: [{ id: 99, member_id: 3, name: "stale-skill", description: "", enabled: true, source: "owner" }], undo: null });
    await flush();
    expect(page.el.textContent).not.toContain("stale-skill");
  });
});

describe("words", () => {
  test("in English the page has no Chinese outside the member's own words", async () => {
    setLocale("en");
    list = { groups: [{ id: 20, name: "Study", position: 0, sources: [] }], members: LIST.members.map(m => m.id === 3 ? { ...m, name: "Teacher", role: "Strict", personality: "", instructions: "" } : m) };
    api.membersSkillsList.mockResolvedValue({ skills: [{ id: 1, member_id: 3, name: "summary", description: "", enabled: true, source: "owner" }], undo: null });
    api.membersCommandsList.mockResolvedValue({ commands: [] });
    // The memory documents are the owner's own words: English ones here.
    api.core.mockResolvedValue({ text: "Lives in Taipei\n", revision: "r1", chars: 16, entries: 1, limit: 2200, summary: null });
    await open();
    for (const kind of kinds()) {
      await cat(kind);
      expect(page.el.textContent, kind).not.toMatch(/[\u3400-\u9fff]/);
      expect(page.el.innerHTML, kind).not.toMatch(/(?:aria-label|title|placeholder)="[^"]*[\u3400-\u9fff]/);
    }
  });
});
