interface Waiter { resolve(value: unknown): void; reject(reason: unknown): void }
interface Reading { last: number; running: boolean; starting?: boolean; timer?: ReturnType<typeof setTimeout>; work: () => Promise<unknown>; waiting: Waiter[] }
const scopes = new WeakMap<object, Map<string, Reading>>();
const WINDOW_MS = 300;

function schedule(slot: Reading): void {
  if (slot.running || slot.starting || slot.timer !== undefined || !slot.waiting.length) return;
  const delay = Math.max(0, slot.last + WINDOW_MS - performance.now());
  if (delay) { slot.timer = setTimeout(() => { slot.timer = undefined; schedule(slot); }, delay); return; }
  slot.starting = true;
  queueMicrotask(() => {
    slot.starting = false;
    const waiting = slot.waiting.splice(0);
    slot.last = performance.now(); slot.running = true;
    let result: Promise<unknown>;
    try { result = slot.work(); } catch (error) { result = Promise.reject(error); }
    void Promise.resolve(result).then(value => waiting.forEach(waiter => waiter.resolve(value)), error => waiting.forEach(waiter => waiter.reject(error)))
      .finally(() => { slot.running = false; schedule(slot); });
  });
}

/** Event invalidations coalesce globally by read identity; in-flight invalidations retain a trailing read. */
export function eventRead<T>(key: string, read: () => Promise<T>, scope: object = globalThis): Promise<T> {
  let readings = scopes.get(scope);
  if (!readings) { readings = new Map(); scopes.set(scope,readings); }
  let slot = readings.get(key);
  if (!slot) { slot = {last:-Infinity, running:false, work:read, waiting:[]}; readings.set(key,slot); }
  if (performance.now() < slot.last) slot.last = -Infinity;
  slot.work = read;
  const result = new Promise<T>((resolve,reject) => slot!.waiting.push({resolve: value => resolve(value as T),reject}));
  schedule(slot);
  return result;
}
