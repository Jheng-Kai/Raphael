import { afterEach, describe, expect, test } from "vitest";
import { exchangeView, receivedLineHTML } from "./exchange-line";
import { setLocale } from "./i18n";
import { peerChatHTML } from "./peer-chat";
import type { TurnLook } from "./timeline";
import type { AgentTurn } from "./types";

const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const NAMES: Record<number, string> = { 0: "拉斐爾", 3: "行銷", 4: "PM" };
const LOOK: TurnLook = { face: () => "", memberName: (id) => NAMES[id] ?? "", memberFace: (id) => `<i class="face-${id}"></i>` };
const HANDED: AgentTurn = { id: 5, created_at_ms: 5000, question: "把新品頁做出來", route: "exchange", prefix: "", text: "做好了", detail: null, status: "done",
  source: "member", scope: "exchange", member_id: 3, peer_id: 4 };

afterEach(() => setLocale("zh-TW"));

describe("what a colleague said to a member, in that member's own chat", () => {
  test("is one line, as on the asker's side, that opens the two members' conversation instead of a box under it", () => {
    setLocale("zh-TW");
    const html = receivedLineHTML(HANDED, LOOK);
    expect(visible(html)).toBe("與 PM 的 2 則訊息");
    expect(html).toContain('<i class="face-4"></i>');
    expect(html).toContain('data-act="peer-chat"');
    expect(html).toContain('data-peer-keys="x5"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("把新品頁做出來");
  });

  test("the conversation it opens holds what was asked and what the member answered, under each one's face", () => {
    const view = exchangeView(HANDED);
    expect(view).toMatchObject({ from_member_id: 4, member_id: 3, request: "把新品頁做出來", result: "做好了", state: "done" });
    const people = (id: number, fallback: string) => ({ name: NAMES[id] ?? fallback, face: `<i class="face-${id}"></i>`, accent: "#000" });
    const chat = peerChatHTML(view.from_member_id, [view], people, 6000);
    expect(visible(chat)).toContain("PM ⇄ 行銷".replace(" ⇄ ", " "));
    expect(chat.indexOf("把新品頁做出來")).toBeLessThan(chat.indexOf("做好了"));
    expect(chat).toContain('data-peer="latest"');
  });

  test("an unfinished answer shows its state on the line", () => {
    expect(visible(receivedLineHTML({ ...HANDED, status: "running", text: "" }, LOOK))).toContain("執行中");
  });

  test("the window's language words the line", () => {
    setLocale("ja");
    expect(visible(receivedLineHTML(HANDED, LOOK))).toContain("PM");
    expect(visible(receivedLineHTML(HANDED, LOOK))).not.toContain("與");
  });
});
