import * as api from "./api";
import { CLIS } from "./cli-brains";
import { RERUNNABLE, type SigninPhase } from "./timeline";
import type { AgentTurn, CliBrainId } from "./types";

/** How often the CLI list is read while its sign-in window is open, and how long the window may stay open before the press is given back. */
const POLL_MS = 1500;
const GIVE_UP_MS = 10 * 60_000;

/**
 * What a finished sign-in sends again for the failed reply it was pressed under: the work of a task, a routine's run
 * included, is run again by the core (the reply's own Run again), because its question is the routine's title and no
 * one's words; any other reply asks its question again.
 */
export function signinRetry(turn: AgentTurn): { kind: "rerun"; task: number } | { kind: "ask" } {
  return turn.task && RERUNNABLE.has(turn.task.state) ? { kind: "rerun", task: turn.task.id } : { kind: "ask" };
}

export interface CliSigninHost {
  /** The phases the thread draws (`TimelineState.signin`). */
  phases: Map<number, SigninPhase>;
  redraw(): void;
  /** Sends the failed turn's question again, once, when its sign-in finished (the reply's own 重新產生). */
  retry(turnId: number): Promise<void>;
  /** Reads the CLI list; a seam for tests. */
  read?(): ReturnType<typeof api.brainsCli>;
}

/**
 * The button under a reply that failed for want of its subscription CLI's sign-in (timeline.ts `signinActionHTML`). It
 * starts the CLI's own sign-in the way Settings does (`brains.cli_login`, here with `again`, since a session that ran out
 * still has its credentials), waits for the console to end by reading the CLI list, and when the sign-in finished sends
 * the owner's question again. A closed window leaves the button; cancelling gives it back; nothing here sees a credential.
 */
export function createCliSignin(host: CliSigninHost) {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const read = host.read ?? (() => api.brainsCli());
  const stop = (turnId: number): void => {
    const timer = timers.get(turnId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(turnId);
  };
  const settle = (turnId: number, phase: SigninPhase | null): void => {
    stop(turnId);
    if (phase) host.phases.set(turnId, phase); else host.phases.delete(turnId);
    host.redraw();
  };

  async function follow(turnId: number, cli: CliBrainId, startedAt: number): Promise<void> {
    if (host.phases.get(turnId) !== "waiting") return;
    let row;
    try { row = (await read()).clis.find((item) => item.id === cli); } catch { row = undefined; }
    if (host.phases.get(turnId) !== "waiting") return;
    if (row && !row.signing_in) {
      if (row.login_result === "done") {
        settle(turnId, "done");
        try { await host.retry(turnId); } finally { settle(turnId, null); }
      } else settle(turnId, row.login_result === "stopped" ? "stopped" : null);
      return;
    }
    if (Date.now() - startedAt > GIVE_UP_MS) {
      void api.brainsCliLogin(cli, { cancel: true }).catch(() => undefined);
      settle(turnId, null);
      return;
    }
    timers.set(turnId, setTimeout(() => void follow(turnId, cli, startedAt), POLL_MS));
  }

  return {
    async start(turnId: number, cli: CliBrainId): Promise<void> {
      if (host.phases.get(turnId) === "waiting") return;
      settle(turnId, "waiting");
      try {
        await api.brainsCliLogin(cli, { again: true });
      } catch {
        settle(turnId, "stopped");
        return;
      }
      timers.set(turnId, setTimeout(() => void follow(turnId, cli, Date.now()), POLL_MS));
    },
    async cancel(turnId: number, cli: CliBrainId): Promise<void> {
      settle(turnId, null);
      await api.brainsCliLogin(cli, { cancel: true }).catch(() => undefined);
    },
    /** The install guide of a CLI that is not on this computer (the page Settings opens for it). */
    async install(cli: CliBrainId): Promise<void> {
      const known = CLIS.find((item) => item.id === cli);
      if (known) await api.openExternalUrl(known.install).catch(() => undefined);
    },
    dispose(): void { for (const turnId of [...timers.keys()]) stop(turnId); },
  };
}
