import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ask = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("./api", () => ({ agentAskText: (...args: unknown[]) => ask(...args) }));
vi.mock("./ui", () => ({ toaster: { info: vi.fn() } }));

const { askInChat, askPending, onAskPending, resetAsks, settleAsks, PENDING_MAX_MS } = await import("./chat-ask");
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("a panel button done in the conversation", () => {
  beforeEach(() => { vi.useFakeTimers(); ask.mockClear(); resetAsks(); });
  afterEach(() => { vi.useRealTimers(); });

  test("sends the owner's words once while the member works on them, and is free once it stops", async () => {
    const seen = vi.fn();
    const stop = onAskPending(seen);
    askInChat(3, "setup-telegram");
    askInChat(3, "setup-telegram");
    await flush();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(askPending(3, "setup-telegram")).toBe(true);
    expect(askPending(4, "setup-telegram")).toBe(false);
    settleAsks(3, "working");
    settleAsks(3, "waiting");
    expect(askPending(3, "setup-telegram")).toBe(true);
    settleAsks(3, "idle");
    expect(askPending(3, "setup-telegram")).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
  });

  test("a refused press and one that never hears back are free again", async () => {
    ask.mockRejectedValueOnce(new Error("busy"));
    askInChat(1, "settings");
    await flush();
    expect(askPending(1, "settings")).toBe(false);
    askInChat(1, "share-template");
    await flush();
    vi.advanceTimersByTime(PENDING_MAX_MS);
    expect(askPending(1, "share-template")).toBe(false);
  });
});