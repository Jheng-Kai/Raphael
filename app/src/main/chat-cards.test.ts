// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  core: vi.fn(),
  openLink: vi.fn().mockResolvedValue(undefined),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
  memberTemplateFile: vi.fn().mockResolvedValue(null),
}));
vi.mock("./api", () => api);

import { BOT_SETUP_URLS, chatCardAction, chatCardsHTML } from "./chat-cards";
import { secretCardHTML } from "./secret-card";
import type { AgentTurn, PairingCard, SecretCard, TemplateCard } from "./types";

const pairing = (over: Partial<PairingCard> = {}): PairingCard => ({ id: "pair-1", platform: "slack", member_id: 3, code: "SL7Q2K", who: "Sam", expires_at_ms: 0, state: "pending", ...over });
const template = (over: Partial<TemplateCard> = {}): TemplateCard => ({ id: "tpl-1", state: "draft", name: "Editor", avatar: "slime:shion", description: "Checks sources.", counts: { skills: 2, routines: 1 }, connections: ["Gmail", "Notion"], findings: [], ...over });
const dom = (html: string): HTMLElement => { const host = document.createElement("div"); host.innerHTML = html; document.body.append(host); return host; };
const turn = (over: Partial<AgentTurn>): AgentTurn => ({ id: 1, ...over }) as AgentTurn;

beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); api.openLink.mockResolvedValue(undefined); api.openExternalUrl.mockResolvedValue(undefined); });

describe("cards a member shows in its conversation for the panel's buttons", () => {
  test("a pairing request shows its code with Allow first, and answers through the core", async () => {
    const host = dom(chatCardsHTML(turn({ pairings: [pairing()] })));
    expect(host.querySelector(".code")!.textContent).toBe("SL7Q2K");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".card-actions button")];
    expect(buttons.map((button) => button.dataset.act)).toEqual(["pairing-allow", "pairing-deny"]);
    expect(buttons[0].classList.contains("pri")).toBe(true);
    api.core.mockResolvedValue({ card: pairing({ state: "approved" }) });
    expect(chatCardAction(buttons[0])).toBe(true);
    await Promise.resolve();
    expect(api.core).toHaveBeenCalledWith("messaging.pairing.answer", { id: "pair-1", approve: true });
    expect(dom(chatCardsHTML(turn({ pairings: [pairing({ state: "approved" })] }))).querySelector(".card-actions button")).toBeNull();
  });

  test("the template card says what it brings, with no face; a key inside stops saving and publishing", () => {
    const host = dom(chatCardsHTML(turn({ templates: [template()] })));
    expect(host.textContent).toContain("Gmail");
    expect(host.querySelector(".slime-surface")).toBeNull();
    expect([...host.querySelectorAll<HTMLButtonElement>(".card-actions button")].map((button) => button.dataset.act)).toEqual(["template-publish", "template-save", "template-view"]);
    const blocked = dom(chatCardsHTML(turn({ templates: [template({ findings: [{ kind: "secret", path: "template.instructions" }] })] })));
    expect(blocked.querySelector<HTMLButtonElement>('[data-act="template-publish"]')!.disabled).toBe(true);
    expect(blocked.querySelector<HTMLButtonElement>('[data-act="template-save"]')!.disabled).toBe(true);
    expect(blocked.querySelector<HTMLButtonElement>('[data-act="template-view"]')!.disabled).toBe(false);
  });

  test("saving the template writes the core's snapshot to a file", async () => {
    const host = dom(chatCardsHTML(turn({ templates: [template()] })));
    api.core.mockResolvedValue({ text: "{\"format\":\"raphael-member\"}" });
    chatCardAction(host.querySelector<HTMLElement>('[data-act="template-save"]')!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.core).toHaveBeenCalledWith("members.template_card_export", { id: "tpl-1" });
    expect(api.memberTemplateFile).toHaveBeenCalledWith("save", "{\"format\":\"raphael-member\"}");
  });

  test("the bot token card opens only the fixed page where the bot is made, and names its field in the window's language", () => {
    const card: SecretCard = { id: "card-slack", name: "Slack", secret: "bot_token", state: "pending", error: null, expires_at_ms: 0, resumed: false, platform: "slack", link: "https://evil.example" };
    const host = dom(secretCardHTML(card));
    const field = host.querySelector<HTMLInputElement>("input[data-secret-input]")!;
    expect(field.type).toBe("password");
    expect(field.getAttribute("aria-label")).not.toContain("bot_token");
    expect(host.textContent).not.toContain("bot_token");
    expect(chatCardAction(host.querySelector<HTMLElement>('[data-act="bot-link"]')!)).toBe(true);
    expect(api.openLink).toHaveBeenCalledWith(BOT_SETUP_URLS.slack);
    expect(api.openLink).not.toHaveBeenCalledWith("https://evil.example");
    const refused = dom(secretCardHTML({ ...card, state: "failed", error: "invalid" }));
    expect(refused.querySelector("input[data-secret-input]")).not.toBeNull();
  });
});
