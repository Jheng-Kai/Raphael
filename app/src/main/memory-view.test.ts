import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setLocale, t } from "./i18n";

const api = vi.hoisted(() => ({ core: vi.fn() }));
vi.mock("./api", () => api);
vi.mock("./ui", async (original) => ({ ...(await original<typeof import("./ui")>()), toaster: { info: vi.fn() } }));

import { type MemoryDocument, type MemoryView, createMemory, emptyMemoryView, memoryHTML } from "./memory-view";
import { toaster } from "./ui";

afterEach(() => setLocale("zh-TW"));

const DOC: MemoryDocument = {
  text: "主人住在台北\n\n回答保持兩三句\n多一行說明\n\n（待確認）新版官網十一月上線\n",
  revision: "r1", chars: 40, entries: 3, limit: 2200,
  summary: { text: "Ongoing:\n- 規劃週末", updated_at_ms: 1 },
};
const view = (over: Partial<MemoryView> = {}): MemoryView => ({ ...emptyMemoryView(), status: DOC, title: "小晴的記憶", ...over });

/** What a sighted reader sees: the text outside the tags. */
const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const buttons = (html: string): string[] => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);

describe("the document", () => {
  test("reads as paragraphs, an entry to a paragraph, with no rows and no type labels", () => {
    const html = memoryHTML(view());
    expect(html.match(/<p class="mem-entry">/g)).toHaveLength(3);
    expect(html).toContain("回答保持兩三句\n多一行說明");
    expect(visible(html)).toBe("小晴的記憶 主人住在台北 回答保持兩三句 多一行說明 待確認 新版官網十一月上線 對話摘要");
    expect(html).not.toContain("mem-sub");
    expect(html).not.toContain('data-mem="more"');
  });

  test("what nobody confirmed wears a tag, and the mark is not shown as words", () => {
    const html = memoryHTML(view());
    expect(html).toContain('<span class="mem-tag">待確認</span> 新版官網十一月上線');
    expect(html).not.toContain("（待確認）");
  });

  test.each([["zh-TW", "2026/10/22"], ["ja", "2026/10/22"], ["en", "Oct 22, 2026"]] as const)("a shared entry says whom the owner told and when, in the %s date", (locale, date) => {
    setLocale(locale);
    const html = memoryHTML(view({ status: { ...DOC, text: "品牌主色是金色 — 拉斐爾 · 2026-10-22\n" } }));
    expect(html).toContain(`<span class="mem-from">拉斐爾 · ${date}</span>`);
    expect(visible(html)).toContain(`品牌主色是金色 拉斐爾 · ${date}`);
  });

  test("nothing that destroys stands on the page (R-UI-56): 全部清除 and the summary's 清除 wait in their ⋯", () => {
    const html = memoryHTML(view());
    expect(html).toContain('aria-label="「小晴的記憶」的選項" title="「小晴的記憶」的選項" data-mem="section-more"');
    expect(html).toContain('aria-label="「對話摘要」的選項" title="「對話摘要」的選項" data-mem="summary-more"');
    expect(html).not.toContain("danger");
    // The summary's text itself is not shown: only that there is one, and the way to clear it.
    expect(html).not.toContain("規劃週末");
  });

  test("an empty document says so, can be written, and has nothing to clear", () => {
    const html = memoryHTML(view({ status: { ...DOC, text: "", entries: 0, chars: 0, summary: null } }));
    expect(visible(html)).toBe("小晴的記憶 尚無記憶");
    expect(html).toContain('data-mem="edit"');
    expect(html).not.toContain('data-mem="section-more"');
  });

  test("編輯 is a pencil, not the word (owner, 2026-11-08), and every icon-only button is named in its label and tooltip", () => {
    const html = memoryHTML(view());
    for (const tag of buttons(html)) {
      expect(tag).toMatch(/^<button type="button" class="btn/);
      if (/class="btn icon/.test(tag)) {
        expect(tag).toMatch(/aria-label="[^"]+"/);
        expect(tag).toMatch(/title="[^"]+"/);
      }
    }
    expect(html).toContain('aria-label="編輯小晴的記憶"');
    expect(buttons(html).find(tag => /data-mem="edit"/.test(tag))).toMatch(/class="btn icon/);
  });

  test("open, it is one box with all of it, 取消 and 儲存 and how full it is", () => {
    const html = memoryHTML(view({ editing: { draft: "主人住在<台北>\n\n第二段", revision: "r1", saving: false, error: null } }));
    expect(html).toContain('<textarea id="mem-body-own" class="mem-body" rows="6" spellcheck="false" aria-label="小晴的記憶的內容">主人住在&lt;台北&gt;\n\n第二段</textarea>');
    expect(html).toContain('data-mem="cancel"');
    expect(html).toContain('data-mem="save"');
    expect(html).not.toContain('data-mem="edit"');
    expect(visible(html)).toContain("13 / 2,200 字");
  });

  test("past its limit the box says so, and still saves: the member condenses it", () => {
    const html = memoryHTML(view({ status: { ...DOC, limit: 5 }, editing: { draft: "一二三四五六七八", revision: "r1", saving: false, error: null } }));
    expect(visible(html)).toContain("超過上限 3 字");
    expect(html).toContain("is-over");
    expect(html).not.toMatch(/data-mem="save"[^>]* disabled/);
  });

  test("text is escaped", () => {
    const html = memoryHTML(view({ status: { ...DOC, text: '<b>"x"</b>\n' } }));
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  });

  test("one language at a time", () => {
    setLocale("en");
    expect(visible(memoryHTML(view()))).toBe("小晴的記憶 主人住在台北 回答保持兩三句 多一行說明 Unconfirmed 新版官網十一月上線 Conversation summary");
    setLocale("ja");
    expect(visible(memoryHTML(view()))).toBe("小晴的記憶 主人住在台北 回答保持兩三句 多一行說明 未確認 新版官網十一月上線 会話の要約");
  });

  test("while it loads, and when it cannot be read", () => {
    expect(memoryHTML(view({ status: "loading" }))).toContain('role="status"');
    expect(memoryHTML(view({ status: "failed" }))).toContain('role="alert"');
  });
});


describe("the controller", () => {
  let redraws = 0;
  const make = () => createMemory({ visible: () => true, redraw: () => void redraws++, space: "own", memberId: () => 3, ownerName: () => "小晴" });
  const click = (c: ReturnType<typeof make>, mem: string) => {
    const b = { dataset: { mem }, closest: () => ({ dataset: { memSpace: "own" } }) } as unknown as HTMLElement;
    return c.click({ closest: () => b } as unknown as Element);
  };
  const box = (value: string) => ({ id: "mem-body-own", value, closest: () => null }) as unknown as HTMLTextAreaElement;
  const keyOn = (key: string, extra: Partial<KeyboardEvent> = {}) =>
    ({ key, target: { id: "mem-body-own" }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ctrlKey: false, metaKey: false, ...extra }) as unknown as KeyboardEvent;

  beforeEach(() => {
    redraws = 0;
    vi.clearAllMocks();
    api.core.mockImplementation(async (method: string, params?: { text?: string }) => {
      if (method === "memory.get") return structuredClone(DOC);
      if (method === "memory.update") return { ...structuredClone(DOC), text: params?.text ?? "", revision: "r2" };
      return {};
    });
  });

  test("it reads the document of its space and member, and one it cannot read is shown as failed", async () => {
    const c = make();
    await c.load();
    expect(api.core).toHaveBeenCalledWith("memory.get", { space: "own", member_id: 3 });
    expect((c.view().status as MemoryDocument).text).toBe(DOC.text);
    expect(c.view().title).toBe("小晴的記憶");
    expect(redraws).toBeGreaterThan(0);
    api.core.mockRejectedValue("down");
    const d = make();
    await d.load();
    expect(d.view().status).toBe("failed");
  });

  test("the shared document asks for no member", async () => {
    const c = createMemory({ visible: () => true, redraw: vi.fn(), space: "shared", memberId: () => 3 });
    await c.load();
    expect(api.core).toHaveBeenCalledWith("memory.get", { space: "shared" });
    expect(c.view().title).toBe("共同記憶");
  });

  test("編輯 opens all of it; 儲存 sends what was typed with the copy it was made from, and shows what came back", async () => {
    const c = make();
    await c.load();
    click(c, "edit");
    expect(c.view().editing).toMatchObject({ draft: DOC.text.trimEnd(), revision: "r1" });
    expect(c.input(box("主人住在高雄"))).toBe(true);
    click(c, "save");
    await vi.waitFor(() => expect(c.view().editing).toBeNull());
    expect(api.core).toHaveBeenCalledWith("memory.update", { space: "own", member_id: 3, text: "主人住在高雄", revision: "r1" });
    expect((c.view().status as MemoryDocument).text).toBe("主人住在高雄");
    expect(toaster.info).toHaveBeenCalledWith("已儲存記憶");
  });

  test("儲存 with nothing changed closes it and sends nothing", async () => {
    const c = make();
    await c.load();
    click(c, "edit");
    click(c, "save");
    expect(c.view().editing).toBeNull();
    expect(api.core).not.toHaveBeenCalledWith("memory.update", expect.anything());
  });

  test("a member wrote meanwhile: what was typed stays, the owner is told, and the next 儲存 is made knowing it", async () => {
    let revision = "r1";
    api.core.mockImplementation(async (method: string, params?: { text?: string; revision?: string }) => {
      if (method === "memory.get") return { ...structuredClone(DOC), revision };
      if (method === "memory.update") {
        if (params?.revision === "r1") { revision = "r2"; throw "Invalid params: changed: The memory changed while it was being edited."; }
        return { ...structuredClone(DOC), text: params?.text ?? "", revision: "r3" };
      }
      return {};
    });
    const c = make();
    await c.load();
    click(c, "edit");
    c.input(box("我打的字"));
    click(c, "save");
    await vi.waitFor(() => expect(c.view().editing?.error).toBe(t("mem.changed")));
    expect(c.view().editing).toMatchObject({ draft: "我打的字", revision: "r2", saving: false });
    click(c, "save");
    await vi.waitFor(() => expect(c.view().editing).toBeNull());
    expect(api.core).toHaveBeenLastCalledWith("memory.update", { space: "own", member_id: 3, text: "我打的字", revision: "r2" });
  });

  test.each([
    ["secret: A memory must never hold a password", "記憶不能存放密碼、金鑰或驗證碼。"],
    ["injection: A memory must be a plain fact", "記憶只放事實，不能放指令或會傳出資料的連結。"],
  ])("a refused edit stays open with the reason, which typing takes away", async (error, said) => {
    api.core.mockImplementation(async (method: string) => {
      if (method === "memory.get") return structuredClone(DOC);
      if (method === "memory.update") throw error;
      return {};
    });
    const c = make();
    await c.load();
    click(c, "edit");
    c.input(box("密碼是 hunter22"));
    click(c, "save");
    await vi.waitFor(() => expect(c.view().editing?.error).toBe(said));
    expect(c.view().editing?.draft).toBe("密碼是 hunter22");
    c.input(box("密碼"));
    expect(c.view().editing?.error).toBeNull();
  });

  test("a change announced while the box is open leaves what is being typed alone", async () => {
    const c = make();
    await c.load();
    click(c, "edit");
    c.input(box("打到一半"));
    await c.load();
    expect(c.view().editing?.draft).toBe("打到一半");
  });

  test("Escape in the box closes it without saving; Ctrl+Enter saves", async () => {
    const c = make();
    await c.load();
    click(c, "edit");
    const escape = keyOn("Escape");
    expect(c.key(escape)).toBe(true);
    expect(escape.stopPropagation).toHaveBeenCalled(); // the panel stays open
    expect(c.view().editing).toBeNull();
    click(c, "edit");
    c.input(box("新的"));
    expect(c.key(keyOn("Enter", { ctrlKey: true }))).toBe(true);
    await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("memory.update", expect.objectContaining({ text: "新的" })));
    expect(c.key({ key: "Escape", target: { id: "other" } } as unknown as KeyboardEvent)).toBe(false);
  });

  test("a click elsewhere is not the memory's, and leaving the tab closes everything", async () => {
    const c = make();
    await c.load();
    expect(c.click({ closest: () => null } as unknown as Element)).toBe(false);
    click(c, "edit");
    c.reset();
    expect(c.view()).toMatchObject({ status: "loading", editing: null });
  });
});


test("reset invalidates a document still loading for the previous member", async () => {
  let resolve!: (value: MemoryDocument) => void;
  api.core.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const memory = createMemory({ visible: () => true, redraw: vi.fn(), space: "own" });
  const old = memory.load();
  memory.reset();
  resolve(DOC);
  await old;
  expect(memory.view().status).toBe("loading");
});


test("Chinese and Japanese memory headings join the owner name without a space", () => {
  setLocale("zh-TW");
  expect(t("mem.own", { p0: "小晴" })).toBe("小晴的記憶");
  setLocale("ja");
  expect(t("mem.own", { p0: "小晴" })).toBe("小晴のメモリ");
});
