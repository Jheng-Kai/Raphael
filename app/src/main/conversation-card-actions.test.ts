// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ cardSave: vi.fn(async () => ({ card: {}, saved: true })), cardConnect: vi.fn(), cardCancel: vi.fn(), cardResume: vi.fn() }));
vi.mock("./api", () => api);

import { mountConversationCardActions } from "./conversation-card-actions";
import { secretCardHTML } from "./secret-card";
import type { SecretCard } from "./types";

const key: SecretCard = { id: "k1", name: "JIRA_USERNAME", secret: "JIRA_USERNAME", key: true, purpose: "the Jira user", state: "pending", error: null, expires_at_ms: 0, resumed: false };

afterEach(() => { document.body.innerHTML = ""; api.cardSave.mockClear(); });

function typed(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("a secret program key waits for six characters and says so, and one marked as no secret is shown, kept short and sent as plain (#281)", async () => {
  const thread = document.createElement("div");
  thread.innerHTML = secretCardHTML(key);
  document.body.append(thread);
  mountConversationCardActions(thread, () => {});
  const field = thread.querySelector<HTMLInputElement>("input[data-secret-input]")!;
  const save = thread.querySelector<HTMLButtonElement>('[data-act="card-save"]')!;
  const hint = thread.querySelector<HTMLElement>("[data-secret-hint]")!;
  const plain = thread.querySelector<HTMLInputElement>("input[data-secret-plain]")!;
  typed(field, "jon");
  expect(save.disabled).toBe(true);
  expect(hint.hidden).toBe(false);
  plain.checked = true;
  plain.dispatchEvent(new Event("change", { bubbles: true }));
  expect(field.type).toBe("text");
  expect(hint.hidden).toBe(true);
  expect(save.disabled).toBe(false);
  save.click();
  expect(api.cardSave).toHaveBeenCalledWith("k1", "jon", true);
  expect(field.value).toBe("");
  plain.checked = false;
  plain.dispatchEvent(new Event("change", { bubbles: true }));
  expect(field.type).toBe("password");
  typed(field, "sk-long-enough-key");
  expect(save.disabled).toBe(false);
  expect(hint.hidden).toBe(true);
});
