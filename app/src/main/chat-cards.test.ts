// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  core: vi.fn(),
  openLink: vi.fn().mockResolvedValue(undefined),
  memberTemplateFile: vi.fn().mockResolvedValue(null),
}));
vi.mock("./api", () => api);

import { BOT_SETUP_URLS, chatCardAction, chatCardsHTML } from "./chat-cards";
import { secretCardHTML } from "./secret-card";
import type { AgentTurn, PairingCard, SecretCard, TemplateCard } from "./types";
import { t } from "./i18n";

const pairing = (over: Partial<PairingCard> = {}): PairingCard => ({ id: "pair-1", platform: "slack", member_id: 3, code: "SL7Q2K", who: "Sam", expires_at_ms: 0, state: "pending", ...over });
const template = (over: Partial<TemplateCard> = {}): TemplateCard => ({ id: "tpl-1", state: "draft", name: "Editor", avatar: "slime:horn-lavender", description: "Checks sources.", counts: { skills: 2, routines: 1 }, connections: ["Gmail", "Notion"], findings: [], ...over });
const dom = (html: string): HTMLElement => { const host = document.createElement("div"); host.innerHTML = html; document.body.append(host); return host; };
const turn = (over: Partial<AgentTurn>): AgentTurn => ({ id: 1, ...over }) as AgentTurn;

beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); api.openLink.mockResolvedValue(undefined); });

test.each([true, false])("a virtual-machine suggestion has one close button and the appropriate action (Docker installed: %s)", async (installed) => {
  const host = dom(chatCardsHTML(turn({ computer_suggestion: { reason: "The package needs a shell.", installed, state: "pending", target: "docker" } })));
  expect(host.querySelectorAll(".card-close")).toHaveLength(1);
  expect(host.querySelector(".card-title")!.textContent).toBe(t("memberComputer.suggestionTitle"));
  expect(host.querySelector(".card-body")!.textContent).toBe("The package needs a shell.");
  const action = host.querySelector<HTMLButtonElement>(".computer-suggestion-action")!;
  // The install is asked of the first member, by the name the owner gave it.
  expect(action.textContent).toBe(installed ? t("memberComputer.suggestionSwitch") : t("memberComputer.suggestionInstall", { p0: t("agent.title") }));
  const handoff = vi.fn();
  api.core.mockResolvedValue(installed ? {} : { setup: true });
  expect(chatCardAction(action, handoff)).toBe(true);
  await Promise.resolve();
  expect(api.core).toHaveBeenCalledExactlyOnceWith("agent.computer_suggestion", { turn_id: 1, action: installed ? "switch" : "setup" });
  expect(handoff).toHaveBeenCalledTimes(installed ? 0 : 1);
});

test("a suggestion to come back to this computer names it, has one close button and one switching action", async () => {
  const reason = "The wiki sits behind the company network.";
  const host = dom(chatCardsHTML(turn({ computer_suggestion: { reason, installed: true, state: "pending", target: "host" } })));
  expect(host.querySelectorAll(".card-close")).toHaveLength(1);
  expect(host.querySelector(".card-title")!.textContent).toBe(t("memberComputer.suggestionTitleHost"));
  expect(host.querySelector(".card-title")!.textContent).not.toBe(t("memberComputer.suggestionTitle"));
  expect(host.querySelector(".card-body")!.textContent).toBe(reason);
  const actions = host.querySelectorAll<HTMLButtonElement>(".card-actions button");
  expect(actions).toHaveLength(1);
  expect(actions[0].textContent).toBe(t("memberComputer.suggestionSwitchHost"));
  api.core.mockResolvedValue({});
  const handoff = vi.fn();
  expect(chatCardAction(actions[0], handoff)).toBe(true);
  await Promise.resolve();
  expect(api.core).toHaveBeenCalledExactlyOnceWith("agent.computer_suggestion", { turn_id: 1, action: "switch" });
  expect(handoff).not.toHaveBeenCalled();
  // Closing declines; a card the owner has answered has no action left.
  api.core.mockClear();
  expect(chatCardAction(host.querySelector<HTMLElement>(".card-close")!)).toBe(true);
  await Promise.resolve();
  expect(api.core).toHaveBeenCalledExactlyOnceWith("agent.computer_suggestion", { turn_id: 1, action: "dismiss" });
  expect(dom(chatCardsHTML(turn({ computer_suggestion: { reason, installed: true, state: "switched", target: "host" } }))).querySelector(".card-actions button")).toBeNull();
});

