// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { connectorCardHTML } from "./connector-card";
import { secretCardHTML } from "./secret-card";
import { computerCardHTML } from "./computer-card";
import { ownerQuestionHTML, permissionCardHTML } from "./permission-card";
import { backgroundQuestionHTML } from "./background-questions";
import { mountOwnerQuestions } from "./owner-questions";
import { setLocale } from "./i18n";
import type { OwnerQuestion } from "./types";
import { cardHTML, cardDisclosureHTML } from "./card";

vi.mock("./api", () => ({ ownerQuestionAnswer: vi.fn(async () => ({ status: "answered" })) }));
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); setLocale("zh-TW"); });

const question: OwnerQuestion = { id: "choice", task_id: 1, turn_id: 1, member_id: 1, kind: "ask_owner", card_id: "", question: "Choose a day", options: ["Monday", "Tuesday"], free_text: true, state: "asked", result: null };
const cards = {
  connect: () => connectorCardHTML({ id: "connect", app: "notes", name: "Notes", state: "pending", error: null, reconnect: false, tool_count: null, expires_at_ms: 0, resumed: false }),
  secret: () => secretCardHTML({ id: "secret", name: "Notes", secret: "NOTES_KEY", state: "pending", error: null, expires_at_ms: 0, resumed: false }),
  computer: () => computerCardHTML({ id: "computer", state: "control", app: "Browser", reason: "sign_in", note: null, seq: 1, error: null, expires_at_ms: 0 }),
  permission: () => permissionCardHTML({ id: "permission", source: "ask", kind: "tool", service: "Notes", tool: "write", summary: "Save a note", reason: null, digest: "digest", always: true, state: "pending", expires_at_ms: 0 }),
  question: () => ownerQuestionHTML(question),
  background: () => backgroundQuestionHTML({ id: "background", task_id: 1, member_id: 1, prefix: "", text: "Save the note?", tier: null, created_at_ms: 0, expires_at_ms: 0 }, false, { name: "Alex", face: '<i class="av"></i>' }),
};

test("each card asks for its own kind of owner input in all three languages", () => {
  const words = {
    "zh-TW": ["等你填入", undefined, "需要你", "需要你允許"],
    en: ["Waiting for input", undefined, "Action needed", "Approval needed"],
    ja: ["入力待ち", undefined, "操作が必要", "承認が必要"],
  } as const;
  for (const locale of ["zh-TW", "en", "ja"] as const) {
    setLocale(locale);
    for (const [index, render] of [cards.secret, cards.question, cards.computer, cards.permission].entries()) {
      document.body.innerHTML = render();
      expect(document.querySelector("[data-card-status-text]")?.textContent).toBe(words[locale][index]);
    }
    document.body.innerHTML = connectorCardHTML({id:"key",app:"sample",name:"Sample",needs:"key",state:"pending",error:null,reconnect:false,tool_count:null,expires_at_ms:0,resumed:false});
    expect(document.querySelector("[data-card-status-text]")?.textContent).toBe(words[locale][0]);
  }
});

test("an empty disclosure is not rendered", () => {
  expect(cardDisclosureHTML("empty", "   ")).toBe("");
});

test("a question head has no pill and puts its close after the heading", () => {
  document.body.innerHTML = ownerQuestionHTML(question);
  const head = document.querySelector(".card-head")!;
  expect(head.querySelector(".card-status")).toBeNull();
  expect(head.lastElementChild?.matches('[data-owner-answer="cancel"]')).toBe(true);
  expect(head.querySelector('.card-heading [data-owner-answer="cancel"]')).toBeNull();
});

test.each(Object.entries(cards))("%s uses the shared shell, textual status and no face", (_name, render) => {
  document.body.innerHTML = render();
  const shell = document.querySelector(".conversation-card");
  expect(shell).not.toBeNull();
  expect(shell!.querySelector(".card-head .card-title")).not.toBeNull();
  if (_name === "question") expect(shell!.querySelector(".card-status")).toBeNull();
  else expect(shell!.querySelector(".card-status [data-card-status-text]")?.textContent?.trim()).toBeTruthy();
  expect(shell!.querySelector(".av,.slime,.ask-face,.bgq-face")).toBeNull();
  const actions = shell!.querySelector(".card-actions");
  if (actions?.querySelector(".pri")) expect(actions.firstElementChild?.classList.contains("pri")).toBe(true);
});

test("questions use a lettered well and an input without a redundant waiting line", () => {
  document.body.innerHTML = ownerQuestionHTML(question);
  expect(document.querySelector(".card-title")?.textContent).toBe(question.question);
  expect([...document.querySelectorAll("[data-choice-letter]")].map(node => node.textContent)).toEqual(["A", "B"]);
  expect(document.querySelector("input[data-owner-answer-input]")).not.toBeNull();
  expect(document.querySelector("textarea")).toBeNull();
});

test("letter shortcuts answer only inside the focused question, never while typing", async () => {
  const api = await import("./api");
  const thread = document.createElement("div"); document.body.append(thread);
  thread.innerHTML = ownerQuestionHTML(question); mountOwnerQuestions(thread, vi.fn());
  const input = thread.querySelector<HTMLInputElement>("[data-owner-answer-input]")!;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  expect(api.ownerQuestionAnswer).not.toHaveBeenCalled();
  thread.querySelector<HTMLElement>("[data-owner-question]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
  await vi.waitFor(() => expect(api.ownerQuestionAnswer).toHaveBeenCalledWith("choice", "Tuesday"));
});

test("settled permission keeps its decision in the pill and folds the original action", () => {
  document.body.innerHTML = permissionCardHTML({ id: "settled", source: "ask", kind: "tool", service: "Notes", tool: "write", summary: "Save a note", reason: null, digest: "digest", always: false, state: "allowed", expires_at_ms: 0 });
  expect(document.querySelector(".card-status")?.textContent).toContain("已允許一次");
  expect(document.querySelector(".card-detail")?.hasAttribute("hidden")).toBe(true);
  expect(document.querySelector("[data-act^=perm-]")).toBeNull();
});

test("a failed card can be closed locally without changing the saved action", () => {
  document.body.innerHTML = cardHTML({ title: "Sample action", status: "failed", actions: '<button type="button" class="btn pri">Retry</button>' });
  const card = document.querySelector<HTMLElement>(".conversation-card")!;
  const close = card.querySelector<HTMLButtonElement>("[data-card-failed-close]");
  expect(close).not.toBeNull();
  close!.click();
  expect(card.hidden).toBe(true);
  expect(card.querySelector(".pri")?.textContent).toBe("Retry");
});
