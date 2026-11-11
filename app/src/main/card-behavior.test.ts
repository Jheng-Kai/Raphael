// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { mailCardHTML } from "./mail-card";
import { mcpProposalHTML } from "./mcp-proposal";
import { pageCardsHTML } from "./page-card";
import { createDraftPanel } from "./member-draft";
import { createChatComposer } from "./chat-composer";
import { mountDesktopTimeline } from "./desktop-timeline";
import type { AgentTurn, MailDraftCard } from "./types";

const api = vi.hoisted(() => ({ core: vi.fn(async () => ({})) }));
vi.mock("./api", () => api);
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); });
const mail: MailDraftCard = { id: "draft", mode: "card", state: "draft", version: 1, digest: "digest", from: { key: "mail", name: "Mail" }, senders: [{ key: "mail", name: "Mail" }], to: "reader@example.invalid", cc: "", subject: "Project note", body: "Please review the note.", offer: null, error: null, holder_id: 1, author_name: "" };

test("mail uses a well, primary first, and a compact settled disclosure", () => {
  document.body.innerHTML = mailCardHTML(mail);
  expect(document.querySelector(".conversation-card .card-well [data-mail-field=body]")).not.toBeNull();
  expect(document.querySelector(".card-actions")?.firstElementChild?.getAttribute("data-act")).toBe("mail-send");
  document.body.innerHTML = mailCardHTML({ ...mail, state: "sent" });
  expect(document.querySelector(".conversation-card .card-detail[hidden]")).not.toBeNull();
});

test("an editable mail does not fold its already visible fields or technical version", () => {
  document.body.innerHTML = mailCardHTML({...mail, version:2, author_name:"Alex"});
  expect(document.querySelector("[data-card-disclosure]")).toBeNull();
});

test("failed mail keeps an editable draft and a usable retry", () => {
  document.body.innerHTML = mailCardHTML({ ...mail, state: "failed", error: "interrupted" });
  expect(document.querySelector(".card-status.is-failed")).not.toBeNull();
  expect(document.querySelector<HTMLButtonElement>('[data-act="mail-send"]')?.disabled).toBe(false);
  expect(document.querySelector<HTMLTextAreaElement>('[data-mail-field="body"]')?.value).toBe(mail.body);
});

test("mail shows a copy row only when the draft has copy recipients", () => {
  document.body.innerHTML = mailCardHTML(mail);
  expect(document.querySelector('[data-mail-field="cc"]')).toBeNull();
  document.body.innerHTML = mailCardHTML({...mail, cc: "copy@example.invalid"});
  expect(document.querySelector<HTMLInputElement>('[data-mail-field="cc"]')?.value).toBe("copy@example.invalid");
});

test("MCP and page consumers share the same card header and status", () => {
  const proposal = mcpProposalHTML({ id: "mcp", state: "draft", revision: 1, error: null, first_local: false, groups: [], fields: { name: "Sample", transport: "http", command: "", args: [], url: "https://example.invalid/mcp", env: [], headers: [] } });
  const page = pageCardsHTML({ pages: [{ id: "page", rev: 1, title: "Review", height: 320, fallback: "", server: "" }] } as AgentTurn);
  for (const html of [proposal, page]) { document.body.innerHTML = html; expect(document.querySelector(".conversation-card .card-status")).not.toBeNull(); }
});

test("member drafts start as short editable disclosure rows without faces", () => {
  const panel = createDraftPanel({ groups: () => [], onConfirm: vi.fn(), onCancel: vi.fn() });
  panel.sync({ id: "team", prefix: "", text: "Create a reviewer", tier: "T2", timeout_ms: 1, drafts: [{ id: "reviewer", name: "Alex", role: "Reviewer", personality: "Careful", instructions: "Review drafts", blurb: "Reviews notes", group: "", avatar_preset: "" }] });
  document.body.append(panel.el);
  expect(panel.el.querySelector(".conversation-card .card-status")).not.toBeNull();
  expect(panel.el.querySelector(".av,.slime,.draft-face")).toBeNull();
  expect(panel.el.querySelector<HTMLElement>(".draft-more-body")?.hidden).toBe(true);
});

test("failed composer delivery retains words in place and offers retry in a card", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(undefined);
  const composer = createChatComposer({ send, placeholder: () => "Write a message" }); document.body.append(composer.el);
  composer.setDraft("A generic review request"); composer.el.requestSubmit();
  await vi.waitFor(() => expect(document.querySelector(".conversation-card .card-status.is-failed")).not.toBeNull());
  expect(composer.input.value).toBe("A generic review request");
  document.querySelector<HTMLButtonElement>("[data-card-retry]")!.click();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
});

test("desktop owner waits render a card and identical refresh preserves its element", () => {
  document.body.innerHTML = '<ol><li data-desktop-slot="42"></li></ol>';
  const timeline = mountDesktopTimeline(document.querySelector("ol")!);
  const state = { state: "running", ready: true, control: "owner", works: [{ id: "work", turn_id: 42, state: "waiting_control", tool: "", reason: "sign_in" }] } as const;
  timeline.update({ ...state, works: [...state.works] });
  const card = document.querySelector(".conversation-card"); expect(card).not.toBeNull();
  timeline.update({ ...state, works: [...state.works] }); expect(document.querySelector(".conversation-card")).toBe(card);
  expect(card!.querySelector('[data-card-desktop="take"]')).not.toBeNull();
  expect(card!.querySelector('[data-card-desktop="return"]')).not.toBeNull();
});

 test("settled team decisions use the same shell and keep the disclosure", async () => {
  const { settledDraftHTML } = await import("./member-draft");
  const html = settledDraftHTML({ id: 13, status: "done", text: "Created Analyst", detail: "Analyst: research" } as never, false);
  document.body.innerHTML = html;
  expect(document.querySelector(".draft-done.conversation-card .card-status.is-done")).not.toBeNull();
  expect(document.querySelector("[data-act='draft-done']")?.getAttribute("aria-expanded")).toBe("false");
 });
