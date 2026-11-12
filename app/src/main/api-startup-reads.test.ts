import { beforeEach, expect, test, vi } from "vitest";

const { invoke, handlers } = vi.hoisted(() => ({ invoke: vi.fn(), handlers: [] as Array<(event: { type: string }) => void> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class { constructor(handler: (event: { type: string }) => void) { handlers.push(handler); } } }));

type Api = typeof import("./api");
type Reads = typeof import("./startup-reads");
let api: Api;
let reads: Reads;

const asked = (method: string): number => invoke.mock.calls.filter(([, args]) => args?.method === method).length;

beforeEach(async () => {
  vi.resetModules();
  handlers.length = 0;
  invoke.mockReset();
  invoke.mockImplementation(async (_command: string, args?: { method?: string }) => args?.method === "members.list" ? { members: [], groups: [] } : {});
  api = await import("./api");
  reads = await import("./startup-reads");
});

test("while the window starts up, a roster answered a moment ago answers the same read again", async () => {
  reads.holdOptionalReads();
  await api.membersList("en");
  await api.membersList("en");
  await api.membersList("en");
  expect(asked("members.list")).toBe(1);
  await api.membersList("zh-TW");  // another language is another read
  expect(asked("members.list")).toBe(2);
});

test("a change made since, or an event heard since the read was asked, makes it a new read", async () => {
  reads.holdOptionalReads();
  await api.membersList();
  await api.core("members.update", { id: 1 });
  await api.membersList();
  expect(asked("members.list")).toBe(2);

  await api.subscribeMainEvents(() => {});
  const asking = api.membersList();
  handlers[0]!({ type: "MembersChanged" });
  await asking;
  await api.membersList();
  expect(asked("members.list")).toBe(3);

  // The microphone's loudness says nothing about the roster: the answer just read still stands.
  handlers[0]!({ type: "Level" });
  await api.membersList();
  expect(asked("members.list")).toBe(3);
});

test("once start-up is over every read goes to the core, as before", async () => {
  await api.membersList();
  await api.membersList();
  expect(asked("members.list")).toBe(2);
});

test("the allowances are asked of the core at every call, even while the window starts up, and one under way is joined", async () => {
  reads.holdOptionalReads();
  await api.usageAllowances();
  await api.usageAllowances();
  expect(asked("usage.allowances")).toBe(2);

  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = api.usageAllowances(), second = api.usageAllowances();
  expect(asked("usage.allowances")).toBe(3);
  finish({ brains: [] });
  await Promise.all([first, second]);
});
