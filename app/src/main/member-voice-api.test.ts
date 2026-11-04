import { expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
import { agentAskText, agentRetract, agentVoice } from "./api";

test("the composer carries its member through the main-window voice command", async () => {
  await agentVoice("down", 3, 32);
  expect(invoke).toHaveBeenLastCalledWith("window_hotkey", { kind: "agent_down", memberId: 3, conversationId: 32 });
  await agentVoice("up", 3, 32);
  expect(invoke).toHaveBeenLastCalledWith("window_hotkey", { kind: "agent_up", memberId: 3, conversationId: 32 });
  await agentVoice("down", 0, 2);
  expect(invoke).toHaveBeenLastCalledWith("window_hotkey", { kind: "agent_down", memberId: 0, conversationId: 2 });
  await agentVoice("down", 0, 4, "quick");
  expect(invoke).toHaveBeenLastCalledWith("window_hotkey", { kind: "agent_down", memberId: 0, conversationId: 4, destination: "quick" });
});

test("typed requests carry correlation, replacement and quote separately from the text", async () => {
  const quote = { text: "Selected passage", author: "Teacher" };
  await agentAskText("Explain", [], 3, { requestId: "one", replaceTurnId: 17, quote });
  expect(invoke).toHaveBeenLastCalledWith("agent_ask_text", { text: "Explain", memberId: 3, requestId: "one", replaceTurnId: 17, quote });
  await agentRetract("one", 3, 18);
  expect(invoke).toHaveBeenLastCalledWith("agent_retract", { sessionId: "one", memberId: 3, turnId: 18 });
});
