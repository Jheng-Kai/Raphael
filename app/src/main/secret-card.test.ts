// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { setLocale, t } from "./i18n";
import { carryTyped, secretCardHTML, secretResumedLineHTML } from "./secret-card";
import { mcpProposalHTML } from "./mcp-proposal";
import { SERVICE_ICONS } from "./service-icons";
import { emptyTimelineState, turnHTML, type TurnLook } from "./timeline";
import type { AgentTurn, SecretCard } from "./types";

afterEach(() => {
  setLocale("zh-TW");
  document.body.innerHTML = "";
});

const card = (over: Partial<SecretCard> = {}): SecretCard => ({
  id: "k1", name: "Notion", secret: "NOTION_TOKEN", state: "pending", error: null, expires_at_ms: 0, resumed: false, ...over,
});

const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({
  id: 9, created_at_ms: 0, question: "請用 Notion 查一下專案頁", route: "answer", prefix: "", text: "請在卡片裡儲存 Notion 的金鑰，儲存後我會接著查。",
  detail: null, status: "done", source: "app", steps: [], task: null, ...over,
});

const LOOK: TurnLook = { face: () => "<i></i>" };
// The words as read: a tag is a space, except between the clauses of a line, which a comma joins.
const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/(?<=[，、]) /g, "").trim();
const actions = (html: string): string[] => [...html.matchAll(/data-act="([^"]+)"/g)].map(match => match[1]);

