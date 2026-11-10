/**
 * Start-up asks the core for the first view first and for everything optional after it (owner, 2026-11-11:
 * 「第一次開 app 的速度還是非常慢，就只有第一次而已」). The core answers on one event loop, so a catalog read that
 * arrived with the Home overview made the overview take 4 s instead of 0.3 s. Optional reads (the model and app
 * catalogs, the settings read-ahead) wait here until the first view is shown and the core has gone quiet, and then
 * run one at a time.
 */

/** No core call in flight for this long counts as the first view being answered. */
export const QUIET_MS = 200;
/** A core that never answers does not hold the optional reads for ever. */
export const GIVE_UP_MS = 60_000;

let gated = false;
let open = true;
let shown = false;
let answered = false;
let inFlight = 0;
let running = 0;
let quiet: ReturnType<typeof setTimeout> | undefined;
let giveUp: ReturnType<typeof setTimeout> | undefined;
let opening: (() => void) | null = null;
let gate: Promise<void> = Promise.resolve();
let tail: Promise<unknown> = Promise.resolve();

/** The window starts: optional reads wait from here on. Without it (tests, other pages) they run at once. */
export function holdOptionalReads(): void {
  gated = true; open = false; shown = false; answered = false; inFlight = 0;
  clearTimeout(quiet); clearTimeout(giveUp);
  gate = new Promise<void>(resolve => { opening = resolve; });
}

/** The first page has been asked for; the gate opens once the core has answered everything the window asked. */
export function firstViewShown(): void {
  if (!gated || open || shown) return;
  shown = true;
  giveUp = setTimeout(openGate, GIVE_UP_MS);
  arm();
}

/** Every call to the core before the gate opens is part of the first view. */
export function trackCoreCall(call: Promise<unknown>): void {
  if (!gated || open) return;
  inFlight++;
  const done = (ok: boolean): void => { inFlight--; answered ||= ok; arm(); };
  call.then(() => done(true), () => done(false));
}

function arm(): void {
  clearTimeout(quiet);
  if (open || !shown || !answered || inFlight > 0) return;
  quiet = setTimeout(openGate, QUIET_MS);
}

function openGate(): void {
  if (open) return;
  open = true;
  clearTimeout(quiet); clearTimeout(giveUp);
  opening?.();
}

/** Whether optional reads may start now. */
export const optionalReadsOpen = (): boolean => open;

/**
 * Runs an optional read after the first view, and after the optional reads asked for before it: one at a time.
 * Once the gate is open and nothing else is running, `read` starts at once.
 */
export function optionalRead<T>(read: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    running++;
    try { return await read(); } finally { running--; }
  };
  if (open && running === 0) return run();
  const result = tail.then(() => gate).then(run);
  tail = result.then(() => undefined, () => undefined);
  return result;
}
