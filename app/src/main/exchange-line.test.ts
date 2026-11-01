import { afterEach, describe, expect, test } from "vitest";
import { receivedLineHTML } from "./exchange-line";
import { setLocale } from "./i18n";
import type { TurnLook } from "./timeline";
import type { AgentTurn } from "./types";

const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const summary = (html: string): string => visible(html.slice(html.indexOf("<summary>"), html.indexOf("</summary>")));
const detail = (html: string): string => visible(html.slice(html.indexOf(">", html.indexOf('class="handoff-detail')) + 1));
const NAMES: Record<number, string> = { 0: "拉斐爾", 3: "行銷", 4: "PM" };
const LOOK: TurnLook = { face: () => "", memberName: (id) => NAMES[id] ?? "", memberFace: (id) => `<i class="face-${id}"></i>` };
const HANDED: AgentTurn = { id: 5, created_at_ms: 5000, question: "把新品頁做出來", route: "exchange", prefix: "", text: "做好了", detail: null, status: "done",
  source: "member", scope: "exchange", member_id: 3, peer_id: 4 };

afterEach(() => setLocale("zh-TW"));

describe("what a colleague handed a member, in that member's own chat", () => {
  test("says who it came from, with their face, and opens on what was asked", () => {
    setLocale("zh-TW");
    const html = receivedLineHTML(HANDED, LOOK);
    expect(summary(html)).toBe("訊息來自 PM");
    expect(html).toContain('<i class="face-4"></i>');
    expect(detail(html)).toBe("把新品頁做出來");
  });

  test("the answer is not in the line: it follows as the member's own turn", () => {
    expect(receivedLineHTML(HANDED, LOOK)).not.toContain("做好了");
  });

  test("the window's language words the line", () => {
    setLocale("ja");
    expect(summary(receivedLineHTML(HANDED, LOOK))).toBe("PM からのメッセージ");
  });
});
