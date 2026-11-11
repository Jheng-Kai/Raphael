import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => ({ started: true })) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));

import { createCliSignin } from "./cli-signin";
import type { SigninPhase } from "./timeline";
import type { CliBrain } from "./types";

const row = (more: Partial<CliBrain>): CliBrain => ({ id: "claude", name: "Claude Code", installed: true, logged_in: true, disconnected: false, available: true, login_command: "claude auth login", models: [], ...more });

let phases: Map<number, SigninPhase>;
let list: CliBrain[];
const redraws: Array<SigninPhase | undefined> = [];
const retry = vi.fn(async (_turnId: number): Promise<void> => undefined);
/** What reached the core: the method and its params, in order. */
const rpc = (): Array<{ method: string; params: Record<string, unknown> }> =>
  invoke.mock.calls.filter(([command]) => command === "core_call").map(([, args]) => args as { method: string; params: Record<string, unknown> });

function make(): ReturnType<typeof createCliSignin> {
  return createCliSignin({ phases, redraw: () => redraws.push(phases.get(7)), retry, read: async () => ({ clis: list }) });
}

beforeEach(() => {
  vi.useFakeTimers();
  phases = new Map();
  list = [row({ signing_in: true })];
  redraws.length = 0;
  retry.mockClear();
  invoke.mockClear();
  invoke.mockImplementation(async () => ({ started: true }));
});
afterEach(() => vi.useRealTimers());

test("the button starts the CLI's own sign-in with `again`, waits while its window is open, and sends the question again once when it finished", async () => {
  const signin = make();
  await signin.start(7, "claude");
  expect(rpc()).toEqual([{ method: "brains.cli_login", params: { id: "claude", again: true } }]);
  expect(phases.get(7)).toBe("waiting");
  await vi.advanceTimersByTimeAsync(1600);
  expect(phases.get(7)).toBe("waiting"); expect(retry).not.toHaveBeenCalled();
  list = [row({ signing_in: false, login_result: "done" })];
  await vi.advanceTimersByTimeAsync(1600);
  expect(retry).toHaveBeenCalledOnce(); expect(retry).toHaveBeenCalledWith(7);
  expect(phases.has(7)).toBe(false);
  expect(redraws).toContain("done");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(retry).toHaveBeenCalledOnce();
  signin.dispose();
});

test("a window closed before the sign-in finished says so, leaves the button usable and sends nothing", async () => {
  const signin = make();
  await signin.start(7, "codex");
  list = [row({ id: "codex", signing_in: false, login_result: "stopped" })];
  await vi.advanceTimersByTimeAsync(1600);
  expect(phases.get(7)).toBe("stopped"); expect(retry).not.toHaveBeenCalled();
  // The next press starts again and waits again.
  list = [row({ id: "codex", signing_in: true })];
  await signin.start(7, "codex");
  expect(phases.get(7)).toBe("waiting");
  expect(rpc().filter(call => call.params.again)).toHaveLength(2);
  signin.dispose();
});

test("cancelling gives the button back at once and ends the console", async () => {
  const signin = make();
  await signin.start(7, "claude");
  await signin.cancel(7, "claude");
  expect(phases.has(7)).toBe(false);
  expect(rpc().slice(-1)[0]).toEqual({ method: "brains.cli_login", params: { id: "claude", cancel: true } });
  list = [row({ signing_in: false, login_result: "done" })];
  await vi.advanceTimersByTimeAsync(5000);
  expect(retry).not.toHaveBeenCalled();
  signin.dispose();
});

test("a start the core refuses is a stopped sign-in, never a stuck wait", async () => {
  invoke.mockRejectedValueOnce(new Error("Install the CLI before signing in"));
  const signin = make();
  await signin.start(7, "claude");
  expect(phases.get(7)).toBe("stopped");
  signin.dispose();
});

test("a window left open for ten minutes is ended and the button comes back", async () => {
  const signin = make();
  await signin.start(7, "claude");
  await vi.advanceTimersByTimeAsync(10 * 60_000 + 3000);
  expect(phases.has(7)).toBe(false);
  expect(rpc().slice(-1)[0]).toEqual({ method: "brains.cli_login", params: { id: "claude", cancel: true } });
  signin.dispose();
});

test("a second press while the window is open starts nothing more", async () => {
  const signin = make();
  await signin.start(7, "claude");
  await signin.start(7, "claude");
  expect(rpc().filter(call => call.params.again)).toHaveLength(1);
  signin.dispose();
});

test("the install guide of a missing CLI is the page Settings opens for it", async () => {
  const signin = make();
  await signin.install("codex");
  expect(invoke).toHaveBeenCalledWith("open_external_url", { url: "https://developers.openai.com/codex/cli/" });
  signin.dispose();
});