describe("a secret card", () => {
  test("a saved key with a resume error explains it once without a repeated disclosure", () => {
    const host = document.createElement("div");
    host.innerHTML = secretCardHTML(card({ state: "saved", error: "resume_failed" }));
    expect(host.querySelector(".card-body.cc-state")?.textContent).toContain(t("card.keyNotResumed"));
    expect(host.querySelector("[data-card-disclosure]")).toBeNull();
    expect(host.querySelector('[data-act="card-resume"]')).not.toBeNull();
    const footer = host.querySelector("footer.card-actions");
    expect(footer?.querySelector('[data-act="card-resume"]')).not.toBeNull();
    expect(footer?.querySelector("[data-card-failed-close]")).not.toBeNull();
    expect(host.querySelector("input")).toBeNull();
  });
  test("shows the connection's own mark, bare, its secret's name, a masked field and a disabled framed Save", () => {
    const html = secretCardHTML(card());
    expect(html).toContain(SERVICE_ICONS.notion.path);
    expect(html).not.toContain("tile");
    expect(visible(html)).toContain("連結 Notion 等你填入 安全儲存憑證後，就能繼續這項工作。 安全儲存");
    expect(visible(html)).toContain("NOTION_TOKEN");
    expect(html).toContain('type="password"');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('class="btn sm pri" data-act="card-save" data-card="k1" disabled');
    expect(html).toContain(">安全儲存</button>");
    // The field draws no characters: no value is ever put into the markup.
    expect(html).not.toMatch(/\bvalue=/);
    expect(html).toContain(`placeholder="${t("card.keyField")}"`);
  });

  test("a connection that is no known program gets the generic plug, never a letter", () => {
    const html = secretCardHTML(card({ name: "天氣服務" }));
    expect(html).toContain('class="mono md" aria-hidden="true"');
    expect(html).not.toContain("天"[0] + "</span>");
  });

  test("each state has the one action it can take", () => {
    expect(actions(secretCardHTML(card()))).toEqual(["card-save"]);
    expect(actions(secretCardHTML(card({ state: "failed", error: "invalid" })))).toEqual(["card-save"]);
    expect(actions(secretCardHTML(card({ state: "failed", error: "gone" })))).toEqual([]);
    expect(actions(secretCardHTML(card({ state: "saved" })))).toEqual([]);
    expect(actions(secretCardHTML(card({ state: "saved", error: "resume_failed" })))).toEqual(["card-resume"]);
    expect(actions(secretCardHTML(card({ state: "saved", error: "interrupted" })))).toEqual(["card-resume"]);
    for (const state of ["resuming", "resumed", "cancelled", "expired"] as const) {
      expect(actions(secretCardHTML(card({ state })))).toEqual([]);
    }
    expect(secretCardHTML(card({ state: "failed", error: "gone" }))).not.toContain("<input");
    expect(secretCardHTML(card({ state: "saved" }))).not.toContain("<input");
  });

  test("says that the key is saved apart from whether the task went on", () => {
    expect(visible(secretCardHTML(card({ state: "saved" })))).toContain("已安全儲存");
    expect(visible(secretCardHTML(card({ state: "resuming" })))).toContain("已儲存 · 繼續這項工作…");
    expect(visible(secretCardHTML(card({ state: "resumed", resumed: true })))).toContain("已儲存 · 工作已繼續");
    const notResumed = secretCardHTML(card({ state: "saved", error: "resume_failed" }));
    expect(visible(notResumed)).toContain(t("card.keyNotResumed"));
    expect(notResumed).not.toContain("<input");
    expect(visible(secretCardHTML(card({ state: "failed", error: "too_long" })))).toContain(t("card.keyTooLong"));
    expect(visible(secretCardHTML(card({ state: "failed", error: "unheard-of" })))).toContain(t("card.keyVault"));
    expect(visible(secretCardHTML(card({ state: "expired" })))).toContain("已逾時，這項工作沒有繼續");
    expect(visible(secretCardHTML(card({ state: "cancelled" })))).toContain("已停止，這項工作沒有繼續");
  });

  test("speaks only the window's language", () => {
    setLocale("en");
    expect(visible(secretCardHTML(card()))).toContain("Connect Notion Waiting for input Save your credentials securely to continue the task. Save securely");
    expect(visible(secretCardHTML(card({ state: "saved", error: "resume_failed" })))).toContain(t("card.keyNotResumed"));
    setLocale("ja");
    expect(visible(secretCardHTML(card()))).toContain("Notion に接続 入力待ち 認証情報を安全に保存すると作業を続けられます。 安全に保存");
    expect(visible(secretCardHTML(card({ state: "resumed" })))).toContain("保存済み · 作業を続けました");
  });

  test("escapes the names it is given", () => {
    const html = secretCardHTML(card({ name: '<img src=x onerror=1>', secret: '"><b>' }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>");
  });
});

describe("a turn with a secret card", () => {
  test("draws its cards below what it said", () => {
    const html = turnHTML(turn({ secrets: [card()] }), emptyTimelineState(), false, LOOK);
    expect(html.indexOf('data-secret-card="k1"')).toBeGreaterThan(html.indexOf("請在卡片裡儲存 Notion"));
  });

  test("a task resumed after its key was saved opens with one centred line naming the connection, not the owner's words again", () => {
    const resumed = turn({ id: 10, source: "connector", resumed_secrets: ["Notion"], text: "專案頁的標題是「路線圖」。" });
    const html = turnHTML(resumed, emptyTimelineState(), false, LOOK);
    expect(html).not.toContain("owner-message");
    expect(html).toContain('data-resumed="10"');
    expect(visible(secretResumedLineHTML(resumed))).toBe("Notion 的金鑰已儲存，繼續原本的工作");
    expect(html).toContain(SERVICE_ICONS.notion.path);
    expect(secretResumedLineHTML(turn())).toBe("");
  });
});

describe("a card drawn again", () => {
  const draw = (html: string): HTMLElement => {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    document.body.append(holder);
    return holder;
  };

  test("takes what the owner was typing to the same card's new field and enables Save", () => {
    const before = draw(secretCardHTML(card()));
    const field = before.querySelector<HTMLInputElement>("input[data-secret-input]")!;
    field.value = "gsk-typed-by-the-test";
    const after = draw(secretCardHTML(card()));
    expect(after.querySelector<HTMLInputElement>("input")!.value).toBe("");
    const restore = carryTyped(before, after);
    const fresh = after.querySelector<HTMLInputElement>("input[data-secret-input]")!;
    expect(fresh.value).toBe("gsk-typed-by-the-test");
    expect(after.querySelector<HTMLButtonElement>('[data-act="card-save"]')!.disabled).toBe(false);
    restore();
    // Nothing of it is in the markup: the characters live in the field only.
    expect(after.innerHTML).not.toContain("gsk-typed-by-the-test");
    expect(before.innerHTML).not.toContain("gsk-typed-by-the-test");
  });

  test("keeps the cursor with the field that had it, and gives a field of another card nothing", () => {
    const before = draw(secretCardHTML(card()));
    const field = before.querySelector<HTMLInputElement>("input")!;
    field.value = "abcdef";
    field.focus();
    field.setSelectionRange(2, 4);
    const after = draw(secretCardHTML(card()));
    const restore = carryTyped(before, after);
    before.remove();
    restore();
    const fresh = after.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(fresh);
    expect([fresh.selectionStart, fresh.selectionEnd]).toEqual([2, 4]);
    const other = draw(secretCardHTML(card({ id: "k2" })));
    carryTyped(before, other);
    expect(other.querySelector<HTMLInputElement>("input")!.value).toBe("");
  });

  test("a card that no longer waits for a key has no field to take it", () => {
    const before = draw(secretCardHTML(card()));
    before.querySelector<HTMLInputElement>("input")!.value = "gsk-typed-by-the-test";
    const after = draw(secretCardHTML(card({ state: "saved" })));
    carryTyped(before, after)();
    expect(after.innerHTML).not.toContain("gsk-typed-by-the-test");
  });

  test("keeps MCP edits and both private login fields across the same redraw", () => {
    const proposal = mcpProposalHTML({ id: "sample", state: "draft", revision: 1, error: null, first_local: true, groups: [],
      fields: { name: "Sample", transport: "http", command: "", args: [], url: "https://example.invalid/mcp", env: [], headers: [] } });
    const markup = proposal + secretCardHTML(card({ id: "login", login: true, name: "https://example.invalid", secret: "login" }));
    const before = draw(markup);
    const values: Record<string, string> = { '[data-mcp-field="name"]': "Sample edited", '[data-login-user="login"]': "sample-owner", '[data-secret-input="login"]': "sample-private-value" };
    for (const [selector, value] of Object.entries(values)) before.querySelector<HTMLInputElement>(selector)!.value = value;
    const edited = before.querySelector<HTMLInputElement>('[data-mcp-field="name"]')!;
    edited.focus(); edited.setSelectionRange(2, 4);
    const after = draw(markup);
    const restore = carryTyped(before, after);
    before.remove(); restore();
    for (const [selector, value] of Object.entries(values)) expect(after.querySelector<HTMLInputElement>(selector)!.value).toBe(value);
    expect(document.activeElement).toBe(after.querySelector('[data-mcp-field="name"]'));
    expect(after.querySelector<HTMLButtonElement>('[data-act="card-save"]')!.disabled).toBe(false);
    expect(after.innerHTML).not.toContain("sample-owner");
    expect(after.innerHTML).not.toContain("sample-private-value");
  });
});


test("settled secrets have a short pill and keep the saved/resumed decision folded", () => {
 document.body.innerHTML=secretCardHTML(card({state:"resumed",resumed:true}));
 expect(document.querySelector('.card-status')?.textContent).toBe(t("cards.done"));
 expect(document.querySelector('.card-detail[hidden]')?.textContent).toContain(t("card.keyResumed"));
});
