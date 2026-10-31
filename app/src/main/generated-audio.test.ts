import { expect, test } from "vitest";
import { conversationCardsHTML, emptyTimelineState, turnHTML } from "./timeline";
import type { AgentTurn } from "./types";

test("a generated file uses the existing playable audio card in the member reply", () => {
  const file = { id: `${"a".repeat(32)}.wav`, name: "speech.wav", mime: "audio/wav", size: 48044 };
  const turn = { id: 9, member_id: 1, question: "Read this script", text: "Here is the recording.", prefix: "", route: "answer", status: "done", created_at_ms: 1000,
    steps: [], messages: [{ seq: 1, kind: "media", text: JSON.stringify({ attachment: file }), at_ms: 1001 }] } as unknown as AgentTurn;
  const html = turnHTML(turn, emptyTimelineState(), false, { face: () => "" });
  expect(html).toContain('class="me-file attachment-audio"');
  expect(html).toContain(`data-attachment="${file.id}"`);
  expect(html).toContain("data-audio-toggle");
  expect(html).toContain("speech.wav");
  expect(conversationCardsHTML(turn)).toContain('class="me-file attachment-audio"');
});

test("missing voice is visible with the existing repair button in the reply", () => {
  const turn = { messages: [{ seq: 1, kind: "media", text: JSON.stringify({missing: {resource: "fish", requirement: "setup", state: "missing", repair: "voice"}}) }] } as unknown as AgentTurn;
  const html = conversationCardsHTML(turn);
  expect(html).toContain('class="missing-note"');
  expect(html).toContain('data-missing-repair="voice"');
  expect(html).not.toContain("generate_audio");
});

test("an accepted owner addition is an ordinary owner bubble without an empty member reply", () => {
  const turn = { id: 10, question: "Include the prices", text: "", route: "owner_input", status: "done", created_at_ms: 1000,
    steps: [], messages: [] } as unknown as AgentTurn;
  const html = turnHTML(turn, emptyTimelineState(), false, {face: () => "member-avatar"});
  expect(html).toContain("owner-message");
  expect(html).toContain("Include the prices");
  expect(html).not.toContain("ra-face");
});
