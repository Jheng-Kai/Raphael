import { afterEach, expect, test, vi } from 'vitest';
import { eventRead } from './event-read';
afterEach(() => vi.useRealTimers());

test('event throttling follows elapsed time when the wall clock is held still', async () => {
  vi.useFakeTimers();
  const clock=vi.spyOn(Date,'now').mockReturnValue(1000), scope={};
  try {
    const read=vi.fn(async()=>read.mock.calls.length);
    expect(await eventRead('synthetic-clock',read,scope)).toBe(1);
    const trailing=eventRead('synthetic-clock',read,scope);
    await vi.advanceTimersByTimeAsync(300);
    expect(read).toHaveBeenCalledTimes(2);
    expect(await trailing).toBe(2);
  } finally { clock.mockRestore(); }
});

test('event readers share one read per 300ms and deliver the trailing state to every waiter', async () => {
  vi.useFakeTimers();
  let value = 0;
  const times: number[] = [];
  const read = vi.fn(async () => { times.push(Date.now()); return value; });
  expect(await eventRead('synthetic-roster', read)).toBe(0);
  const pending: Promise<number>[] = [];
  for (let index=1;index<=5;index++) { await vi.advanceTimersByTimeAsync(40); value=index; pending.push(eventRead('synthetic-roster', read)); }
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(await Promise.all(pending)).toEqual([5,5,5,5,5]);
  expect(times[1]!-times[0]!).toBe(300);
});

test('an invalidation during an in-flight read always gets a new trailing read', async () => {
  vi.useFakeTimers();
  let release!: (value:number) => void;
  const read = vi.fn(() => new Promise<number>(resolve => { release=resolve; }));
  const first=eventRead('synthetic-slow', read);
  await vi.advanceTimersByTimeAsync(50);
  const last=eventRead('synthetic-slow', read);
  release(1); expect(await first).toBe(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(read).toHaveBeenCalledTimes(2);
  release(2); expect(await last).toBe(2);
});
