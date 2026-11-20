// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ cardSave: vi.fn(async () => ({ card: {}, saved: true })), cardConnect: vi.fn(), cardCancel: vi.fn(), cardResume: vi.fn() }));
vi.mock("./api", () => api);

import { mountConversationCardActions } from "./conversation-card-actions";
import { secretCardHTML } from "./secret-card";
import type { SecretCard } from "./types";

const key: SecretCard = { id: "k1", name: "JIRA_API_TOKEN", secret: "JIRA_API_TOKEN", key: true, purpose: "the Jira API", state: "pending", error: null, expires_at_ms: 0, resumed: false };

afterEach(() => { document.body.innerHTML = ""; api.cardSave.mockClear(); });

function typed(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("a program key waits for six characters and says so under its field, then saves the value alone (#281)", async () => {
  const thread = document.createElement("div");
  thread.innerHTML = secretCardHTML(key);
  document.body.append(thread);
  mountConversationCardActions(thread, () => {});
  const field = thread.querySelector<HTMLInputElement>("input[data-secret-input]")!;
  const save = thread.querySelector<HTMLButtonElement>('[data-act="card-save"]')!;
  const hint = thread.querySelector<HTMLElement>("[data-secret-hint]")!;
  typed(field, "abc");
  expect(field.type).toBe("password");
  expect(save.disabled).toBe(true);
  expect(hint.hidden).toBe(false);
  typed(field, "sk-long-enough-key");
  expect(save.disabled).toBe(false);
  expect(hint.hidden).toBe(true);
  save.click();
  expect(api.cardSave).toHaveBeenCalledWith("k1", "sk-long-enough-key");
  expect(field.value).toBe("");
});
