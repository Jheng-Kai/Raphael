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

test("a program key of any length saves, the value alone (R-LIMIT-01)", async () => {
  const thread = document.createElement("div");
  thread.innerHTML = secretCardHTML(key);
  document.body.append(thread);
  mountConversationCardActions(thread, () => {});
  const field = thread.querySelector<HTMLInputElement>("input[data-secret-input]")!;
  const save = thread.querySelector<HTMLButtonElement>('[data-act="card-save"]')!;
  expect(save.disabled).toBe(true);
  typed(field, "abc");
  expect(field.type).toBe("password");
  expect(save.disabled).toBe(false);
  expect(thread.querySelector("[data-secret-hint]")).toBeNull();
  save.click();
  expect(api.cardSave).toHaveBeenCalledWith("k1", "abc");
  expect(field.value).toBe("");
});
