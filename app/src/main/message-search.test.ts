// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
vi.mock("./api", () => ({ core: vi.fn() }));
import * as api from "./api";
import { createMessageSearch } from "./message-search";
import { setLocale } from "./i18n";

test("cross-conversation results escape markup, mark matches and navigate with the conversation", async () => {
  setLocale("en");
  vi.mocked(api.core).mockResolvedValue({ turns: [{ id: 9, member_id: 3, conversation_id: 7, conversation_title: "Budget", question: "cobalt <script>", text: "A cobalt report", created_at_ms: 1000 }] });
  const host = document.createElement("div"), open = vi.fn();
  const search = createMessageSearch(host, { face: () => "", name: () => "Researcher <b>", open });
  search.draw("cobalt", "<button>Team member</button>");
  await vi.waitFor(() => expect(host.querySelector("mark")?.textContent).toBe("cobalt"));
  expect(host.querySelector("script")).toBeNull();
  expect(host.textContent).toContain("Budget");
  expect(host.querySelector(".message-search-title")?.textContent).toContain("Researcher <b>");
  expect(host.querySelector(".message-search-title b b")).toBeNull();
  host.querySelector<HTMLButtonElement>("[data-message-result]")!.click();
  expect(open).toHaveBeenCalledWith(3, 7, 9);
  search.draw("", "<b>Members again</b>");
  expect(host.textContent).toBe("Members again");
});

test.each(["routine", "calendar", "meeting", "skill_learned"])("%s search snippets use the event's words", async type => {
  const raw = JSON.stringify({type, action: "created", id: 987654321, name: "Sample orchard", text: "已建立 · Sample orchard"});
  vi.mocked(api.core).mockResolvedValue({turns: [{id: 1, member_id: 0, conversation_id: 1, conversation_title: "Samples", question: "", text: "", created_at_ms: 1000, messages: [{kind: "event", text: raw}]}]});
  const host = document.createElement("div");
  createMessageSearch(host, {face: () => "", name: () => "Sample", open: vi.fn()}).draw("orchard", "");
  await vi.waitFor(() => expect(host.querySelector("mark")?.textContent).toBe("orchard"));
  expect(host.querySelector('.message-search-snippet')?.textContent).toBe("已建立 · Sample orchard");
  expect(host.textContent).not.toContain('987654321');
});
