// @vitest-environment happy-dom
// A file a member downloaded with Raphael Chrome is a file card in its turn (#347): found in the conversation, opened by its
// stored id, with the name the page gave it and nothing of the folder it was placed in.
import { expect, test } from "vitest";
import { emptyTimelineState, turnHTML } from "./timeline";
import type { AgentTurn } from "./types";

const download = { id: `${"7".repeat(32)}.csv`, name: "銷售報表.csv", mime: "text/csv", size: 18432 };
const words = "「銷售報表.csv」下載好了，已附在這段對話裡，點一下就能打開。";
const turn: AgentTurn = {
  id: 827, created_at_ms: 1000, question: "把這個月的銷售報表下載下來", text: words, prefix: "", route: "answer", source: "app",
  session_id: "download", status: "done", detail: null, steps: [], task: null,
  messages: [{ seq: 1, kind: "media", at_ms: 1000, text: JSON.stringify({ attachment: download }) }, { seq: 2, kind: "reply", at_ms: 2000, text: words }],
};
const draw = (): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = turnHTML(turn, emptyTimelineState(), false, { face: () => "<i></i>" });
  return root;
};

test("a download is a card with its own name that opens the stored file, above the words that say it is attached", () => {
  const root = draw();
  const card = root.querySelector<HTMLButtonElement>("button.attachment-file[data-act='attachment-open']")!;
  expect(card.dataset.id).toBe(download.id);
  expect(card.querySelector(".me-file-t")!.textContent).toBe("銷售報表.csv");
  expect(card.querySelector(".attachment-icon")!.getAttribute("data-mark")).toBe("fileText");
  expect(card.textContent).toContain("18 KB");
  const reply = root.querySelector(".chat-message[data-reply]")!;
  expect(reply.textContent).toContain("銷售報表.csv");
  expect(card.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("nothing of the folder it was placed in or of git shows in the turn", () => {
  expect(draw().textContent).not.toMatch(/\.raphael|git|隱藏|資料夾/i);
});
