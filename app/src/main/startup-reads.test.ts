import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Reads = typeof import("./startup-reads");
let reads: Reads;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  reads = await import("./startup-reads");
});
afterEach(() => vi.useRealTimers());

const settle = async (ms = 0): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };
function core(ms: number): Promise<string> { return new Promise(resolve => setTimeout(() => resolve("ok"), ms)); }

test("without a held window optional reads start at once", async () => {
  let started = 0;
  void reads.optionalRead(async () => { started++; });
  expect(started).toBe(1);
});

test("optional reads wait for the first view and for the core to go quiet, then run one at a time", async () => {
  const log: string[] = [];
  reads.holdOptionalReads();
  const first = core(1000);
  reads.trackCoreCall(first);
  const second = core(3000);
  reads.trackCoreCall(second);
  const optional = (name: string, ms: number) => reads.optionalRead(async () => { log.push(`${name} start`); await core(ms); log.push(`${name} end`); });
  const a = optional("models", 500), b = optional("clis", 100), c = optional("connectors", 300);
  reads.firstViewShown();
  await settle(2500);
  expect(log).toEqual([]);           // a first-view read is still under way
  await settle(500 + reads.QUIET_MS - 1);
  expect(log).toEqual([]);           // quiet, but not for long enough
  await settle(1);
  expect(log).toEqual(["models start"]);
  await settle(500);
  expect(log).toEqual(["models start", "models end", "clis start"]);
  await settle(100);
  await settle(300);
  await Promise.all([a, b, c]);
  expect(log).toEqual(["models start", "models end", "clis start", "clis end", "connectors start", "connectors end"]);
});

test("a first view that is not yet shown keeps the gate shut however quiet the core is", async () => {
  reads.holdOptionalReads();
  const first = core(10);
  reads.trackCoreCall(first);
  let started = false;
  void reads.optionalRead(async () => { started = true; });
  await settle(5000);
  expect(started).toBe(false);
  reads.firstViewShown();
  await settle(reads.QUIET_MS + 1);
  expect(started).toBe(true);
});

test("a core that never answers does not hold optional reads for ever", async () => {
  reads.holdOptionalReads();
  reads.trackCoreCall(new Promise(() => {}));
  let started = false;
  void reads.optionalRead(async () => { started = true; });
  reads.firstViewShown();
  await settle(reads.GIVE_UP_MS - 1);
  expect(started).toBe(false);
  await settle(1);
  expect(started).toBe(true);
});

test("a failing optional read does not stop the ones behind it", async () => {
  reads.holdOptionalReads();
  reads.trackCoreCall(core(10));
  const failed = reads.optionalRead(async () => { throw new Error("no"); });
  const after = reads.optionalRead(async () => "fine");
  failed.catch(() => {});
  reads.firstViewShown();
  await settle(500);
  await expect(after).resolves.toBe("fine");
});

test("a read after the gate opened and the line is empty starts without waiting", async () => {
  reads.holdOptionalReads();
  reads.trackCoreCall(core(10));
  reads.firstViewShown();
  await settle(500);
  expect(reads.optionalReadsOpen()).toBe(true);
  let started = false;
  void reads.optionalRead(async () => { started = true; });
  expect(started).toBe(true);
});