describe("cards a member shows in its conversation for the panel's buttons", () => {
  test("a pairing request shows its code with Allow first, and answers through the core", async () => {
    const host = dom(chatCardsHTML(turn({ pairings: [pairing()] })));
    expect(host.querySelector(".code")!.textContent).toBe("SL7Q2K");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".card-actions button")];
    expect(buttons.map((button) => button.dataset.act)).toEqual(["pairing-allow"]);
    expect(buttons[0].classList.contains("pri")).toBe(true);
    // Declining is the × at the card's top right.
    expect(host.querySelector<HTMLButtonElement>(".card-head .card-close")!.dataset.act).toBe("pairing-deny");
    api.core.mockResolvedValue({ card: pairing({ state: "approved" }) });
    expect(chatCardAction(buttons[0])).toBe(true);
    await Promise.resolve();
    expect(api.core).toHaveBeenCalledWith("messaging.pairing.answer", { id: "pair-1", approve: true });
    expect(dom(chatCardsHTML(turn({ pairings: [pairing({ state: "approved" })] }))).querySelector(".card-actions button")).toBeNull();
  });

  test("the template card says what it brings, with no face; a key inside stops saving", () => {
    const host = dom(chatCardsHTML(turn({ templates: [template()] })));
    expect(host.textContent).toContain("Gmail");
    expect(host.querySelector(".slime-surface")).toBeNull();
    expect([...host.querySelectorAll<HTMLButtonElement>(".card-actions button")].map((button) => button.dataset.act)).toEqual(["template-save", "template-view"]);
    const blocked = dom(chatCardsHTML(turn({ templates: [template({ findings: [{ kind: "secret", path: "template.instructions" }] })] })));
    expect(host.querySelector(".card-actions .pri")?.textContent).toBe(t("cards.templateSave"));
    expect(blocked.querySelector<HTMLButtonElement>('[data-act="template-save"]')!.disabled).toBe(true);
    expect(blocked.querySelector<HTMLButtonElement>('[data-act="template-view"]')!.disabled).toBe(false);
  });

  test("saving the template writes the core's snapshot to a file, and only then is the card saved", async () => {
    const host = dom(chatCardsHTML(turn({ templates: [template()] })));
    api.core.mockResolvedValue({ text: "{\"format\":\"raphael-member\"}" });
    api.memberTemplateFile.mockResolvedValueOnce("");
    chatCardAction(host.querySelector<HTMLElement>('[data-act="template-save"]')!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.core).toHaveBeenNthCalledWith(1, "members.template_card_export", { id: "tpl-1" });
    expect(api.memberTemplateFile).toHaveBeenCalledWith("save", "{\"format\":\"raphael-member\"}");
    expect(api.core).toHaveBeenNthCalledWith(2, "members.template_card_export", { id: "tpl-1", saved: true });
  });

  test("a save dialog the owner cancels leaves the card as it was: nothing says saved", async () => {
    const host = dom(chatCardsHTML(turn({ templates: [template()] })));
    api.core.mockResolvedValue({ text: "{}" });
    api.memberTemplateFile.mockResolvedValueOnce(null);
    chatCardAction(host.querySelector<HTMLElement>('[data-act="template-save"]')!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.memberTemplateFile).toHaveBeenCalledOnce();
    expect(api.core).toHaveBeenCalledOnce();
    expect(api.core).not.toHaveBeenCalledWith("members.template_card_export", expect.objectContaining({ saved: true }));
    expect(host.querySelector<HTMLButtonElement>('[data-act="template-save"]')!.disabled).toBe(false);
  });

  test("a legacy published template offers the same file and review actions as a draft", () => {
    const legacy = template({ state: "published", url: "https://github.com/x/compare", folder: "C:/Raphael/template-exports/0123456789abcdef", folder_id: "0123456789abcdef" });
    const card = dom(chatCardsHTML(turn({ templates: [legacy] })));
    const draft = dom(chatCardsHTML(turn({ templates: [template()] })));
    expect(card.querySelector(".card-actions")?.innerHTML).toBe(draft.querySelector(".card-actions")?.innerHTML);
    expect(card.querySelector(".card-status")?.textContent).toBe(t("cards.templateReady"));
    expect(card.innerHTML).not.toContain(legacy.url);
    expect(card.innerHTML).not.toContain(legacy.folder);
  });

  test("with a share service the card copies a link first, and a key inside stops it", () => {
    const host = dom(chatCardsHTML(turn({ templates: [template({ shareable: true })] })));
    expect([...host.querySelectorAll<HTMLButtonElement>(".card-actions button")].map((button) => button.dataset.act)).toEqual(["template-share", "template-save", "template-view"]);
    expect(host.querySelector(".card-actions .pri")!.textContent!.trim()).toBe(t("cards.templateCopyLink"));
    const blocked = dom(chatCardsHTML(turn({ templates: [template({ shareable: true, findings: [{ kind: "secret", path: "template.instructions" }] })] })));
    expect(blocked.querySelector<HTMLButtonElement>('[data-act="template-share"]')!.disabled).toBe(true);
  });

  test("sharing copies the link the core made, and a failure copies nothing and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const host = dom(chatCardsHTML(turn({ templates: [template({ shareable: true })] })));
    api.core.mockResolvedValueOnce({ share_url: "https://share.example/s/Ab3dE5gH9k" });
    expect(chatCardAction(host.querySelector<HTMLElement>('[data-act="template-share"]')!)).toBe(true);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("https://share.example/s/Ab3dE5gH9k"));
    expect(api.core).toHaveBeenCalledWith("members.template_card_share", { id: "tpl-1" });
    // The card shows the link and its copy button: no toast repeats it (R-TOAST-01).
    expect(document.querySelector(".toast")).toBeNull();
    writeText.mockClear();
    api.core.mockRejectedValueOnce(new Error("The share service answered 500"));
    chatCardAction(host.querySelector<HTMLElement>('[data-act="template-share"]')!);
    await vi.waitFor(() => expect(document.body.textContent).toContain(t("cards.templateLinkFailed")));
    expect(writeText).not.toHaveBeenCalled();
  });

  test("a shared card shows its link, copies it again without asking the core, and stops sharing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const link = "https://share.example/s/Ab3dE5gH9k";
    const host = dom(chatCardsHTML(turn({ templates: [template({ shareable: true, share_url: link })] })));
    expect(host.querySelector("[data-template-link-line]")!.textContent).toBe(link);
    expect(host.textContent).toContain(t("cards.templateShared"));
    expect([...host.querySelectorAll<HTMLButtonElement>(".card-actions button")].map((button) => button.dataset.act)).toEqual(["template-copy-link", "template-unshare", "template-view"]);
    chatCardAction(host.querySelector<HTMLElement>('[data-act="template-copy-link"]')!);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(api.core).not.toHaveBeenCalled();
    api.core.mockResolvedValueOnce({});
    chatCardAction(host.querySelector<HTMLElement>('[data-act="template-unshare"]')!);
    expect(api.core).toHaveBeenCalledWith("members.template_card_unshare", { id: "tpl-1" });
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
